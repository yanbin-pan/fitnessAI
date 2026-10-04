import type { ExerciseItemInput, FoodItemInput } from "../shared.ts";
import { exerciseKcal } from "../targets/targets.ts";
import type { ExerciseItemData, FoodItemData } from "./entries.ts";

export function foodData(input: FoodItemInput): FoodItemData {
  return { ...input, saved_food_id: null };
}

/** Uses the kcal given; otherwise derives active kcal from MET and duration; otherwise 0. */
export function exerciseData(input: ExerciseItemInput, weightKg: number): ExerciseItemData {
  const derived = input.met !== null && input.duration_min !== null ? exerciseKcal(input.met, weightKg, input.duration_min) : 0;
  return { ...input, kcal: input.kcal ?? derived, kcal_measured: false };
}
