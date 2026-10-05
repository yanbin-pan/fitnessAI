import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDay, getDay } from "../src/days/days.ts";
import { insertEntry } from "../src/log/entries.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { NOW, makeProfile, sampleEntry, sampleFood, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const PROFILE = {
  sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80,
  activity_level: "light", goal: "lose", goal_rate_kg_week: 0.5,
};

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function withProfile(extra: Record<string, unknown> = {}): Promise<TestApp> {
  const app = await testApp();
  const res = await app.app.inject({ method: "PUT", url: "/api/profile", headers: app.headers, payload: { ...PROFILE, ...extra } });
  expect(res.statusCode).toBe(200);
  return app;
}

describe("profile routes", () => {
  it("404 before a profile exists, then save one and return the calculated targets", async () => {
    ctx = await testApp();
    expect((await ctx.app.inject({ method: "GET", url: "/api/profile", headers: ctx.headers })).statusCode).toBe(404);
    const put = await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: { ...PROFILE, override_kcal: 2000 } });
    expect(put.statusCode).toBe(200);
    expect(put.json().profile).toMatchObject({ weight_kg: 80, override_kcal: 2000, timezone: "Europe/London" });
    expect(put.json().calculated.kcal).toBeCloseTo(1863.125, 6);
    const get = await ctx.app.inject({ method: "GET", url: "/api/profile", headers: ctx.headers });
    expect(get.json().profile.override_kcal).toBe(2000);
  });

  it("reject an invalid profile and say what is wrong", async () => {
    ctx = await testApp();
    const res = await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: { ...PROFILE, height_cm: 20 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request", issues: [{ path: "height_cm" }] });
  });

  it("update today's snapshot but leave earlier days alone", async () => {
    ctx = await withProfile();
    ensureDay(ctx.db, makeProfile(), "2026-10-02", NOW.toISOString());
    await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: { ...PROFILE, override_kcal: 2100 } });
    expect(getDay(ctx.db, "2026-10-03")?.base_kcal).toBe(2100);
    expect(getDay(ctx.db, "2026-10-02")?.base_kcal).toBeCloseTo(1863.125, 6);
  });
});

describe("day routes", () => {
  it("ask for a profile first", async () => {
    ctx = await testApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/days/today", headers: ctx.headers });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_profile" });
  });

  it("return today's view and create today's row", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({ method: "GET", url: "/api/days/today", headers: ctx.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ date: "2026-10-03", today: "2026-10-03", entries: [], messages: [] });
    expect(getDay(ctx.db, "2026-10-03")).not.toBeNull();
  });

  it("reject a malformed date", async () => {
    ctx = await withProfile();
    expect((await ctx.app.inject({ method: "GET", url: "/api/days/2026-02-30", headers: ctx.headers })).statusCode).toBe(400);
  });

  it("create today's row when today is opened, and no row for any other date", async () => {
    ctx = await testApp();
    // Saved straight to the table: the PUT route also creates today's row, which would hide the GET's own effect.
    saveProfile(ctx.db, makeProfile(), NOW.toISOString());
    expect(getDay(ctx.db, "2026-10-03")).toBeNull();
    await ctx.app.inject({ method: "GET", url: "/api/days/2026-10-01", headers: ctx.headers });
    await ctx.app.inject({ method: "GET", url: "/api/days/2026-10-04", headers: ctx.headers });
    expect(getDay(ctx.db, "2026-10-01")).toBeNull();
    expect(getDay(ctx.db, "2026-10-04")).toBeNull();
    await ctx.app.inject({ method: "GET", url: "/api/days/today", headers: ctx.headers });
    expect(getDay(ctx.db, "2026-10-03")).not.toBeNull();
  });
});

describe("GET /api/days?from=&to=", () => {
  it("summarises the days with food, and says which way the goal points", async () => {
    ctx = await withProfile({ goal: "gain", goal_rate_kg_week: 0.25 });
    insertEntry(ctx.db, sampleEntry({ date: "2026-10-02", foods: [sampleFood({ kcal: 2600 })] }), NOW.toISOString());
    const res = await ctx.app.inject({ method: "GET", url: "/api/days?from=2026-09-28&to=2026-11-08", headers: ctx.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ goal: "gain", days: [{ date: "2026-10-02", kcal: 2600, target_kcal: expect.any(Number) }] });
  });

  it("refuses a missing, invalid, reversed or longer than six-week range", async () => {
    ctx = await withProfile();
    const bad = ["", "?from=2026-10-01", "?from=2026-10-05&to=2026-10-01", "?from=2026-10-01&to=2026-11-12", "?from=2026-02-30&to=2026-03-01", "?from=2026-10-01&from=2026-10-02&to=2026-10-03"];
    for (const query of bad) {
      const res = await ctx.app.inject({ method: "GET", url: `/api/days${query}`, headers: ctx.headers });
      expect(res.statusCode, query).toBe(400);
      expect(res.json(), query).toEqual({ error: "bad_range" });
    }
    const sixWeeks = await ctx.app.inject({ method: "GET", url: "/api/days?from=2026-10-01&to=2026-11-11", headers: ctx.headers });
    expect(sixWeeks.statusCode).toBe(200); // exactly 42 days
  });

  it("answers a range that ends on the last date there is", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({ method: "GET", url: "/api/days?from=9999-12-30&to=9999-12-31", headers: ctx.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ goal: "lose", days: [] });
  });

  it("needs a profile, and the owner's token", async () => {
    ctx = await testApp();
    const noProfile = await ctx.app.inject({ method: "GET", url: "/api/days?from=2026-10-01&to=2026-10-03", headers: ctx.headers });
    expect(noProfile.statusCode).toBe(409);
    const anonymous = await ctx.app.inject({ method: "GET", url: "/api/days?from=2026-10-01&to=2026-10-03" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body).toBe("");
  });
});

