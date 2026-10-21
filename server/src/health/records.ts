import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { chat, consent, documents, facts, observations, suggestions } from "../db/health-schema.ts";
import type { Sql } from "../db/types.ts";
import { CODE_LABELS, FactDraftInput, labFlag } from "../shared.ts";
import type {
  DocumentKind, DocumentView, FactDraft, FactKind, FactStatus, FactView, FoodLevel, HealthCondition, HealthView,
  LabMarker, MarkerTrend, ObservationView, SuggestionStatus, SuggestionView,
} from "../shared.ts";

// The Health tab's records (2026-10-19 health tab design): facts, the documents behind them, and the suggestions waiting
// for the person's OK, all in health.db. Nothing here is ever logged.

export function consentedAt(health: Sql): string | null {
  return health.select().from(consent).get()?.granted_at ?? null;
}

export function grantConsent(health: Sql, nowIso: string): void {
  health.insert(consent).values({ id: 1, granted_at: nowIso }).onConflictDoNothing().run();
}

/** "Delete my health data": every record, the chat and the consent, in one transaction. */
export function deleteHealthData(health: Sql): void {
  health.transaction((tx) => {
    tx.delete(suggestions).run();
    tx.delete(chat).run();
    tx.delete(facts).run();
    tx.delete(observations).run();
    tx.delete(documents).run();
    tx.delete(consent).run();
  });
}

// --- Facts ---

type FactRow = typeof facts.$inferSelect;
/** A fact as the routes have parsed it: FactInput's output. */
export type Fact = { [K in keyof FactDraft]: FactDraft[K] } & { status: FactStatus; shared: boolean };

function factView(row: FactRow): FactView {
  return {
    id: row.id,
    kind: row.kind as FactKind,
    code: row.code as HealthCondition | null,
    label: row.label,
    detail: row.detail,
    level: row.level as FoodLevel | null,
    status: row.status as FactStatus,
    started_on: row.started_on,
    ended_on: row.ended_on,
    shared: row.shared,
    document_id: row.document_id,
    created_at: row.created_at,
  };
}

/** Oldest first: the order they were added in. */
export function listFacts(health: Sql): FactView[] {
  return health.select().from(facts).orderBy(asc(facts.created_at), asc(facts.id)).all().map(factView);
}

/**
 * Adds a fact. One the person already has (the same code, or the same kind and words) is returned instead of added twice,
 * so accepting "Lactose intolerance" again changes nothing.
 */
export function addFact(health: Sql, input: Fact, nowIso: string, documentId: string | null = null): FactView {
  const same = (f: FactView) => f.kind === input.kind && f.status === "active" && (input.code ? f.code === input.code : f.label.trim().toLowerCase() === input.label.trim().toLowerCase());
  const existing = listFacts(health).find(same);
  if (existing) return existing;
  const row: FactRow = { id: randomUUID(), ...input, document_id: documentId, details: {}, created_at: nowIso, updated_at: nowIso };
  health.insert(facts).values(row).run();
  return factView(row);
}

export function updateFact(health: Sql, id: string, input: Fact, nowIso: string): FactView | null {
  const changed = health.update(facts).set({ ...input, updated_at: nowIso }).where(eq(facts.id, id)).run().changes;
  if (changed === 0) return null;
  const row = health.select().from(facts).where(eq(facts.id, id)).get();
  return row ? factView(row) : null;
}

export function removeFact(health: Sql, id: string): boolean {
  return health.delete(facts).where(eq(facts.id, id)).run().changes > 0;
}

// --- Documents ---

type Observation = Omit<ObservationView, "id" | "flag">;
/** A document as the routes have parsed it: DocumentInput's output. */
export interface Document {
  kind: DocumentKind;
  taken_on: string;
  title: string;
  source: string;
  language: string;
  summary: string;
  observations: Observation[];
  facts: FactDraft[];
  suggestions: FactDraft[];
  message_id: string | null;
}

/**
 * Saves a record the person checked, with the facts they ticked; the ones they left become its suggestions. A blood test
 * taken on a day that already has one joins it (see sameDayRecord), and the id returned is the record it is now part of.
 */
