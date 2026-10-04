import type Database from "better-sqlite3";
import { Cron } from "croner";
import type { FastifyBaseLogger } from "fastify";
import { pruneSnapshots, snapshot } from "./db/snapshot.ts";
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
