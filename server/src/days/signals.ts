import type { Sql } from "../db/types.ts";
import { listEntriesBetween } from "../log/entries.ts";
import { addDays, nutrientSignals } from "../shared.ts";
import type { Entry, Micro, NutrientSignals, Profile, SignalDay } from "../shared.ts";

// Nutrient signals (2026-10-06 nutrients design): fats, sugar, salt, vitamins and minerals as words, over several days.

/** A day per date with food, summed the way the signals read it. */
export function signalDays(list: Entry[]): SignalDay[] {
  const days = new Map<string, SignalDay>();
  for (const entry of list) {
    for (const food of entry.foods) {
      const day = days.get(entry.date) ?? { kcal: 0, fat_g: 0, saturated_fat_g: 0, sugars_g: 0, salt_g: 0, micros: {}, micros_kcal: 0 };
      day.kcal += food.kcal;
      day.fat_g += food.fat_g;
      day.saturated_fat_g += food.saturated_fat_g;
      day.sugars_g += food.sugars_g;
      day.salt_g += food.salt_g;
      if (food.micros !== null) {
        day.micros_kcal += food.kcal;
        for (const m of food.micros) day.micros[m.nutrient as Micro] = (day.micros[m.nutrient as Micro] ?? 0) + m.amount;
      }
      days.set(entry.date, day);
    }
  }
  return [...days.values()];
}

/**
 * The signals shown under a day's macros: the last 7 complete days. Viewing today, that is the 7 before it, so the
 * words don't drop to "low" every morning; viewing an earlier day, the 7 ending on it.
 */
export function signalsFor(sql: Sql, profile: Profile, date: string, today: string): NutrientSignals {
  const end = date === today ? addDays(date, -1) : date;
  const list = listEntriesBetween(sql, addDays(end, -6), end).map((row) => row.entry);
  return nutrientSignals(signalDays(list), profile.sex);
}
