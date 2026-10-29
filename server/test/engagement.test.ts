import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { messages } from "../src/db/schema.ts";
import { actionsOf, engagementOf, mondayOf } from "../src/engagement/engagement.ts";
import type { ActionKind } from "../src/engagement/engagement.ts";
import { engagementReader } from "../src/engagement/metrics.ts";
import { insertEntry } from "../src/log/entries.ts";
import { createMetrics, registerEngagement } from "../src/metrics.ts";
import { personKey } from "../src/people/people.ts";
import type { People, Store } from "../src/people/people.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { makeProfile, openTestDb, sampleEntry, sampleExercise } from "./helpers.ts";

const OWNER_KEY = personKey("owner@example.com");
const silent = { error: () => {} } as unknown as FastifyBaseLogger;
const series = (text: string, name: string) => text.split("\n").filter((line) => line.startsWith(`${name}{`)).sort();
let db: ReturnType<typeof openTestDb> | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

const act = (date: string, kind: ActionKind) => ({ date, kind });
/** Meals on three days of the first week and a coach message: activated. */
const ACTIVE_START = [act("2026-10-01", "meal"), act("2026-10-02", "meal"), act("2026-10-04", "meal"), act("2026-10-05", "coach")];

function say(sql: ReturnType<typeof openTestDb>["db"], createdAt: string, role = "user") {
  sql.insert(messages).values({ id: randomUUID(), date: createdAt.slice(0, 10), role, text: "hi", cards: [], created_at: createdAt }).run();
}

