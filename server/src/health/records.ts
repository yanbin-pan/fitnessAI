import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { healthConditions, healthConsent, labReports, labResults, medications } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { labFlag } from "../shared.ts";
import type {
  ConditionView, HealthCondition, HealthView, LabMarker, LabReportInput, LabReportView, LabResultView, MarkerTrend,
  MedicationInput, MedicationView,
} from "../shared.ts";

// The Health tab's records (2026-10-12 health context design): conditions, medications and blood results, kept in the
// person's own database until they remove them. Nothing here is ever logged.

export function consentedAt(sql: Sql): string | null {
  return sql.select().from(healthConsent).get()?.granted_at ?? null;
}

export function grantConsent(sql: Sql, nowIso: string): void {
  sql.insert(healthConsent).values({ id: 1, granted_at: nowIso }).onConflictDoNothing().run();
}

/** "Delete my health data": every record and the consent, in one transaction. */
export function deleteHealthData(sql: Sql): void {
  sql.transaction((tx) => {
    tx.delete(labResults).run();
    tx.delete(labReports).run();
    tx.delete(medications).run();
    tx.delete(healthConditions).run();
    tx.delete(healthConsent).run();
  });
}

export function listConditions(sql: Sql): ConditionView[] {
  return sql
    .select()
    .from(healthConditions)
    .orderBy(asc(healthConditions.added_at))
    .all()
    .map((row) => ({ id: row.id, kind: row.kind as HealthCondition, label: row.label, added_at: row.added_at }));
}

/** Adds a condition; a fixed chip already there is returned instead of added twice. */
export function addCondition(sql: Sql, input: { kind: HealthCondition; label: string | null }, nowIso: string): ConditionView {
  if (input.kind !== "other") {
    const existing = listConditions(sql).find((c) => c.kind === input.kind);
    if (existing) return existing;
  }
  const row = { id: randomUUID(), kind: input.kind, label: input.label, added_at: nowIso };
  sql.insert(healthConditions).values(row).run();
  return row;
}

export function removeCondition(sql: Sql, id: string): boolean {
  return sql.delete(healthConditions).where(eq(healthConditions.id, id)).run().changes > 0;
}

function medicationView(row: typeof medications.$inferSelect): MedicationView {
  return { id: row.id, name: row.name, dose: row.dose, started_on: row.started_on, stopped_on: row.stopped_on };
}

/** Current medications first, then stopped ones, newest first within each. */
export function listMedications(sql: Sql): MedicationView[] {
  const rows = sql.select().from(medications).orderBy(desc(medications.added_at)).all().map(medicationView);
  return [...rows.filter((m) => !m.stopped_on), ...rows.filter((m) => m.stopped_on)];
}

type Medication = Required<{ [K in keyof MedicationInput]: Exclude<MedicationInput[K], undefined> }>;

export function addMedication(sql: Sql, input: Medication, nowIso: string): MedicationView {
  const row = { id: randomUUID(), ...input, added_at: nowIso, updated_at: nowIso };
  sql.insert(medications).values(row).run();
  return medicationView(row);
}

export function updateMedication(sql: Sql, id: string, input: Medication, nowIso: string): MedicationView | null {
  const changed = sql.update(medications).set({ ...input, updated_at: nowIso }).where(eq(medications.id, id)).run().changes;
  if (changed === 0) return null;
  const row = sql.select().from(medications).where(eq(medications.id, id)).get();
  return row ? medicationView(row) : null;
}

export function removeMedication(sql: Sql, id: string): boolean {
  return sql.delete(medications).where(eq(medications.id, id)).run().changes > 0;
}

type LabReport = { taken_on: string; lab_name: string; results: Required<{ [K in keyof LabReportInput["results"][number]]: Exclude<LabReportInput["results"][number][K], undefined> }>[] };

export function addLabReport(sql: Sql, input: LabReport, nowIso: string): string {
  const id = randomUUID();
  sql.transaction((tx) => {
    tx.insert(labReports).values({ id, taken_on: input.taken_on, lab_name: input.lab_name, created_at: nowIso }).run();
    tx.insert(labResults)
      .values(input.results.map((result, position) => ({ id: randomUUID(), report_id: id, position, ...result })))
      .run();
  });
  return id;
}

export function removeLabReport(sql: Sql, id: string): boolean {
  return sql.transaction((tx) => {
    tx.delete(labResults).where(eq(labResults.report_id, id)).run();
    return tx.delete(labReports).where(eq(labReports.id, id)).run().changes > 0;
  });
}

/** Every report, newest first, each with its results in the order the report printed them. */
export function listLabReports(sql: Sql): LabReportView[] {
  const reports = sql.select().from(labReports).orderBy(desc(labReports.taken_on), desc(labReports.created_at)).all();
  if (reports.length === 0) return [];
  const results = sql
    .select()
    .from(labResults)
    .where(inArray(labResults.report_id, reports.map((r) => r.id)))
    .orderBy(asc(labResults.position))
    .all();
  return reports.map((report) => ({
    id: report.id,
    taken_on: report.taken_on,
    lab_name: report.lab_name,
    results: results
      .filter((r) => r.report_id === report.id)
      .map((r): LabResultView => ({
        id: r.id,
        marker: r.marker as LabMarker,
        name: r.name,
        printed_name: r.printed_name,
        value: r.value,
        text_value: r.text_value,
        unit: r.unit,
        ref_low: r.ref_low,
        ref_high: r.ref_high,
        flag: labFlag(r.value, r.ref_low, r.ref_high),
      })),
  }));
}