export function addDocument(health: Sql, input: Document, nowIso: string): string {
  const id = randomUUID();
  return health.transaction((tx) => {
    tx.insert(documents).values({
      id, kind: input.kind, taken_on: input.taken_on, title: input.title, source: input.source, language: input.language,
      summary: input.summary, details: {}, created_at: nowIso, updated_at: nowIso,
    }).run();
    if (input.observations.length > 0) {
      tx.insert(observations)
        .values(input.observations.map((o, position) => ({ id: randomUUID(), document_id: id, position, ...o, details: {} })))
        .run();
    }
    for (const fact of input.facts) addFact(tx, { ...fact, status: "active", shared: true }, nowIso, id);
    if (input.suggestions.length > 0) {
      tx.insert(suggestions)
        .values(input.suggestions.map((fact, position) => ({ id: randomUUID(), fact, document_id: id, position, created_at: nowIso })))
        .run();
    }
    if (input.message_id) {
      const message = tx.select().from(chat).where(eq(chat.id, input.message_id)).get();
      if (message) tx.update(chat).set({ details: { ...message.details, saved_document_id: id } }).where(eq(chat.id, message.id)).run();
    }
    const into = sameDayRecord(tx, input.kind, input.taken_on, id);
    if (!into) return id;
    mergeInto(tx, into, [id], nowIso);
    return into;
  });
}

// --- Merging records ---

/**
 * Kinds whose records of one day are one record: a blood test's pages, or the panels of one draw read separately, belong
 * together. Scans and letters of a day can be about different things, so they merge only when the person says.
 */
const MERGES_BY_DAY: readonly DocumentKind[] = ["lab"];

/** The record a new one of this kind and day joins: the first saved, so it keeps its id and its link from the chat. */
function sameDayRecord(health: Sql, kind: DocumentKind, takenOn: string, except: string): string | null {
  if (!MERGES_BY_DAY.includes(kind)) return null;
  const rows = health
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.kind, kind), eq(documents.taken_on, takenOn), ne(documents.id, except)))
    .orderBy(asc(documents.created_at), asc(documents.id))
    .all();
  return rows[0]?.id ?? null;
}

/** Two texts as one, each once: "City Lab" and "City Lab" stay "City Lab". */
function joined(a: string, b: string, separator: string): string {
  const parts = [a.trim(), b.trim()].filter(Boolean);
  return [...new Set(parts)].join(separator);
}

/**
 * Folds the sources into the target: their values join its list (a marker it already has is not repeated, the target's
 * result stays), their facts and suggestions point at it, and the chat's "saved" link follows. The sources are gone after.
 * Runs in the caller's transaction.
 */
function mergeInto(tx: Sql, targetId: string, sourceIds: readonly string[], nowIso: string): void {
  const target = tx.select().from(documents).where(eq(documents.id, targetId)).get();
  if (!target) return;
  const kept = tx.select().from(observations).where(eq(observations.document_id, targetId)).all();
  const keys = new Set(kept.map((o) => markerKey({ code: o.code as LabMarker, name: o.name })));
  let position = kept.reduce((max, o) => Math.max(max, o.position + 1), 0);
  let merged = { title: target.title, source: target.source, language: target.language, summary: target.summary };
  for (const sourceId of sourceIds) {
    if (sourceId === targetId) continue;
    const source = tx.select().from(documents).where(eq(documents.id, sourceId)).get();
    if (!source) continue;
    const values = tx.select().from(observations).where(eq(observations.document_id, sourceId)).orderBy(asc(observations.position)).all();
    for (const o of values) {
      const key = markerKey({ code: o.code as LabMarker, name: o.name });
      if (keys.has(key)) {
        tx.delete(observations).where(eq(observations.id, o.id)).run();
        continue;
      }
      keys.add(key);
      tx.update(observations).set({ document_id: targetId, position: position++ }).where(eq(observations.id, o.id)).run();
    }
    tx.update(facts).set({ document_id: targetId }).where(eq(facts.document_id, sourceId)).run();
    tx.update(suggestions).set({ document_id: targetId }).where(eq(suggestions.document_id, sourceId)).run();
    const messages = tx.select().from(chat).where(sql`json_extract(${chat.details}, '$.saved_document_id') = ${sourceId}`).all();
    for (const m of messages) tx.update(chat).set({ details: { ...m.details, saved_document_id: targetId } }).where(eq(chat.id, m.id)).run();
    merged = {
      title: merged.title || source.title,
      source: joined(merged.source, source.source, ", ").slice(0, 100),
      language: merged.language || source.language,
      summary: joined(merged.summary, source.summary, "\n\n"),
    };
    tx.delete(documents).where(eq(documents.id, sourceId)).run();
  }
  tx.update(documents).set({ ...merged, updated_at: nowIso }).where(eq(documents.id, targetId)).run();
}

