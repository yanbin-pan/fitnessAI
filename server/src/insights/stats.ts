import { countDistinct, isNull } from "drizzle-orm";
import { adjustedTargets } from "../days/days.ts";
import { entries } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { signalDays } from "../days/signals.ts";
import { listEntriesBetween } from "../log/entries.ts";
import { INSIGHTS_WINDOW_DAYS, addDays, daysBetween, nutrientSignals } from "../shared.ts";
import type { Activity, Entry, FoodGroup, InsightStats, Muscle, NutrientStat, Profile } from "../shared.ts";

// The numbers behind the weekly insights (2026-10-06 design §3.2). Worked out here, exactly, so the analysis is written
// from facts: the model interprets them, it never adds them up.

/** Upper limits with no personal target: UK reference intakes (saturated fat by sex), and drinks a day by sex (EFSA). */
const SATURATED_FAT_MAX_G = { male: 30, female: 20 } as const;
const SUGARS_REFERENCE_G = 90;
const SALT_MAX_G = 6;
const DRINKS_ML = { male: 2000, female: 1600 } as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Days with anything logged, ever: what decides when insights start (2026-10-06 design §3.1). */
export function loggedDays(sql: Sql): number {
  const row = sql.select({ days: countDistinct(entries.date) }).from(entries).where(isNull(entries.deleted_at)).get();
  return row?.days ?? 0;
}

function stat(total: number, days: number, target: number | null): NutrientStat {
  return { average: days > 0 ? round1(total / days) : 0, target: target === null ? null : round1(target) };
}

/** The longest run of consecutive dates in a sorted list. */
function longestRun(dates: string[]): number {
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of dates) {
    run = previous !== null && daysBetween(previous, date) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

/** The four weeks ending on `periodEnd` (yesterday, when a report is written: a finished day). */
export function computeStats(sql: Sql, profile: Profile, periodEnd: string, nowIso: string): InsightStats {
  const periodStart = addDays(periodEnd, 1 - INSIGHTS_WINDOW_DAYS);
  const weeks = INSIGHTS_WINDOW_DAYS / 7;
  const list = listEntriesBetween(sql, periodStart, periodEnd).map((row) => row.entry);
  const byDate = new Map<string, Entry[]>();
  for (const entry of list) byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  const foodDays = [...byDate].filter(([, dayList]) => dayList.some((e) => e.foods.length > 0));

  // Nutrition: daily averages over the days with food logged, against that day's own adjusted targets.
  const sum = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0 };
  const targets = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
  const groups = new Map<FoodGroup, number>();
  for (const [date, dayList] of foodDays) {
    for (const entry of dayList) {
      for (const food of entry.foods) {
        for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += food[key];
        for (const g of food.groups) groups.set(g.group, (groups.get(g.group) ?? 0) + g.portions);
      }
    }
    const t = adjustedTargets(sql, profile, date, dayList, nowIso);
    for (const key of Object.keys(targets) as (keyof typeof targets)[]) targets[key] += t[key];
  }
  const n = foodDays.length;
  const avgTarget = (key: keyof typeof targets) => (n > 0 ? targets[key] / n : null);

  // Training: weekly figures over the whole four weeks, rest days included.
  const exercises = list.flatMap((entry) => entry.exercises.map((item) => ({ entry, item })));
  const sessions = new Set(exercises.map(({ entry }) => entry.id)).size;
  const activities = new Map<Activity, { entries: Set<string>; minutes: number }>();
  const sets = new Map<Muscle, number>();
  for (const { entry, item } of exercises) {
    const a = activities.get(item.activity) ?? { entries: new Set<string>(), minutes: 0 };
    a.entries.add(entry.id);
    a.minutes += item.duration_min ?? 0;
    activities.set(item.activity, a);
    if (item.sets !== null) {
      for (const m of item.muscles) sets.set(m.muscle, (sets.get(m.muscle) ?? 0) + item.sets * (m.role === "primary" ? 1 : 0.5));
    }
  }
  const trainingDates = [...new Set(exercises.map(({ entry }) => entry.date))].sort();
  const lastWeekStart = addDays(periodEnd, -6);
  const kcalTotal = exercises.reduce((total, { item }) => total + item.kcal, 0);
  const kcalLastWeek = exercises.filter(({ entry }) => entry.date >= lastWeekStart).reduce((total, { item }) => total + item.kcal, 0);

  return {
    period_start: periodStart,
    period_end: periodEnd,
    days_logged: byDate.size,
    food_days: n,
    nutrients: {
      kcal: stat(sum.kcal, n, avgTarget("kcal")),
      protein_g: stat(sum.protein_g, n, avgTarget("protein_g")),
      carbs_g: stat(sum.carbs_g, n, avgTarget("carbs_g")),
      fat_g: stat(sum.fat_g, n, avgTarget("fat_g")),
      fibre_g: stat(sum.fibre_g, n, avgTarget("fibre_g")),
      saturated_fat_g: stat(sum.saturated_fat_g, n, SATURATED_FAT_MAX_G[profile.sex]),
      sugars_g: stat(sum.sugars_g, n, SUGARS_REFERENCE_G),
      salt_g: stat(sum.salt_g, n, SALT_MAX_G),
      fluid_ml: stat(sum.fluid_ml, n, DRINKS_ML[profile.sex]),
    },
    protein_g_per_kg: n > 0 ? round1(sum.protein_g / n / profile.weight_kg) : 0,
    alcohol_units_per_week: n > 0 ? round1((sum.alcohol_units / n) * 7) : 0,
    food_groups: Object.fromEntries([...groups].map(([group, portions]) => [group, round1(portions / Math.max(n, 1))])),
    training: {
      sessions_per_week: round1(sessions / weeks),
      minutes_per_week: Math.round(exercises.reduce((total, { item }) => total + (item.duration_min ?? 0), 0) / weeks),
      active_kcal_per_week: Math.round(kcalTotal / weeks),
      by_activity: [...activities]
        .map(([activity, a]) => ({ activity, sessions: a.entries.size, minutes: Math.round(a.minutes) }))
        .sort((x, y) => y.sessions - x.sessions || y.minutes - x.minutes),
      sets_per_muscle: Object.fromEntries([...sets].map(([muscle, total]) => [muscle, round1(total / weeks)])),
      training_days_last_7: trainingDates.filter((date) => date >= lastWeekStart).length,
      longest_streak: longestRun(trainingDates),
      load_ratio: kcalTotal > 0 ? Math.round((kcalLastWeek / (kcalTotal / weeks)) * 100) / 100 : null,
    },
    signals: nutrientSignals(signalDays(list), profile.sex),
  };
}
