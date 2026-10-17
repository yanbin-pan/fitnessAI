import type { Sex } from "./vocab.ts";

// Fat and sugar of a day (2026-10-17 fat & sugar design): its fat split into unsaturated and saturated, and its free
// sugars, in grams against the UK daily maxima. Shown in the nutrients card, so the macro bars stay as they are.

/** NHS daily maxima: saturated fat by sex, and free sugars for anyone 11 or older. */
export const SATURATED_FAT_MAX_G: Record<Sex, number> = { male: 30, female: 20 };
export const ADDED_SUGARS_MAX_G = 30;

/** What a food item needs for this. `added_sugars_g` is null when nobody estimated it (logged before 2026-10-17). */
export interface FatSugarLike {
  fat_g: number;
  saturated_fat_g: number;
  sugars_g: number;
  added_sugars_g?: number | null;
}

export interface FatSugarDay {
  fat_g: number;
  saturated_fat_g: number;
  /** Fat that is not saturated: mono- and polyunsaturated, the little trans fat left in food aside. */
  unsaturated_fat_g: number;
  sugars_g: number;
  /** Free sugars of the items with an estimate; null when none has one, so an old day shows nothing rather than 0. */
  added_sugars_g: number | null;
  /** Items without an estimate, when some have one. */
  unestimated: number;
}

export function fatSugarDay(foods: readonly FatSugarLike[]): FatSugarDay {
  let fat = 0;
  let saturated = 0;
  let sugars = 0;
  let added: number | null = null;
  let unestimated = 0;
  for (const food of foods) {
    fat += food.fat_g;
    saturated += food.saturated_fat_g;
    sugars += food.sugars_g;
    if (food.added_sugars_g === null || food.added_sugars_g === undefined) unestimated += 1;
    else added = (added ?? 0) + food.added_sugars_g;
  }
  // A saturated estimate above the fat leaves no unsaturated fat rather than a negative amount.
  return {
    fat_g: fat,
    saturated_fat_g: saturated,
    unsaturated_fat_g: Math.max(0, fat - saturated),
    sugars_g: sugars,
    added_sugars_g: added,
    unestimated: added === null ? 0 : unestimated,
  };
}
