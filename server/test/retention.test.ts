import fs from "node:fs";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";
import { appendTurns, getOrCreateThread } from "../src/coach/thread.ts";
import { coachThreads, coachTurns, messages, photos } from "../src/db/schema.ts";
import { openDatabase } from "../src/db/open.ts";
import { startRetention } from "../src/jobs.ts";
import { getEntry, insertEntry } from "../src/log/entries.ts";
import { insertReply, insertUserMessage, setMessageStatus } from "../src/messages/messages.ts";
import { shortKey } from "../src/people/people.ts";
import { claimPhotos, savePhoto } from "../src/photos/photos.ts";
import { purgeExpired } from "../src/retention/retention.ts";
import type { Sql } from "../src/db/types.ts";
import type { MessageStatus } from "../src/shared.ts";
import { fakeJpeg } from "./images.ts";
import { NOW, openTestDb, sampleEntry, sampleFood, tempDir, testPeople, unlistable } from "./helpers.ts";

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const TZ = "UTC";
// NOW is midday on the 3rd: the 3rd and the three days before it keep their chat, so the 30th is the oldest open day.
const OPEN = "2026-09-30";
const GONE = "2026-09-29";

/** A user message. It starts out finished, because one still pending is being processed and never expires. */
function message(sql: Sql, id: string, date: string, createdAt: string, status: MessageStatus = "done"): void {
  insertUserMessage(sql, { id, date, text: `text of ${id}`, photoIds: [], sentAt: createdAt, nowIso: createdAt });
  setMessageStatus(sql, id, status, status === "failed" ? "ai_error" : null);
}

function photoFor(sql: Sql, dir: string, createdAt: string, messageId: string | null): string {
  const saved = savePhoto(sql, dir, fakeJpeg(4, 4), createdAt);
  if (!saved.ok) throw new Error("the test photo was refused");
  if (messageId) claimPhotos(sql, [saved.photo.id], messageId);
  return saved.photo.id;
}

function thread(sql: Sql, date: string, messageId: string, createdAt: string): void {
  getOrCreateThread(sql, date, () => "system", createdAt);
  appendTurns(sql, date, messageId, [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }], createdAt);
}

