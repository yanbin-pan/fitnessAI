import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pruneSnapshots, snapshot, stamp } from "./snapshot.ts";
import type { Sql } from "./types.ts";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export interface OpenOptions {
  file: string;
  /**
   * Where to put a snapshot of an existing database before a pending migration runs; null to skip.
   * Nothing is taken when no migration is pending, so restarts cannot rotate that copy away.
   */
  snapshotDir: string | null;
  /** How long to wait for another process's lock to clear (default 2 minutes, spec §14.4). */
  lockWaitMs?: number;
  lockRetryMs?: number;
  /** Tests only: a different migrations folder. */
  migrationsFolder?: string;
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

/** The newest applied migration's timestamp, or null when none has been applied. */
function lastAppliedMigration(sqlite: Database.Database): number | null {
  try {
    const row = sqlite
      .prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1")
      .get() as { created_at: unknown } | undefined;
    return row ? Number(row.created_at) : null;
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return null;
    throw err;
  }
}

/** The comparison migrate() makes: anything newer than the newest applied migration will run. */
function migrationPending(sqlite: Database.Database, migrationsFolder: string): boolean {
  const last = lastAppliedMigration(sqlite);
  return last === null || readMigrationFiles({ migrationsFolder }).some((m) => m.folderMillis > last);
}

export function openDatabase(opts: OpenOptions) {
  const migrationsFolder = opts.migrationsFolder ?? MIGRATIONS;
  fs.mkdirSync(path.dirname(opts.file), { recursive: true });
  const existed = fs.existsSync(opts.file) && fs.statSync(opts.file).size > 0;
  const sqlite = new Database(opts.file, { timeout: 0 });
  try {
    sqlite.pragma("locking_mode = EXCLUSIVE");
    acquireExclusiveLock(sqlite, opts);
    // WAL needs shared memory, which NFS cannot provide, so keep the rollback journal.
    sqlite.pragma("journal_mode = DELETE");
    sqlite.pragma("synchronous = FULL");
    sqlite.pragma("temp_store = MEMORY");
    // Conversations are deleted after 48 hours (spec §6.6). secure_delete overwrites their
    // rows instead of leaving them in free pages, and a zero journal_size_limit truncates the
    // rollback journal that exclusive locking keeps between transactions.
    sqlite.pragma("secure_delete = ON");
    sqlite.pragma("journal_size_limit = 0");
    if (existed && opts.snapshotDir && migrationPending(sqlite, migrationsFolder)) {
      snapshot(sqlite, opts.snapshotDir, `startup-${stamp(new Date())}.db`);
      pruneSnapshots(opts.snapshotDir, "startup-", 3);
    }
    // SQLite ignores PRAGMA foreign_keys inside a transaction, and the migrator runs every pending
    // migration in one, so keep foreign keys off across it: a generated table rebuild would
    // otherwise cascade-delete child rows. Check the result before turning them back on.
    sqlite.pragma("foreign_keys = OFF");
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder });
    const violations = sqlite.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error(`migrations left ${violations.length} foreign-key violation(s); restore the startup snapshot`);
    }
    sqlite.pragma("foreign_keys = ON");
    const db: Sql = database;
    return { db, sqlite, close: () => sqlite.close() };
  } catch (err) {
    sqlite.close();
    throw err;
  }
}

export type OpenDatabase = ReturnType<typeof openDatabase>;
