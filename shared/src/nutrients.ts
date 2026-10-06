import type { Micro, Sex } from "./vocab.ts";
import { MICROS } from "./vocab.ts";

// Nutrient signals (2026-10-06 nutrients design): a calm word for each nutrient over several days, never a number
// against a target. Vitamin and mineral amounts are the coach's estimates, so only clear tendencies are worth showing.

/** Daily reference intakes for adults (EU NRVs; iron and zinc by sex, after the UK RNIs). */
export const MICRO_REFERENCE: Record<Micro, Record<Sex, number>> = {
  vitamin_a_ug: { male: 800, female: 800 },
  vitamin_c_mg: { male: 80, female: 80 },
  vitamin_d_ug: { male: 10, female: 10 },
  vitamin_e_mg: { male: 12, female: 12 },
  vitamin_b12_ug: { male: 2.5, female: 2.5 },
  folate_ug: { male: 200, female: 200 },
  calcium_mg: { male: 800, female: 800 },
  iron_mg: { male: 8.7, female: 14.8 },
  magnesium_mg: { male: 375, female: 375 },
  potassium_mg: { male: 3500, female: 3500 },
  zinc_mg: { male: 9.5, female: 7 },
};

/** Fats, sugar and salt first, then the vitamins and minerals. */
export const SIGNAL_KEYS = ["unsaturated_fat", "saturated_fat", "sugars", "salt", ...MICROS] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

/** Nutrients to keep moderate: for these, "low" is good news. The rest are nutrients to get enough of. */
export const MODERATE: readonly SignalKey[] = ["saturated_fat", "sugars", "salt"];

export type NutrientLevel = "low" | "ok" | "high";

/** One day's food, as the signals need it. */
export interface SignalDay {
  kcal: number;
  fat_g: number;
  saturated_fat_g: number;
  sugars_g: number;
  salt_g: number;
  /** Summed over the foods that carry an estimate. */
  micros: Partial<Record<Micro, number>>;
  /** The kcal of the foods that carry an estimate: how much of the day the estimates cover. */
  micros_kcal: number;
}

export interface NutrientSignals {
  /** Days with food in the window. */
  days: number;
  /** A nutrient left out has too little to go on. */
  levels: Partial<Record<SignalKey, NutrientLevel>>;
}

/** Fewer days than this, and nothing is judged. */
export const SIGNAL_MIN_DAYS = 2;
/** Vitamins and minerals are judged only when foods with an estimate make up this much of what was eaten. */
export const MICRO_MIN_COVERAGE = 0.6;

const band = (ratio: number, low: number, high: number): NutrientLevel => (ratio < low ? "low" : ratio <= high ? "ok" : "high");

/** The signals for some days of food (2026-10-06 nutrients design §2). */
export function nutrientSignals(days: SignalDay[], sex: Sex): NutrientSignals {
  const eaten = days.filter((day) => day.kcal > 0);
  const n = eaten.length;
  if (n < SIGNAL_MIN_DAYS) return { days: n, levels: {} };
  const sum = (pick: (day: SignalDay) => number) => eaten.reduce((total, day) => total + pick(day), 0);
  const kcal = sum((d) => d.kcal);
  const fat = sum((d) => d.fat_g);
  const saturated = sum((d) => d.saturated_fat_g);
  const levels: NutrientSignals["levels"] = {};

  // Most of the fat unsaturated is the aim; saturated fat around a tenth of energy or less.
  if (fat > 0) levels.unsaturated_fat = band((fat - saturated) / fat, 0.55, 0.8);
  levels.saturated_fat = band((saturated * 9) / kcal, 0.06, 0.11);
  // Total sugars against 90 g per 2000 kcal; salt against 6 g a day.
  levels.sugars = band(sum((d) => d.sugars_g) / ((90 * kcal) / 2000), 0.5, 1.1);
  levels.salt = band(sum((d) => d.salt_g) / n / 6, 0.5, 1.05);

  // Estimates that cover only part of what was eaten are scaled up to the whole; too little cover, and none are judged.
  const coverage = sum((d) => d.micros_kcal) / kcal;
  if (coverage >= MICRO_MIN_COVERAGE) {
    for (const micro of MICROS) {
      const daily = sum((d) => d.micros[micro] ?? 0) / n / coverage;
      levels[micro] = band(daily / MICRO_REFERENCE[micro][sex], 0.66, 1.5);
    }
  }
  return { days: n, levels };
}