/** The person's merge: the other records join this one, whatever their kind or day; this one keeps its date. */
export function mergeDocuments(health: Sql, targetId: string, sourceIds: readonly string[], nowIso: string): boolean {
  return health.transaction((tx) => {
    if (!tx.select({ id: documents.id }).from(documents).where(eq(documents.id, targetId)).get()) return false;
    mergeInto(tx, targetId, sourceIds, nowIso);
    return true;
  });
}

/**
 * Merges the blood tests already saved on one day (before records merged by themselves): once each start, a no-op once
 * done. Returns how many records were folded into another.
 */
export function mergeSameDayRecords(health: Sql, nowIso: string): number {
  return health.transaction((tx) => {
    const rows = tx
      .select({ id: documents.id, kind: documents.kind, taken_on: documents.taken_on })
      .from(documents)
      .where(inArray(documents.kind, [...MERGES_BY_DAY]))
      .orderBy(asc(documents.created_at), asc(documents.id))
      .all();
    const groups = new Map<string, string[]>();
    for (const row of rows) {
      const key = `${row.kind}:${row.taken_on}`;
      groups.set(key, [...(groups.get(key) ?? []), row.id]);
    }
    let folded = 0;
    for (const [first, ...rest] of groups.values()) {
      if (rest.length === 0) continue;
      mergeInto(tx, first!, rest, nowIso);
      folded += rest.length;
    }
    return folded;
  });
}

export function removeDocument(health: Sql, id: string): boolean {
  return health.transaction((tx) => {
    tx.delete(suggestions).where(eq(suggestions.document_id, id)).run();
    tx.update(facts).set({ document_id: null }).where(eq(facts.document_id, id)).run();
    tx.delete(observations).where(eq(observations.document_id, id)).run();
    return tx.delete(documents).where(eq(documents.id, id)).run().changes > 0;
  });
}

/** Every record, newest first, each with its values in the order it printed them. */
export function listDocuments(health: Sql): DocumentView[] {
  const rows = health.select().from(documents).orderBy(desc(documents.taken_on), desc(documents.created_at)).all();
  if (rows.length === 0) return [];
  const values = health
    .select()
    .from(observations)
    .where(inArray(observations.document_id, rows.map((r) => r.id)))
    .orderBy(asc(observations.position))
    .all();
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as DocumentKind,
    taken_on: row.taken_on,
    title: row.title,
    source: row.source,
    language: row.language,
    summary: row.summary,
    created_at: row.created_at,
    observations: values
      .filter((o) => o.document_id === row.id)
      .map((o): ObservationView => ({
        id: o.id,
        code: o.code as LabMarker,
        name: o.name,
        printed_name: o.printed_name,
        value: o.value,
        text_value: o.text_value,
        unit: o.unit,
        ref_low: o.ref_low,
        ref_high: o.ref_high,
        flag: labFlag(o.value, o.ref_low, o.ref_high),
      })),
  }));
}

// --- Suggestions ---

type SuggestionRow = typeof suggestions.$inferSelect;

function suggestionView(row: SuggestionRow): SuggestionView | null {
  // Written by this code; read defensively all the same, since a later version may have changed what a fact holds.
  const fact = FactDraftInput.safeParse(row.fact);
  if (!fact.success) return null;
  return { id: row.id, fact: fact.data, status: row.status as SuggestionStatus, fact_id: row.fact_id, document_id: row.document_id, message_id: row.message_id };
}

const viewsOf = (rows: SuggestionRow[]) => rows.map(suggestionView).filter((s): s is SuggestionView => s !== null);
const suggestionOrder = [asc(suggestions.created_at), asc(suggestions.position)];

export function pendingSuggestions(health: Sql): SuggestionView[] {
  return viewsOf(health.select().from(suggestions).where(eq(suggestions.status, "pending")).orderBy(...suggestionOrder).all());
}

export function suggestionsOfMessages(health: Sql, messageIds: readonly string[]): SuggestionView[] {
  if (messageIds.length === 0) return [];
  return viewsOf(health.select().from(suggestions).where(inArray(suggestions.message_id, [...messageIds])).orderBy(...suggestionOrder).all());
}

