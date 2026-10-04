import { ACTIVITY_FACTORS } from "../shared.ts";
import type { MacroTargets, Profile } from "../shared.ts";

// Pure target maths (spec §7). No I/O: everything comes in as arguments.

const KCAL_PER_KG = 7700;

export function ageOn(birthDate: string, date: string): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  const birthdayPassed = month > birthMonth || (month === birthMonth && day >= birthDay);
  return year - birthYear - (birthdayPassed ? 0 : 1);
}

/** Mifflin-St Jeor resting energy, kcal/day. */
export function bmr(sex: Profile["sex"], weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}

/** Daily kcal change for the body goal: rate × 7700 ÷ 7. */
export function goalDelta(goal: Profile["goal"], rateKgWeek: number): number {
  if (goal === "maintain") return 0;
  const daily = (rateKgWeek * KCAL_PER_KG) / 7;
  return goal === "lose" ? -daily : daily;
}

const NO_OVERRIDES = {
  override_kcal: null,
  override_protein_g: null,
  override_carbs_g: null,
  override_fat_g: null,
  override_fibre_g: null,
} as const;

export function baselineTargets(profile: Profile, weightKg: number, date: string, useOverrides = true): MacroTargets {
  const floor = bmr(profile.sex, weightKg, profile.height_cm, ageOn(profile.birth_date, date));
  const maintenance = floor * ACTIVITY_FACTORS[profile.activity_level];
  const calculatedKcal = Math.max(floor, maintenance + goalDelta(profile.goal, profile.goal_rate_kg_week));
  const o = useOverrides ? profile : NO_OVERRIDES;

  const kcal = o.override_kcal ?? calculatedKcal;
  const protein_g = o.override_protein_g ?? profile.protein_g_per_kg * weightKg;
  const fat_g = o.override_fat_g ?? (profile.fat_pct / 100) * kcal / 9;
  const carbs_g = o.override_carbs_g ?? Math.max(0, (kcal - 4 * protein_g - 9 * fat_g) / 4);
  const fibre_g = o.override_fibre_g ?? profile.fibre_g;
  return { kcal, protein_g, carbs_g, fat_g, fibre_g };
}

export interface WorkoutSummary {
  /** Active kcal of the day's workouts. */
  workoutKcal: number;
  strengthDay: boolean;
}

export interface AdjustedTargets {
  base: MacroTargets;
  adjusted: MacroTargets;
  addBackKcal: number;
  workoutKcal: number;
}

/** Adds part of the workout calories back to the day's budget (spec §7.2). */
export function adjustTargets(base: MacroTargets, addBackPct: number, weightKg: number, workout: WorkoutSummary): AdjustedTargets {
  const addBack = (addBackPct / 100) * workout.workoutKcal;
  const proteinExtra = workout.strengthDay ? Math.min(0.2 * weightKg, addBack / 4) : 0;
  const rest = addBack - 4 * proteinExtra;
  return {
    base,
    adjusted: {
      kcal: base.kcal + addBack,
      protein_g: base.protein_g + proteinExtra,
      carbs_g: base.carbs_g + (0.75 * rest) / 4,
      fat_g: base.fat_g + (0.25 * rest) / 9,
      fibre_g: base.fibre_g,
    },
    addBackKcal: addBack,
    workoutKcal: workout.workoutKcal,
  };
}

/** Active kcal for an activity: resting burn is already in BMR, so subtract one MET. */
export function exerciseKcal(met: number, weightKg: number, minutes: number): number {
  return Math.max(0, (met - 1) * weightKg * (minutes / 60));
}
