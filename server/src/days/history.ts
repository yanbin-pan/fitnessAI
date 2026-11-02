import type { Sql } from "../db/types.ts";
import { listEntries, listEntriesBetween } from "../log/entries.ts";
import { addDays } from "../shared.ts";
import type { Activity, Entry, FoodItem } from "../shared.ts";
import { weekdayName } from "../time.ts";

// What the coach knows of the days before the one it is chatting about (2026-11-02 coach context): the foods of the
// last two days, the same food eaten more than once that day counted once with its amounts summed, and the workouts of
// the past week, so it can plan today's training. Built once with the day's system prompt.

/** Days back whose foods the coach sees by name. */
export const RECENT_FOOD_DAYS = 2;
/** Days back whose workouts the coach sees. */
export const RECENT_WORKOUT_DAYS = 7;

/** One food of a day, every time it was logged that day added together. */
export interface EatenFood {
  name: string;
  /** How many times it was logged; left out when once. */
  times?: number;
  /** Each portion as logged, joined with " + " when there was more than one. */
  quantity: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** The key two items share when they are the same food: case, spacing and accents aside. */
export function foodKey(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** A list of food items with each food counted once, its macros summed, in the order first eaten. */
export function dedupeFoods(foods: readonly Pick<FoodItem, "name" | "quantity" | "kcal" | "protein_g" | "carbs_g" | "fat_g">[]): EatenFood[] {
  const byKey = new Map<string, { name: string; quantities: string[]; kcal: number; protein_g: number; carbs_g: number; fat_g: number }>();
  for (const food of foods) {
    const key = foodKey(food.name);
    if (!key) continue;
    const seen = byKey.get(key) ?? { name: food.name.trim(), quantities: [], kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    seen.quantities.push(food.quantity.trim());
    seen.kcal += food.kcal;
    seen.protein_g += food.protein_g;
    seen.carbs_g += food.carbs_g;
    seen.fat_g += food.fat_g;
    byKey.set(key, seen);
  }
  return [...byKey.values()].map((food) => ({
    name: food.name,
    ...(food.quantities.length > 1 ? { times: food.quantities.length } : {}),
    quantity: food.quantities.filter(Boolean).join(" + "),
    kcal: Math.round(food.kcal),
    protein_g: Math.round(food.protein_g),
    carbs_g: Math.round(food.carbs_g),
    fat_g: Math.round(food.fat_g),
  }));
}

export interface Workout {
  name: string;
  activity: Activity;
  minutes: number | null;
  kcal: number;
  /** The muscles worked most, primary first. */
  muscles?: string[];
}

export interface EarlierDays {
  recent_foods: { date: string; weekday: string; foods: EatenFood[] }[];
  recent_workouts: { date: string; weekday: string; workouts: Workout[] }[];
  /** Of the RECENT_WORKOUT_DAYS days before, how many had any training. */
  training_days: number;
}

function workoutsOf(list: readonly Entry[]): Workout[] {
  return list.flatMap((entry) =>
    entry.exercises.map((item) => {
      const muscles = [...item.muscles].sort((a, b) => (a.role === b.role ? 0 : a.role === "primary" ? -1 : 1)).map((m) => m.muscle.replaceAll("_", " "));
      return {
        name: item.name,
        activity: item.activity,
        minutes: item.duration_min === null ? null : Math.round(item.duration_min),
        kcal: Math.round(item.kcal),
        ...(muscles.length > 0 ? { muscles } : {}),
      };
    }),
  );
}

const weekdayOf = (date: string) => weekdayName(new Date(`${date}T12:00:00Z`), "UTC");

/** The foods of the RECENT_FOOD_DAYS days before `date` and the workouts of the RECENT_WORKOUT_DAYS before it, oldest first. */
export function earlierDays(sql: Sql, date: string): EarlierDays {
  const recent_foods: EarlierDays["recent_foods"] = [];
  const recent_workouts: EarlierDays["recent_workouts"] = [];
  for (let back = RECENT_WORKOUT_DAYS; back >= 1; back--) {
    const day = addDays(date, -back);
    const list = listEntries(sql, day);
    const workouts = workoutsOf(list);
    if (workouts.length > 0) recent_workouts.push({ date: day, weekday: weekdayOf(day), workouts });
    if (back <= RECENT_FOOD_DAYS) {
      const foods = dedupeFoods(list.flatMap((entry) => entry.foods));
      recent_foods.push({ date: day, weekday: weekdayOf(day), foods });
    }
  }
  return { recent_foods, recent_workouts, training_days: recent_workouts.length };
}

/** The most foods the weekly analysis sees by name. */
export const WEEK_FOODS_MAX = 40;

/** The foods of a period, each counted once with how often it was logged, most often first: what the weekly goals section reads. */
export function foodsOfPeriod(sql: Sql, from: string, to: string): { name: string; times: number }[] {
  const foods = listEntriesBetween(sql, from, to).flatMap((row) => row.entry.foods);
  return dedupeFoods(foods)
    .map((food, order) => ({ name: food.name, times: food.times ?? 1, kcal: food.kcal, order }))
    .sort((a, b) => b.times - a.times || b.kcal - a.kcal || a.order - b.order)
    .slice(0, WEEK_FOODS_MAX)
    .map(({ name, times }) => ({ name, times }));
}
