import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CACHEDIR_TAG, personPaths, preparePersonDir } from "../src/db/location.ts";
import { openDatabase } from "../src/db/open.ts";
import { insertEntry, listEntries } from "../src/log/entries.ts";
import { getMessage, insertUserMessage } from "../src/messages/messages.ts";
import { createPeople, personKey, shortKey } from "../src/people/people.ts";
import { NOW, sampleEntry, tempDir, testPeople } from "./helpers.ts";

const OWNER_KEY = "c8cd3c6427301eaf6665bccacd65ddb614527acc843a15463e3faba57124c351";
const FRIEND_KEY = "f387373a9f44e7b317f6dc3f28e1807788ca174c44c247745fffaafbacb04bbe";
const owner = { email: "owner@example.com", owner: true };
const friend = { email: "friend@example.com", owner: false };

describe("personKey", () => {
  it("is the sha256 of the email in lowercase hex, and shortKey its first 8 characters", () => {
    expect(personKey("owner@example.com")).toBe(OWNER_KEY);
    expect(personKey("friend@example.com")).toBe(FRIEND_KEY);
    expect(shortKey(OWNER_KEY)).toBe("c8cd3c64");
  });
});

describe("createPeople", () => {
  it("opens a person's database on first use, in their own folder laid out for backups, and keeps it open", () => {
    const dataDir = tempDir();
    const people = createPeople({ dataDir });
    const store = people.store(OWNER_KEY);
    const dir = path.join(dataDir, "users", OWNER_KEY);
    expect(store).toMatchObject({ key: OWNER_KEY, photoDir: path.join(dir, "photos"), snapshotDir: path.join(dir, "snapshots") });
    expect(fs.existsSync(path.join(dir, "db", "fitness.db"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "db", "CACHEDIR.TAG"), "utf8")).toBe(CACHEDIR_TAG);
    expect(fs.readFileSync(path.join(dir, "photos", "CACHEDIR.TAG"), "utf8")).toBe(CACHEDIR_TAG);
    expect(fs.existsSync(path.join(dir, "snapshots", "CACHEDIR.TAG"))).toBe(false);
    expect(people.store(OWNER_KEY)).toBe(store);
    people.close();
  });

  it("gives each person a database and a photo folder of their own", () => {
    const people = createPeople({ dataDir: tempDir() });
    const a = people.personFor(owner);
    const b = people.personFor(friend);
    expect(a).toMatchObject({ key: OWNER_KEY, owner: true });
    expect(b).toMatchObject({ key: FRIEND_KEY, owner: false });
    insertEntry(a.db, sampleEntry({ id: "owners" }), NOW.toISOString());
    expect(listEntries(a.db, "2026-10-03").map((e) => e.id)).toEqual(["owners"]);
    expect(listEntries(b.db, "2026-10-03")).toEqual([]);
    expect(b.photoDir).not.toBe(a.photoDir);
    people.close();
  });

  it("marks a message the last run left pending as interrupted when it opens a database", () => {
    const dataDir = tempDir();
    const first = createPeople({ dataDir });
    insertUserMessage(first.store(FRIEND_KEY).db, {
      id: "m1", date: "2026-10-03", text: "eggs", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString(),
    });
    first.close();
    const second = createPeople({ dataDir });
    expect(getMessage(second.store(FRIEND_KEY).db, "m1")).toMatchObject({ status: "failed", error_code: "interrupted" });
    second.close();
  });

  it("lists the folders named by a key, and nothing else", () => {
    const dataDir = tempDir();
    const people = createPeople({ dataDir });
    expect(people.keys()).toEqual([]); // no users/ yet
    people.store(FRIEND_KEY);
    people.store(OWNER_KEY);
    const users = path.join(dataDir, "users");
    fs.mkdirSync(path.join(users, `${OWNER_KEY}.moving`));
    fs.mkdirSync(path.join(users, "not-a-key"));
    fs.writeFileSync(path.join(users, "a".repeat(64)), "a file, not a folder");
    expect(people.keys()).toEqual([OWNER_KEY, FRIEND_KEY].sort());
    people.close();
  });

  it("refuses a key that is not a hash, and creates nothing for it", () => {
    const dataDir = tempDir();
    const people = createPeople({ dataDir });
    const notKeys = ["../db", "", OWNER_KEY.toUpperCase(), `${OWNER_KEY}.moving`, `${OWNER_KEY}\n`, `../${OWNER_KEY}`, OWNER_KEY.slice(0, 63), `${OWNER_KEY}0`];
    for (const key of notKeys) expect(() => people.store(key), JSON.stringify(key)).toThrow("not a person key");
    expect(fs.readdirSync(dataDir)).toEqual([]); // not even users/
    people.close();
  });

  it("fails interrupted messages once, when a database is first opened, and never again while it stays open", () => {
    const people = createPeople({ dataDir: tempDir() });
    insertUserMessage(people.store(FRIEND_KEY).db, {
      id: "m1", date: "2026-10-03", text: "eggs", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString(),
    });
    // The message is pending because this process is working on it: asking for the person again must not fail it.
    people.personFor(friend);
    people.store(FRIEND_KEY);
    expect(getMessage(people.store(FRIEND_KEY).db, "m1")).toMatchObject({ status: "pending", error_code: null });
    people.close();
  });

  it("closes a database it could not finish opening, so the file's lock is released", () => {
    const dataDir = tempDir();
    const first = createPeople({ dataDir });
    const seeded = first.store(FRIEND_KEY);
    insertUserMessage(seeded.db, {
      id: "m1", date: "2026-10-03", text: "eggs", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString(),
    });
    // Marking that message interrupted fails on the next open: the step after the database itself has been opened.
    seeded.sqlite.exec("CREATE TRIGGER refuse_updates BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT, 'updates refused'); END");
    first.close();

    const second = createPeople({ dataDir });
    expect(() => second.store(FRIEND_KEY)).toThrow("updates refused");
    // Had the handle been left open it would still hold the file's exclusive lock, and this would be refused.
    openDatabase({ file: personPaths(dataDir, FRIEND_KEY).dbFile, snapshotDir: null, lockWaitMs: 0 }).close();
    second.close();
  });

  it("closes every database even when one will not close, and then says so", () => {
    const { people, stores } = testPeople("owner@example.com", "friend@example.com");
    const [first, second] = stores;
    const realClose = first.sqlite.close.bind(first.sqlite);
    first.sqlite.close = () => {
      throw new Error("the disk went away");
    };
    expect(() => people.close()).toThrow("the disk went away");
    expect(second.sqlite.open).toBe(false); // the failure did not stop the loop, so this lock is released
    expect(() => people.close()).not.toThrow(); // and the registry was emptied
    realClose(); // the stub kept the first connection open
  });
});

describe("stopWaitingForLocks", () => {
  it("makes a database someone else holds fail at once, and leaves what the holder wrote alone", () => {
    const dataDir = tempDir();
    // As the previous pod would: another connection holding the file's exclusive lock.
    const holder = openDatabase({ file: preparePersonDir(dataDir, FRIEND_KEY).dbFile, snapshotDir: null });
    insertEntry(holder.db, sampleEntry({ id: "held" }), NOW.toISOString());
    const people = createPeople({ dataDir });
    people.stopWaitingForLocks();
    const started = Date.now();
    expect(() => people.store(FRIEND_KEY)).toThrow(/locked|busy/i);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(listEntries(holder.db, "2026-10-03").map((e) => e.id)).toEqual(["held"]);
    // Nothing was kept from the failed try: once the holder lets go, the next one opens the database.
    holder.close();
    expect(people.store(FRIEND_KEY).key).toBe(FRIEND_KEY);
    people.close();
  });
});
