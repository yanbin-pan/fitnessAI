import { afterEach, describe, expect, it } from "vitest";
import {
  deleteEntry, getEntry, insertEntry, listEntries, normalizeGroups, normalizeMuscles, replaceEntryItems,
} from "../src/log/entries.ts";
import { openTestDb, sampleEntry, sampleExercise, sampleFood } from "./helpers.ts";

const NOW_ISO = "2026-10-03T12:00:00.000Z";
let db: ReturnType<typeof openTestDb> | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe("entries", () => {
  it("stores an entry with its foods, groups, exercises and muscles", () => {
    db = openTestDb();
    const entry = sampleEntry({
      foods: [sampleFood({ groups: [{ group: "wholegrains", portions: 1 }, { group: "wholegrains", portions: 0.5 }, { group: "fruit", portions: 1 }] })],
      exercises: [sampleExercise({ muscles: [{ muscle: "quads", role: "secondary" }, { muscle: "quads", role: "primary" }, { muscle: "calves", role: "secondary" }] })],
    });
    db.db.transaction((tx) => insertEntry(tx, entry, NOW_ISO));

    const stored = getEntry(db.db, entry.id);
    expect(stored).toMatchObject({ id: entry.id, date: "2026-10-03", source: "manual", edited: false, message_id: null });
    expect(stored?.foods[0]).toMatchObject({ name: "Eggs", kcal: 156, saturated_fat_g: 3.3, position: 0 });
    expect(stored?.foods[0].groups).toEqual([{ group: "fruit", portions: 1 }, { group: "wholegrains", portions: 1.5 }]);
    expect(stored?.exercises[0]).toMatchObject({ name: "Run", kcal: 320, kcal_measured: false, category: "cardio" });
    expect(stored?.exercises[0].muscles).toEqual([{ muscle: "quads", role: "primary" }, { muscle: "calves", role: "secondary" }]);
  });

  it("lists one day's entries in time order", () => {
    db = openTestDb();
    const late = sampleEntry({ logged_at: "2026-10-03T18:00:00.000Z" });
    const early = sampleEntry({ logged_at: "2026-10-03T07:00:00.000Z" });
    const otherDay = sampleEntry({ date: "2026-10-02", logged_at: "2026-10-02T07:00:00.000Z" });
    db.db.transaction((tx) => [late, early, otherDay].forEach((e) => insertEntry(tx, e, NOW_ISO)));
    expect(listEntries(db.db, "2026-10-03").map((e) => e.id)).toEqual([early.id, late.id]);
  });

  it("replaces an entry's items and marks it edited", () => {
    db = openTestDb();
    const entry = sampleEntry();
    db.db.transaction((tx) => insertEntry(tx, entry, NOW_ISO));
    const replaced = db.db.transaction((tx) =>
      replaceEntryItems(tx, entry.id, [sampleFood({ name: "Toast", kcal: 90 }), sampleFood({ name: "Butter", kcal: 70 })], [], NOW_ISO),
    );
    expect(replaced).toBe(true);
    const stored = getEntry(db.db, entry.id);
    expect(stored?.edited).toBe(true);
    expect(stored?.foods.map((f) => [f.name, f.position])).toEqual([["Toast", 0], ["Butter", 1]]);
  });

  it("deletes an entry together with everything under it", () => {
    db = openTestDb();
    const entry = sampleEntry({
      foods: [sampleFood({ groups: [{ group: "fruit", portions: 1 }] })],
      exercises: [sampleExercise()],
    });
    db.db.transaction((tx) => insertEntry(tx, entry, NOW_ISO));
    expect(deleteEntry(db.db, entry.id)).toBe(true);
    for (const table of ["food_items", "food_item_groups", "exercise_items", "exercise_muscles"]) {
      expect(db.sqlite.prepare(`select count(*) from ${table}`).pluck().get()).toBe(0);
    }
  });

  it("reports missing entries", () => {
    db = openTestDb();
    expect(getEntry(db.db, "nope")).toBeNull();
    expect(deleteEntry(db.db, "nope")).toBe(false);
    expect(db.db.transaction((tx) => replaceEntryItems(tx, "nope", [sampleFood()], [], NOW_ISO))).toBe(false);
  });
});

describe("normalizers", () => {
  it("sum repeated food groups and drop empty ones", () => {
    expect(normalizeGroups([{ group: "fruit", portions: 1 }, { group: "fruit", portions: 1 }, { group: "legumes", portions: 0 }])).toEqual([
      { group: "fruit", portions: 2 },
    ]);
  });

  it("keep one row per muscle, preferring primary", () => {
    expect(normalizeMuscles([{ muscle: "core", role: "primary" }, { muscle: "core", role: "secondary" }])).toEqual([
      { muscle: "core", role: "primary" },
    ]);
  });
});
