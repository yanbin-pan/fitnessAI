import { desc, eq } from "drizzle-orm";
import type { AiClient, AiUsage } from "../ai/client.ts";
import { AiError } from "../ai/client.ts";
import { callsOn, recordRun } from "../coach/usage.ts";
import { insights } from "../db/schema.ts";
import { healthContext } from "../health/records.ts";
import type { Sql } from "../db/types.ts";
import { INSIGHTS_MIN_DATA_DAYS, INSIGHTS_TREND_WEEKS, INSIGHTS_WINDOW_DAYS, addDays, daysBetween } from "../shared.ts";
import type { FindingSeverity, InsightPayload, InsightReport, InsightStats, InsightsHistory, InsightsView, Profile, WeekPoint } from "../shared.ts";
import { todayIn } from "../time.ts";
import { insightPrompt, insightsInstructions, readReport, reportJsonSchema } from "./report.ts";
import { computeStats, loggedDays, weekPoint, weeklySeries } from "./stats.ts";

// Weekly insights (2026-10-06 design §3): written once per local week, on its Monday or on the first day after that
// the person has seven days of data, and again within the week only if they change the app's language.

/** Time one analysis may take: well beyond a chat reply, since nobody is waiting on it. */
export const INSIGHTS_BUDGET_MS = 240_000;

/** The Monday that starts `date`'s week. */
export function weekStartOf(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return addDays(date, -weekday);
}

interface StoredInsight {
  week_start: string;
  generated_at: string;
  language: string;
  stats: InsightStats;
  report: InsightReport;
}

export function latestInsight(sql: Sql): StoredInsight | null {
  const row = sql.select().from(insights).orderBy(desc(insights.week_start)).limit(1).get();
  return row ? { ...row, stats: row.stats as InsightStats, report: row.report as InsightReport } : null;
}

/** The stored report for the week starting `week`, or null. */
export function insightFor(sql: Sql, week: string): StoredInsight | null {
  const row = sql.select().from(insights).where(eq(insights.week_start, week)).get();
  return row ? { ...row, stats: row.stats as InsightStats, report: row.report as InsightReport } : null;
}

/** The 7 days before a one-week period, to compare with; null for the four-week reports written before 2026-11-01. */
export function previousWeek(sql: Sql, profile: Profile, stats: InsightStats, nowIso: string): WeekPoint | null {
  if (daysBetween(stats.period_start, stats.period_end) !== INSIGHTS_WINDOW_DAYS - 1) return null;
  const before = computeStats(sql, profile, addDays(stats.period_start, -1), nowIso, { load: false });
  return before.days_logged > 0 ? weekPoint(before) : null;
}

function payload(sql: Sql, profile: Profile, stored: StoredInsight, nowIso: string): InsightPayload {
  return { week_start: stored.week_start, generated_at: stored.generated_at, stats: stored.stats, report: stored.report, previous: previousWeek(sql, profile, stored.stats, nowIso) };
}

/** A stored report as the tab shows it, or null when there is none for that week. */
export function insightPayload(sql: Sql, profile: Profile, week: string, now: Date): InsightPayload | null {
  const stored = insightFor(sql, week);
  return stored ? payload(sql, profile, stored, now.toISOString()) : null;
}

function tally(report: InsightReport): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { good: 0, watch: 0, act: 0 };
  for (const finding of [...report.nutrition.findings, ...report.training.findings]) counts[finding.severity]++;
  return counts;
}

/** Every stored report, newest first, and each finished week's averages (2026-11-01 insights history design). */
export function insightsHistory(sql: Sql, profile: Profile, now: Date): InsightsHistory {
  const rows = sql.select().from(insights).orderBy(desc(insights.week_start)).all();
  const reports = rows.map((row) => {
    const stats = row.stats as InsightStats;
    const report = row.report as InsightReport;
    return { week_start: row.week_start, period_start: stats.period_start, period_end: stats.period_end, headline: report.headline, tally: tally(report) };
  });
  return { reports, weeks: weeklySeries(sql, profile, todayIn(profile.timezone, now), now.toISOString(), INSIGHTS_TREND_WEEKS) };
}

function isCurrent(stored: StoredInsight | null, week: string, profile: Profile): boolean {
  return stored !== null && stored.week_start === week && stored.language === profile.language;
}

