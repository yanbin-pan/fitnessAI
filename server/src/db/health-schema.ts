import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { FactDraft } from "../../../shared/src/health.ts";

// The person's health database, health.db beside fitness.db (2026-10-19 health tab design §1). Kinds, codes and levels
// are text checked in code, and each table that can grow new details has a JSON `details` column, so a new kind of record
// or a new detail needs no migration. Keep this file free of app imports but types: drizzle-kit loads it on its own.

/** The person's agreement to keep health records and give them to the coach. One row at most. */
export const consent = sqliteTable("consent", {
  id: integer().primaryKey(),
  granted_at: text().notNull(),
});

/** One record: a blood test, a scan's report, a doctor's letter, a prescription. */
export const documents = sqliteTable(
  "documents",
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    taken_on: text().notNull(),
    title: text().notNull(),
    source: text().notNull().default(""),
    language: text().notNull().default(""),
    summary: text().notNull().default(""),
    details: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [index("documents_taken_on_idx").on(t.taken_on)],
);

/** One measured value of a record, in the order the record printed it. */
export const observations = sqliteTable(
  "observations",
  {
    id: text().primaryKey(),
    document_id: text().notNull().references(() => documents.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    printed_name: text().notNull().default(""),
    value: real(),
    text_value: text().notNull().default(""),
    unit: text().notNull().default(""),
    ref_low: real(),
    ref_high: real(),
    details: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("observations_document_idx").on(t.document_id), index("observations_code_idx").on(t.code)],
);

/** What the coach should know: a condition, injury, medication, allergy, diet, food rule, target or note. */
export const facts = sqliteTable(
  "facts",
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    code: text(),
    label: text().notNull(),
    detail: text().notNull().default(""),
    level: text(),
    status: text().notNull().default("active"),
    started_on: text(),
    ended_on: text(),
    shared: integer({ mode: "boolean" }).notNull().default(true),
    document_id: text().references(() => documents.id, { onDelete: "set null" }),
    details: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [index("facts_kind_idx").on(t.kind)],
);

/** The Health chat (design §4): a conversation, deleted with the Today chats and never backed up. */
export const chat = sqliteTable(
  "chat",
  {
    id: text().primaryKey(),
    role: text().notNull(),
    text: text().notNull(),
    /** For a message of the person's: the coach's reply to it, once there is one. */
    reply_id: text(),
    details: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    created_at: text().notNull(),
  },
  (t) => [index("chat_created_idx").on(t.created_at)],
);

/** Facts the coach found and the person has not yet added: from the chat, or left unticked on a record. */
export const suggestions = sqliteTable(
  "suggestions",
  {
    id: text().primaryKey(),
    fact: text({ mode: "json" }).$type<FactDraft>().notNull(),
    status: text().notNull().default("pending"),
    fact_id: text().references(() => facts.id, { onDelete: "set null" }),
    document_id: text().references(() => documents.id, { onDelete: "cascade" }),
    message_id: text().references(() => chat.id, { onDelete: "cascade" }),
    position: integer().notNull().default(0),
    created_at: text().notNull(),
  },
  (t) => [index("suggestions_document_idx").on(t.document_id), index("suggestions_message_idx").on(t.message_id)],
);
