import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CACHEDIR_TAG, moveOwnerIn, personPaths, preparePersonDir } from "../src/db/location.ts";
import { openDatabase } from "../src/db/open.ts";
import { CONVERSATION_TABLES, snapshot, stripConversations } from "../src/db/snapshot.ts";
import { insertEntry } from "../src/log/entries.ts";
import { insertUserMessage } from "../src/messages/messages.ts";
import { appendTurns, getOrCreateThread } from "../src/coach/thread.ts";
import { NOW, openTestDb, sampleEntry, tempDir } from "./helpers.ts";

const SIGNATURE = "Signature: 8a477f597d28d172789f06886806bc55";

/** What a snapshot being built leaves beside the live database: `<database>.snapshot-part`, and its journal. */
const partFiles = (folder: string) => fs.readdirSync(folder).filter((f) => f.includes(".snapshot-part"));

const KEY = "c8cd3c6427301eaf6665bccacd65ddb614527acc843a15463e3faba57124c351";

/** Milestone 2.1's layout: one person's db/, photos/ and snapshots/ at the top of the data folder. */
function singlePersonFolder(): string {
  const dir = tempDir();
  for (const name of ["db", "photos", "snapshots"]) fs.mkdirSync(path.join(dir, name));
  fs.writeFileSync(path.join(dir, "db", "CACHEDIR.TAG"), CACHEDIR_TAG);
  fs.writeFileSync(path.join(dir, "photos", "CACHEDIR.TAG"), CACHEDIR_TAG);
  const old = openDatabase({ file: path.join(dir, "db", "fitness.db"), snapshotDir: null });
  insertEntry(old.db, sampleEntry({ id: "a" }), NOW.toISOString());
  insertEntry(old.db, sampleEntry({ id: "b" }), NOW.toISOString());
  old.close();
  fs.writeFileSync(path.join(dir, "photos", `${"1".repeat(32)}.jpg`), "a photo");
  fs.writeFileSync(path.join(dir, "snapshots", "fitness-2026-10-02.db"), "a snapshot");
  return dir;
}

describe("preparePersonDir", () => {
  it("lays out a person's folder: db/ and photos/ tagged for restic to skip, snapshots/ not", () => {
    const dir = tempDir();
    const paths = preparePersonDir(dir, KEY);
    const home = path.join(dir, "users", KEY);
    expect(paths).toEqual({
      dir: home,
      dbFile: path.join(home, "db", "fitness.db"),
      photoDir: path.join(home, "photos"),
      snapshotDir: path.join(home, "snapshots"),
    });
    expect(personPaths(dir, KEY)).toEqual(paths);
    for (const tagged of ["db", "photos"]) {
      const tag = fs.readFileSync(path.join(home, tagged, "CACHEDIR.TAG"), "utf8");
      expect(tag.startsWith(SIGNATURE)).toBe(true);
      expect(tag).toBe(CACHEDIR_TAG);
    }
    expect(fs.existsSync(paths.snapshotDir)).toBe(true);
    expect(fs.existsSync(path.join(paths.snapshotDir, "CACHEDIR.TAG"))).toBe(false);
  });

  it("clears a snapshot copy that a crash left beside a person's database", () => {
    const dir = tempDir();
    const db = path.join(dir, "users", KEY, "db");
    fs.mkdirSync(db, { recursive: true });
    fs.writeFileSync(path.join(db, "fitness.db"), "");
    for (const stale of ["fitness.db.snapshot-part", "fitness.db.snapshot-part-journal"]) {
      fs.writeFileSync(path.join(db, stale), "a copy with conversations in it");
    }
    preparePersonDir(dir, KEY);
    expect(fs.readdirSync(db).sort()).toEqual(["CACHEDIR.TAG", "fitness.db"]);
  });
});

