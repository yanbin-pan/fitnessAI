import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDay, getDay } from "../src/days/days.ts";
import { NOW, makeProfile, testApp } from "./helpers.ts";
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
});

describe("entry routes", () => {
  const banana = { name: "Banana", kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 };

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
});