/** How a result is grouped across reports: by its code, or by its printed name when the code is `other`. */
export function markerKey(result: { marker: LabMarker; name: string }): string {
  return result.marker === "other" ? `other:${result.name.trim().toLowerCase()}` : result.marker;
}

type NumericResult = LabResultView & { value: number };
const numeric = (r: LabResultView): r is NumericResult => r.value !== null;

/**
 * Each numeric marker's values across reports, oldest first, in the unit of its latest result so the points compare.
 * Results printed as words have no trend; they are read from the reports themselves.
 */
export function markerTrends(reports: readonly LabReportView[]): MarkerTrend[] {
  const latest = new Map<string, NumericResult>();
  const byKey = new Map<string, MarkerTrend["points"]>();
  // Reports come newest first: the first result seen for a key is its latest.
  for (const report of reports) {
    for (const result of report.results.filter(numeric)) {
      const key = markerKey(result);
      const head = latest.get(key) ?? result;
      latest.set(key, head);
      if (result.unit.trim().toLowerCase() !== head.unit.trim().toLowerCase()) continue;
      const points = byKey.get(key) ?? [];
      points.unshift({ taken_on: report.taken_on, value: result.value, flag: result.flag });
      byKey.set(key, points);
    }
  }
  return [...latest.entries()].map(([key, head]) => ({
    key,
    marker: head.marker,
    name: head.name,
    unit: head.unit,
    points: byKey.get(key) ?? [],
    ref_low: head.ref_low,
    ref_high: head.ref_high,
  }));
}

export function healthView(sql: Sql): HealthView {
  const reports = listLabReports(sql);
  return {
    consented_at: consentedAt(sql),
    conditions: listConditions(sql),
    medications: listMedications(sql),
    reports,
    trends: markerTrends(reports),
  };
}

/** What the coach sees of the Health tab in each message's context: nothing at all until the person has agreed. */
export interface HealthContext {
  conditions: string[];
  current_medications: { name: string; dose?: string; since?: string }[];
  stopped_medications: { name: string; from?: string; to: string }[];
  latest_blood_results?: {
    taken_on: string;
    /** Only the results outside the lab's range; the coach asks for the rest with a question. */
    outside_range: {
      marker: string;
      value: number;
      unit: string;
      range: string;
      flag: "low" | "high";
      /** The same marker on earlier reports, oldest first, so the coach can say how it moved. */
      earlier: { taken_on: string; value: number }[];
    }[];
    /** The rest of that report, by name: within range or printed without one; a result in words with its words. */
    other_results: string[];
  };
}

function rangeText(low: number | null, high: number | null): string {
  if (low !== null && high !== null) return `${low}-${high}`;
  if (low !== null) return `>${low}`;
  if (high !== null) return `<${high}`;
  return "none given";
}

export function healthContext(sql: Sql): HealthContext | null {
  if (!consentedAt(sql)) return null;
  const conditions = listConditions(sql).map((c) => (c.kind === "other" ? (c.label ?? "other") : c.kind));
  const meds = listMedications(sql);
  const context: HealthContext = {
    conditions,
    current_medications: meds
      .filter((m) => !m.stopped_on)
      .map((m) => ({ name: m.name, ...(m.dose ? { dose: m.dose } : {}), ...(m.started_on ? { since: m.started_on } : {}) })),
    stopped_medications: meds
      .filter((m): m is MedicationView & { stopped_on: string } => Boolean(m.stopped_on))
      .map((m) => ({ name: m.name, ...(m.started_on ? { from: m.started_on } : {}), to: m.stopped_on })),
  };
  const reports = listLabReports(sql);
  const [latest] = reports;
  if (latest) {
    const trends = new Map(markerTrends(reports).map((t) => [t.key, t.points]));
    context.latest_blood_results = {
      taken_on: latest.taken_on,
      outside_range: latest.results
        .filter((r): r is NumericResult & { flag: "low" | "high" } => r.value !== null && (r.flag === "low" || r.flag === "high"))
        .map((r) => ({
          marker: r.name,
          value: r.value,
          unit: r.unit,
          range: rangeText(r.ref_low, r.ref_high),
          flag: r.flag,
          earlier: (trends.get(markerKey(r)) ?? []).filter((p) => p.taken_on < latest.taken_on).map(({ taken_on, value }) => ({ taken_on, value })),
        })),
      other_results: latest.results
        .filter((r) => r.flag === "normal" || r.flag === "unknown")
        .map((r) => (r.value === null ? `${r.name}: ${r.text_value}` : r.name)),
    };
  }
  return context;
}
