import type Database from "better-sqlite3";
import { Cron } from "croner";
import type { FastifyBaseLogger } from "fastify";
import { pruneSnapshots, snapshot } from "./db/snapshot.ts";
import type { Sql } from "./db/types.ts";
import { purgeExpired } from "./retention/retention.ts";
import { localDate } from "./time.ts";

export function runNightlySnapshot(sqlite: Database.Database, dir: string, keep: number, timeZone: string, now: Date): string {
  const file = snapshot(sqlite, dir, `fitness-${localDate(now, timeZone)}.db`);
  pruneSnapshots(dir, "fitness-", keep);
  return file;
}

/** 03:00 local, half an hour before the cluster's restic run copies /data (spec §14.4). */
export function startNightlySnapshot(opts: {
  sqlite: Database.Database;
  dir: string;
  keep: number;
  timeZone: string;
  log: FastifyBaseLogger;
}): Cron {
  return new Cron("0 3 * * *", { timezone: opts.timeZone }, () => {
    try {
      const file = runNightlySnapshot(opts.sqlite, opts.dir, opts.keep, opts.timeZone, new Date());
      opts.log.info({ file }, "nightly snapshot written");
    } catch (err) {
      opts.log.error({ err }, "nightly snapshot failed");
    }
  });
}

/** Deletes expired conversations and photos at startup and then hourly, at minute 7 (spec §6.6). */
export function startRetention(opts: {
  sql: Sql;
  photoDir: string;
  hours: number;
  log: FastifyBaseLogger;
  now?: () => Date;
}): Cron {
  const now = opts.now ?? (() => new Date());
  const run = () => {
    try {
      const counts = purgeExpired(opts.sql, opts.photoDir, now(), opts.hours);
      // Counts only: never what was deleted.
      if (Object.values(counts).some((n) => n > 0)) opts.log.info(counts, "expired conversations deleted");
    } catch (err) {
      opts.log.error({ err }, "retention purge failed");
    }
  };
  run();
  return new Cron("7 * * * *", run);
}
