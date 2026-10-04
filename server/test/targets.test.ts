import { describe, expect, it } from "vitest";
import { adjustTargets, ageOn, baselineTargets, bmr, exerciseKcal, goalDelta } from "../src/targets/targets.ts";
import { makeProfile } from "./helpers.ts";

const DATE = "2026-10-03";

describe("ageOn", () => {
  it("counts a birthday only once it has passed", () => {
    expect(ageOn("1991-03-15", DATE)).toBe(35);
    expect(ageOn("1991-10-04", DATE)).toBe(34);
    expect(ageOn("1991-10-03", DATE)).toBe(35);
  });
});

describe("bmr (Mifflin-St Jeor)", () => {
  it("uses +5 for men and −161 for women", () => {
    expect(bmr("male", 80, 180, 35)).toBe(1755);
    expect(bmr("female", 50, 160, 30)).toBe(1189);
  });
});

describe("goalDelta", () => {
  it("turns kg a week into daily kcal", () => {
    expect(goalDelta("lose", 0.5)).toBe(-550);
    expect(goalDelta("gain", 0.25)).toBe(275);
    expect(goalDelta("maintain", 0.5)).toBe(0);
  });
});

describe("baselineTargets", () => {
  it("matches a hand-worked example", () => {
    // BMR 1755 × 1.375 = 2413.125, minus 550 for losing 0.5 kg a week.
    const t = baselineTargets(makeProfile(), 80, DATE);
    expect(t.kcal).toBeCloseTo(1863.125, 6);
    expect(t.protein_g).toBeCloseTo(144, 6); // 1.8 g × 80 kg
    expect(t.fat_g).toBeCloseTo(62.1041667, 6); // 30 % of kcal ÷ 9
    expect(t.carbs_g).toBeCloseTo(182.046875, 6); // the remainder ÷ 4
    expect(t.fibre_g).toBe(30);
  });

  it("never goes below BMR", () => {
    const profile = makeProfile({
      sex: "female", birth_date: "1996-01-01", height_cm: 160, weight_kg: 50,
      activity_level: "sedentary", goal: "lose", goal_rate_kg_week: 1,
    });
    expect(baselineTargets(profile, 50, DATE).kcal).toBeCloseTo(1189, 6);
  });

  it("adds the surplus when gaining", () => {
    const profile = makeProfile({ goal: "gain", goal_rate_kg_week: 0.25 });
    expect(baselineTargets(profile, 80, DATE).kcal).toBeCloseTo(2688.125, 6);
  });

  it("lets fat follow an overridden kcal and keeps carbs as the remainder", () => {
    const t = baselineTargets(makeProfile({ override_kcal: 2000 }), 80, DATE);
    expect(t.kcal).toBe(2000);
    expect(t.fat_g).toBeCloseTo(66.6666667, 6);
    expect(t.carbs_g).toBeCloseTo(206, 6); // (2000 − 576 − 600) ÷ 4
  });

  it("uses an overridden carb target as given", () => {
    expect(baselineTargets(makeProfile({ override_carbs_g: 150 }), 80, DATE).carbs_g).toBe(150);
  });

  it("can ignore overrides, for showing the calculated values", () => {
    const t = baselineTargets(makeProfile({ override_kcal: 2000 }), 80, DATE, false);
    expect(t.kcal).toBeCloseTo(1863.125, 6);
  });
});

describe("adjustTargets", () => {
  const base = { kcal: 2000, protein_g: 144, carbs_g: 200, fat_g: 66, fibre_g: 30 };

  it("changes nothing without a workout", () => {
    const t = adjustTargets(base, 50, 80, { workoutKcal: 0, strengthDay: false });
    expect(t.adjusted).toEqual(base);
    expect(t.addBackKcal).toBe(0);
  });

  it("splits a cardio add-back 75 % carbs, 25 % fat", () => {
    const t = adjustTargets(base, 50, 80, { workoutKcal: 400, strengthDay: false });
    expect(t.addBackKcal).toBe(200);
    expect(t.adjusted.kcal).toBe(2200);
    expect(t.adjusted.protein_g).toBe(144);
    expect(t.adjusted.carbs_g).toBeCloseTo(237.5, 6); // + 150 kcal ÷ 4
    expect(t.adjusted.fat_g).toBeCloseTo(71.5555556, 6); // + 50 kcal ÷ 9
    expect(t.adjusted.fibre_g).toBe(30);
  });

  it("pays for strength-day protein out of the add-back", () => {
    const t = adjustTargets(base, 50, 80, { workoutKcal: 400, strengthDay: true });
    expect(t.adjusted.protein_g).toBeCloseTo(160, 6); // + 0.2 g × 80 kg
    expect(t.adjusted.carbs_g).toBeCloseTo(225.5, 6); // + 0.75 × 136 ÷ 4
    expect(t.adjusted.fat_g).toBeCloseTo(69.7777778, 6); // + 0.25 × 136 ÷ 9
    expect(t.adjusted.kcal).toBe(2200);
  });

  it("never lets the protein increase exceed the add-back", () => {
    const t = adjustTargets(base, 50, 80, { workoutKcal: 40, strengthDay: true });
    expect(t.adjusted.protein_g).toBeCloseTo(149, 6); // add-back 20 kcal → 5 g
    expect(t.adjusted.carbs_g).toBe(200);
    expect(t.adjusted.fat_g).toBe(66);
  });
});

describe("exerciseKcal", () => {
  it("counts active calories only: (MET − 1) × kg × hours", () => {
    expect(exerciseKcal(8, 80, 30)).toBe(280);
    expect(exerciseKcal(1, 80, 60)).toBe(0);
    expect(exerciseKcal(0.5, 80, 60)).toBe(0);
  });
});
