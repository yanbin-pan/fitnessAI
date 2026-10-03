import { afterEach, describe, expect, it } from "vitest";
import { buildDayView, ensureDay, getDay, refreshDay } from "../src/days/days.ts";
import { insertEntry } from "../src/log/entries.ts";
import { getProfile, saveProfile } from "../src/profile/profile.ts";
import { makeProfile, openTestDb, sampleEntry, sampleExercise, sampleFood } from "./helpers.ts";

const NOW_ISO = "2026-10-03T12:00:00.000Z";
let db: ReturnType<typeof openTestDb> | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe("profile", () => {
  it("round-trips through the database", () => {
    db = openTestDb();
    expect(getProfile(db.db)).toBeNull();
    const profile = makeProfile();
    saveProfile(db.db, profile, NOW_ISO);
    expect(getProfile(db.db)).toEqual(profile);
    saveProfile(db.db, { ...profile, weight_kg: 78 }, NOW_ISO);
    expect(getProfile(db.db)?.weight_kg).toBe(78);
  });

  it("round-trips non-default values and clears an override on update", () => {
    db = openTestDb();
    const custom = makeProfile({ override_kcal: 2100, add_back_pct: 25, timezone: "America/New_York", units_mass: "st_lb", goal_notes: "off" });
    saveProfile(db.db, custom, NOW_ISO);
    expect(getProfile(db.db)).toEqual(custom);
    saveProfile(db.db, { ...custom, override_kcal: null, add_back_pct: 75 }, NOW_ISO);
    expect(getProfile(db.db)).toEqual({ ...custom, override_kcal: null, add_back_pct: 75 });
  });
});

describe("day snapshots", () => {
  it("freeze a day's targets the first time the day is touched", () => {
    db = openTestDb();
    expect(ensureDay(db.db, makeProfile(), "2026-10-03", NOW_ISO).base_kcal).toBeCloseTo(1863.125, 6);
    // A later profile change does not rewrite the stored day.
    expect(ensureDay(db.db, makeProfile({ weight_kg: 90 }), "2026-10-03", NOW_ISO).base_kcal).toBeCloseTo(1863.125, 6);
    const stored = getDay(db.db, "2026-10-03");
    expect(stored?.base_kcal).toBeCloseTo(1863.125, 6);
    expect(stored?.weight_kg_used).toBe(80);
  });

  it("refresh on request (used for today when the profile changes)", () => {
    db = openTestDb();
    ensureDay(db.db, makeProfile(), "2026-10-03", NOW_ISO);
    refreshDay(db.db, makeProfile({ override_kcal: 2100, add_back_pct: 25, weight_kg: 78 }), "2026-10-03", NOW_ISO);
    expect(getDay(db.db, "2026-10-03")).toMatchObject({ base_kcal: 2100, add_back_pct: 25, weight_kg_used: 78 });
    // A day with no snapshot yet gets one.
    refreshDay(db.db, makeProfile(), "2026-10-04", NOW_ISO);
    expect(getDay(db.db, "2026-10-04")?.base_kcal).toBeCloseTo(1863.125, 6);
  });
});

describe("buildDayView", () => {
  it("totals the food and adds back half the workout calories", () => {
    db = openTestDb();
    const profile = makeProfile();
    ensureDay(db.db, profile, "2026-10-03", NOW_ISO);
    db.db.transaction((tx) => {
      insertEntry(tx, sampleEntry({ foods: [sampleFood({ kcal: 500, protein_g: 30, saturated_fat_g: 5, fluid_ml: 250 })] }), NOW_ISO);
      insertEntry(tx, sampleEntry({ foods: [], exercises: [sampleExercise({ kcal: 400 })] }), NOW_ISO);
    });
    const view = buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO);
    expect(view.totals).toMatchObject({ kcal: 500, protein_g: 30, saturated_fat_g: 5, fluid_ml: 250 });
    expect(view.targets.workout_kcal).toBe(400);
    expect(view.targets.add_back_kcal).toBe(200);
    expect(view.targets.adjusted.kcal).toBeCloseTo(2063.125, 6);
    expect(view.entries).toHaveLength(2);
    expect(view.messages).toEqual([]);
    expect(view.today).toBe("2026-10-03");
  });

  it("gives an untouched past day targets from the current profile without storing it", () => {
    db = openTestDb();
    const view = buildDayView(db.db, makeProfile(), "2026-09-01", "2026-10-03", NOW_ISO);
    expect(view.targets.base.kcal).toBeCloseTo(1863.125, 6);
    expect(getDay(db.db, "2026-09-01")).toBeNull();
  });

  it("sums every nutrient across foods and every workout across entries", () => {
    db = openTestDb();
    db.db.transaction((tx) => {
      insertEntry(tx, sampleEntry({ foods: [
        sampleFood({ kcal: 500, protein_g: 30, carbs_g: 40, fat_g: 20, fibre_g: 5, saturated_fat_g: 5, sugars_g: 10, salt_g: 1, fluid_ml: 250, alcohol_units: 1 }),
        sampleFood({ kcal: 100, protein_g: 10, carbs_g: 10, fat_g: 2, fibre_g: 3, saturated_fat_g: 1, sugars_g: 2, salt_g: 0.5, fluid_ml: 100, alcohol_units: 0 }),
      ] }), NOW_ISO);
      insertEntry(tx, sampleEntry({ foods: [], exercises: [sampleExercise({ kcal: 300 }), sampleExercise({ kcal: 100 })] }), NOW_ISO);
      insertEntry(tx, sampleEntry({ foods: [], exercises: [sampleExercise({ kcal: 200 })] }), NOW_ISO);
    });
    const view = buildDayView(db.db, makeProfile(), "2026-10-03", "2026-10-03", NOW_ISO);
    expect(view.totals).toEqual({
      kcal: 600, protein_g: 40, carbs_g: 50, fat_g: 22, fibre_g: 8,
      saturated_fat_g: 6, sugars_g: 12, salt_g: 1.5, fluid_ml: 350, alcohol_units: 1,
    });
    expect(view.targets.workout_kcal).toBe(600);
  });

  it("keeps a frozen day's add-back and strength protein when the profile later changes", () => {
    db = openTestDb();
    ensureDay(db.db, makeProfile(), "2026-10-03", NOW_ISO); // 80 kg, add-back 50 %
    db.db.transaction((tx) => insertEntry(tx, sampleEntry({ foods: [], exercises: [sampleExercise({ category: "strength", kcal: 400 })] }), NOW_ISO));
    const view = buildDayView(db.db, makeProfile({ weight_kg: 100, add_back_pct: 100 }), "2026-10-03", "2026-10-03", NOW_ISO);
    expect(view.targets.add_back_kcal).toBe(200);
    // Strength-day protein: min(0.2 g/kg × the frozen 80 kg, add-back ÷ 4) = 16 g.
    expect(view.targets.adjusted.protein_g - view.targets.base.protein_g).toBeCloseTo(16, 9);
  });
});
