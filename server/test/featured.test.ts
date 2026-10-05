import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { aiUsage, entries, messages } from "../src/db/schema.ts";
import type { Sql } from "../src/db/types.ts";
import { GUEST_STARTER, OWNER_STARTER, featuredActivities, starterFor } from "../src/days/featured.ts";
import { insertEntry } from "../src/log/entries.ts";
import type { Activity } from "../src/shared.ts";
import { fakeAi, textReply, toolCall } from "./fake-ai.ts";
import { NOW, logItemsInput, openTestDb, sampleEntry, sampleExercise, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const PROFILE = {
  sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80,
  activity_level: "light", goal: "lose", goal_rate_kg_week: 0.5,
};
const FRIEND = "friend@example.com";
const BANANA = { name: "Banana", kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 };

/** The events of a text/event-stream body, comments left out. */
function eventsOf(payload: string) {
  return payload
    .split("\n\n")
    .filter((block) => block.trim() !== "" && !block.startsWith(":"))
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
      const data = JSON.parse(lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "null");
      return { event, data };
    });
}

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

  it("never features an activity this version doesn't know, even the most-logged: it takes no place from a sport", () => {
    db = openTestDb();
    // One a newer version added, say. Nothing in the database stops it from being stored (insertEntry takes it as it is).
    const parkour = "parkour" as Activity;
    // One entry, so one time: parkour 3, padel 2, and 1 each for golf, yoga and rowing, which the last tie-break puts in name order.
    logged(db.db, "2026-10-03", [parkour, parkour, parkour, "padel", "padel", "golf", "yoga", "rowing"]);
    expect(featuredActivities(db.db, "2026-10-03", GUEST_STARTER)).toEqual(["padel", "golf", "rowing", "yoga"]);
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

  it("are a guest's starter, never the owner's, on every route that answers with a day: the streamed send and its Retry too", async () => {
    t = await testApp({
      guests: [FRIEND],
      ai: fakeAi([
        new AiError("api_error", "overloaded"), // the guest's streamed send fails...
        toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged."), // ...its Retry goes through...
        textReply("Noted."), // ...and a plain send follows
      ]),
    });
    const guest = await t.headersFor(FRIEND);
    for (const headers of [t.headers, guest]) await t.app.inject({ method: "PUT", url: "/api/profile", headers, payload: PROFILE });
    const streaming = { ...guest, accept: "text/event-stream" };
    const message = (text: string) => ({ id: randomUUID(), sent_at: "2026-10-03T11:58:00.000Z", text });
    // By name: a step comes before the result, so an event's place in the stream is not its identity.
    const event = (payload: string, name: string) => eventsOf(payload).find((e) => e.event === name)?.data;

    const first = message("two eggs");
    const sent = await t.app.inject({ method: "POST", url: "/api/messages", headers: streaming, payload: first });
    expect(event(sent.payload, "stored")?.day.featured).toEqual(GUEST_STARTER);
    expect(event(sent.payload, "result")?.user.status).toBe("failed"); // so there is something to retry
    expect(event(sent.payload, "result")?.day.featured).toEqual(GUEST_STARTER);

    const retried = await t.app.inject({ method: "POST", url: `/api/messages/${first.id}/retry`, headers: streaming });
    const retryResult = event(retried.payload, "result");
    expect(retryResult?.user.status).toBe("done");
    expect(retryResult?.day.featured).toEqual(GUEST_STARTER);

    const second = message("a coffee");
    const plain = await t.app.inject({ method: "POST", url: "/api/messages", headers: guest, payload: second });
    expect(plain.statusCode).toBe(201);
    expect(plain.json().day.featured).toEqual(GUEST_STARTER);

    const manual = randomUUID();
    const post = await t.app.inject({ method: "POST", url: "/api/entries", headers: guest, payload: { id: manual, date: "2026-10-03", foods: [BANANA] } });
    expect(post.statusCode).toBe(201);
    expect(post.json().day.featured).toEqual(GUEST_STARTER);
    const patch = await t.app.inject({ method: "PATCH", url: `/api/entries/${manual}`, headers: guest, payload: { foods: [{ ...BANANA, kcal: 110 }], exercises: [] } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().day.featured).toEqual(GUEST_STARTER);
    const removed = await t.app.inject({ method: "DELETE", url: `/api/entries/${manual}`, headers: guest });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().day.featured).toEqual(GUEST_STARTER);

    // The same route for the owner answers with the owner's.
    const owners = randomUUID();
    const ownerPost = await t.app.inject({ method: "POST", url: "/api/entries", headers: t.headers, payload: { id: owners, date: "2026-10-03", foods: [BANANA] } });
    expect(ownerPost.statusCode).toBe(201);
    expect(ownerPost.json().day.featured).toEqual(OWNER_STARTER);

    // All of the guest's work, the coach's included, is in the guest's database; none of it reached the owner's.
    const theirs = t.storeOf(FRIEND).db;
    const coached = (retryResult?.day.entries ?? []).map((e: { id: string }) => e.id);
    expect(coached).toHaveLength(1); // what the coach logged on the Retry
    expect(theirs.select({ id: entries.id }).from(entries).all()).toEqual([{ id: coached[0] }]);
    const theirMessages = theirs.select({ id: messages.id, role: messages.role }).from(messages).all();
    expect(theirMessages.filter((m) => m.role === "user").map((m) => m.id).sort()).toEqual([first.id, second.id].sort());
    expect(theirMessages.filter((m) => m.role === "assistant")).toHaveLength(2);
    const theirRuns = theirs.select({ message_id: aiUsage.message_id }).from(aiUsage).all();
    expect(theirRuns.map((r) => r.message_id).sort()).toEqual([first.id, first.id, second.id].sort()); // the failed run, its Retry, the plain send
    expect(t.db.select({ id: entries.id }).from(entries).all()).toEqual([{ id: owners }]);
    expect(t.db.select().from(messages).all()).toEqual([]);
    expect(t.db.select().from(aiUsage).all()).toEqual([]);
  });
});
