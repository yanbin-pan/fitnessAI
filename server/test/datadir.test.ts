import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CACHEDIR_TAG, prepareDataDir } from "../src/db/location.ts";
import { openDatabase } from "../src/db/open.ts";
import { snapshot, stripConversations } from "../src/db/snapshot.ts";
import { insertEntry } from "../src/log/entries.ts";
import { insertUserMessage } from "../src/messages/messages.ts";
import { appendTurns, getOrCreateThread } from "../src/coach/thread.ts";
import { NOW, sampleEntry, tempDir } from "./helpers.ts";

const SIGNATURE = "Signature: 8a477f597d28d172789f06886806bc55";

/** What a snapshot being built leaves beside the live database: `<database>.snapshot-part`, and its journal. */
const partFiles = (folder: string) => fs.readdirSync(folder).filter((f) => f.includes(".snapshot-part"));

describe("prepareDataDir", () => {
  it("lays out a fresh folder: db/ and photos/ tagged for restic to skip, snapshots/ not", () => {
    const dir = tempDir();
    const paths = prepareDataDir(dir);
    expect(paths).toEqual({
      dbFile: path.join(dir, "db", "fitness.db"),
      photoDir: path.join(dir, "photos"),
      snapshotDir: path.join(dir, "snapshots"),
      move: "fresh",
    });
    for (const tagged of ["db", "photos"]) {
      const tag = fs.readFileSync(path.join(dir, tagged, "CACHEDIR.TAG"), "utf8");
      expect(tag.startsWith(SIGNATURE)).toBe(true);
      expect(tag).toBe(CACHEDIR_TAG);
    }
    expect(fs.existsSync(path.join(dir, "snapshots", "CACHEDIR.TAG"))).toBe(false);
  });

  it("moves milestone 1's database and its journal into db/", () => {
    const dir = tempDir();
    const old = openDatabase({ file: path.join(dir, "fitness.db"), snapshotDir: null });
    insertEntry(old.db, sampleEntry({ id: "kept" }), NOW.toISOString());
    old.close();
    fs.writeFileSync(path.join(dir, "fitness.db-journal"), "journal");

    const paths = prepareDataDir(dir);
    expect(paths.move).toBe("moved");
    expect(fs.existsSync(path.join(dir, "fitness.db"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "fitness.db-journal"))).toBe(false);
    expect(fs.readFileSync(`${paths.dbFile}-journal`, "utf8")).toBe("journal");
    fs.rmSync(`${paths.dbFile}-journal`); // not a real journal: don't let SQLite try to roll it back
    const moved = new Database(paths.dbFile);
    expect(moved.prepare("SELECT id FROM entries").pluck().all()).toEqual(["kept"]);
    moved.close();
  });

  it("leaves both files alone when each place already has a database", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "db"));
    fs.writeFileSync(path.join(dir, "fitness.db"), "old");
    fs.writeFileSync(path.join(dir, "db", "fitness.db"), "new");
    expect(prepareDataDir(dir).move).toBe("both");
    expect(fs.readFileSync(path.join(dir, "fitness.db"), "utf8")).toBe("old");
    expect(fs.readFileSync(path.join(dir, "db", "fitness.db"), "utf8")).toBe("new");
  });

  it("is a no-op on the next start", () => {
    const dir = tempDir();
    prepareDataDir(dir);
    fs.writeFileSync(path.join(dir, "db", "fitness.db"), "");
    expect(prepareDataDir(dir).move).toBe("in_place");
  });
});

describe("snapshots", () => {
  it("never contain a conversation or a photo, and keep every entry", () => {
    const dir = tempDir();
    const live = openDatabase({ file: path.join(dir, "fitness.db"), snapshotDir: null });
    const nowIso = NOW.toISOString();
    insertUserMessage(live.db, { id: "m1", date: "2026-10-03", text: "porridge", sentAt: nowIso, nowIso });
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
});
