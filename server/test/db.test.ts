import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/open.ts";
import { pruneSnapshots } from "../src/db/snapshot.ts";
import { getEntry, insertEntry } from "../src/log/entries.ts";
import { NOW, openTestDb, sampleEntry, sampleFood, tempDir } from "./helpers.ts";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

interface Journal {
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
}
const readJournal = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as Journal;
/** How many migrations server/drizzle ships. */
const SHIPPED = readJournal(MIGRATIONS).entries.length;

/** A copy of server/drizzle with one more migration after the last, as drizzle-kit would append it. */
function migrationsWith(tag: string, statements: string[]): string {
  const folder = path.join(tempDir(), "drizzle");
  fs.cpSync(MIGRATIONS, folder, { recursive: true });
  const journal = readJournal(folder);
  const last = journal.entries[journal.entries.length - 1];
  journal.entries.push({ idx: last.idx + 1, version: "6", when: last.when + 60_000, tag, breakpoints: true });
  fs.writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify(journal, null, 2));
  fs.writeFileSync(path.join(folder, `${tag}.sql`), statements.join("\n--> statement-breakpoint\n"));
  return folder;
}

const ENTRY_COLUMNS = "id, date, logged_at, source, message_id, external_id, merged_into_entry_id, edited, deleted_at, created_at, updated_at";

/** Rebuilds `entries` the way drizzle-kit does when a column change needs a new table. */
const rebuildEntries = () => migrationsWith("0001_rebuild", [
  "PRAGMA foreign_keys=OFF;",
  `CREATE TABLE __new_entries (
  id text PRIMARY KEY NOT NULL, date text NOT NULL, logged_at text NOT NULL, source text NOT NULL,
  message_id text, external_id text, merged_into_entry_id text, edited integer DEFAULT false NOT NULL,
  deleted_at text, created_at text NOT NULL, updated_at text NOT NULL
);`,
  `INSERT INTO __new_entries(${ENTRY_COLUMNS}) SELECT ${ENTRY_COLUMNS} FROM entries;`,
  "DROP TABLE entries;",
  "ALTER TABLE __new_entries RENAME TO entries;",
  "PRAGMA foreign_keys=ON;",
  "CREATE UNIQUE INDEX entries_external_id_unique ON entries (external_id);",
  "CREATE INDEX entries_date_idx ON entries (date);",
]);

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

    openDatabase({ file, snapshotDir: snapshots, migrationsFolder: rebuildEntries() }).close();
    const taken = fs.readdirSync(snapshots).filter((f) => f.startsWith("startup-"));
    expect(taken).toHaveLength(1);
    const copy = new Database(path.join(snapshots, taken[0]), { readonly: true });
    expect(copy.prepare("select count(*) from coach_threads").pluck().get()).toBe(1);
    expect(copy.prepare("select count(*) from __drizzle_migrations").pluck().get()).toBe(SHIPPED); // taken before the new one ran
    copy.close();
  });

  it("snapshots at startup only when a migration is pending", () => {
    const dir = tempDir();
    const file = path.join(dir, "fitness.db");
    const snapshots = path.join(dir, "snapshots");
    const taken = () => (fs.existsSync(snapshots) ? fs.readdirSync(snapshots).filter((f) => f.startsWith("startup-")) : []);
    openDatabase({ file, snapshotDir: snapshots }).close();
    expect(taken()).toEqual([]); // the file did not exist
    openDatabase({ file, snapshotDir: snapshots }).close();
    expect(taken()).toEqual([]); // nothing pending: restarts, even a crash loop, cannot rotate the useful copy away
    openDatabase({ file, snapshotDir: snapshots, migrationsFolder: rebuildEntries() }).close();
    expect(taken()).toHaveLength(1);
  });

  it("keeps child rows when a migration rebuilds their parent table", () => {
    const file = path.join(tempDir(), "fitness.db");
    const first = openDatabase({ file, snapshotDir: null });
    const entry = sampleEntry({ foods: [sampleFood({ groups: [{ group: "wholegrains", portions: 1 }] })] });
    insertEntry(first.db, entry, NOW.toISOString());
    first.close();

    const second = openDatabase({ file, snapshotDir: null, migrationsFolder: rebuildEntries() });
    try {
      expect(second.sqlite.prepare("select count(*) from __drizzle_migrations").pluck().get()).toBe(SHIPPED + 1); // the rebuild ran
      const kept = getEntry(second.db, entry.id);
      expect(kept?.foods.map((f) => f.name)).toEqual(["Eggs"]);
      expect(kept?.foods[0].groups).toEqual([{ group: "wholegrains", portions: 1 }]);
      expect(second.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      second.close();
    }
  });

  it("refuses to start when a migration leaves a foreign-key violation", () => {
    const file = path.join(tempDir(), "fitness.db");
    openDatabase({ file, snapshotDir: null }).close();
    const orphan = migrationsWith("0001_orphan", ["INSERT INTO exercise_muscles (exercise_item_id, muscle, role) VALUES ('missing', 'quads', 'primary');"]);
    expect(() => openDatabase({ file, snapshotDir: null, migrationsFolder: orphan })).toThrow(
      "migrations left 1 foreign-key violation(s); restore the startup snapshot",
    );
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
