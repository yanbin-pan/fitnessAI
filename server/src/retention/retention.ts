import fs from "node:fs";
import path from "node:path";
import { and, inArray, isNull, lt, ne, notInArray, or } from "drizzle-orm";
import { coachThreads, coachTurns, entries, messages, photos } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { deletePhotoFiles } from "../photos/photos.ts";
import { CHAT_WINDOW_DAYS, addDays } from "../shared.ts";
import { todayIn, zonedTimeToInstant } from "../time.ts";

const HOUR_MS = 3_600_000;
const PHOTO_FILE = /^([0-9a-f]{32})\.(jpg|png)(\.part)?$/;

export interface PurgeCounts {
  messages: number;
  photos: number;
  threads: number;
  orphanFiles: number;
}

/**
 * Files without a photo row — a crash between a row's delete and its file's, or an upload
 * whose row was never written — and leftover temporary files. Anything younger than an hour
 * is left alone, because an upload writes its file just before its row.
 */
function sweepOrphanFiles(sql: Sql, photoDir: string, now: Date): number {
  const known = new Set(sql.select({ id: photos.id }).from(photos).all().map((p) => p.id));
  let removed = 0;
  for (const name of fs.readdirSync(photoDir)) {
    const match = PHOTO_FILE.exec(name);
    if (!match) continue; // CACHEDIR.TAG, or anything else that isn't a photo
    const orphan = match[3] !== undefined || !known.has(match[1]);
    if (!orphan) continue;
    const file = path.join(photoDir, name);
    // A file can vanish between the listing and the check; that is no reason to stop sweeping.
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat || now.getTime() - stat.mtimeMs < HOUR_MS) continue;
    fs.rmSync(file, { force: true });
    removed += 1;
  }
  return removed;
}

/**
 * Deletes the conversations of the days that have left the chat window (spec §6.6): today and the CHAT_WINDOW_DAYS
 * before it, in the person's timezone, keep theirs. Messages of every role on an older day go (a reply with its
 * question), with their photos, photos no message claimed since before the oldest open day began, and each day's coach
 * thread once that day has no message left. Entries keep every number; they only lose the link to their message. A
 * message still being processed is spared however old it is: Retry can start on a message close to its expiry, and
 * the coach would otherwise finish with its message and thread gone.
 */
export function purgeExpired(sql: Sql, photoDir: string, now: Date, timeZone: string): PurgeCounts {
  const oldestOpen = addDays(todayIn(timeZone, now), -CHAT_WINDOW_DAYS);
  const cutoff = zonedTimeToInstant(oldestOpen, "00:00", timeZone).toISOString();
  const { counts, doomed } = sql.transaction((tx) => {
    // Replies and notes have no status. Startup turns messages stranded as pending into failed
    // ones (failInterrupted), so nothing stays exempt forever.
    const expiredWhere = and(lt(messages.date, oldestOpen), or(isNull(messages.status), ne(messages.status, "pending")));
    const expired = tx.select({ id: messages.id }).from(messages).where(expiredWhere);
    const photoWhere = or(inArray(photos.message_id, expired), and(isNull(photos.message_id), lt(photos.created_at, cutoff)));
    const doomed = tx.select({ id: photos.id, media_type: photos.media_type }).from(photos).where(photoWhere).all();
    const photoCount = tx.delete(photos).where(photoWhere).run().changes;
    tx.update(entries).set({ message_id: null }).where(inArray(entries.message_id, expired)).run();
    // A reply goes with its question, never outliving it, whatever day it carries.
    const replyCount = tx.delete(messages).where(inArray(messages.reply_to, expired)).run().changes;
    // Last, because the statements above find the expired messages through this table.
    const messageCount = replyCount + tx.delete(messages).where(expiredWhere).run().changes;
    const liveDates = tx.selectDistinct({ date: messages.date }).from(messages);
    tx.delete(coachTurns).where(notInArray(coachTurns.date, liveDates)).run();
    const threadCount = tx.delete(coachThreads).where(notInArray(coachThreads.date, liveDates)).run().changes;
    return { counts: { messages: messageCount, photos: photoCount, threads: threadCount }, doomed };
  });
  // Files go after the commit: a failed transaction must not leave rows without their files.
  deletePhotoFiles(photoDir, doomed);
  return { ...counts, orphanFiles: sweepOrphanFiles(sql, photoDir, now) };
}
