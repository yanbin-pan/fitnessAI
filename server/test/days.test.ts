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
});

describe("day snapshots", () => {
  it("freeze a day's targets the first time the day is touched", () => {
    db = openTestDb();
    expect(ensureDay(db.db, makeProfile(), "2026-10-03", NOW_ISO).base_kcal).toBeCloseTo(1863.125, 6);
    // A later profile change does not rewrite the stored day.
    expect(ensureDay(db.db, makeProfile({ weight_kg: 90 }), "2026-10-03", NOW_ISO).base_kcal).toBeCloseTo(1863.125, 6);
  });

  it("refresh on request (used for today when the profile changes)", () => {
    db = openTestDb();
    ensureDay(db.db, makeProfile(), "2026-10-03", NOW_ISO);
    refreshDay(db.db, makeProfile({ override_kcal: 2100 }), "2026-10-03", NOW_ISO);
    expect(getDay(db.db, "2026-10-03")?.base_kcal).toBe(2100);
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
});