describe("engagement", () => {
  it("starts on the first action, in the week of its Monday", () => {
    expect(mondayOf("2026-10-29")).toBe("2026-10-26");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    const e = engagementOf(ACTIVE_START, null, "2026-10-05");
    expect(e).toMatchObject({ start: "2026-10-01", cohort: "2026-09-28", activated: "yes", retained: [], channel: "unknown", onboarded: false });
  });

  it("activates on meals on 3 days and a coach chat in the first week, and is pending until that week is over", () => {
    const twoDays = [act("2026-10-01", "meal"), act("2026-10-01", "meal"), act("2026-10-02", "meal"), act("2026-10-02", "coach")];
    expect(engagementOf(twoDays, null, "2026-10-07").activated).toBe("pending");
    expect(engagementOf(twoDays, null, "2026-10-08").activated).toBe("no");
    // A third meal day after the first week is too late.
    expect(engagementOf([...twoDays, act("2026-10-08", "meal")], null, "2026-10-09").activated).toBe("no");
    expect(engagementOf(ACTIVE_START.filter((a) => a.kind === "meal"), null, "2026-10-20").activated).toBe("no");
    expect(engagementOf([], null, "2026-10-20")).toMatchObject({ start: null, cohort: null, activated: null, retained: [] });
  });

  it("reports retention for each week after the first that has ended", () => {
    const actions = [...ACTIVE_START, act("2026-10-09", "workout"), act("2026-10-22", "coach"), act("2026-10-29", "meal")];
    // Week 1 is 8 to 14 October, week 2 is 15 to 21, week 3 is 22 to 28; week 4 (29 Oct to 4 Nov) is still running.
    expect(engagementOf(actions, null, "2026-10-29").retained).toEqual([
      { week: 1, active: true }, { week: 2, active: false }, { week: 3, active: true },
    ]);
    expect(engagementOf(actions, null, "2026-11-05").retained.at(-1)).toEqual({ week: 4, active: true });
  });

  it("counts active days and each week's actions", () => {
    const actions = [act("2026-10-29", "meal"), act("2026-10-29", "meal"), act("2026-10-27", "coach"), act("2026-10-20", "workout"), act("2026-09-01", "meal")];
    const e = engagementOf(actions, makeProfile({ about: { heard_from: "friend" }, onboarding: "done" }), "2026-10-29");
    expect(e.activeDays).toEqual({ d7: 2, d28: 3 });
    expect(e.channel).toBe("friend");
    expect(e.onboarded).toBe(true);
    expect(e.weekly).toHaveLength(8 * 3);
    expect(e.weekly.filter((w) => w.week === "2026-10-26")).toEqual([
      { week: "2026-10-26", kind: "meal", count: 2 }, { week: "2026-10-26", kind: "workout", count: 0 }, { week: "2026-10-26", kind: "coach", count: 1 },
    ]);
    expect(e.weekly[0].week).toBe("2026-09-07");
  });

  it("reads the person's own actions on their local day, leaving out Apple Health imports and the coach's replies", () => {
    db = openTestDb();
    insertEntry(db.db, sampleEntry(), "2026-10-03T23:30:00.000Z");
    insertEntry(db.db, sampleEntry({ foods: [], exercises: [sampleExercise()] }), "2026-10-04T08:00:00.000Z");
    insertEntry(db.db, sampleEntry({ source: "apple_health", foods: [], exercises: [sampleExercise()] }), "2026-10-05T08:00:00.000Z");
    say(db.db, "2026-10-04T09:00:00.000Z");
    say(db.db, "2026-10-04T09:00:05.000Z", "assistant");
    expect(actionsOf(db.db, "Europe/Rome").sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { date: "2026-10-04", kind: "coach" }, { date: "2026-10-04", kind: "meal" }, { date: "2026-10-04", kind: "workout" },
    ]);
  });

  it("is exposed per person, read once per scrape, and leaves out a person whose records can't be read", async () => {
    db = openTestDb();
    saveProfile(db.db, makeProfile({ timezone: "Europe/London", about: { heard_from: "social" } }), "2026-10-01T12:00:00.000Z");
    for (const day of ["01", "02", "04"]) insertEntry(db.db, sampleEntry(), `2026-10-${day}T12:00:00.000Z`);
    say(db.db, "2026-10-05T12:00:00.000Z");
    insertEntry(db.db, sampleEntry(), "2026-10-09T12:00:00.000Z");
    const unreadable = { key: personKey("friend@example.com"), db: { select: () => { throw new Error("SQLITE_IOERR"); } } } as unknown as Store;
    let reads = 0;
    const people = { opened: () => { reads++; return [unreadable, { key: OWNER_KEY, db: db!.db } as unknown as Store]; } } as unknown as People;
    const metrics = createMetrics(new Map([[OWNER_KEY, "owner@example.com"]]));
    registerEngagement(metrics, engagementReader(people, OWNER_KEY, () => new Date("2026-10-23T12:00:00.000Z"), silent));
    const text = await metrics.registry.metrics();
    expect(reads).toBe(1);
    const who = 'person="owner@example.com",role="owner",cohort="2026-09-28",activated="yes"';
    expect(series(text, "fitnessai_engagement_person")).toEqual([`fitnessai_engagement_person{${who},channel="social",onboarded="no"} 1`]);
    expect(series(text, "fitnessai_engagement_retained")).toEqual([
      `fitnessai_engagement_retained{${who},week="1"} 1`,
      `fitnessai_engagement_retained{${who},week="2"} 0`,
    ]);
    expect(series(text, "fitnessai_engagement_active_days")).toEqual([
      'fitnessai_engagement_active_days{person="owner@example.com",role="owner",window="28d"} 5',
      'fitnessai_engagement_active_days{person="owner@example.com",role="owner",window="7d"} 0',
    ]);
    expect(series(text, "fitnessai_engagement_actions_week").filter((line) => line.includes('week="2026-10-05"'))).toEqual([
      'fitnessai_engagement_actions_week{person="owner@example.com",role="owner",kind="coach",week="2026-10-05"} 1',
      'fitnessai_engagement_actions_week{person="owner@example.com",role="owner",kind="meal",week="2026-10-05"} 1',
      'fitnessai_engagement_actions_week{person="owner@example.com",role="owner",kind="workout",week="2026-10-05"} 0',
    ]);
  });
});
