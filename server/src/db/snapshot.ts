import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/** A consistent copy of the live database (VACUUM INTO), safe to back up while the app runs. */
export function snapshot(sqlite: Database.Database, dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  fs.rmSync(target, { force: true }); // VACUUM INTO refuses to overwrite
  sqlite.prepare("VACUUM INTO ?").run(target);
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
