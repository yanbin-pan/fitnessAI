import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { entries } from "../src/db/schema.ts";
import type { Sql } from "../src/db/types.ts";
import { GUEST_STARTER, OWNER_STARTER, featuredActivities, starterFor } from "../src/days/featured.ts";
import { insertEntry } from "../src/log/entries.ts";
import type { Activity } from "../src/shared.ts";
import { NOW, openTestDb, sampleEntry, sampleExercise, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const PROFILE = {
  sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80,
  activity_level: "light", goal: "lose", goal_rate_kg_week: 0.5,
};

let db: ReturnType<typeof openTestDb> | undefined;
let t: TestApp | undefined;
afterEach(async () => {
  db?.close();
  db = undefined;
  await t?.close();
  t = undefined;
});

/** One entry on `date`, logged at `time` UTC, with one exercise for each activity given. Returns its id. */
function logged(sql: Sql, date: string, activities: Activity[], time = "07:00"): string {
  const entry = sampleEntry({
    date, logged_at: `${date}T${time}:00.000Z`, foods: [], exercises: activities.map((activity) => sampleExercise({ activity })),
  });
  insertEntry(sql, entry, NOW.toISOString());
  return entry.id;
}

describe("featuredActivities", () => {
  it("is the four activities with the most exercises, ties going to the most recently logged", () => {
    db = openTestDb();
    logged(db.db, "2026-10-01", ["running", "running"]);
    logged(db.db, "2026-10-02", ["running", "golf"]);
    logged(db.db, "2026-09-20", ["tennis", "tennis"]);
    logged(db.db, "2026-09-25", ["yoga", "yoga"]);
    logged(db.db, "2026-09-30", ["cycling"], "06:00");
    logged(db.db, "2026-09-30", ["cycling"], "18:00");
    // running 3; then 2 each for cycling (last on the 30th), yoga (the 25th) and tennis (the 20th); golf 1.
    expect(featuredActivities(db.db, "2026-10-03", OWNER_STARTER)).toEqual(["running", "cycling", "yoga", "tennis"]);
  });

  it("counts the 60 days ending on the viewed day, and nothing after it", () => {
    db = openTestDb();
    logged(db.db, "2026-08-04", ["golf", "golf", "golf"]); // 61 days back, counting the 3rd itself: outside
    logged(db.db, "2026-08-05", ["boxing"]); // the 60th day: inside
    logged(db.db, "2026-10-04", ["skiing", "skiing"]); // after the viewed day
    expect(featuredActivities(db.db, "2026-10-03", GUEST_STARTER)).toEqual(["boxing", "running", "walking", "cycling"]);
  });

  it("never features other, or an entry that was deleted", () => {
    db = openTestDb();
    logged(db.db, "2026-10-03", ["other", "other", "other"]);
    const gone = logged(db.db, "2026-10-03", ["rowing"]);
    db.db.update(entries).set({ deleted_at: NOW.toISOString() }).where(eq(entries.id, gone)).run();
    expect(featuredActivities(db.db, "2026-10-03", GUEST_STARTER)).toEqual([...GUEST_STARTER]);
  });

  it("fills up from the starter set, skipping what is already there", () => {
    db = openTestDb();
    logged(db.db, "2026-10-03", ["gym"]);
    expect(featuredActivities(db.db, "2026-10-03", GUEST_STARTER)).toEqual(["gym", "running", "walking", "cycling"]);
    expect(featuredActivities(db.db, "2026-10-03", OWNER_STARTER)).toEqual(["gym", "tennis", "wakeboarding", "kitesurfing"]);
  });

  it("starts the owner on their four sports and everyone else on everyday ones", () => {
    expect(starterFor(true)).toEqual(["tennis", "gym", "wakeboarding", "kitesurfing"]);
    expect(starterFor(false)).toEqual(["running", "walking", "cycling", "gym"]);
  });
});

describe("the day view's featured activities", () => {
  it("are each person's own", async () => {
    t = await testApp({ guests: ["friend@example.com"] });
    const guest = await t.headersFor("friend@example.com");
    for (const headers of [t.headers, guest]) await t.app.inject({ method: "PUT", url: "/api/profile", headers, payload: PROFILE });
    logged(t.storeOf("friend@example.com").db, "2026-10-02", ["climbing"]);
    const ownersDay = await t.app.inject({ method: "GET", url: "/api/days/today", headers: t.headers });
    const guestsDay = await t.app.inject({ method: "GET", url: "/api/days/today", headers: guest });
    expect(ownersDay.json().featured).toEqual(["tennis", "gym", "wakeboarding", "kitesurfing"]);
    expect(guestsDay.json().featured).toEqual(["climbing", "running", "walking", "cycling"]);
  });
});
