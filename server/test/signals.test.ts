import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDayView } from "../src/days/days.ts";
import { signalsFor } from "../src/days/signals.ts";
import { getEntry, insertEntry } from "../src/log/entries.ts";
import type { FoodItemData } from "../src/log/entries.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { addDays } from "../src/shared.ts";
import type { Profile } from "../src/shared.ts";
import { NOW, makeProfile, openTestDb, sampleEntry, sampleFood } from "./helpers.ts";

const TODAY = "2026-10-03";
const NOW_ISO = NOW.toISOString();
let test: ReturnType<typeof openTestDb>;
let profile: Profile;

/** A day of 2000 kcal that is heavy on salt, with a generous vitamin C estimate. */
const salty = (vitaminC: number): FoodItemData =>
  sampleFood({ kcal: 2000, fat_g: 70, saturated_fat_g: 20, sugars_g: 60, salt_g: 10, micros: [{ nutrient: "vitamin_c_mg", amount: vitaminC }] });

function log(date: string, food: FoodItemData) {
  const id = randomUUID();
  test.db.transaction((tx) => insertEntry(tx, sampleEntry({ id, date, logged_at: `${date}T12:00:00.000Z`, foods: [food] }), NOW_ISO));
  return id;
}

beforeEach(() => {
  test = openTestDb();
  profile = makeProfile();
  saveProfile(test.db, profile, NOW_ISO);
});
afterEach(() => test.close());

describe("food micros", () => {
  it("are stored with the food and come back as they went in; a food without an estimate has none", () => {
    const id = log(TODAY, sampleFood({ micros: [{ nutrient: "iron_mg", amount: 2.5 }] }));
    expect(getEntry(test.db, id)?.foods[0].micros).toEqual([{ nutrient: "iron_mg", amount: 2.5 }]);
    const plain = log(TODAY, sampleFood());
    expect(getEntry(test.db, plain)?.foods[0].micros).toBeNull();
  });
});

describe("signalsFor", () => {
  it("reads today from the 7 complete days before it, so a morning with nothing logged changes nothing", () => {
    for (let d = 1; d <= 7; d++) log(addDays(TODAY, -d), salty(160));
    const before = signalsFor(test.db, profile, TODAY, TODAY);
    expect(before).toMatchObject({ days: 7, levels: { salt: "high", vitamin_c_mg: "high" } });
    log(TODAY, sampleFood({ kcal: 300, salt_g: 0.1, micros: [] }));
    expect(signalsFor(test.db, profile, TODAY, TODAY)).toEqual(before);
  });

  it("reads an earlier day from the 7 days ending on it", () => {
    log("2026-09-20", salty(0));
    log("2026-09-19", salty(0));
    log("2026-09-12", salty(500)); // eight days before: outside
    expect(signalsFor(test.db, profile, "2026-09-20", TODAY)).toMatchObject({ days: 2, levels: { vitamin_c_mg: "low" } });
  });

  it("rides in the day view", () => {
    for (let d = 1; d <= 3; d++) log(addDays(TODAY, -d), salty(80));
    const view = buildDayView(test.db, profile, TODAY, TODAY, NOW_ISO, []);
    expect(view.nutrients).toMatchObject({ days: 3, levels: { salt: "high", vitamin_c_mg: "ok", sugars: "ok" } });
  });
});
