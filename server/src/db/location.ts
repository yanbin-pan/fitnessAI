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

function writeTag(dir: string): void {
  const file = path.join(dir, "CACHEDIR.TAG");
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === CACHEDIR_TAG) return;
  fs.writeFileSync(file, CACHEDIR_TAG);
}

/** Where one person's data lives (2.2 §4). `key` is their personKey, never an email. */
export interface PersonPaths {
  dir: string;
  dbFile: string;
  photoDir: string;
  snapshotDir: string;
}

export function personPaths(dataDir: string, key: string): PersonPaths {
  const dir = path.join(dataDir, "users", key);
  return { dir, dbFile: path.join(dir, "db", "fitness.db"), photoDir: path.join(dir, "photos"), snapshotDir: path.join(dir, "snapshots") };
}

/**
 * Lays out one person's folder: db/ and photos/, both tagged so backups skip them, and snapshots/. Run before their
 * database is opened, because it clears the copy a crashed snapshot can leave beside it.
 */
export function preparePersonDir(dataDir: string, key: string): PersonPaths {
  const paths = personPaths(dataDir, key);
  const dbDir = path.dirname(paths.dbFile);
  for (const dir of [dbDir, paths.photoDir, paths.snapshotDir]) fs.mkdirSync(dir, { recursive: true });
  writeTag(dbDir);
  writeTag(paths.photoDir);
  // A crash during a snapshot leaves its copy, conversations still in it, beside the database until the next one.
  const part = snapshotPartFile(paths.dbFile);
  for (const stale of [part, `${part}-journal`]) fs.rmSync(stale, { force: true });
  return paths;
}

/** What the first start of milestone 2.2 found at the top of the data folder. */
export type OwnerMove = "none" | "moved" | "both";

/**
 * Milestone 2.2's one move (2.2 §4): milestone 2.1's db/, photos/ and snapshots/ at the top of the data folder become
 * the owner's. Run before anything opens a database. The folders go into a staging folder and arrive with one rename,
 * so a crash part-way leaves something the next start finishes, never a half-filled owner's folder. An owner's folder
 * that already exists is never touched: "both".
 */
export function moveOwnerIn(dataDir: string, ownerKey: string): OwnerMove {
  const owner = personPaths(dataDir, ownerKey);
  const staging = `${owner.dir}.moving`;
  if (!fs.existsSync(path.join(dataDir, "db", "fitness.db")) && !fs.existsSync(staging)) return "none";
  if (fs.existsSync(owner.dir)) return "both";
  fs.mkdirSync(staging, { recursive: true });
  // db/ moves whole, so a journal stays beside its database.
  for (const name of ["db", "photos", "snapshots"]) {
    const from = path.join(dataDir, name);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(staging, name));
  }
  fs.renameSync(staging, owner.dir);
  return "moved";
}
