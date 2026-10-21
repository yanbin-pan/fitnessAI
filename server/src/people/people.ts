import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Identity } from "../auth/access.ts";
import { PERSON_KEY, preparePersonDir } from "../db/location.ts";
import { openDatabase } from "../db/open.ts";
import type { OpenDatabase } from "../db/open.ts";
import type { Sql } from "../db/types.ts";
import { mergeSameDayRecords } from "../health/records.ts";
import { moveLegacyHealth, openHealthDatabase } from "../health/store.ts";
import { failInterrupted } from "../messages/messages.ts";

// Two databases and one photo folder per person (2.2 §4): the logbook in fitness.db, the health records in health.db
// (2026-10-19 health tab design §1). Nobody's data is ever reachable from another's.

/** A person's folder name: the sha256 of their verified, lowercased email, in lowercase hex (2.2 §3). */
export function personKey(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

/** How logs name a person: the first 8 characters of their key, never their email (2.2 §8). */
export function shortKey(key: string): string {
  return key.slice(0, 8);
}

/** One person's open database and folders. */
export interface Store {
  key: string;
  db: Sql;
  sqlite: Database.Database;
  health: Sql;
  healthSqlite: Database.Database;
  photoDir: string;
  snapshotDir: string;
}

/** The signed-in person a request acts for. */
export interface Person {
  key: string;
  owner: boolean;
  db: Sql;
  health: Sql;
  photoDir: string;
}

export interface People {
  /** The signed-in person's data, opened on their first request and kept open. */
  personFor(identity: Identity): Person;
  /** A person's store by key, opened if it isn't yet. */
  store(key: string): Store;
  /** Every person's folder under users/, by key, sorted. */
  keys(): string[];
  /** The stores open now (startup opens everyone's), so a reader can skip opening any. */
  opened(): Store[];
  /** Only startup may wait out an old pod's lock (P2); afterwards a locked database is refused at once. */
  stopWaitingForLocks(): void;
  close(): void;
}

export function createPeople(opts: { dataDir: string }): People {
  const open = new Map<string, { store: Store; close: () => void }>();
  const usersDir = path.join(opts.dataDir, "users");
  // openDatabase waits for a lock with a synchronous sleep (2 minutes by default), which blocks the event loop: right at
  // startup, wrong in a request. undefined leaves its default; stopWaitingForLocks() makes it 0.
  let lockWaitMs: number | undefined;

  function store(key: string): Store {
    // Keys come from personKey or from folder names; anything else must never reach a path.
    if (!PERSON_KEY.test(key)) throw new Error("not a person key");
    const existing = open.get(key);
    if (existing) return existing.store;
    const paths = preparePersonDir(opts.dataDir, key);
    // health.db first: fitness.db's migrations drop the old health tables, so their rows move across just before.
    const health = openHealthDatabase({ file: paths.healthFile, snapshotDir: paths.snapshotDir, lockWaitMs });
    let database: OpenDatabase;
    try {
      // The settings and startup snapshot milestone 1 gave the one database (spec §14.4).
      database = openDatabase({
        file: paths.dbFile,
        snapshotDir: paths.snapshotDir,
        lockWaitMs,
        beforeMigrate: (sqlite) => void moveLegacyHealth(sqlite, health.sqlite),
      });
    } catch (err) {
      health.close();
      throw err;
    }
    const close = () => {
      try {
        database.close();
      } finally {
        health.close();
      }
    };
    try {
      // Nothing in this process has touched this database yet, so a message still pending was cut off by the last restart.
      failInterrupted(database.db);
      // Blood tests saved apart on one day before they merged by themselves (2026-10-21) become one record.
      mergeSameDayRecords(health.db, new Date().toISOString());
    } catch (err) {
      // Not open after all: its exclusive lock would be held for the life of the process, and every retry refused.
      close();
      throw err;
    }
    const opened: Store = {
      key, db: database.db, sqlite: database.sqlite, health: health.db, healthSqlite: health.sqlite, photoDir: paths.photoDir, snapshotDir: paths.snapshotDir,
    };
    open.set(key, { store: opened, close });
    return opened;
  }

  return {
    personFor(identity) {
      const opened = store(personKey(identity.email));
      return { key: opened.key, owner: identity.owner, db: opened.db, health: opened.health, photoDir: opened.photoDir };
    },
    store,
    keys() {
      if (!fs.existsSync(usersDir)) return [];
      return fs
        .readdirSync(usersDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && PERSON_KEY.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    },
    opened() {
      return [...open.values()].map(({ store: opened }) => opened);
    },
    stopWaitingForLocks() {
      lockWaitMs = 0;
    },
    close() {
      // Each handle in its own try: one that won't close must not leave the others' locks held.
      let failure: { err: unknown } | undefined;
      for (const { close } of open.values()) {
        try {
          close();
        } catch (err) {
          failure ??= { err };
        }
      }
      open.clear();
      if (failure) throw failure.err;
    },
  };
}
