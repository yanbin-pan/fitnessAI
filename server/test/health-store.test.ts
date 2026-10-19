import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { personPaths } from "../src/db/location.ts";
import { openDatabase } from "../src/db/open.ts";
import { addChatSuggestions, addFact, grantConsent, healthView } from "../src/health/records.ts";
import { saveExchange } from "../src/health/chat.ts";
import { moveLegacyHealth } from "../src/health/store.ts";
import { runNightlyHealthSnapshot } from "../src/jobs.ts";
import { createPeople, personKey } from "../src/people/people.ts";
import { NOW, openTestHealthDb, tempDir } from "./helpers.ts";

// health.db beside fitness.db (2026-10-19 health tab design §1): the move of the old health tables, and its snapshots.

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
const NOW_ISO = NOW.toISOString();

/** server/drizzle as it stood before the health tables moved out: 0000 to 0012. */
function migrationsBeforeTheMove(): string {
  const folder = path.join(tempDir(), "drizzle");
  fs.cpSync(MIGRATIONS, folder, { recursive: true });
  const file = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(file, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.tag < "0013");
  fs.writeFileSync(file, JSON.stringify(journal, null, 2));
  return folder;
}

/** A fitness.db of 2026-10-12, with one of everything the old Health tab kept. */
function seedOldHealth(file: string): void {
  const old = openDatabase({ file, snapshotDir: null, migrationsFolder: migrationsBeforeTheMove() });
  old.sqlite.exec(`
    INSERT INTO health_consent (id, granted_at) VALUES (1, '2026-10-12T09:00:00.000Z');
    INSERT INTO health_conditions (id, kind, label, added_at) VALUES
      ('c1', 'vegetarian', NULL, '2026-10-12T09:01:00.000Z'),
      ('c2', 'coeliac', NULL, '2026-10-12T09:02:00.000Z'),
      ('c3', 'lactose_intolerance', NULL, '2026-10-12T09:03:00.000Z'),
      ('c4', 'nut_allergy', NULL, '2026-10-12T09:04:00.000Z'),
      ('c5', 'other', 'Gout', '2026-10-12T09:05:00.000Z'),
      ('c6', 'high_cholesterol', NULL, '2026-10-12T09:06:00.000Z');
    INSERT INTO medications (id, name, dose, started_on, stopped_on, added_at, updated_at) VALUES
      ('m1', 'Atorvastatin', '20 mg', '2026-05-01', NULL, '2026-10-12T09:07:00.000Z', '2026-10-12T09:07:00.000Z'),
      ('m2', 'Metformin', '', NULL, '2026-04-01', '2026-10-12T09:08:00.000Z', '2026-10-12T09:08:00.000Z');
    INSERT INTO lab_reports (id, taken_on, lab_name, created_at) VALUES ('r1', '2026-09-20', 'City Lab', '2026-10-12T09:09:00.000Z');
    INSERT INTO lab_results (id, report_id, position, marker, name, printed_name, value, text_value, unit, ref_low, ref_high) VALUES
      ('x1', 'r1', 0, 'ldl', 'LDL', 'Colesterol LDL', 4.1, '', 'mmol/L', NULL, 3),
      ('x2', 'r1', 1, 'other', 'Blood group', '', NULL, 'A Rh+', '', NULL, NULL);
  `);
  old.close();
}

