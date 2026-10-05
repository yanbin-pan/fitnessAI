import { eq } from "drizzle-orm";
import { days } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { getEntry, listEntries } from "../log/entries.ts";
import { listMessages } from "../messages/messages.ts";
import { addDays, daysBetween } from "../shared.ts";
import type { DaySummary, DayView, Entry, MacroTargets, Profile, Totals } from "../shared.ts";
import { adjustTargets, baselineTargets } from "../targets/targets.ts";
import type { WorkoutSummary } from "../targets/targets.ts";

export type DaySnapshot = typeof days.$inferSelect;

/** The targets a day would freeze today. Milestone 2 swaps the weight for the 7-day weigh-in average (spec §7.4). */
export function snapshotValues(profile: Profile, date: string, nowIso: string): DaySnapshot {
  const weight = profile.weight_kg;
  const base = baselineTargets(profile, weight, date);
  return {
    date,
    base_kcal: base.kcal,
    base_protein_g: base.protein_g,
    base_carbs_g: base.carbs_g,
    base_fat_g: base.fat_g,
    base_fibre_g: base.fibre_g,
    add_back_pct: profile.add_back_pct,
    weight_kg_used: weight,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export function getDay(sql: Sql, date: string): DaySnapshot | null {
  return sql.select().from(days).where(eq(days.date, date)).get() ?? null;
}

/** Creates the day's snapshot the first time anything touches it; never overwrites (spec §7.5). */
export function ensureDay(sql: Sql, profile: Profile, date: string, nowIso: string): DaySnapshot {
  const existing = getDay(sql, date);
  if (existing) return existing;
  const row = snapshotValues(profile, date, nowIso);
  sql.insert(days).values(row).run();
  return row;
}

/** Re-snapshots a day from the current profile. Only ever used for today. */
export function refreshDay(sql: Sql, profile: Profile, date: string, nowIso: string): void {
  const row = snapshotValues(profile, date, nowIso);
  sql
    .insert(days)
    .values(row)
    .onConflictDoUpdate({
      target: days.date,
      set: {
        base_kcal: row.base_kcal,
        base_protein_g: row.base_protein_g,
        base_carbs_g: row.base_carbs_g,
        base_fat_g: row.base_fat_g,
        base_fibre_g: row.base_fibre_g,
        add_back_pct: row.add_back_pct,
        weight_kg_used: row.weight_kg_used,
        updated_at: nowIso,
      },
    })
    .run();
}

function baseOf(day: DaySnapshot): MacroTargets {
  return { kcal: day.base_kcal, protein_g: day.base_protein_g, carbs_g: day.base_carbs_g, fat_g: day.base_fat_g, fibre_g: day.base_fibre_g };
}

const TOTAL_KEYS = [
  "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g",
  "saturated_fat_g", "sugars_g", "salt_g", "fluid_ml", "alcohol_units",
] as const satisfies readonly (keyof Totals)[];

export function sumTotals(list: Entry[]): Totals {
  const totals: Totals = {
    kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0,
    saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0,
  };
  for (const entry of list) for (const food of entry.foods) for (const key of TOTAL_KEYS) totals[key] += food[key];
  return totals;
}

export function summarizeWorkouts(list: Entry[]): WorkoutSummary {
  let workoutKcal = 0;
  let strengthDay = false;
  for (const entry of list) {
    for (const item of entry.exercises) {
      workoutKcal += item.kcal;
      if (item.category === "strength") strengthDay = true;
    }
  }
  return { workoutKcal, strengthDay };
}

/** Everything the Today screen shows for one date. Reads only. */
export function buildDayView(sql: Sql, profile: Profile, date: string, today: string, nowIso: string): DayView {
  const snapshot = getDay(sql, date) ?? snapshotValues(profile, date, nowIso);
  const list = listEntries(sql, date);
  const messages = listMessages(sql, date);
  // A reply can record something for another day ("yesterday I had..."). Its card still belongs to
  // this day's conversation, so the entry travels with it, but it never counts towards this day.
  const onThisDay = new Set(list.map((e) => e.id));
  const linkedIds = [...new Set(messages.flatMap((m) => m.cards.filter((c) => c.type === "entry" && !onThisDay.has(c.id)).map((c) => c.id)))];
  const linked = linkedIds.map((id) => getEntry(sql, id)).filter((e): e is Entry => e !== null);
  const t = adjustTargets(baseOf(snapshot), snapshot.add_back_pct, snapshot.weight_kg_used, summarizeWorkouts(list));
  return {
    date,
    today,
    targets: { base: t.base, adjusted: t.adjusted, add_back_kcal: t.addBackKcal, workout_kcal: t.workoutKcal },
    totals: sumTotals(list),
    entries: list,
    linked_entries: linked,
    messages,
  };
}

/** The calendar's days (spec §12): each day in [from, to] with food logged, its eaten kcal and its adjusted target. */
export function daySummaries(sql: Sql, profile: Profile, from: string, to: string, nowIso: string): DaySummary[] {
  const out: DaySummary[] = [];
  // Counted, not compared: stepping past 9999-12-31 gives "+010000-01", which is no date and sorts below it.
  const count = daysBetween(from, to) + 1;
  for (let i = 0; i < count; i++) {
    const date = addDays(from, i);
    const list = listEntries(sql, date);
    if (!list.some((entry) => entry.foods.length > 0)) continue;
    const snapshot = getDay(sql, date) ?? snapshotValues(profile, date, nowIso);
    const t = adjustTargets(baseOf(snapshot), snapshot.add_back_pct, snapshot.weight_kg_used, summarizeWorkouts(list));
    out.push({ date, kcal: sumTotals(list).kcal, target_kcal: t.adjusted.kcal });
  }
  return out;
}
