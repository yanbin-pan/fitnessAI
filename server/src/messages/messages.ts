import { asc, eq, sql as rawSql } from "drizzle-orm";
import { messages } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import type { ChatMessage, MessageRole, MessageStatus } from "../shared.ts";

export type MessageRow = typeof messages.$inferSelect;

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    date: row.date,
    role: row.role as MessageRole,
    text: row.text,
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
