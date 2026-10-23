import { afterEach, describe, expect, it } from "vitest";
import { testApp } from "./helpers.ts";

const PROFILE = { sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80, activity_level: "light", goal: "maintain", goal_rate_kg_week: 0, timezone: "Europe/Rome" };
let ctx: Awaited<ReturnType<typeof testApp>> | undefined;
afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

describe("tips", () => {
  it("are kept once each, on the person's local day, at most two a day", async () => {
    // 23:30 in London is the next day in Rome.
    ctx = await testApp({ now: new Date("2026-10-23T23:30:00.000Z") });
    const post = (payload: Record<string, unknown>) => ctx!.app.inject({ method: "POST", url: "/api/tips", headers: ctx!.headers, payload });
    expect((await post({ id: "drinks" })).statusCode).toBe(409);
    expect((await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: PROFILE })).statusCode).toBe(200);

    const first = await post({ id: "close-day", vars: { kcal: 620, protein_g: 41 } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ tips: [{ id: "close-day", date: "2026-10-24", seen_at: "2026-10-23T23:30:00.000Z", vars: { kcal: 620, protein_g: 41 } }] });
    // Shown again (a lost answer): nothing changes.
    expect((await post({ id: "close-day", vars: { kcal: 1 } })).json().tips).toHaveLength(1);
    expect((await post({ id: "vitamin-gaps", vars: { nutrients: ["iron_mg"] } })).statusCode).toBe(200);
    expect((await post({ id: "drinks" })).json()).toEqual({ error: "tip_limit" });

    const all = await ctx.app.inject({ method: "GET", url: "/api/tips", headers: ctx.headers });
    expect(all.json().tips.map((tip: { id: string }) => tip.id)).toEqual(["close-day", "vitamin-gaps"]);
  });

  it("refuse an unknown tip or unknown numbers", async () => {
    ctx = await testApp();
    await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: PROFILE });
    const post = (payload: Record<string, unknown>) => ctx!.app.inject({ method: "POST", url: "/api/tips", headers: ctx!.headers, payload });
    expect((await post({ id: "nope" })).statusCode).toBe(400);
    expect((await post({ id: "drinks", vars: { secret: 1 } })).statusCode).toBe(400);
    expect((await post({ id: "vitamin-gaps", vars: { nutrients: ["vitamin_x"] } })).statusCode).toBe(400);
  });
});
