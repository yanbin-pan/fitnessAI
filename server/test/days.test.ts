import { afterEach, describe, expect, it } from "vitest";
import { buildDayView, daySummaries, ensureDay, getDay, refreshDay } from "../src/days/days.ts";
import type { Sql } from "../src/db/types.ts";
import { insertEntry } from "../src/log/entries.ts";
import { insertReply, insertUserMessage } from "../src/messages/messages.ts";
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
    const view = buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO, []);
    expect(view.totals).toMatchObject({ kcal: 500, protein_g: 30, saturated_fat_g: 5, fluid_ml: 250 });
    expect(view.targets.workout_kcal).toBe(400);
    expect(view.targets.add_back_kcal).toBe(200);
    expect(view.targets.adjusted.kcal).toBeCloseTo(2063.125, 6);
    expect(view.entries).toHaveLength(2);
    expect(view.messages).toEqual([]);
    expect(view.today).toBe("2026-10-03");
  });

  it("shows the companion as of today from the week before it, whichever day is open", () => {
    db = openTestDb();
    const profile = makeProfile();
    expect(buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO, []).companion.mood).toBe("inactive");
    // A week of 500 kcal days against a target near 1860: well under.
    db.db.transaction((tx) => {
      for (const date of ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]) {
        insertEntry(tx, sampleEntry({ date, foods: [sampleFood({ kcal: 500 })] }), NOW_ISO);
      }
    });
    const today = buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO, []).companion;
    expect(today).toMatchObject({ mood: "sluggish", avg_kcal: 500, days_logged: 7 });
    expect(buildDayView(db.db, profile, "2026-09-20", "2026-10-03", NOW_ISO, []).companion).toEqual(today);
  });

  it("carries the alcohol of the 7 days ending on the day, and none when there was none", () => {
    db = openTestDb();
    const profile = makeProfile();
    expect(buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO, []).alcohol).toBeNull();
    const pint = sampleFood({ name: "Lager", kcal: 200, alcohol_units: 2.3, drink: "beer" });
    db.db.transaction((tx) => {
      insertEntry(tx, sampleEntry({ date: "2026-09-28", foods: [pint, pint] }), NOW_ISO);
      insertEntry(tx, sampleEntry({ date: "2026-10-03", foods: [pint, sampleFood({ name: "Red wine", kcal: 160, alcohol_units: 2.3, drink: "wine" })] }), NOW_ISO);
    });
    const today = buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO, []);
    expect(today.alcohol).toMatchObject({ units: 9.2, status: "within", alcohol_free_days: 5 });
    expect(today.alcohol?.drinks).toEqual([{ drink: "beer", count: 3, units: 6.9, kcal: 600 }, { drink: "wine", count: 1, units: 2.3, kcal: 160 }]);
    expect(today.entries[0].foods[0].drink).toBe("beer");
    // Six days later the binge on the 28th has left the week.
    expect(buildDayView(db.db, profile, "2026-10-05", "2026-10-05", NOW_ISO, []).alcohol?.units).toBe(4.6);
  });

  it("gives an untouched past day targets from the current profile without storing it", () => {
    db = openTestDb();
    const view = buildDayView(db.db, makeProfile(), "2026-09-01", "2026-10-03", NOW_ISO, []);
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
    const view = buildDayView(db.db, makeProfile(), "2026-10-03", "2026-10-03", NOW_ISO, []);
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
    const view = buildDayView(db.db, makeProfile({ weight_kg: 100, add_back_pct: 100 }), "2026-10-03", "2026-10-03", NOW_ISO, []);
    expect(view.targets.add_back_kcal).toBe(200);
    // Strength-day protein: min(0.2 g/kg × the frozen 80 kg, add-back ÷ 4) = 16 g.
    expect(view.targets.adjusted.protein_g - view.targets.base.protein_g).toBeCloseTo(16, 9);
  });
});