describe("entry routes", () => {
  const banana = { name: "Banana", kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 };
  const run = { name: "Run", category: "cardio", duration_min: 30, met: 9 };

  it("add a manual entry and return the updated day", async () => {
    ctx = await withProfile();
    const id = randomUUID();
    const res = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-10-03", foods: [banana] } });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry).toMatchObject({ id, source: "manual", logged_at: NOW.toISOString() });
    expect(res.json().day.totals.kcal).toBe(105);
  });

  it("treat a repeated id as the same entry", async () => {
    ctx = await withProfile();
    const payload = { id: randomUUID(), date: "2026-10-03", foods: [banana] };
    await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload });
    const again = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload });
    expect(again.statusCode).toBe(200);
    expect(again.json().day.entries).toHaveLength(1);
  });

  it("use the given local time", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id: randomUUID(), date: "2026-10-03", time: "07:30", foods: [banana] } });
    expect(res.json().entry.logged_at).toBe("2026-10-03T06:30:00.000Z");
  });

  it("work out exercise calories from MET and adjust the targets", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({
      method: "POST", url: "/api/entries", headers: ctx.headers,
      payload: { id: randomUUID(), date: "2026-10-03", exercises: [{ name: "Run", category: "cardio", duration_min: 30, met: 9 }] },
    });
    expect(res.json().entry.exercises[0].kcal).toBe(320); // (9 − 1) × 80 kg × 0.5 h
    expect(res.json().day.targets.add_back_kcal).toBe(160);
  });

  it("stores a manual exercise's activity, defaulting to other", async () => {
    ctx = await testApp();
    saveProfile(ctx.db, makeProfile(), NOW.toISOString());
    const post = (exercise: Record<string, unknown>) =>
      ctx!.app.inject({
        method: "POST", url: "/api/entries", headers: ctx!.headers,
        payload: { id: randomUUID(), date: "2026-10-03", time: null, foods: [], exercises: [exercise] },
      });
    const plain = await post({ name: "Walk", category: "cardio", duration_min: 30, met: 3.5 });
    expect(plain.json().entry.exercises[0].activity).toBe("other");
    const kite = await post({ name: "Kite session", category: "sport", activity: "kitesurfing", duration_min: 60, met: 8 });
    expect(kite.json().entry.exercises[0].activity).toBe("kitesurfing");
  });

  it("refuse a future date", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id: randomUUID(), date: "2026-10-04", foods: [banana] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "future_date" });
  });

  it("refuse a date more than 7 days back", async () => {
    ctx = await withProfile();
    const tooOld = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id: randomUUID(), date: "2026-09-25", foods: [banana] } });
    expect(tooOld.statusCode).toBe(400);
    expect(tooOld.json()).toEqual({ error: "too_old" });
    const oldest = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id: randomUUID(), date: "2026-09-26", foods: [banana] } });
    expect(oldest.statusCode).toBe(201);
  });

  it("replace items with PATCH and mark the entry edited", async () => {
    ctx = await withProfile();
    const id = randomUUID();
    await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-10-03", foods: [banana] } });
    const res = await ctx.app.inject({ method: "PATCH", url: `/api/entries/${id}`, headers: ctx.headers, payload: { foods: [{ ...banana, kcal: 120 }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry).toMatchObject({ edited: true, foods: [{ kcal: 120 }] });
    expect(res.json().day.totals.kcal).toBe(120);
  });

  it("delete with DELETE, then 404", async () => {
    ctx = await withProfile();
    const id = randomUUID();
    await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-10-03", foods: [banana] } });
    const res = await ctx.app.inject({ method: "DELETE", url: `/api/entries/${id}`, headers: ctx.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().day.entries).toEqual([]);
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/entries/${id}`, headers: ctx.headers })).statusCode).toBe(404);
  });

  it("leave a stored entry untouched when its id is repeated, whatever the new payload says", async () => {
    ctx = await withProfile();
    const id = randomUUID();
    await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-10-03", foods: [banana] } });
    const again = await ctx.app.inject({
      method: "POST", url: "/api/entries", headers: ctx.headers,
      payload: { id, date: "2026-10-02", foods: [{ ...banana, name: "Pizza", kcal: 900 }] },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().entry).toMatchObject({ date: "2026-10-03", edited: false, foods: [{ name: "Banana", kcal: 105 }] });
    expect(again.json().day).toMatchObject({ date: "2026-10-03" });
    expect(again.json().day.totals.kcal).toBe(105);
  });

  it("answer a repeat of a stored entry with 200 even after its date has left the window", async () => {
    ctx = await withProfile();
    const id = randomUUID();
    insertEntry(ctx.db, sampleEntry({ id, date: "2026-09-20", logged_at: "2026-09-20T11:00:00.000Z" }), NOW.toISOString());
    const again = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-09-20", foods: [banana] } });
    expect(again.statusCode).toBe(200);
    expect(again.json().entry).toMatchObject({ id, date: "2026-09-20" });
  });

  it("freeze a back-dated entry's day, place it at 12:00 local and return that day", async () => {
    ctx = await withProfile();
    expect(getDay(ctx.db, "2026-09-30")).toBeNull();
    const id = randomUUID();
    const res = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-09-30", foods: [banana] } });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.logged_at).toBe("2026-09-30T11:00:00.000Z"); // 12:00 BST
    expect(res.json().day).toMatchObject({ date: "2026-09-30", today: "2026-10-03" });
    expect(res.json().day.totals.kcal).toBe(105);
    expect(getDay(ctx.db, "2026-09-30")).not.toBeNull();
    const del = await ctx.app.inject({ method: "DELETE", url: `/api/entries/${id}`, headers: ctx.headers });
    expect(del.json().day).toMatchObject({ date: "2026-09-30", entries: [] });
  });

  it("work out exercise calories from the day's frozen weight, on POST and on PATCH", async () => {
    ctx = await withProfile();
    ensureDay(ctx.db, makeProfile(), "2026-10-02", NOW.toISOString()); // frozen at 80 kg
    await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: { ...PROFILE, weight_kg: 70 } });
    const id = randomUUID();
    const created = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-10-02", exercises: [run] } });
    expect(created.json().entry.exercises[0].kcal).toBe(320); // (9 − 1) × 80 kg × 0.5 h, not today's 70 kg
    const patched = await ctx.app.inject({ method: "PATCH", url: `/api/entries/${id}`, headers: ctx.headers, payload: { exercises: [run] } });
    expect(patched.json().entry.exercises[0].kcal).toBe(320);
  });

  it("keep the exercise kcal the client gives, even zero, and derive nothing without a duration", async () => {
    const app = await withProfile();
    ctx = app;
    const kcalOf = async (item: Record<string, unknown>) => {
      const res = await app.app.inject({
        method: "POST", url: "/api/entries", headers: app.headers,
        payload: { id: randomUUID(), date: "2026-10-03", exercises: [{ name: "Yoga", category: "mobility", ...item }] },
      });
      return res.json().entry.exercises[0].kcal;
    };
    expect(await kcalOf({ kcal: 250, met: 3, duration_min: 60 })).toBe(250);
    expect(await kcalOf({ kcal: 0, met: 3, duration_min: 60 })).toBe(0);
    expect(await kcalOf({ met: 3 })).toBe(0);
  });

  it("answer PATCH for an unknown id with 404", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({ method: "PATCH", url: `/api/entries/${randomUUID()}`, headers: ctx.headers, payload: { foods: [banana] } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("ignore keys a client must not set", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({
      method: "POST", url: "/api/entries", headers: ctx.headers,
      payload: {
        id: randomUUID(), date: "2026-10-03", source: "apple_health", edited: true, logged_at: "2020-01-01T00:00:00.000Z",
        foods: [{ ...banana, saved_food_id: "sf-1" }],
        exercises: [{ name: "Run", category: "cardio", kcal: 10, kcal_measured: true }],
      },
    });
    expect(res.json().entry).toMatchObject({
      source: "manual", edited: false, logged_at: NOW.toISOString(),
      foods: [{ saved_food_id: null }], exercises: [{ kcal_measured: false }],
    });
  });

  it("name a bad field by its dotted path, and a problem with the whole entry by an empty path", async () => {
    ctx = await withProfile();
    const field = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id: randomUUID(), date: "2026-10-03", foods: [{ ...banana, kcal: -1 }] } });
    expect(field.json()).toMatchObject({ error: "invalid_request", issues: [{ path: "foods.0.kcal", message: expect.any(String) }] });
    const whole = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id: randomUUID(), date: "2026-10-03" } });
    expect(whole.json()).toEqual({ error: "invalid_request", issues: [{ path: "", message: "An entry needs at least one item" }] });
  });
});