/** Facts the chat proposes, waiting on a message of the coach's. */
export function addChatSuggestions(health: Sql, messageId: string, found: readonly FactDraft[], nowIso: string): void {
  if (found.length === 0) return;
  health.insert(suggestions)
    .values(found.map((fact, position) => ({ id: randomUUID(), fact, message_id: messageId, position, created_at: nowIso })))
    .run();
}

function getSuggestion(health: Sql, id: string): SuggestionRow | undefined {
  return health.select().from(suggestions).where(eq(suggestions.id, id)).get();
}

/**
 * Adds a suggestion to the profile, as found or as the person edited it. An answer that is no longer pending returns the
 * suggestion as it stands, so a double tap adds it once.
 */
export function acceptSuggestion(health: Sql, id: string, edited: FactDraft | undefined, nowIso: string): SuggestionView | null {
  return health.transaction((tx) => {
    const row = getSuggestion(tx, id);
    if (!row) return null;
    const current = suggestionView(row);
    if (!current || current.status !== "pending") return current;
    const draft = edited ?? current.fact;
    const fact = addFact(tx, { ...draft, status: "active", shared: true }, nowIso, row.document_id);
    tx.update(suggestions).set({ status: "added", fact_id: fact.id, fact: draft }).where(eq(suggestions.id, id)).run();
    return suggestionView({ ...row, status: "added", fact_id: fact.id, fact: draft });
  });
}

export function dismissSuggestion(health: Sql, id: string): SuggestionView | null {
  const row = getSuggestion(health, id);
  if (!row) return null;
  if (row.status !== "pending") return suggestionView(row);
  health.update(suggestions).set({ status: "dismissed" }).where(eq(suggestions.id, id)).run();
  return suggestionView({ ...row, status: "dismissed" });
}

/** Undo after Add or Not now: the suggestion is pending again, and the fact it became is removed. */
export function undoSuggestion(health: Sql, id: string): SuggestionView | null {
  return health.transaction((tx) => {
    const row = getSuggestion(tx, id);
    if (!row) return null;
    if (row.fact_id) tx.delete(facts).where(eq(facts.id, row.fact_id)).run();
    tx.update(suggestions).set({ status: "pending", fact_id: null }).where(eq(suggestions.id, id)).run();
    return suggestionView({ ...row, status: "pending", fact_id: null });
  });
}

// --- Trends and the view ---

/** How a value is grouped across records: by its code, or by its printed name when the code is `other`. */
export function markerKey(result: { code: LabMarker; name: string }): string {
  return result.code === "other" ? `other:${result.name.trim().toLowerCase()}` : result.code;
}

type NumericResult = ObservationView & { value: number };
const numeric = (r: ObservationView): r is NumericResult => r.value !== null;

/**
 * Each numeric marker's values across records, oldest first, in the unit of its latest result so the points compare.
 * Results printed as words have no trend; they are read from the records themselves.
 */
export function markerTrends(docs: readonly DocumentView[]): MarkerTrend[] {
  const latest = new Map<string, NumericResult>();
  const byKey = new Map<string, MarkerTrend["points"]>();
  // Records come newest first: the first result seen for a key is its latest.
  for (const doc of docs) {
    for (const result of doc.observations.filter(numeric)) {
      const key = markerKey(result);
      const head = latest.get(key) ?? result;
      latest.set(key, head);
      if (result.unit.trim().toLowerCase() !== head.unit.trim().toLowerCase()) continue;
      const points = byKey.get(key) ?? [];
      points.unshift({ taken_on: doc.taken_on, value: result.value, flag: result.flag });
      byKey.set(key, points);
    }
  }
  return [...latest.entries()].map(([key, head]) => ({
    key,
    code: head.code,
    name: head.name,
    unit: head.unit,
    points: byKey.get(key) ?? [],
    ref_low: head.ref_low,
    ref_high: head.ref_high,
  }));
}

export function healthView(health: Sql): HealthView {
  const docs = listDocuments(health);
  return {
    consented_at: consentedAt(health),
    facts: listFacts(health),
    documents: docs,
    trends: markerTrends(docs),
    suggestions: pendingSuggestions(health),
  };
}

// --- What the coach sees ---

