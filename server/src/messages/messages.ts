import { asc, eq, sql as rawSql } from "drizzle-orm";
import { messages } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { deleteEntry, getEntry, restoreEntry } from "../log/entries.ts";
import type { EntryBefore } from "../log/entries.ts";
import { asReaction } from "../shared.ts";
import type { Card, ChatMessage, MessageRole, MessageStatus, Reaction } from "../shared.ts";

export type MessageRow = typeof messages.$inferSelect;

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    date: row.date,
    role: row.role as MessageRole,
    text: row.text,
    photo_ids: row.photo_ids,
    status: row.status as MessageStatus | null,
    error_code: row.error_code,
    cards: row.cards,
    reply_to: row.reply_to,
    reaction: row.reaction === null ? null : asReaction(row.reaction),
    reverts: (row.undo ?? []).map((before) => before.entry_id),
    sent_at: row.sent_at,
    created_at: row.created_at,
  };
}

export function listMessages(sql: Sql, date: string): ChatMessage[] {
  return sql
    .select()
    .from(messages)
    .where(eq(messages.date, date))
    // A reply can share its question's timestamp; rowid keeps insertion order.
    .orderBy(asc(messages.created_at), asc(rawSql`rowid`))
    .all()
    .map(toChatMessage);
}

export function getMessage(sql: Sql, id: string): MessageRow | null {
  return sql.select().from(messages).where(eq(messages.id, id)).get() ?? null;
}

export function getReply(sql: Sql, userMessageId: string): MessageRow | null {
  return sql.select().from(messages).where(eq(messages.reply_to, userMessageId)).get() ?? null;
}

export function insertUserMessage(
  sql: Sql,
  m: { id: string; date: string; text: string; photoIds: string[]; sentAt: string; nowIso: string },
): void {
  sql
    .insert(messages)
    .values({
      id: m.id, date: m.date, role: "user", text: m.text, photo_ids: m.photoIds, cards: [], status: "pending",
      error_code: null, reply_to: null, sent_at: m.sentAt, created_at: m.nowIso,
    })
    .run();
}

export function setMessageStatus(sql: Sql, id: string, status: MessageStatus, errorCode: string | null): void {
  sql.update(messages).set({ status, error_code: errorCode }).where(eq(messages.id, id)).run();
}

export function insertReply(
  sql: Sql, r: { id: string; replyTo: string; date: string; text: string; cards: Card[]; undo?: EntryBefore[]; nowIso: string },
): void {
  sql
    .insert(messages)
    .values({
      id: r.id, date: r.date, role: "assistant", text: r.text, photo_ids: [], cards: r.cards, status: null,
      error_code: null, reply_to: r.replyTo, undo: r.undo?.length ? r.undo : null, sent_at: null, created_at: r.nowIso,
    })
    .run();
}

/** The companion's reaction to a user message, set with its reply. */
export function setMessageReaction(sql: Sql, id: string, reaction: Reaction | null): void {
  sql.update(messages).set({ reaction }).where(eq(messages.id, id)).run();
}

/** Takes back a reply's own entries and puts back the older ones it changed, unless changed again since; the Undo is then used up. */
export function undoReply(sql: Sql, reply: MessageRow, nowIso: string): void {
  sql.transaction((tx) => {
    if (reply.reply_to !== null) {
      for (const card of reply.cards) {
        const entry = getEntry(tx, card.id);
        if (entry && entry.message_id === reply.reply_to) deleteEntry(tx, entry.id);
      }
    }
    for (const before of reply.undo ?? []) restoreEntry(tx, before, nowIso);
    tx.update(messages).set({ undo: null }).where(eq(messages.id, reply.id)).run();
  });
}

/** A restart can strand messages as pending forever; mark them so Retry works. */
export function failInterrupted(sql: Sql): number {
  return sql.update(messages).set({ status: "failed", error_code: "interrupted" }).where(eq(messages.status, "pending")).run().changes;
}