export interface InsightDeps {
  sql: Sql;
  /** The person's health.db (2026-10-19 health tab design §6); without it the analysis sees no health records. */
  health?: Sql;
  profile: Profile;
  ai: AiClient | null;
  now: Date;
  /** Model calls this person may start per local day (2.2 §6): the analysis counts against it like a coach message. */
  dailyCallCap: number;
}

export type InsightOutcome = "collecting" | "current" | "off" | "capped" | "written" | "failed";

/** One analysis in flight per database: a second request or the job finds it and waits on the same one. */
const inFlight = new WeakMap<Sql, Promise<InsightOutcome>>();

/** Writes this week's analysis if it is due and missing. Never throws: a failure is retried on the next run. */
export function ensureWeeklyInsight(deps: InsightDeps): Promise<InsightOutcome> {
  const running = inFlight.get(deps.sql);
  if (running) return running;
  const run = write(deps).finally(() => inFlight.delete(deps.sql));
  inFlight.set(deps.sql, run);
  return run;
}

export function insightRunning(sql: Sql): boolean {
  return inFlight.has(sql);
}

async function write(deps: InsightDeps): Promise<InsightOutcome> {
  const { sql, profile, ai, now } = deps;
  const today = todayIn(profile.timezone, now);
  const week = weekStartOf(today);
  if (loggedDays(sql) < INSIGHTS_MIN_DATA_DAYS) return "collecting";
  if (isCurrent(latestInsight(sql), week, profile)) return "current";
  if (!ai) return "off";
  // Checked before the call, as for the coach (2.2 §6): the next hourly run tries again once the cap resets.
  if (callsOn(sql, today) >= deps.dailyCallCap) return "capped";

  // The week ending yesterday: a finished day, and on a Monday the Monday-to-Sunday week just ended.
  const stats = computeStats(sql, profile, addDays(today, -1), now.toISOString());
  const previous = previousWeek(sql, profile, stats, now.toISOString());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INSIGHTS_BUDGET_MS);
  let usage: AiUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let model: string | null = null;
  let outcome: InsightOutcome = "failed";
  try {
    const response = await ai.structured(
      { system: insightsInstructions(profile.companion), prompt: insightPrompt(profile, stats, today, deps.health ? healthContext(deps.health) : null, previous), schema: reportJsonSchema() },
      controller.signal,
    );
    usage = response.usage;
    model = response.model;
    const read = readReport(response);
    if (read.ok) {
      const row = { week_start: week, generated_at: now.toISOString(), language: profile.language, model, stats, report: read.report };
      sql
        .insert(insights)
        .values(row)
        .onConflictDoUpdate({ target: insights.week_start, set: { generated_at: row.generated_at, language: row.language, model, stats, report: read.report } })
        .run();
      outcome = "written";
    }
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
  } finally {
    clearTimeout(timer);
    // Every call that reached Claude counts, a failed one too, so retrying can't run up the bill (2.2 §6).
    recordRun(sql, { messageId: `insights:${week}`, date: today, model, calls: 1, usage, nowIso: now.toISOString() });
  }
  return outcome;
}

/** What the Insights tab shows (2026-10-06 design §3.4), starting this week's analysis when it is due. */
export function insightsView(deps: InsightDeps, start: (deps: InsightDeps) => void): InsightsView {
  const { sql, profile, ai, now } = deps;
  const today = todayIn(profile.timezone, now);
  const week = weekStartOf(today);
  const dataDays = loggedDays(sql);
  const base = { data_days: dataDays, required_days: INSIGHTS_MIN_DATA_DAYS, next_update: addDays(week, 7) };
  if (dataDays < INSIGHTS_MIN_DATA_DAYS) return { ...base, status: "collecting", insight: null };
  const stored = latestInsight(sql);
  if (stored && isCurrent(stored, week, profile)) {
    return { ...base, status: "ready", insight: payload(sql, profile, stored, now.toISOString()) };
  }
  if (!ai) {
    // The coach is off: the numbers alone, worked out now.
    const stats = computeStats(sql, profile, addDays(today, -1), now.toISOString());
    return { ...base, status: "off", insight: { week_start: week, generated_at: now.toISOString(), stats, report: null, previous: previousWeek(sql, profile, stats, now.toISOString()) } };
  }
  start(deps);
  // Last week's analysis stays on screen while this week's is written.
  return { ...base, status: "pending", insight: stored ? payload(sql, profile, stored, now.toISOString()) : null };
}