/** What the coach sees of the Health tab in each message's context: nothing at all until the person has agreed. */
export interface HealthContext {
  conditions?: string[];
  injuries?: string[];
  current_medications?: string[];
  stopped_medications?: string[];
  diet?: string[];
  /** Foods by how strictly to keep them out (or in): never, limit, avoid, prefer. */
  foods?: { food: string; level: FoodLevel }[];
  targets?: string[];
  notes?: string[];
  latest_blood_results?: {
    taken_on: string;
    /** Only the results outside the record's range; the coach asks for the rest with a question. */
    outside_range: {
      marker: string;
      value: number;
      unit: string;
      range: string;
      flag: "low" | "high";
      /** The same marker on earlier records, oldest first, so the coach can say how it moved. */
      earlier: { taken_on: string; value: number }[];
    }[];
    /** The rest of that record, by name: within range or printed without one; a result in words with its words. */
    other_results: string[];
  };
  /** The latest records other than blood tests: scans, letters, prescriptions. */
  other_records?: { kind: DocumentKind; taken_on: string; title: string; summary: string }[];
}

function rangeText(low: number | null, high: number | null): string {
  if (low !== null && high !== null) return `${low}-${high}`;
  if (low !== null) return `>${low}`;
  if (high !== null) return `<${high}`;
  return "none given";
}

/** "Atorvastatin (10 mg once a day; since 2026-06-02)": a fact in one line, in the words it was saved with. */
function factLine(fact: FactView): string {
  const name = fact.code && fact.label.trim() === "" ? CODE_LABELS[fact.code as Exclude<HealthCondition, "other">] : fact.label;
  const extra = [
    fact.detail,
    fact.started_on ? `since ${fact.started_on}` : "",
    fact.ended_on ? `until ${fact.ended_on}` : "",
  ].filter(Boolean);
  return extra.length > 0 ? `${name} (${extra.join("; ")})` : name;
}

const OTHER_RECORDS = 5;
const SUMMARY_CHARS = 400;

export function healthContext(health: Sql): HealthContext | null {
  if (!consentedAt(health)) return null;
  const shared = listFacts(health).filter((f) => f.shared);
  const active = shared.filter((f) => f.status === "active");
  const lines = (kind: FactKind, list = active) => list.filter((f) => f.kind === kind).map(factLine);
  const context: HealthContext = {};
  const put = <K extends keyof HealthContext>(key: K, value: HealthContext[K] & unknown[]) => {
    if (value.length > 0) context[key] = value;
  };
  put("conditions", lines("condition"));
  put("injuries", lines("injury"));
  put("current_medications", lines("medication"));
  put("stopped_medications", lines("medication", shared.filter((f) => f.status === "resolved")));
  put("diet", lines("diet"));
  put("foods", active.filter((f) => f.level !== null).map((f) => ({ food: factLine(f), level: f.level as FoodLevel })));
  put("targets", lines("target"));
  put("notes", lines("note"));

  const docs = listDocuments(health);
  const latest = docs.find((d) => d.kind === "lab" && d.observations.length > 0);
  if (latest) {
    const labs = docs.filter((d) => d.kind === "lab");
    const trends = new Map(markerTrends(labs).map((t) => [t.key, t.points]));
    context.latest_blood_results = {
      taken_on: latest.taken_on,
      outside_range: latest.observations
        .filter((r): r is NumericResult & { flag: "low" | "high" } => r.value !== null && (r.flag === "low" || r.flag === "high"))
        .map((r) => ({
          marker: r.name,
          value: r.value,
          unit: r.unit,
          range: rangeText(r.ref_low, r.ref_high),
          flag: r.flag,
          earlier: (trends.get(markerKey(r)) ?? []).filter((p) => p.taken_on < latest.taken_on).map(({ taken_on, value }) => ({ taken_on, value })),
        })),
      other_results: latest.observations
        .filter((r) => r.flag === "normal" || r.flag === "unknown")
        .map((r) => (r.value === null ? `${r.name}: ${r.text_value}` : r.name)),
    };
  }
  put(
    "other_records",
    docs
      .filter((d) => d.kind !== "lab" && d.summary)
      .slice(0, OTHER_RECORDS)
      .map((d) => ({ kind: d.kind, taken_on: d.taken_on, title: d.title, summary: d.summary.slice(0, SUMMARY_CHARS) })),
  );
  return context;
}
