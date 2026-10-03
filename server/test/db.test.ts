import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/open.ts";
import { pruneSnapshots } from "../src/db/snapshot.ts";
import { openTestDb, tempDir } from "./helpers.ts";

describe("openDatabase", () => {
  it("applies the migrations and the NFS-safe settings", () => {
    const db = openTestDb();
    const tables = db.sqlite.prepare("select name from sqlite_master where type = 'table'").pluck().all();
    expect(tables).toEqual(expect.arrayContaining([
      "profile", "days", "entries", "food_items", "food_item_groups",
      "exercise_items", "exercise_muscles", "messages", "coach_threads", "coach_turns",
    ]));
    expect(db.sqlite.pragma("journal_mode", { simple: true })).toBe("delete");
    expect(db.sqlite.pragma("synchronous", { simple: true })).toBe(2); // FULL
    expect(db.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.sqlite.pragma("locking_mode", { simple: true })).toBe("exclusive");
    db.close();
  });

  it("refuses a second opener while the first holds the lock, and lets it in afterwards", () => {
    const file = path.join(tempDir(), "fitness.db");
    const first = openDatabase({ file, snapshotDir: null });
    expect(() => openDatabase({ file, snapshotDir: null, lockWaitMs: 50, lockRetryMs: 10 })).toThrow(/locked|busy/i);
    first.close();
    openDatabase({ file, snapshotDir: null, lockWaitMs: 50, lockRetryMs: 10 }).close();
  });

  it("snapshots an existing database before migrating", () => {
    const dir = tempDir();
    const file = path.join(dir, "fitness.db");
    const snapshots = path.join(dir, "snapshots");
    const first = openDatabase({ file, snapshotDir: snapshots });
    first.sqlite.exec("insert into coach_threads (date, system, created_at) values ('2026-10-03', 'x', 'now')");
    first.close();
    expect(fs.existsSync(snapshots)).toBe(false); // a brand-new file is not worth a snapshot

    openDatabase({ file, snapshotDir: snapshots }).close();
    const taken = fs.readdirSync(snapshots).filter((f) => f.startsWith("startup-"));
    expect(taken).toHaveLength(1);
    const copy = new Database(path.join(snapshots, taken[0]), { readonly: true });
    expect(copy.prepare("select count(*) from coach_threads").pluck().get()).toBe(1);
    copy.close();
  });
});

describe("pruneSnapshots", () => {
  it("keeps the newest files with the prefix and leaves the others alone", () => {
    const dir = tempDir();
    for (const name of ["fitness-2026-10-01.db", "fitness-2026-10-02.db", "fitness-2026-10-03.db", "startup-x.db"]) {
      fs.writeFileSync(path.join(dir, name), "");
    }
    expect(pruneSnapshots(dir, "fitness-", 2)).toEqual(["fitness-2026-10-01.db"]);
    expect(fs.readdirSync(dir).sort()).toEqual(["fitness-2026-10-02.db", "fitness-2026-10-03.db", "startup-x.db"]);
  });
});
