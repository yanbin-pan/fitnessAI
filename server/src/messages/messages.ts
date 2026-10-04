import { asc, eq, sql as rawSql } from "drizzle-orm";
import { messages } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import type { Card, ChatMessage, MessageRole, MessageStatus } from "../shared.ts";

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

export function insertUserMessage(sql: Sql, m: { id: string; date: string; text: string; sentAt: string; nowIso: string }): void {
  sql
    .insert(messages)
    .values({
      id: m.id, date: m.date, role: "user", text: m.text, photo_ids: [], cards: [], status: "pending",
      error_code: null, reply_to: null, sent_at: m.sentAt, created_at: m.nowIso,
    })
    .run();
}

export function setMessageStatus(sql: Sql, id: string, status: MessageStatus, errorCode: string | null): void {
  sql.update(messages).set({ status, error_code: errorCode }).where(eq(messages.id, id)).run();
}

export function insertReply(sql: Sql, r: { id: string; replyTo: string; date: string; text: string; cards: Card[]; nowIso: string }): void {
  sql
    .insert(messages)
    .values({
      id: r.id, date: r.date, role: "assistant", text: r.text, photo_ids: [], cards: r.cards, status: null,
      error_code: null, reply_to: r.replyTo, sent_at: null, created_at: r.nowIso,
    })
    .run();
}

/** A restart can strand messages as pending forever; mark them so Retry works. */
export function failInterrupted(sql: Sql): number {
  return sql.update(messages).set({ status: "failed", error_code: "interrupted" }).where(eq(messages.status, "pending")).run().changes;
}
