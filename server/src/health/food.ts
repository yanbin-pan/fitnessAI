import type { Sql } from "../db/types.ts";
import { listEntriesBetween } from "../log/entries.ts";
import { MARKER_NUTRIENT, addDays } from "../shared.ts";
import type { FoodItem, MarkerFoodView, MarkerNutrient, MarkerTrend } from "../shared.ts";

// A marker beside the nutrient it relates to in the food log (2026-10-19 health tab design §5): the monthly averages over
// the days with food logged, and the foods behind most of it lately. Side by side only, never a claim of cause.

/** At least this many months are shown, so a single result still has food to stand beside. */
const MIN_MONTHS = 6;
const MAX_MONTHS = 24;
const SOURCE_DAYS = 90;
const SOURCES = 3;
/** A food under this share of the total is not worth naming. */
const MIN_SHARE = 0.05;

const UNITS: Record<MarkerNutrient, "g" | "mg" | "ug"> = {
  saturated_fat_g: "g", added_sugars_g: "g", iron_mg: "mg", vitamin_d_ug: "ug", vitamin_b12_ug: "ug", folate_ug: "ug",
};

/** An item's amount of the nutrient, or null when nobody estimated it (added sugar before 2026-10-17, micros by hand). */
function amountIn(food: FoodItem, nutrient: MarkerNutrient): number | null {
  if (nutrient === "saturated_fat_g") return food.saturated_fat_g;
  if (nutrient === "added_sugars_g") return food.added_sugars_g;
  if (!food.micros) return null;
  return food.micros.find((m) => m.nutrient === nutrient)?.amount ?? 0;
}

const monthOf = (date: string) => date.slice(0, 7);

function firstOfMonthsBefore(today: string, months: number): string {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const index = year * 12 + (month - 1) - (months - 1);
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export function markerFood(sql: Sql, trend: MarkerTrend, today: string): MarkerFoodView {
  const nutrient = MARKER_NUTRIENT[trend.code];
  if (!nutrient) return { trend, nutrient: null };
  const firstPoint = trend.points[0]?.taken_on ?? today;
  const earliest = firstOfMonthsBefore(today, MAX_MONTHS);
  const from = [firstOfMonthsBefore(today, MIN_MONTHS), `${monthOf(firstPoint)}-01`].sort()[0]!;
  const start = from < earliest ? earliest : from;

  const perDay = new Map<string, number>();
  const sources = new Map<string, { name: string; amount: number }>();
  const sourceFrom = addDays(today, 1 - SOURCE_DAYS);
  for (const { entry } of listEntriesBetween(sql, start, today)) {
    for (const food of entry.foods) {
      const amount = amountIn(food, nutrient);
      if (amount === null) continue;
      perDay.set(entry.date, (perDay.get(entry.date) ?? 0) + amount);
      if (entry.date >= sourceFrom && amount > 0) {
        const key = food.name.trim().toLowerCase();
        const source = sources.get(key) ?? { name: food.name.trim(), amount: 0 };
        source.amount += amount;
        sources.set(key, source);
      }
    }
  }
  const months = new Map<string, { total: number; days: number }>();
  for (const [date, total] of perDay) {
    const month = months.get(monthOf(date)) ?? { total: 0, days: 0 };
    month.total += total;
    month.days += 1;
    months.set(monthOf(date), month);
  }
  const total = [...sources.values()].reduce((sum, s) => sum + s.amount, 0);
  return {
    trend,
    nutrient: {
      key: nutrient,
      unit: UNITS[nutrient],
      months: [...months.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, m]) => ({ month, average: Math.round((m.total / m.days) * 10) / 10, days: m.days })),
      sources: total > 0
        ? [...sources.values()]
            .map((s) => ({ name: s.name, share: Math.round((s.amount / total) * 100) / 100 }))
            .filter((s) => s.share >= MIN_SHARE)
            .sort((a, b) => b.share - a.share)
            .slice(0, SOURCES)
        : [],
    },
  };
}