describe("purgeExpired", () => {
  it("deletes the messages, replies, photos and thread of a day that left the chat window; the entry keeps every number", () => {
    const db = openTestDb();
    const dir = tempDir();
    message(db.db, "old", GONE, hoursAgo(50));
    insertReply(db.db, { id: "old-reply", replyTo: "old", date: GONE, text: "reply to old", cards: [{ type: "entry", id: "e-old" }], nowIso: hoursAgo(50) });
    const oldPhoto = photoFor(db.db, dir, hoursAgo(50), "old");
    insertEntry(db.db, sampleEntry({ id: "e-old", date: GONE, source: "photo", message_id: "old", foods: [sampleFood({ kcal: 420 })] }), hoursAgo(50));
    thread(db.db, GONE, "old", hoursAgo(50));
    message(db.db, "new", OPEN, hoursAgo(80));
    const newPhoto = photoFor(db.db, dir, hoursAgo(80), "new");
    insertEntry(db.db, sampleEntry({ id: "e-new", date: OPEN, source: "coach", message_id: "new" }), hoursAgo(80));
    thread(db.db, OPEN, "new", hoursAgo(80));

    expect(purgeExpired(db.db, dir, NOW, TZ)).toEqual({ messages: 2, photos: 1, threads: 1, orphanFiles: 0 });

    expect(db.db.select({ id: messages.id }).from(messages).all()).toEqual([{ id: "new" }]);
    expect(db.db.select({ id: photos.id }).from(photos).all()).toEqual([{ id: newPhoto }]);
    expect(fs.existsSync(path.join(dir, `${oldPhoto}.jpg`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${newPhoto}.jpg`))).toBe(true);
    expect(getEntry(db.db, "e-old")).toMatchObject({ source: "photo", message_id: null, foods: [expect.objectContaining({ kcal: 420 })] });
    expect(getEntry(db.db, "e-new")?.message_id).toBe("new");
    expect(db.db.select({ date: coachThreads.date }).from(coachThreads).all()).toEqual([{ date: OPEN }]);
    expect(new Set(db.db.select({ date: coachTurns.date }).from(coachTurns).all().map((t) => t.date))).toEqual(new Set([OPEN]));
    db.close();
  });

  it("deletes a reply with its question, whatever day the reply carries", () => {
    const db = openTestDb();
    message(db.db, "q", GONE, hoursAgo(90));
    insertReply(db.db, { id: "q-reply", replyTo: "q", date: OPEN, text: "reply to q", cards: [], nowIso: hoursAgo(90) });
    thread(db.db, GONE, "q", hoursAgo(90));

    expect(purgeExpired(db.db, tempDir(), NOW, TZ)).toEqual({ messages: 2, photos: 0, threads: 1, orphanFiles: 0 });

    expect(db.db.select().from(messages).all()).toEqual([]);
    expect(db.db.select().from(coachThreads).all()).toEqual([]);
    expect(db.db.select().from(coachTurns).all()).toEqual([]);
    db.close();
  });

  it("goes by the day in the person's timezone, not by age: a day is kept until it is CHAT_WINDOW_DAYS before today", () => {
    const db = openTestDb();
    // Sent today about a day that is still open, and long ago about one that is too.
    message(db.db, "backfill", OPEN, hoursAgo(1));
    message(db.db, "aged", OPEN, hoursAgo(84));
    // Sent today about a day that is no longer open: it goes at the next run.
    message(db.db, "late", GONE, hoursAgo(1));
    expect(purgeExpired(db.db, tempDir(), NOW, TZ).messages).toBe(1);
    expect(db.db.select({ id: messages.id }).from(messages).all().map((m) => m.id).sort()).toEqual(["aged", "backfill"]);
    // In Auckland it is already the 4th, so the 30th has left the window there.
    expect(purgeExpired(db.db, tempDir(), NOW, "Pacific/Auckland").messages).toBe(2);
    db.close();
  });

  it("keeps a day's thread while any of its messages remain, such as one the coach is still on", () => {
    const db = openTestDb();
    message(db.db, "first", GONE, hoursAgo(50));
    thread(db.db, GONE, "first", hoursAgo(50));
    // A failed message goes with its day; Retry is offered only while the day is open.
    message(db.db, "failed", GONE, hoursAgo(80), "failed");
    message(db.db, "working", GONE, hoursAgo(1), "pending");
    purgeExpired(db.db, tempDir(), NOW, TZ);
    expect(db.db.select({ id: messages.id }).from(messages).all()).toEqual([{ id: "working" }]);
    expect(db.db.select().from(coachThreads).all()).toHaveLength(1);
    expect(db.db.select().from(coachTurns).all()).toHaveLength(2);
    db.close();
  });

  it("spares a message still being processed, such as a Retry in flight, with its photo, entry and day's thread", () => {
    const db = openTestDb();
    const dir = tempDir();
    message(db.db, "retrying", GONE, hoursAgo(50), "pending");
    const photo = photoFor(db.db, dir, hoursAgo(50), "retrying");
    insertEntry(db.db, sampleEntry({ id: "e-retry", date: GONE, source: "photo", message_id: "retrying" }), hoursAgo(50));
    thread(db.db, GONE, "retrying", hoursAgo(50));

    expect(purgeExpired(db.db, dir, NOW, TZ)).toEqual({ messages: 0, photos: 0, threads: 0, orphanFiles: 0 });

    expect(db.db.select({ id: messages.id }).from(messages).all()).toEqual([{ id: "retrying" }]);
    expect(db.db.select({ id: photos.id }).from(photos).all()).toEqual([{ id: photo }]);
    expect(fs.existsSync(path.join(dir, `${photo}.jpg`))).toBe(true);
    expect(getEntry(db.db, "e-retry")?.message_id).toBe("retrying");
    expect(db.db.select().from(coachThreads).all()).toHaveLength(1);
    expect(db.db.select().from(coachTurns).all()).toHaveLength(2);

    // Once it has finished, it expires like any other message.
    setMessageStatus(db.db, "retrying", "failed", "timeout");
    expect(purgeExpired(db.db, dir, NOW, TZ)).toEqual({ messages: 1, photos: 1, threads: 1, orphanFiles: 0 });
    expect(db.db.select().from(messages).all()).toEqual([]);
    expect(getEntry(db.db, "e-retry")?.message_id).toBeNull();
    db.close();
  });

  it("deletes photos that were never sent once they are older than the oldest open day", () => {
    const db = openTestDb();
    const dir = tempDir();
    // Midnight starting the 30th is 84 hours before NOW.
    const stale = photoFor(db.db, dir, hoursAgo(85), null);
    const fresh = photoFor(db.db, dir, hoursAgo(83), null);
    expect(purgeExpired(db.db, dir, NOW, TZ).photos).toBe(1);
    expect(db.db.select({ id: photos.id }).from(photos).all()).toEqual([{ id: fresh }]);
    expect(fs.existsSync(path.join(dir, `${stale}.jpg`))).toBe(false);
    db.close();
  });

  it("sweeps files that lost their row once they are an hour old, and nothing else", () => {
    const db = openTestDb();
    const dir = tempDir();
    const old = new Date(NOW.getTime() - 2 * 3_600_000);
    const known = photoFor(db.db, dir, hoursAgo(1), null);
    // savePhoto stamps the file with the real clock, which is later than the fake NOW and would
    // keep it out of the sweep by age alone. Backdate it, so that only its row protects it.
    fs.utimesSync(path.join(dir, `${known}.jpg`), old, old);
    const write = (name: string, mtime: Date) => {
      fs.writeFileSync(path.join(dir, name), "x");
      fs.utimesSync(path.join(dir, name), mtime, mtime);
    };
    write(`${"a".repeat(32)}.jpg`, old); // orphan, old: goes
    write(`${"b".repeat(32)}.png`, NOW); // orphan, young: an upload may be mid-way
    write(`${known}.jpg.part`, old); // a leftover temporary file: goes
    write("CACHEDIR.TAG", old); // not ours to touch
    expect(purgeExpired(db.db, dir, NOW, TZ).orphanFiles).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual([`${known}.jpg`, `${"b".repeat(32)}.png`, "CACHEDIR.TAG"].sort());
    db.close();
  });

  it("carries on sweeping when a file disappears before it is looked at", () => {
    const db = openTestDb();
    const dir = tempDir();
    const old = new Date(NOW.getTime() - 2 * 3_600_000);
    // A dangling link is listed by readdir but cannot be stat'ed: the same moment as a file
    // removed by something else between the listing and the check.
    fs.symlinkSync(path.join(dir, "gone"), path.join(dir, `${"d".repeat(32)}.jpg`));
    const orphan = path.join(dir, `${"a".repeat(32)}.jpg`);
    fs.writeFileSync(orphan, "x");
    fs.utimesSync(orphan, old, old);
    expect(purgeExpired(db.db, dir, NOW, TZ).orphanFiles).toBe(1);
    expect(fs.existsSync(orphan)).toBe(false);
    db.close();
  });

  it("overwrites what it deletes, so the text is gone from the database file", () => {
    const dir = tempDir();
    const file = path.join(dir, "fitness.db");
    const live = openDatabase({ file, snapshotDir: null });
    insertUserMessage(live.db, {
      id: "m1", date: GONE, text: "zebra-crossing-sandwich", photoIds: [], sentAt: hoursAgo(50), nowIso: hoursAgo(50),
    });
    setMessageStatus(live.db, "m1", "done", null);
    purgeExpired(live.db, tempDir(), NOW, TZ);
    live.close();
    expect(fs.readFileSync(file).includes("zebra-crossing-sandwich")).toBe(false);
    if (fs.existsSync(`${file}-journal`)) expect(fs.readFileSync(`${file}-journal`).includes("zebra-crossing-sandwich")).toBe(false);
  });
});

describe("startRetention", () => {
  it("purges everyone once straight away, then every hour, logging counts by person", async () => {
    const { people, stores } = testPeople("owner@example.com", "friend@example.com");
    for (const store of stores) message(store.db, "old", GONE, hoursAgo(50));
    const logged: unknown[] = [];
    const log = { info: (obj: unknown) => logged.push(obj), error: (obj: unknown) => logged.push(obj) } as unknown as FastifyBaseLogger;
    const job = startRetention({ people, log, now: () => NOW });
    for (const store of stores) expect(store.db.select().from(messages).all()).toEqual([]);
    const keys = stores.map((s) => s.key).sort();
    expect(logged).toEqual(keys.map((key) => ({ person: shortKey(key), messages: 1, photos: 0, threads: 0, orphanFiles: 0 })));
    // The hourly pass finds nothing left to delete, and says nothing: no line an hour for every person.
    const afterStartup = [...logged];
    await job.trigger();
    expect(logged).toEqual(afterStartup);
    expect(job.getPattern()).toBe("7 * * * *");
    job.stop();
    people.close();
  });

  it("logs one person's failed purge, goes on to the next, and the job can still be stopped", () => {
    const { people, stores } = testPeople("owner@example.com", "friend@example.com");
    for (const store of stores) message(store.db, "old", GONE, hoursAgo(50));
    const infos: unknown[][] = [];
    const errors: unknown[][] = [];
    const log = {
      info: (...args: unknown[]) => infos.push(args),
      error: (...args: unknown[]) => errors.push(args),
    } as unknown as FastifyBaseLogger;
    // The sweep cannot list a photo folder that is not there.
    fs.rmSync(stores[0].photoDir, { recursive: true, force: true });
    const job = startRetention({ people, log, now: () => NOW });
    expect(errors).toEqual([[{ err: expect.objectContaining({ code: "ENOENT" }), person: shortKey(stores[0].key) }, "retention purge failed"]]);
    expect(stores[1].db.select().from(messages).all()).toEqual([]);
    expect(infos).toEqual([[{ person: shortKey(stores[1].key), messages: 1, photos: 0, threads: 0, orphanFiles: 0 }, "expired conversations deleted"]]);
    expect(job.isStopped()).toBe(false);
    job.stop();
    expect(job.isStopped()).toBe(true);
    people.close();
  });

  it("logs a failure to list the folders and goes on: the startup run does not throw, and neither does an hourly one", async () => {
    const { people } = testPeople("owner@example.com");
    const errors: unknown[][] = [];
    const log = { info: () => {}, error: (...args: unknown[]) => errors.push(args) } as unknown as FastifyBaseLogger;
    // startRetention runs once before it returns, so a throw here would stop the app from starting.
    const job = startRetention({ people: unlistable(people), log, now: () => NOW });
    try {
      await expect(job.trigger()).resolves.toBeUndefined();
      // The listing itself failed, not anyone's folder: no person to name.
      const failure = [{ err: expect.objectContaining({ code: "EIO" }) }, "retention purge failed"];
      expect(errors).toStrictEqual([failure, failure]);
    } finally {
      job.stop();
      people.close();
    }
  });

  it("logs whatever else escapes an hourly run through croner's own catch, so the run can never reject", async () => {
    const { people } = testPeople("owner@example.com");
    const errors: unknown[][] = [];
    let refuse = false;
    const log = {
      info: () => {},
      error: (...args: unknown[]) => {
        // As a broken log pipe might: the one throw the job's own guard cannot catch.
        if (refuse) {
          refuse = false;
          throw new Error("the log pipe is closed");
        }
        errors.push(args);
      },
    } as unknown as FastifyBaseLogger;
    const job = startRetention({ people: unlistable(people), log, now: () => NOW });
    expect(errors).toHaveLength(1); // the startup run's listing failure
    refuse = true;
    try {
      await expect(job.trigger()).resolves.toBeUndefined();
      expect(errors).toStrictEqual([
        [{ err: expect.objectContaining({ code: "EIO" }) }, "retention purge failed"],
        [{ err: expect.objectContaining({ message: "the log pipe is closed" }) }, "retention purge failed"],
      ]);
    } finally {
      job.stop();
      people.close();
    }
  });
});