describe("moving the old health tables into health.db", () => {
  it("copies every row with its id on the first start, then drops them from fitness.db", () => {
    const dataDir = tempDir();
    const key = personKey("owner@example.com");
    const paths = personPaths(dataDir, key);
    seedOldHealth(paths.dbFile);

    const people = createPeople({ dataDir });
    const store = people.store(key);
    const view = healthView(store.health);
    expect(view.consented_at).toBe("2026-10-12T09:00:00.000Z");
    expect(view.facts.map((f) => [f.id, f.kind, f.code, f.label, f.level, f.status])).toEqual([
      ["c1", "diet", "vegetarian", "Vegetarian", null, "active"],
      ["c2", "intolerance", "coeliac", "Coeliac disease", "never", "active"],
      ["c3", "intolerance", "lactose_intolerance", "Lactose intolerance", "limit", "active"],
      ["c4", "allergy", "nut_allergy", "Nut allergy", "never", "active"],
      ["c5", "condition", null, "Gout", null, "active"],
      ["c6", "condition", "high_cholesterol", "High cholesterol", null, "active"],
      ["m1", "medication", null, "Atorvastatin", null, "active"],
      ["m2", "medication", null, "Metformin", null, "resolved"],
    ]);
    expect(view.facts.find((f) => f.id === "m1")).toMatchObject({ detail: "20 mg", started_on: "2026-05-01" });
    expect(view.facts.find((f) => f.id === "m2")).toMatchObject({ ended_on: "2026-04-01" });
    expect(view.documents).toEqual([expect.objectContaining({ id: "r1", kind: "lab", source: "City Lab", taken_on: "2026-09-20" })]);
    expect(view.documents[0]!.observations.map((o) => [o.code, o.printed_name, o.value, o.text_value, o.flag])).toEqual([
      ["ldl", "Colesterol LDL", 4.1, "", "high"],
      ["other", "", null, "A Rh+", "unknown"],
    ]);
    const tables = store.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
    expect(tables).not.toContain("health_conditions");
    expect(tables).not.toContain("lab_results");
    // The snapshot taken before the migration keeps the old rows.
    const snapshots = fs.readdirSync(paths.snapshotDir).filter((f) => f.startsWith("startup-"));
    expect(snapshots).toHaveLength(1);
    const before = new Database(path.join(paths.snapshotDir, snapshots[0]!), { readonly: true });
    expect(before.prepare("SELECT count(*) FROM health_conditions").pluck().get()).toBe(6);
    before.close();
    people.close();

    // A second start finds nothing to move and keeps what moved.
    const again = createPeople({ dataDir });
    expect(healthView(again.store(key).health).facts).toHaveLength(8);
    again.close();
  });

  it("adds nothing twice when it runs again before the tables are dropped", () => {
    const file = path.join(tempDir(), "fitness.db");
    seedOldHealth(file);
    const main = new Database(file);
    const health = openTestHealthDb();
    expect(moveLegacyHealth(main, health.sqlite)).toBe(12);
    expect(moveLegacyHealth(main, health.sqlite)).toBe(0);
    main.close();
    health.close();
  });

  it("does nothing on a database that never had them", () => {
    const people = createPeople({ dataDir: tempDir() });
    const store = people.store(personKey("new@example.com"));
    expect(healthView(store.health)).toEqual({ consented_at: null, facts: [], documents: [], trends: [], suggestions: [] });
    people.close();
  });
});

describe("health.db's nightly snapshot", () => {
  it("leaves out the chat and its suggestions, keeps the records, and never prunes the startup snapshots", () => {
    const db = openTestHealthDb();
    grantConsent(db.db, NOW_ISO);
    addFact(db.db, { kind: "diet", code: "vegan", label: "Vegan", detail: "", level: null, started_on: null, ended_on: null, status: "active", shared: true }, NOW_ISO);
    saveExchange(
      db.db,
      { id: "u1", text: "my back hurts", photos: 0, createdAt: NOW_ISO },
      { id: "r1", text: "Shall I add it?", options: [], read: null, facts: [], createdAt: NOW_ISO },
    );
    addChatSuggestions(db.db, "r1", [{ kind: "injury", code: null, label: "Back pain", detail: "", level: null, started_on: null, ended_on: null }], NOW_ISO);
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "health-startup-2026-09-30T01-00-00-000Z.db"), "");
    for (const iso of ["2026-10-01T02:00:00Z", "2026-10-02T02:00:00Z"]) runNightlyHealthSnapshot(db.sqlite, dir, 1, "Europe/London", new Date(iso));
    expect(fs.readdirSync(dir).sort()).toEqual(["health-2026-10-02.db", "health-startup-2026-09-30T01-00-00-000Z.db"]);
    const copy = new Database(path.join(dir, "health-2026-10-02.db"), { readonly: true });
    expect(copy.prepare("SELECT count(*) FROM chat").pluck().get()).toBe(0);
    expect(copy.prepare("SELECT count(*) FROM suggestions").pluck().get()).toBe(0);
    expect(copy.prepare("SELECT label FROM facts").pluck().all()).toEqual(["Vegan"]);
    copy.close();
    db.close();
  });
});
