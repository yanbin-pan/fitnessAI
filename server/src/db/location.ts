import fs from "node:fs";
import path from "node:path";
import { snapshotPartFile } from "./snapshot.ts";

/**
 * restic's --exclude-caches skips every folder holding this file (spec §14.4). The first
 * line is the Cache Directory Tagging standard's signature and must stay exactly as it is.
 */
export const CACHEDIR_TAG = [
  "Signature: 8a477f597d28d172789f06886806bc55",
  "# fitnessAI: this folder is never backed up. It holds the live database or photos;",
  "# backups keep the nightly snapshots in ../snapshots instead (spec §14.4).",
  "",
].join("\n");

/** What happened to milestone 1's database, which lived at <dataDir>/fitness.db. */
export type MoveOutcome = "fresh" | "moved" | "in_place" | "both";

export interface DataPaths {
  dbFile: string;
  photoDir: string;
  snapshotDir: string;
  move: MoveOutcome;
}

function writeTag(dir: string): void {
  const file = path.join(dir, "CACHEDIR.TAG");
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === CACHEDIR_TAG) return;
  fs.writeFileSync(file, CACHEDIR_TAG);
}

/**
 * Lays out the data folder: db/ and photos/ (both tagged so backups skip them) and
 * snapshots/. Run before the database is opened, because it may move milestone 1's
 * database into db/ — a rename on the same volume — and because it clears the copy a
 * crashed snapshot can leave beside the database.
 */
export function prepareDataDir(dataDir: string): DataPaths {
  const dbDir = path.join(dataDir, "db");
  const photoDir = path.join(dataDir, "photos");
  const snapshotDir = path.join(dataDir, "snapshots");
  for (const dir of [dbDir, photoDir, snapshotDir]) fs.mkdirSync(dir, { recursive: true });
  writeTag(dbDir);
  writeTag(photoDir);

  const dbFile = path.join(dbDir, "fitness.db");
  const legacy = path.join(dataDir, "fitness.db");
  let move: MoveOutcome;
  if (!fs.existsSync(legacy)) {
    move = fs.existsSync(dbFile) ? "in_place" : "fresh";
  } else if (fs.existsSync(dbFile)) {
    // Something put a database back at the old path (a rollback to milestone 1, say). The one in db/ is current.
    move = "both";
  } else {
    // The journal first: a hot journal must end up beside its database, or SQLite cannot roll it back.
    if (fs.existsSync(`${legacy}-journal`)) fs.renameSync(`${legacy}-journal`, `${dbFile}-journal`);
    fs.renameSync(legacy, dbFile);
    move = "moved";
  }

  // A crash during a snapshot leaves its copy, conversations still in it, beside the database until
  // the next snapshot. Startup is the moment to clear it.
  const part = snapshotPartFile(dbFile);
  for (const stale of [part, `${part}-journal`]) fs.rmSync(stale, { force: true });
  return { dbFile, photoDir, snapshotDir, move };
}
