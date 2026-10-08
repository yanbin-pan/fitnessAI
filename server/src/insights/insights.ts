import { desc } from "drizzle-orm";
import type { AiClient, AiUsage } from "../ai/client.ts";
import { AiError } from "../ai/client.ts";
import { callsOn, recordRun } from "../coach/usage.ts";
import { insights } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { INSIGHTS_MIN_DATA_DAYS, addDays } from "../shared.ts";
import type { InsightReport, InsightStats, InsightsView, Profile } from "../shared.ts";
import { todayIn } from "../time.ts";
import { insightPrompt, insightsInstructions, readReport, reportJsonSchema } from "./report.ts";
import { computeStats, loggedDays } from "./stats.ts";

// Weekly insights (2026-10-06 design §3): written once per local week, on its Monday or on the first day after that
// the person has fourteen days of data, and again within the week only if they change the app's language.

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

function isCurrent(stored: StoredInsight | null, week: string, profile: Profile): boolean {
  return stored !== null && stored.week_start === week && stored.language === profile.language;
}

export interface InsightDeps {
  sql: Sql;
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

  // The four weeks ending yesterday: a finished day, and on a Monday the week just ended.
  const stats = computeStats(sql, profile, addDays(today, -1), now.toISOString());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INSIGHTS_BUDGET_MS);
  let usage: AiUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let model: string | null = null;
  let outcome: InsightOutcome = "failed";
  try {
    const response = await ai.structured(
      { system: insightsInstructions(profile.companion), prompt: insightPrompt(profile, stats, today), schema: reportJsonSchema() },
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
    return { ...base, status: "ready", insight: { week_start: stored.week_start, generated_at: stored.generated_at, stats: stored.stats, report: stored.report } };
  }
  if (!ai) {
    // The coach is off: the numbers alone, worked out now.
    const stats = computeStats(sql, profile, addDays(today, -1), now.toISOString());
    return { ...base, status: "off", insight: { week_start: week, generated_at: now.toISOString(), stats, report: null } };
  }
  start(deps);
  // Last week's analysis stays on screen while this week's is written.
  const previous = stored ? { week_start: stored.week_start, generated_at: stored.generated_at, stats: stored.stats, report: stored.report } : null;
  return { ...base, status: "pending", insight: previous };
}
