import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertEntry } from "../src/log/entries.ts";
import type { ExerciseItemData, FoodItemData } from "../src/log/entries.ts";
import { saveProfile } from "../src/profile/profile.ts";
import {
  analyseRegulars, dismissRegular, normalizeName, regularKey, saveRegularEdit, suggestRegulars,
} from "../src/regulars/regulars.ts";
import { addDays } from "../src/shared.ts";
import type { EntrySource } from "../src/shared.ts";
import { zonedTimeToInstant } from "../src/time.ts";
import { NOW, makeProfile, openTestDb, sampleEntry, sampleExercise, sampleFood, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const TODAY = "2026-10-03"; // NOW is 13:00 in London
const ZONE = "Europe/London";
const NOW_ISO = NOW.toISOString();

type Db = ReturnType<typeof openTestDb>["db"];

/** Logs an entry `daysAgo` days before today at a local time. */
function log(
  db: Db, daysAgo: number, time: string,
  items: { foods?: FoodItemData[]; exercises?: ExerciseItemData[]; source?: EntrySource; regular_key?: string | null },
): string {
  const date = addDays(TODAY, -daysAgo);
  const id = randomUUID();
  db.transaction((tx) =>
    insertEntry(tx, sampleEntry({
      id, date, logged_at: zonedTimeToInstant(date, time, ZONE).toISOString(), foods: items.foods ?? [], exercises: items.exercises ?? [],
      source: items.source ?? "manual", regular_key: items.regular_key ?? null,
    }), NOW_ISO),
  );
  return id;
}

const food = (name: string, kcal = 100) => sampleFood({ name, kcal });
const breakfast = (kcal = 300) => [food("Porridge", kcal), food("Coffee", 20)];
/** A different dinner on each of the given days, so that many days have data and none of it is a regular. */
const DINNERS = ["Pasta", "Curry", "Risotto", "Stew", "Tacos", "Sushi", "Pie", "Soup", "Ramen", "Paella"];
function filler(db: Db, daysAgo: number[]) {
  for (const d of daysAgo) log(db, d, "19:00", { foods: [food(DINNERS[d % DINNERS.length])] });
}

let test: ReturnType<typeof openTestDb>;
let db: Db;
beforeEach(() => {
  test = openTestDb();
  db = test.db;
  saveProfile(db, makeProfile(), NOW_ISO);
});
afterEach(() => test.close());

describe("analyseRegulars", () => {
  it("finds nothing until five days have something logged, and says how many there are", () => {
    for (const d of [1, 2, 3]) log(db, d, "08:00", { foods: breakfast() });
    filler(db, [4]);
    const view = analyseRegulars(db, TODAY, ZONE);
    expect(view).toMatchObject({ data_days: 4, required_days: 5, window_days: 28, regulars: [] });
  });

  it("makes a meal had on three different days a regular, named after its items, at its usual time", () => {
    log(db, 1, "08:10", { foods: breakfast(310) });
    log(db, 3, "07:50", { foods: breakfast(290) });
    log(db, 5, "08:00", { foods: breakfast(300) });
    filler(db, [2, 4]);
    const [regular] = analyseRegulars(db, TODAY, ZONE).regulars;
    expect(regular).toMatchObject({
      kind: "meal", name: "Porridge, Coffee", typical_time: "08:00", days_seen: 3, last_seen: addDays(TODAY, -1),
      edited: false, logged_today: false,
    });
    // A tap logs the latest time it was had: portions follow the habit.
    expect(regular.foods.map((f) => [f.name, f.kcal])).toEqual([["Porridge", 310], ["Coffee", 20]]);
    expect(regular.kcal).toBe(330);
    expect(regular.key).toBe(regularKey("f:coffee|f:porridge"));
  });

  it("needs three different days: twice in one day and once more is not a regular", () => {
    log(db, 1, "08:00", { foods: breakfast() });
    log(db, 1, "10:00", { foods: breakfast() });
    log(db, 2, "08:00", { foods: breakfast() });
    filler(db, [3, 4, 5]);
    expect(analyseRegulars(db, TODAY, ZONE).regulars).toEqual([]);
  });

  it("counts a meal with an extra item as the same meal, and keeps the usual version", () => {
    log(db, 1, "08:00", { foods: [...breakfast(), food("Banana")] });
    log(db, 2, "08:00", { foods: breakfast() });
    log(db, 3, "08:00", { foods: [food("2 porridge!"), food("coffee")] });
    filler(db, [4, 5]);
    const regulars = analyseRegulars(db, TODAY, ZONE).regulars;
    expect(regulars).toHaveLength(1);
    expect(regulars[0].days_seen).toBe(3);
    expect(regulars[0].foods.map((f) => f.name)).toEqual(["Porridge", "Coffee"]);
  });

  it("keeps meals that only share an item apart", () => {
    for (const d of [1, 2, 3]) log(db, d, "08:00", { foods: [food("Porridge"), food("Coffee")] });
    for (const d of [4, 5, 6]) log(db, d, "13:00", { foods: [food("Sandwich"), food("Coffee"), food("Crisps")] });
    const names = analyseRegulars(db, TODAY, ZONE).regulars.map((r) => r.name);
    expect(names).toEqual(["Porridge, Coffee", "Sandwich, Coffee, Crisps"]);
  });

  it("takes an activity by its sport, whatever the session was called", () => {
    const tennis = (name: string) => [sampleExercise({ name, activity: "tennis", category: "sport", kcal: 480 })];
    log(db, 1, "18:00", { exercises: tennis("Tennis singles") });
    log(db, 3, "18:30", { exercises: tennis("Tennis doubles") });
    log(db, 5, "18:15", { exercises: tennis("Tennis singles") });
    filler(db, [2, 4]);
    const [regular] = analyseRegulars(db, TODAY, ZONE).regulars;
    expect(regular).toMatchObject({ kind: "activity", name: "Tennis singles", days_seen: 3, kcal: 480, typical_time: "18:15" });
  });

  it("never mixes a meal with an activity", () => {
    for (const d of [1, 2]) log(db, d, "08:00", { foods: [food("Banana")] });
    log(db, 3, "08:00", { exercises: [sampleExercise({ name: "Banana" })] });
    filler(db, [4, 5]);
    expect(analyseRegulars(db, TODAY, ZONE).regulars).toEqual([]);
  });

  it("looks only at the last four weeks", () => {
    for (const d of [28, 29, 30]) log(db, d, "08:00", { foods: breakfast() });
    filler(db, [1, 2, 3, 4, 5]);
    expect(analyseRegulars(db, TODAY, ZONE).regulars).toEqual([]);
  });

  it("keeps the person's edits to a regular, under the same key, as the habit goes on", () => {
    for (const d of [2, 3, 4]) log(db, d, "08:00", { foods: breakfast() });
    filler(db, [5, 6]);
    const [found] = analyseRegulars(db, TODAY, ZONE).regulars;
    saveRegularEdit(db, found.key, { name: "Usual breakfast", foods: [{ ...found.foods[0], kcal: 350 }], exercises: [] }, NOW_ISO);
    log(db, 1, "08:05", { foods: breakfast() });
    const [edited] = analyseRegulars(db, TODAY, ZONE).regulars;
    expect(edited).toMatchObject({ key: found.key, name: "Usual breakfast", edited: true, days_seen: 4, kcal: 350 });
    expect(edited.foods.map((f) => f.name)).toEqual(["Porridge"]);
  });

  it("never offers a removed regular again", () => {
    for (const d of [1, 2, 3]) log(db, d, "08:00", { foods: breakfast() });
    filler(db, [4, 5]);
    const [found] = analyseRegulars(db, TODAY, ZONE).regulars;
    dismissRegular(db, found.key, NOW_ISO);
    log(db, 0, "08:00", { foods: breakfast() });
    expect(analyseRegulars(db, TODAY, ZONE).regulars).toEqual([]);
  });

  it("counts an entry logged with a tap towards its regular, even after the regular's items were edited", () => {
    for (const d of [2, 3, 4]) log(db, d, "08:00", { foods: breakfast() });
    filler(db, [5, 6]);
    const [found] = analyseRegulars(db, TODAY, ZONE).regulars;
    saveRegularEdit(db, found.key, { name: "Oats", foods: [food("Oats with honey", 400)], exercises: [] }, NOW_ISO);
    log(db, 0, "08:00", { foods: [food("Oats with honey", 400)], source: "regular", regular_key: found.key });
    const regulars = analyseRegulars(db, TODAY, ZONE).regulars;
    expect(regulars).toHaveLength(1);
    expect(regulars[0]).toMatchObject({ key: found.key, days_seen: 4, logged_today: true });
  });
});

describe("normalizeName", () => {
  it("compares names without case, numbers or punctuation", () => {
    expect(normalizeName("  2 Fried EGGS!  ")).toBe("fried eggs");
    expect(normalizeName("Café au lait (large)")).toBe("café au lait large");
    expect(normalizeName("鸡蛋")).toBe("鸡蛋");
  });
});

describe("suggestRegulars", () => {
  function three() {
    for (const d of [1, 2, 3]) {
      log(db, d, "08:00", { foods: breakfast() });
      log(db, d, "12:30", { foods: [food("Chicken salad")] });
      log(db, d, "23:30", { foods: [food("Herbal tea")] });
    }
    filler(db, [4, 5]);
    return analyseRegulars(db, TODAY, ZONE);
  }

  it("offers what is usually logged within four hours of now, nearest first", () => {
    const analysis = three();
    expect(suggestRegulars(analysis, 11 * 60).map((r) => r.name)).toEqual(["Chicken salad", "Porridge, Coffee"]);
    expect(suggestRegulars(analysis, 17 * 60)).toEqual([]);
  });

  it("reaches across midnight", () => {
    expect(suggestRegulars(three(), 60).map((r) => r.name)).toEqual(["Herbal tea"]);
  });

  it("leaves out what is already logged today", () => {
    log(db, 0, "12:00", { foods: [food("Chicken salad")] });
    expect(suggestRegulars(three(), 11 * 60).map((r) => r.name)).toEqual(["Porridge, Coffee"]);
  });
});

describe("regulars routes", () => {
  let ctx: TestApp | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  async function withBreakfast(): Promise<TestApp> {
    const app = await testApp({ now: new Date("2026-10-03T07:00:00.000Z") }); // 08:00 in London
    saveProfile(app.db, makeProfile(), NOW_ISO);
    for (const d of [1, 2, 3]) log(app.db, d, "08:00", { foods: breakfast() });
    filler(app.db, [4, 5]);
    return app;
  }

  it("lists the regulars, and refuses before there is a profile", async () => {
    ctx = await testApp();
    expect((await ctx.app.inject({ method: "GET", url: "/api/regulars", headers: ctx.headers })).statusCode).toBe(409);
    await ctx.close();
    ctx = await withBreakfast();
    const res = await ctx.app.inject({ method: "GET", url: "/api/regulars", headers: ctx.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data_days: 5, required_days: 5, regulars: [{ name: "Porridge, Coffee" }] });
    expect(res.json()).not.toHaveProperty("minutesByKey");
  });

  it("suggests today's regular in the day view, logs it with one tap, once, and stops suggesting it", async () => {
    ctx = await withBreakfast();
    const day = (await ctx.app.inject({ method: "GET", url: "/api/days/today", headers: ctx.headers })).json();
    expect(day.suggestions.map((r: { name: string }) => r.name)).toEqual(["Porridge, Coffee"]);
    const key = day.suggestions[0].key;
    const id = randomUUID();
    const tap = () => ctx!.app.inject({ method: "POST", url: `/api/regulars/${key}/log`, headers: ctx!.headers, payload: { id } });
    const first = await tap();
    expect(first.statusCode).toBe(201);
    expect(first.json().entry).toMatchObject({ id, date: TODAY, source: "regular", foods: [{ name: "Porridge" }, { name: "Coffee" }] });
    expect(first.json().day.suggestions).toEqual([]);
    expect((await tap()).statusCode).toBe(200);
    const today = (await ctx.app.inject({ method: "GET", url: "/api/days/today", headers: ctx.headers })).json();
    expect(today.entries).toHaveLength(1);
    // Another day's view never carries suggestions.
    expect((await ctx.app.inject({ method: "GET", url: "/api/days/2026-10-02", headers: ctx.headers })).json().suggestions).toEqual([]);
  });

  it("edits a regular's name and items, but has no way to add one", async () => {
    ctx = await withBreakfast();
    const [regular] = (await ctx.app.inject({ method: "GET", url: "/api/regulars", headers: ctx.headers })).json().regulars;
    const edit = { name: "My breakfast", foods: [{ ...regular.foods[0], kcal: 333 }], exercises: [] };
    const put = await ctx.app.inject({ method: "PUT", url: `/api/regulars/${regular.key}`, headers: ctx.headers, payload: edit });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ key: regular.key, name: "My breakfast", kcal: 333, edited: true });
    const unknown = await ctx.app.inject({ method: "PUT", url: "/api/regulars/0123456789abcdef", headers: ctx.headers, payload: edit });
    expect(unknown.statusCode).toBe(404);
    const empty = await ctx.app.inject({ method: "PUT", url: `/api/regulars/${regular.key}`, headers: ctx.headers, payload: { name: "x", foods: [], exercises: [] } });
    expect(empty.statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "POST", url: "/api/regulars", headers: ctx.headers, payload: edit })).statusCode).toBe(404);
  });

  it("removes a regular for good", async () => {
    ctx = await withBreakfast();
    const [regular] = (await ctx.app.inject({ method: "GET", url: "/api/regulars", headers: ctx.headers })).json().regulars;
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/regulars/${regular.key}`, headers: ctx.headers })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: "GET", url: "/api/regulars", headers: ctx.headers })).json().regulars).toEqual([]);
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/regulars/${regular.key}`, headers: ctx.headers })).statusCode).toBe(404);
    const log404 = await ctx.app.inject({ method: "POST", url: `/api/regulars/${regular.key}/log`, headers: ctx.headers, payload: { id: randomUUID() } });
    expect(log404.statusCode).toBe(404);
  });
});
