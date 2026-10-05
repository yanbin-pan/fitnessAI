import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CACHEDIR_TAG } from "../src/db/location.ts";
import { insertEntry, listEntries } from "../src/log/entries.ts";
import { getMessage, insertUserMessage } from "../src/messages/messages.ts";
import { createPeople, personKey, shortKey } from "../src/people/people.ts";
import { NOW, sampleEntry, tempDir } from "./helpers.ts";

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

  it("refuses a key that is not a hash", () => {
    const people = createPeople({ dataDir: tempDir() });
    for (const key of ["../db", "", OWNER_KEY.toUpperCase(), `${OWNER_KEY}.moving`]) {
      expect(() => people.store(key)).toThrow("not a person key");
    }
    people.close();
  });
});
