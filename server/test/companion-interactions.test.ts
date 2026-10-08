import { afterEach, describe, expect, it } from "vitest";
import { DAILY_INTERACTION_CAP, interactionCounts, recordInteraction } from "../src/companion/interactions.ts";
import { interactionsReader } from "../src/companion/metrics.ts";
import { createMetrics, registerCompanionInteractions } from "../src/metrics.ts";
import { personKey } from "../src/people/people.ts";
import type { People, Store } from "../src/people/people.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { makeProfile, openTestDb, testApp } from "./helpers.ts";
import type { FastifyBaseLogger } from "fastify";

const OWNER_KEY = personKey("owner@example.com");
const PROFILE = { sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80, activity_level: "light", goal: "maintain", goal_rate_kg_week: 0 };
let db: ReturnType<typeof openTestDb> | undefined;
let ctx: Awaited<ReturnType<typeof testApp>> | undefined;
afterEach(async () => {
  db?.close();
  db = undefined;
  await ctx?.app.close();
  ctx = undefined;
});

const series = (text: string, name: string) => text.split("\n").filter((line) => line.startsWith(`${name}{`)).sort();
const silent = { error: () => {} } as unknown as FastifyBaseLogger;

describe("companion interactions", () => {
  it("count each kind per local day, up to a daily cap", () => {
    db = openTestDb();
    for (let i = 0; i < 3; i++) recordInteraction(db.db, "2026-10-08", "pet");
    recordInteraction(db.db, "2026-10-08", "open");
    recordInteraction(db.db, "2026-09-30", "pet");
    for (let i = 0; i < DAILY_INTERACTION_CAP + 20; i++) recordInteraction(db.db, "2026-10-09", "open");
    expect(interactionCounts(db.db, ["2026-09", "2026-10"])).toEqual([
      { kind: "pet", total: 4, byMonth: [{ month: "2026-09", count: 1 }, { month: "2026-10", count: 3 }] },
      { kind: "open", total: 1 + DAILY_INTERACTION_CAP, byMonth: [{ month: "2026-09", count: 0 }, { month: "2026-10", count: 1 + DAILY_INTERACTION_CAP }] },
    ]);
  });

  it("are taken from the phone on the person's local day, and refused when they are not pet or open", async () => {
    ctx = await testApp({ now: new Date("2026-10-08T23:30:00.000Z") });
    const put = await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: { ...PROFILE, timezone: "Europe/Rome" } });
    expect(put.statusCode).toBe(200);
    const post = (kind: string) => ctx!.app.inject({ method: "POST", url: "/api/companion/interactions", headers: ctx!.headers, payload: { kind } });
    expect((await post("pet")).statusCode).toBe(204);
    expect((await post("open")).statusCode).toBe(204);
    expect((await post("feed")).statusCode).toBe(400);
  });

  it("are exposed per person: all time as a counter, this month and last (in their timezone) as a gauge, zeros included", async () => {
    db = openTestDb();
    saveProfile(db.db, makeProfile({ timezone: "Europe/London" }), "2026-10-08T12:00:00.000Z");
    recordInteraction(db.db, "2026-09-12", "pet");
    recordInteraction(db.db, "2026-10-08", "pet");
    recordInteraction(db.db, "2026-10-08", "pet");
    const people = { opened: () => [{ key: OWNER_KEY, db: db!.db } as unknown as Store] } as unknown as People;
    const metrics = createMetrics(new Map([[OWNER_KEY, "owner@example.com"]]));
    registerCompanionInteractions(metrics, interactionsReader(people, OWNER_KEY, () => new Date("2026-10-08T12:00:00.000Z"), silent));
    const text = await metrics.registry.metrics();
    expect(series(text, "fitnessai_companion_interactions_total")).toEqual([
      'fitnessai_companion_interactions_total{kind="open",person="owner@example.com",role="owner"} 0',
      'fitnessai_companion_interactions_total{kind="pet",person="owner@example.com",role="owner"} 3',
    ]);
    expect(series(text, "fitnessai_companion_interactions_month")).toEqual([
      'fitnessai_companion_interactions_month{kind="open",person="owner@example.com",role="owner",period="last_month"} 0',
      'fitnessai_companion_interactions_month{kind="open",person="owner@example.com",role="owner",period="this_month"} 0',
      'fitnessai_companion_interactions_month{kind="pet",person="owner@example.com",role="owner",period="last_month"} 1',
      'fitnessai_companion_interactions_month{kind="pet",person="owner@example.com",role="owner",period="this_month"} 2',
    ]);
  });

  it("leave out a person whose records can't be read, and still answer for the rest", async () => {
    db = openTestDb();
    const unreadable = { key: personKey("friend@example.com"), db: { select: () => { throw new Error("SQLITE_IOERR"); } } } as unknown as Store;
    const people = { opened: () => [unreadable, { key: OWNER_KEY, db: db!.db } as unknown as Store] } as unknown as People;
    const read = interactionsReader(people, OWNER_KEY, () => new Date("2026-10-08T12:00:00.000Z"), silent);
    expect(read().map((row) => row.person.key)).toEqual([OWNER_KEY, OWNER_KEY]);
  });
});
