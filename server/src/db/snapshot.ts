import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Conversations never reach a backup (spec §14.4): empty them out of a snapshot, clear the
 * entries' links to them, and compact the file so nothing deleted is left in free pages.
 * A startup snapshot can come from an older schema, so only tables that exist are touched.
 */
export function stripConversations(file: string): void {
  const copy = new Database(file);
  try {
    const tables = new Set(copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[]);
    copy.transaction(() => {
      for (const table of ["coach_turns", "coach_threads", "photos", "messages"]) {
        if (tables.has(table)) copy.prepare(`DELETE FROM ${table}`).run();
      }
      if (tables.has("entries")) copy.prepare("UPDATE entries SET message_id = NULL").run();
    })();
    copy.exec("VACUUM");
  } finally {
    copy.close();
  }
}

/**
 * A consistent copy of the live database (VACUUM INTO), without conversations, safe to back up while the app runs.
 * The copy is built beside the live database, in a folder backups skip, and moved into `dir` only once its
 * conversations are gone (a rename, so `dir` must share the live database's volume): a failed strip or a crash
 * can then never leave a copy that holds a conversation in the folder that is backed up.
 */
export function snapshot(sqlite: Database.Database, dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  const part = `${sqlite.name}.snapshot-part`;
  fs.rmSync(part, { force: true }); // a leftover from a crash; VACUUM INTO refuses to overwrite
  try {
    sqlite.prepare("VACUUM INTO ?").run(part);
    stripConversations(part);
    fs.renameSync(part, target); // atomic on one volume, and it replaces an earlier snapshot of the same name
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
  return target;
}

/** Deletes all but the newest `keep` snapshots starting with `prefix`. Names sort by time. */
export function pruneSnapshots(dir: string, prefix: string, keep: number): string[] {
  const names = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".db")).sort();
  const remove = names.slice(0, Math.max(0, names.length - keep));
  for (const name of remove) fs.rmSync(path.join(dir, name));
  return remove;
}

/** A filesystem-safe timestamp that sorts chronologically. */
export function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