describe("linked entries (a reply that recorded something for another day)", () => {
  /** Today's conversation: a question, and the coach's reply with one card pointing at `entryId`. */
  function converse(sql: Sql, entryId: string) {
    insertUserMessage(sql, { id: "m1", date: "2026-10-03", text: "yesterday I did a workout", photoIds: [], sentAt: NOW_ISO, nowIso: NOW_ISO });
    insertReply(sql, { id: "m2", replyTo: "m1", date: "2026-10-03", text: "Logged.", cards: [{ type: "entry", id: entryId }], nowIso: NOW_ISO });
  }

  it("never count towards the day they travel with, only towards their own", () => {
    db = openTestDb();
    const profile = makeProfile();
    ensureDay(db.db, profile, "2026-10-03", NOW_ISO);
    db.db.transaction((tx) => {
      insertEntry(tx, sampleEntry({
        id: "lifting", date: "2026-10-02", logged_at: "2026-10-02T17:00:00.000Z", source: "coach", message_id: "m1",
        foods: [], exercises: [sampleExercise({ category: "strength", kcal: 400 })],
      }), NOW_ISO);
      converse(tx, "lifting");
    });
    const today = buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO, []);
    expect(today.linked_entries.map((e) => e.id)).toEqual(["lifting"]); // it travels with today's reply...
    expect(today.entries).toEqual([]);
    expect(today.targets.workout_kcal).toBe(0); // ...but is not today's workout
    expect(today.targets.add_back_kcal).toBe(0);
    expect(today.targets.adjusted).toEqual(today.targets.base); // no add-back, no strength-day protein
    // The day it is dated for does count it.
    expect(buildDayView(db.db, profile, "2026-10-02", "2026-10-03", NOW_ISO, []).targets.workout_kcal).toBe(400);
  });

  it("stay empty when every card of a reply is an entry of its own day", () => {
    db = openTestDb();
    db.db.transaction((tx) => {
      insertEntry(tx, sampleEntry({ id: "eggs", source: "coach", message_id: "m1" }), NOW_ISO);
      converse(tx, "eggs");
    });
    const view = buildDayView(db.db, makeProfile(), "2026-10-03", "2026-10-03", NOW_ISO, []);
    expect(view.entries.map((e) => e.id)).toEqual(["eggs"]);
    expect(view.linked_entries).toEqual([]);
  });
});

describe("day summaries", () => {
  it("list the days with food, with the eaten kcal and the adjusted target, workouts included", () => {
    db = openTestDb();
    const profile = makeProfile();
    saveProfile(db.db, profile, NOW_ISO);
    for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"]) ensureDay(db.db, profile, date, NOW_ISO);
    insertEntry(db.db, sampleEntry({ date: "2026-10-01", foods: [sampleFood({ kcal: 500 })] }), NOW_ISO);
    insertEntry(db.db, sampleEntry({ date: "2026-10-02", foods: [], exercises: [sampleExercise()] }), NOW_ISO);
    insertEntry(db.db, sampleEntry({ date: "2026-10-03", foods: [sampleFood({ kcal: 900 })], exercises: [sampleExercise({ kcal: 320 })] }), NOW_ISO);

    const got = daySummaries(db.db, profile, "2026-09-28", "2026-10-04", NOW_ISO);
    expect(got.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-03"]); // the day with only exercise is left out
    expect(got[0].kcal).toBe(500);
    expect(got[1].kcal).toBe(900);
    for (const day of got) {
      expect(day.target_kcal).toBeCloseTo(buildDayView(db.db, profile, day.date, "2026-10-03", NOW_ISO, []).targets.adjusted.kcal, 6);
    }
    expect(got[1].target_kcal).toBeGreaterThan(got[0].target_kcal); // the workout's add-back
  });

  it("cover the range inclusively, and only the range", () => {
    db = openTestDb();
    const sql = db.db;
    for (const date of ["2026-09-30", "2026-10-01", "2026-10-03", "2026-10-04"]) {
      insertEntry(sql, sampleEntry({ date, foods: [sampleFood({ kcal: 100 })] }), NOW_ISO);
    }
    const datesIn = (from: string, to: string) => daySummaries(sql, makeProfile(), from, to, NOW_ISO).map((d) => d.date);
    expect(datesIn("2026-10-01", "2026-10-03")).toEqual(["2026-10-01", "2026-10-03"]); // both ends in, the days beside them out
    expect(datesIn("2026-10-03", "2026-10-03")).toEqual(["2026-10-03"]); // a one-day range
    expect(datesIn("2026-10-02", "2026-10-02")).toEqual([]); // a day with no food
  });

  it("use the targets a day froze, and the current profile for a day that never froze any", () => {
    db = openTestDb();
    ensureDay(db.db, makeProfile(), "2026-10-01", NOW_ISO); // frozen at the calculated 1,863.125 kcal
    for (const date of ["2026-10-01", "2026-10-02"]) insertEntry(db.db, sampleEntry({ date, foods: [sampleFood({ kcal: 100 })] }), NOW_ISO);
    const [frozen, unfrozen] = daySummaries(db.db, makeProfile({ override_kcal: 3000 }), "2026-10-01", "2026-10-02", NOW_ISO);
    expect(frozen.target_kcal).toBeCloseTo(1863.125, 6); // the profile changed since: the day keeps its own
    expect(unfrozen.target_kcal).toBe(3000); // nothing stored for it, so what it would freeze today
    expect(getDay(db.db, "2026-10-02")).toBeNull(); // and reading does not store it
  });

  it("reach the last date there is, and stop there instead of stepping past it", () => {
    db = openTestDb();
    const profile = makeProfile();
    // The day after 9999-12-31 is not a date the helpers can write, so the loop must never take that step.
    expect(daySummaries(db.db, profile, "9999-12-30", "9999-12-31", NOW_ISO)).toEqual([]);
    insertEntry(db.db, sampleEntry({ date: "9999-12-31", foods: [sampleFood({ kcal: 100 })] }), NOW_ISO);
    expect(daySummaries(db.db, profile, "9999-12-30", "9999-12-31", NOW_ISO).map((d) => d.date)).toEqual(["9999-12-31"]);
  });
});
