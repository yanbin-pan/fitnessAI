import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { insertEntry } from "../src/log/entries.ts";
import type { FoodItemData } from "../src/log/entries.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { addDays } from "../src/shared.ts";
import { zonedTimeToInstant } from "../src/time.ts";
import { NOW, makeProfile, sampleEntry, sampleFood, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const TODAY = "2026-10-03";
const ZONE = "Europe/London";
const NOW_ISO = NOW.toISOString();

function log(ctx: TestApp, daysAgo: number, time: string, foods: FoodItemData[]) {
  const date = addDays(TODAY, -daysAgo);
  ctx.db.transaction((tx) =>
    insertEntry(tx, sampleEntry({ id: randomUUID(), date, logged_at: zonedTimeToInstant(date, time, ZONE).toISOString(), foods, exercises: [], source: "manual" }), NOW_ISO),
  );
}

const food = (name: string, kcal = 100) => sampleFood({ name, kcal });
const DINNERS = ["Pasta", "Curry", "Risotto", "Stew", "Tacos"];

describe("frequent items", () => {
  let ctx: TestApp | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  /** 08:00 in London, with porridge three mornings running (a regular) and five different dinners. */
  async function setup(): Promise<TestApp> {
    const app = await testApp({ now: new Date("2026-10-03T07:00:00.000Z") });
    saveProfile(app.db, makeProfile(), NOW_ISO);
    for (const d of [1, 2, 3]) log(app, d, "08:00", [food("Porridge", 300), food("Coffee", 20)]);
    for (const d of [1, 2, 3, 4, 5]) log(app, d, "19:00", [food(DINNERS[d - 1])]);
    return app;
  }
  const req = (method: "GET" | "PUT" | "DELETE" | "POST", url: string, payload?: object) => ctx!.app.inject({ method, url, headers: ctx!.headers, payload });
  const day = async () => (await req("GET", "/api/days/today")).json();

  it("pins a suggested regular: it moves to the pinned list and is no longer suggested", async () => {
    ctx = await setup();
    const before = (await req("GET", "/api/frequent")).json();
    expect(before.items).toEqual([]);
    const [regular] = before.suggestions;
    const id = randomUUID();
    const put = await req("PUT", `/api/frequent/${id}`, { name: "Porridge", foods: regular.foods, exercises: [], slot: "morning", source_key: regular.key });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ id, name: "Porridge", kcal: 320, slot: "morning", times_logged: 0, logged_today: false });
    const after = (await req("GET", "/api/frequent")).json();
    expect(after.items.map((i: { id: string }) => i.id)).toEqual([id]);
    expect(after.suggestions).toEqual([]);
    expect((await day()).quick).toMatchObject([{ ref: `f:${id}`, name: "Porridge", pinned: true, due: true }]);
  });

  it("pins a regular as it is, around its usual part of the day, once", async () => {
    ctx = await setup();
    const key = (await day()).quick[0].ref.slice(2);
    const id = randomUUID();
    const first = await req("POST", `/api/regulars/${key}/pin`, { id });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ id, name: "Porridge, Coffee", slot: "morning", source_key: key, kcal: 320 });
    expect((await req("POST", `/api/regulars/${key}/pin`, { id })).statusCode).toBe(200);
    expect((await req("GET", "/api/frequent")).json()).toMatchObject({ items: [{ id }], suggestions: [] });
    expect((await req("POST", "/api/regulars/0123456789abcdef/pin", { id: randomUUID() })).statusCode).toBe(404);
  });

  it("hides a suggestion that is much the same as something pinned by hand", async () => {
    ctx = await setup();
    await req("PUT", `/api/frequent/${randomUUID()}`, { name: "Oats", foods: [food("Porridge"), food("Coffee")], exercises: [] });
    expect((await req("GET", "/api/frequent")).json().suggestions).toEqual([]);
  });

  it("logs a pinned item with one tap, once, and keeps it on the list after the suggestions", async () => {
    ctx = await setup();
    const morning = randomUUID();
    const evening = randomUUID();
    await req("PUT", `/api/frequent/${evening}`, { name: "Shake", foods: [food("Whey", 120)], exercises: [], slot: "evening" });
    await req("PUT", `/api/frequent/${morning}`, { name: "Toast", foods: [food("Toast", 200)], exercises: [], slot: "morning" });
    // Due (morning) first, then the evening one; then the suggested porridge.
    expect((await day()).quick.map((q: { name: string; due: boolean }) => [q.name, q.due])).toEqual([["Toast", true], ["Shake", false], ["Porridge, Coffee", true]]);
    const entryId = randomUUID();
    const tap = () => req("POST", `/api/frequent/${morning}/log`, { id: entryId });
    const first = await tap();
    expect(first.statusCode).toBe(201);
    expect(first.json().entry).toMatchObject({ id: entryId, date: TODAY, source: "regular", foods: [{ name: "Toast", kcal: 200 }] });
    expect((await tap()).statusCode).toBe(200);
    const quick = (await day()).quick;
    expect(quick.map((q: { name: string }) => q.name)).toEqual(["Shake", "Toast", "Porridge, Coffee"]);
    expect(quick[1]).toMatchObject({ logged_today: true, due: false });
    expect((await req("GET", "/api/frequent")).json().items.find((i: { id: string }) => i.id === morning)).toMatchObject({ times_logged: 1, logged_today: true });
  });

  it("edits in place, refuses an item with nothing in it, and unpins (twice is fine)", async () => {
    ctx = await setup();
    const id = randomUUID();
    await req("PUT", `/api/frequent/${id}`, { name: "Toast", foods: [food("Toast", 200)], exercises: [] });
    const edited = await req("PUT", `/api/frequent/${id}`, { name: "Two toasts", foods: [food("Toast", 400)], exercises: [], slot: "midday" });
    expect(edited.json()).toMatchObject({ id, name: "Two toasts", kcal: 400, slot: "midday" });
    expect((await req("PUT", `/api/frequent/${id}`, { name: "Empty", foods: [], exercises: [] })).statusCode).toBe(400);
    expect((await req("PUT", "/api/frequent/not-an-id", { name: "x", foods: [food("x")], exercises: [] })).statusCode).toBe(404);
    expect((await req("DELETE", `/api/frequent/${id}`)).statusCode).toBe(204);
    expect((await req("DELETE", `/api/frequent/${id}`)).statusCode).toBe(204);
    expect((await req("GET", "/api/frequent")).json().items).toEqual([]);
    expect((await req("POST", `/api/frequent/${id}/log`, { id: randomUUID() })).statusCode).toBe(404);
  });

  it("refuses before there is a profile", async () => {
    ctx = await testApp();
    expect((await req("GET", "/api/frequent")).statusCode).toBe(409);
  });
});
