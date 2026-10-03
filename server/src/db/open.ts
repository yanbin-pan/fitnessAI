import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pruneSnapshots, snapshot, stamp } from "./snapshot.ts";
import type { Sql } from "./types.ts";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export interface OpenOptions {
  file: string;
  /** Where to put a snapshot of an existing database before migrating; null to skip. */
  snapshotDir: string | null;
  /** How long to wait for another process's lock to clear (default 2 minutes, spec §14.4). */
  lockWaitMs?: number;
  lockRetryMs?: number;
}

function isBusy(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err.code === "SQLITE_BUSY" || err.code === "SQLITE_LOCKED");
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Takes the database's write lock and keeps it for the life of the process.
 * Two pods sharing one SQLite file over NFS would corrupt it; with an exclusive
 * lock held, a second opener gets SQLITE_BUSY instead. A pod that died
 * uncleanly releases its lock when the NFS lease expires, hence the retry.
 */
function acquireExclusiveLock(sqlite: Database.Database, opts: OpenOptions): void {
  const deadline = Date.now() + (opts.lockWaitMs ?? 120_000);
  for (;;) {
    try {
      sqlite.exec("BEGIN EXCLUSIVE; COMMIT;");
      return;
    } catch (err) {
      if (!isBusy(err) || Date.now() >= deadline) throw err;
      sleep(opts.lockRetryMs ?? 5_000);
    }
  }
}

export function openDatabase(opts: OpenOptions) {
  fs.mkdirSync(path.dirname(opts.file), { recursive: true });
  const existed = fs.existsSync(opts.file) && fs.statSync(opts.file).size > 0;
  const sqlite = new Database(opts.file, { timeout: 0 });
  try {
    sqlite.pragma("locking_mode = EXCLUSIVE");
    acquireExclusiveLock(sqlite, opts);
    // WAL needs shared memory, which NFS cannot provide, so keep the rollback journal.
    sqlite.pragma("journal_mode = DELETE");
    sqlite.pragma("synchronous = FULL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("temp_store = MEMORY");
    if (existed && opts.snapshotDir) {
      snapshot(sqlite, opts.snapshotDir, `startup-${stamp(new Date())}.db`);
      pruneSnapshots(opts.snapshotDir, "startup-", 3);
    }
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder: MIGRATIONS });
    const db: Sql = database;
    return { db, sqlite, close: () => sqlite.close() };
  } catch (err) {
    sqlite.close();
    throw err;
  }
}

export type OpenDatabase = ReturnType<typeof openDatabase>;