describe("moveOwnerIn", () => {
  it("moves milestone 2.1's folders into the owner's, every row and file intact", () => {
    const dir = singlePersonFolder();
    expect(moveOwnerIn(dir, KEY)).toBe("moved");
    for (const name of ["db", "photos", "snapshots"]) expect(fs.existsSync(path.join(dir, name))).toBe(false);
    const owner = personPaths(dir, KEY);
    const moved = new Database(owner.dbFile, { readonly: true });
    expect(moved.prepare("SELECT id FROM entries ORDER BY id").pluck().all()).toEqual(["a", "b"]);
    moved.close();
    expect(fs.readFileSync(path.join(owner.photoDir, `${"1".repeat(32)}.jpg`), "utf8")).toBe("a photo");
    expect(fs.readFileSync(path.join(owner.snapshotDir, "fitness-2026-10-02.db"), "utf8")).toBe("a snapshot");
    expect(fs.readFileSync(path.join(owner.dir, "db", "CACHEDIR.TAG"), "utf8")).toBe(CACHEDIR_TAG);
    expect(fs.readFileSync(path.join(owner.photoDir, "CACHEDIR.TAG"), "utf8")).toBe(CACHEDIR_TAG);
    expect(fs.existsSync(`${owner.dir}.moving`)).toBe(false);
  });

  it("takes a journal along with its database", () => {
    const dir = singlePersonFolder();
    fs.writeFileSync(path.join(dir, "db", "fitness.db-journal"), "journal");
    moveOwnerIn(dir, KEY);
    expect(fs.readFileSync(`${personPaths(dir, KEY).dbFile}-journal`, "utf8")).toBe("journal");
  });

  it("finds nothing to move on the next start, or in a fresh folder", () => {
    const dir = singlePersonFolder();
    moveOwnerIn(dir, KEY);
    expect(moveOwnerIn(dir, KEY)).toBe("none");
    const fresh = tempDir();
    expect(moveOwnerIn(fresh, KEY)).toBe("none");
    expect(fs.readdirSync(fresh)).toEqual([]);
  });

  it("never overwrites an owner's folder that already exists", () => {
    const dir = singlePersonFolder();
    const owner = personPaths(dir, KEY);
    fs.mkdirSync(path.dirname(owner.dbFile), { recursive: true });
    fs.writeFileSync(owner.dbFile, "the owner's current database");
    expect(moveOwnerIn(dir, KEY)).toBe("both");
    expect(fs.readFileSync(owner.dbFile, "utf8")).toBe("the owner's current database");
    expect(fs.existsSync(path.join(dir, "db", "fitness.db"))).toBe(true);
  });

  it("finishes a move that a crash cut short", () => {
    const dir = singlePersonFolder();
    const staging = `${personPaths(dir, KEY).dir}.moving`;
    fs.mkdirSync(staging, { recursive: true });
    fs.renameSync(path.join(dir, "db"), path.join(staging, "db")); // the crash came after the first rename
    expect(moveOwnerIn(dir, KEY)).toBe("moved");
    const owner = personPaths(dir, KEY);
    expect(fs.existsSync(owner.dbFile)).toBe(true);
    expect(fs.existsSync(path.join(owner.photoDir, `${"1".repeat(32)}.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(owner.snapshotDir, "fitness-2026-10-02.db"))).toBe(true);
    expect(fs.existsSync(staging)).toBe(false);
    for (const name of ["db", "photos", "snapshots"]) expect(fs.existsSync(path.join(dir, name))).toBe(false);
  });
});

describe("snapshots", () => {
  it("never contain a conversation or a photo, and keep every entry", () => {
    const dir = tempDir();
    const live = openDatabase({ file: path.join(dir, "fitness.db"), snapshotDir: null });
    const nowIso = NOW.toISOString();
    insertUserMessage(live.db, { id: "m1", date: "2026-10-03", text: "porridge", photoIds: [], sentAt: nowIso, nowIso });
    insertEntry(live.db, sampleEntry({ id: "e1", source: "coach", message_id: "m1" }), nowIso);
    getOrCreateThread(live.db, "2026-10-03", () => "system", nowIso);
    appendTurns(live.db, "2026-10-03", "m1", [{ role: "user", content: "porridge" }], nowIso);
    live.sqlite
      .prepare("INSERT INTO photos (id, message_id, media_type, bytes, width, height, created_at) VALUES ('p1', 'm1', 'image/jpeg', 3, 1, 1, ?)")
      .run(nowIso);

    const file = snapshot(live.sqlite, path.join(dir, "snapshots"), "copy.db");
    const copy = new Database(file);
    for (const table of ["messages", "coach_threads", "coach_turns", "photos"]) {
      expect(copy.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
    }
    expect(copy.prepare("SELECT id, message_id FROM entries").all()).toEqual([{ id: "e1", message_id: null }]);
    expect(fs.readFileSync(file).includes("porridge")).toBe(false);
    copy.close();
    // The live database is untouched.
    expect(live.sqlite.prepare("SELECT count(*) FROM messages").pluck().get()).toBe(1);
    live.close();
  });

  it("strip a copy from an older schema without failing", () => {
    const file = path.join(tempDir(), "old.db");
    const old = new Database(file);
    old.exec("CREATE TABLE messages (id text); CREATE TABLE entries (id text, message_id text); INSERT INTO messages VALUES ('m1'); INSERT INTO entries VALUES ('e1', 'm1');");
    old.close();
    stripConversations(file);
    const db = new Database(file);
    expect(db.prepare("SELECT count(*) FROM messages").pluck().get()).toBe(0);
    expect(db.prepare("SELECT message_id FROM entries").pluck().get()).toBeNull();
    db.close();
  });

  it("leave no temporary file beside the live database", () => {
    const dir = tempDir();
    const live = openDatabase({ file: path.join(dir, "fitness.db"), snapshotDir: null });
    snapshot(live.sqlite, path.join(dir, "snapshots"), "copy.db");
    expect(fs.readdirSync(path.join(dir, "snapshots"))).toEqual(["copy.db"]);
    expect(partFiles(dir)).toEqual([]);
    live.close();
  });

  it("replace a temporary file left by a crash", () => {
    const dir = tempDir();
    const live = openDatabase({ file: path.join(dir, "fitness.db"), snapshotDir: null });
    insertEntry(live.db, sampleEntry({ id: "e1" }), NOW.toISOString());
    fs.writeFileSync(`${live.sqlite.name}.snapshot-part`, "left by a crash");
    fs.writeFileSync(`${live.sqlite.name}.snapshot-part-journal`, "left by a crash");

    const copy = new Database(snapshot(live.sqlite, path.join(dir, "snapshots"), "copy.db"));
    expect(copy.prepare("SELECT id FROM entries").pluck().all()).toEqual(["e1"]);
    copy.close();
    expect(partFiles(dir)).toEqual([]);
    live.close();
  });

  it("leave nothing in the snapshot folder when stripping fails, so an unstripped copy is never backed up", () => {
    const dir = tempDir();
    const snapshots = path.join(dir, "snapshots");
    const live = new Database(path.join(dir, "live.db"));
    // No entries.message_id: the strip's last statement fails after the conversation has been copied.
    live.exec("CREATE TABLE messages (id text, text text); CREATE TABLE entries (id text); INSERT INTO messages VALUES ('m1', 'porridge');");
    expect(() => snapshot(live, snapshots, "copy.db")).toThrow(/message_id/);
    expect(fs.readdirSync(snapshots)).toEqual([]);
    expect(partFiles(dir)).toEqual([]);
    live.close();
  });

  // A permission bit does not stop root, so the test cannot say anything there.
  it.skipIf(process.getuid?.() === 0)("leave nothing behind when the snapshot folder cannot be written", () => {
    const dir = tempDir();
    const snapshots = path.join(dir, "snapshots");
    const live = openDatabase({ file: path.join(dir, "fitness.db"), snapshotDir: null });
    fs.mkdirSync(snapshots);
    fs.chmodSync(snapshots, 0o500);
    try {
      // The copy is built and stripped beside the live database; only the move into the folder fails.
      expect(() => snapshot(live.sqlite, snapshots, "copy.db")).toThrow(/EACCES/);
      expect(fs.readdirSync(snapshots)).toEqual([]);
    } finally {
      fs.chmodSync(snapshots, 0o700); // so the temporary folder can be removed
    }
    expect(partFiles(dir)).toEqual([]);
    live.close();
  });

  it("have a decision for every table: emptied as conversation, or kept as logbook", () => {
    // A table added later fails here until someone decides which it is.
    const KEPT = ["profile", "days", "entries", "food_items", "food_item_groups", "exercise_items", "exercise_muscles", "ai_usage"];
    const db = openTestDb();
    const tables = (db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[]).filter(
      (name) => !name.startsWith("sqlite_") && name !== "__drizzle_migrations",
    );
    expect([...tables].sort()).toEqual([...KEPT, ...CONVERSATION_TABLES].sort());
    db.close();
  });
});
