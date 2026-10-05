import type { BodyGoal } from "./vocab.ts";

export type CalorieStatus = "within" | "near" | "off";

/** "A little" off its target: up to this share of it (spec §11.1). */
export const NEAR_SHARE = 0.1;

/** The most days one calendar request covers: a six-week month grid (spec §12). */
export const MAX_SUMMARY_DAYS = 42;

/**
 * How a day went against its adjusted target (spec §11.1), compared as the app shows the numbers: eaten
 * to the nearest kcal, the target to the nearest 10. Losing or maintaining, over is the wrong way;
 * gaining, under is.
 */
export function calorieStatus(eatenKcal: number, targetKcal: number, goal: BodyGoal): CalorieStatus {
  const eaten = Math.round(eatenKcal);
  const target = Math.round(targetKcal / 10) * 10;
  const wrongWay = goal === "gain" ? target - eaten : eaten - target;
  if (wrongWay <= 0) return "within";
  return wrongWay <= target * NEAR_SHARE ? "near" : "off";
}
