import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { photos } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { detectImageType, extensionFor, imageSize } from "./images.ts";
import type { ImageType } from "./images.ts";

// Every coach turn replays the day's photos, and the Claude API refuses any image over 2000 px
// once a request holds more than 20 of them (and over 10 MB of base64 each, 32 MB a request).
// The phone sends JPEGs within 1568 px of a few hundred kilobytes; these limits keep anything
// else from making every later message of its day fail.
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_PHOTO_EDGE = 2000;
/** Photo ids are 128 random bits in hex: unguessable, and safe to put in a file name. */
export const PHOTO_ID = /^[0-9a-f]{32}$/;

export type PhotoRow = typeof photos.$inferSelect;

/** A photo as the coach receives it. */
export interface PhotoData {
  media_type: ImageType;
  /** Base64. */
  data: string;
}

export function photoFile(dir: string, photo: { id: string; media_type: string }): string {
  return path.join(dir, `${photo.id}.${extensionFor(photo.media_type as ImageType)}`);
}

export type SaveResult = { ok: true; photo: PhotoRow } | { ok: false; error: "not_an_image" | "image_too_large" };

/** Checks the bytes, writes the file under a temporary name, renames it, then records the row. */
export function savePhoto(sql: Sql, dir: string, bytes: Uint8Array, nowIso: string): SaveResult {
  const type = detectImageType(bytes);
  const size = type ? imageSize(bytes, type) : null;
  if (!type || !size) return { ok: false, error: "not_an_image" };
  if (size.width > MAX_PHOTO_EDGE || size.height > MAX_PHOTO_EDGE) return { ok: false, error: "image_too_large" };
  const photo: PhotoRow = {
    id: randomBytes(16).toString("hex"),
    message_id: null,
    media_type: type,
    bytes: bytes.length,
    width: size.width,
    height: size.height,
    created_at: nowIso,
  };
  const file = photoFile(dir, photo);
  fs.writeFileSync(`${file}.part`, bytes);
  fs.renameSync(`${file}.part`, file);
  try {
    sql.insert(photos).values(photo).run();
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }
  return { ok: true, photo };
}

export function getPhoto(sql: Sql, id: string): PhotoRow | null {
  return sql.select().from(photos).where(eq(photos.id, id)).get() ?? null;
}

/** The photo's bytes, or null when its file has gone. */
export function readPhoto(dir: string, photo: PhotoRow): Buffer | null {
  try {
    return fs.readFileSync(photoFile(dir, photo));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** The photo as the coach receives it, or null when its row or file has gone. */
export function photoData(sql: Sql, dir: string, id: string): PhotoData | null {
  const photo = getPhoto(sql, id);
  const bytes = photo ? readPhoto(dir, photo) : null;
  return photo && bytes ? { media_type: photo.media_type as ImageType, data: bytes.toString("base64") } : null;
}

export type ClaimResult = { ok: true } | { ok: false; error: "photo_not_found" | "photo_taken" };

/** Attaches photos to a message. Each photo belongs to one message; the same message may claim it again. */
export function claimPhotos(sql: Sql, ids: string[], messageId: string): ClaimResult {
  if (ids.length === 0) return { ok: true };
  const unique = [...new Set(ids)];
  const rows = sql.select().from(photos).where(inArray(photos.id, unique)).all();
  if (rows.length !== unique.length) return { ok: false, error: "photo_not_found" };
  if (rows.some((row) => row.message_id !== null && row.message_id !== messageId)) return { ok: false, error: "photo_taken" };
  sql.update(photos).set({ message_id: messageId }).where(and(inArray(photos.id, unique), isNull(photos.message_id))).run();
  return { ok: true };
}

/** Removes photo files; a file that has already gone is fine. */
export function deletePhotoFiles(dir: string, list: { id: string; media_type: string }[]): void {
  for (const photo of list) fs.rmSync(photoFile(dir, photo), { force: true });
}
