import { eq, ne, sql as rawSql } from "drizzle-orm";
import { entries, messages } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import type { Profile } from "../shared.ts";
import { addDays, daysBetween } from "../shared.ts";
import { localDate } from "../time.ts";

// How engaged each person is (2026-10-29 engagement tracking), for the owner's Grafana dashboard: when they started, whether
// they activated, which weeks after that they came back, and what they did each week. Worked out from records the app
// keeps anyway (logged entries and the person's own coach messages), so there is no event log and nothing new is stored
// about anyone. Only actions the person took count: an Apple Health import is not them using the app.

export const ACTION_KINDS = ["meal", "workout", "coach"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Activation (the 2026-10-20 launch plan): food logged on this many days of the first week, and at least one coach chat. */
export const ACTIVATION_MEAL_DAYS = 3;
/** The weeks after the first whose retention is reported; week 0 is the week someone started. */
export const RETENTION_WEEKS = 12;
/** The calendar weeks the weekly counts reach back, this one included. */
export const ACTION_WEEKS = 8;

export interface Engagement {
  /** The local day of the person's first action; null when they have done nothing yet. */
  start: string | null;
  /** The Monday of the week they started. */
  cohort: string | null;
  activated: "yes" | "no" | "pending" | null;
  /** Whether they came back in week N after starting (days 7N to 7N+6), for each week that has ended. */
  retained: { week: number; active: boolean }[];
  /** Distinct days with an action in the last 7 and 28 days, today included. */
  activeDays: { d7: number; d28: number };
  /** Actions per calendar week (by its Monday), the last ACTION_WEEKS of them, zeros included. */
  weekly: { week: string; kind: ActionKind; count: number }[];
  channel: string;
  onboarded: boolean;
}

/** The Monday of `date`'s week. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** Every action the person took, on the local day they took it. */
export function actionsOf(sql: Sql, timeZone: string): { date: string; kind: ActionKind }[] {
  const logged = sql
    .select({
      created_at: entries.created_at,
      // Spelled out in full: drizzle writes a column inside a raw subquery without its table, and "id" would be the item's.
      food: rawSql<number>`exists (select 1 from food_items where food_items.entry_id = entries.id)`,
      exercise: rawSql<number>`exists (select 1 from exercise_items where exercise_items.entry_id = entries.id)`,
    })
    .from(entries)
    .where(ne(entries.source, "apple_health"))
    .all();
  const said = sql.select({ created_at: messages.created_at }).from(messages).where(eq(messages.role, "user")).all();
  const day = (iso: string) => localDate(new Date(iso), timeZone);
  const out: { date: string; kind: ActionKind }[] = [];
  for (const row of logged) {
    if (row.food) out.push({ date: day(row.created_at), kind: "meal" });
    if (row.exercise) out.push({ date: day(row.created_at), kind: "workout" });
  }
  for (const row of said) out.push({ date: day(row.created_at), kind: "coach" });
  return out;
}

export function engagementOf(actions: readonly { date: string; kind: ActionKind }[], profile: Profile | null, today: string): Engagement {
  const days = new Set(actions.map((a) => a.date));
  const start = actions.reduce<string | null>((first, a) => (first === null || a.date < first ? a.date : first), null);
  const within = (from: string, to: string) => [...days].filter((d) => d >= from && d <= to).length;

  let activated: Engagement["activated"] = null;
  const retained: Engagement["retained"] = [];
  if (start) {
    const firstWeek = actions.filter((a) => daysBetween(start, a.date) < 7);
    const mealDays = new Set(firstWeek.filter((a) => a.kind === "meal").map((a) => a.date)).size;
    const chatted = firstWeek.some((a) => a.kind === "coach");
    activated = mealDays >= ACTIVATION_MEAL_DAYS && chatted ? "yes" : daysBetween(start, today) >= 7 ? "no" : "pending";
    for (let week = 1; week <= RETENTION_WEEKS && daysBetween(start, today) > 7 * week + 6; week++) {
      retained.push({ week, active: within(addDays(start, 7 * week), addDays(start, 7 * week + 6)) > 0 });
    }
  }

  const thisWeek = mondayOf(today);
  const weekly: Engagement["weekly"] = [];
  for (let back = ACTION_WEEKS - 1; back >= 0; back--) {
    const week = addDays(thisWeek, -7 * back);
    const end = addDays(week, 6);
    for (const kind of ACTION_KINDS) {
      weekly.push({ week, kind, count: actions.filter((a) => a.kind === kind && a.date >= week && a.date <= end).length });
    }
  }

  return {
    start,
    cohort: start && mondayOf(start),
    activated,
    retained,
    activeDays: { d7: within(addDays(today, -6), today), d28: within(addDays(today, -27), today) },
    weekly,
    channel: profile?.about.heard_from ?? "unknown",
    onboarded: profile?.onboarding === "done",
  };
}
