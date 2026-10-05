import type Database from "better-sqlite3";
import { Cron } from "croner";
import type { FastifyBaseLogger } from "fastify";
import path from "node:path";
import { pruneSnapshots, snapshot } from "./db/snapshot.ts";
import { shortKey } from "./people/people.ts";
import type { People, Store } from "./people/people.ts";
import { getProfile } from "./profile/profile.ts";
import { purgeExpired } from "./retention/retention.ts";
import { localDate } from "./time.ts";

export function runNightlySnapshot(sqlite: Database.Database, dir: string, keep: number, timeZone: string, now: Date): string {
  const file = snapshot(sqlite, dir, `fitness-${localDate(now, timeZone)}.db`);
  pruneSnapshots(dir, "fitness-", keep);
  return file;
}

/** A job's work for every person's folder, one after another: one person's failure is logged and the rest go on (2.2 §5). */
function forEachPerson(people: People, log: FastifyBaseLogger, failure: string, work: (store: Store) => void): void {
  for (const key of people.keys()) {
    try {
      work(people.store(key));
    } catch (err) {
      // Named by the start of the key, never by an email (2.2 §8).
      log.error({ err, person: shortKey(key) }, failure);
    }
  }
}

/**
 * 03:00 in the owner's timezone, half an hour before the cluster's restic run copies /data (spec §14.4). Each
 * person's snapshot is named after their own local date.
 */
export function startNightlySnapshot(opts: {
  people: People;
  keep: number;
  timeZone: string;
  log: FastifyBaseLogger;
  now?: () => Date;
}): Cron {
  const now = opts.now ?? (() => new Date());
  return new Cron("0 3 * * *", { timezone: opts.timeZone }, () => {
    forEachPerson(opts.people, opts.log, "nightly snapshot failed", (store) => {
      const timeZone = getProfile(store.db)?.timezone ?? opts.timeZone;
      const file = runNightlySnapshot(store.sqlite, store.snapshotDir, opts.keep, timeZone, now());
      // The file's name only: its path holds the whole key.
      opts.log.info({ person: shortKey(store.key), file: path.basename(file) }, "nightly snapshot written");
    });
  });
}

/** Deletes everyone's expired conversations and photos at startup and then hourly, at minute 7 (spec §6.6). */
export function startRetention(opts: {
  people: People;
  hours: number;
  log: FastifyBaseLogger;
  now?: () => Date;
}): Cron {
  const now = opts.now ?? (() => new Date());
  const run = () =>
    forEachPerson(opts.people, opts.log, "retention purge failed", (store) => {
      const counts = purgeExpired(store.db, store.photoDir, now(), opts.hours);
      // Counts only: never what was deleted.
      if (Object.values(counts).some((n) => n > 0)) opts.log.info({ person: shortKey(store.key), ...counts }, "expired conversations deleted");
    });
  run();
  return new Cron("7 * * * *", run);
}
