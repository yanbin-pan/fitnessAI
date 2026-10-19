import type Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../db/open.ts";
import type { OpenDatabase } from "../db/open.ts";
import { stripHealthConversations } from "../db/snapshot.ts";
import { CODE_LABELS, HEALTH_CONDITIONS, kindOfCode } from "../shared.ts";
import type { FoodLevel, HealthCondition } from "../shared.ts";

// health.db, beside fitness.db (2026-10-19 health tab design §1): the same settings and the same startup snapshot, its
// own migrations, and a snapshot that leaves out the Health chat.

const HEALTH_MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle-health");

export function openHealthDatabase(opts: { file: string; snapshotDir: string | null; lockWaitMs?: number }): OpenDatabase {
  return openDatabase({
    file: opts.file,
    snapshotDir: opts.snapshotDir,
    lockWaitMs: opts.lockWaitMs,
    migrationsFolder: HEALTH_MIGRATIONS,
    snapshotPrefix: "health-startup-",
    strip: stripHealthConversations,
  });
}

/** fitness.db's tables from the 2026-10-12 health context design, which migration 0013 drops once they are copied. */
const LEGACY_TABLES = ["health_consent", "health_conditions", "medications", "lab_reports", "lab_results"] as const;

const isCode = (value: string): value is HealthCondition => (HEALTH_CONDITIONS as readonly string[]).includes(value);

/** Coeliac disease admits no gluten at all; lactose in small amounts suits most people who are intolerant. */
function legacyLevel(code: HealthCondition): FoodLevel | null {
  const kind = kindOfCode(code);
  if (kind === "allergy" || code === "coeliac") return "never";
  if (kind === "intolerance") return "limit";
  return null;
}

/**
 * Copies the old health tables of fitness.db into health.db, keeping every id, so running it twice (a crash between the
 * copy and the migration that drops them) adds nothing twice. Does nothing once they are gone. Run as fitness.db's
 * `beforeMigrate`: its startup snapshot, taken just before, keeps the old rows.
 */
export function moveLegacyHealth(main: Database.Database, health: Database.Database): number {
  const present = new Set(main.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[]);
  if (!LEGACY_TABLES.every((table) => present.has(table))) return 0;
  let moved = 0;
  const insertFact = health.prepare(
    `INSERT OR IGNORE INTO facts (id, kind, code, label, detail, level, status, started_on, ended_on, shared, created_at, updated_at)
     VALUES (@id, @kind, @code, @label, @detail, @level, @status, @started_on, @ended_on, 1, @created_at, @updated_at)`,
  );
  health.transaction(() => {
    for (const row of main.prepare("SELECT granted_at FROM health_consent").all() as { granted_at: string }[]) {
      moved += health.prepare("INSERT OR IGNORE INTO consent (id, granted_at) VALUES (1, ?)").run(row.granted_at).changes;
    }
    const conditions = main.prepare("SELECT id, kind, label, added_at FROM health_conditions").all() as {
      id: string; kind: string; label: string | null; added_at: string;
    }[];
    for (const c of conditions) {
      const code = isCode(c.kind) && c.kind !== "other" ? c.kind : null;
      moved += insertFact.run({
        id: c.id,
        kind: code ? kindOfCode(code) : "condition",
        code,
        label: code ? CODE_LABELS[code] : (c.label ?? "Other"),
        detail: "",
        level: code ? legacyLevel(code) : null,
        status: "active",
        started_on: null,
        ended_on: null,
        created_at: c.added_at,
        updated_at: c.added_at,
      }).changes;
    }
    const meds = main.prepare("SELECT id, name, dose, started_on, stopped_on, added_at, updated_at FROM medications").all() as {
      id: string; name: string; dose: string; started_on: string | null; stopped_on: string | null; added_at: string; updated_at: string;
    }[];
    for (const m of meds) {
      moved += insertFact.run({
        id: m.id,
        kind: "medication",
        code: null,
        label: m.name,
        detail: m.dose,
        level: null,
        status: m.stopped_on ? "resolved" : "active",
        started_on: m.started_on,
        ended_on: m.stopped_on,
        created_at: m.added_at,
        updated_at: m.updated_at,
      }).changes;
    }
    const insertDocument = health.prepare(
      `INSERT OR IGNORE INTO documents (id, kind, taken_on, title, source, created_at, updated_at)
       VALUES (@id, 'lab', @taken_on, '', @lab_name, @created_at, @created_at)`,
    );
    for (const r of main.prepare("SELECT id, taken_on, lab_name, created_at FROM lab_reports").all()) moved += insertDocument.run(r as object).changes;
    const insertObservation = health.prepare(
      `INSERT OR IGNORE INTO observations (id, document_id, position, code, name, printed_name, value, text_value, unit, ref_low, ref_high)
       VALUES (@id, @report_id, @position, @marker, @name, @printed_name, @value, @text_value, @unit, @ref_low, @ref_high)`,
    );
    const results = main.prepare(
      "SELECT id, report_id, position, marker, name, printed_name, value, text_value, unit, ref_low, ref_high FROM lab_results",
    ).all();
    for (const r of results) moved += insertObservation.run(r as object).changes;
  })();
  return moved;
}
