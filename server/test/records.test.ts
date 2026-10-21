import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { buildTurnContext } from "../src/coach/prompt.ts";
import { processMessage } from "../src/coach/process.ts";
import { callsOn } from "../src/coach/usage.ts";
import { buildDayView } from "../src/days/days.ts";
import { chat, documents, observations } from "../src/db/health-schema.ts";
import { photos } from "../src/db/schema.ts";
import { purgeHealthChat } from "../src/health/chat.ts";
import { markerFood } from "../src/health/food.ts";
import { READ_INSTRUCTIONS } from "../src/health/read.ts";
import {
  addChatSuggestions, addDocument, addFact, grantConsent, healthContext, listDocuments, listFacts, markerTrends, mergeDocuments, mergeSameDayRecords, pendingSuggestions,
} from "../src/health/records.ts";
import type { Document, Fact } from "../src/health/records.ts";
import { insertEntry } from "../src/log/entries.ts";
import { insertUserMessage } from "../src/messages/messages.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { labFlag } from "../src/shared.ts";
import type { FactDraft, LabMarker } from "../src/shared.ts";
import { fakeAi, jsonReply, stopWith, textReply } from "./fake-ai.ts";
import { fakeJpeg } from "./images.ts";
import { NOW, makeProfile, openTestDb, openTestHealthDb, sampleEntry, sampleFood, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const NOW_ISO = NOW.toISOString();
type Observation = Document["observations"][number];
const result = (overrides: Partial<Observation> = {}): Observation => ({
  code: "ferritin" as LabMarker, name: "Ferritin", printed_name: "", value: 12, text_value: "", unit: "ug/L", ref_low: 30, ref_high: 400, ...overrides,
});
const draft = (overrides: Partial<FactDraft> = {}): FactDraft => ({
  kind: "condition", code: null, label: "Gout", detail: "", level: null, started_on: null, ended_on: null, ...overrides,
});
const fact = (overrides: Partial<Fact> = {}): Fact => ({ ...draft(), status: "active", shared: true, ...overrides });
const doc = (overrides: Partial<Document> = {}): Document => ({
  kind: "lab", taken_on: "2026-09-20", title: "", source: "", language: "", summary: "", observations: [result()], facts: [], suggestions: [],
  message_id: null, ...overrides,
});

async function consented(opts: Parameters<typeof testApp>[0] = {}) {
  const app = await testApp(opts);
  saveProfile(app.db, makeProfile(), NOW_ISO);
  expect((await app.app.inject({ method: "POST", url: "/api/records/consent", headers: app.headers })).statusCode).toBe(200);
  return app;
}

async function uploadPhoto(app: TestApp): Promise<string> {
  const res = await app.app.inject({ method: "POST", url: "/api/photos", headers: { ...app.headers, "content-type": "image/jpeg" }, payload: fakeJpeg(800, 1000) });
  return res.json().id;
}

const view = async (app: TestApp) => (await app.app.inject({ method: "GET", url: "/api/records", headers: app.headers })).json();
const post = (app: TestApp, url: string, payload: unknown = {}) => app.app.inject({ method: "POST", url, headers: app.headers, payload: payload as object });

describe("lab flags", () => {
  it("compare a value with whichever ends of the range are printed", () => {
    expect(labFlag(12, 30, 400)).toBe("low");
    expect(labFlag(500, 30, 400)).toBe("high");
    expect(labFlag(100, 30, 400)).toBe("normal");
    expect(labFlag(6, null, 5.2)).toBe("high");
    expect(labFlag(6, null, null)).toBe("unknown");
  });
});

describe("the Health tab's records", () => {
  it("refuse writes until the person agrees, and deleting takes everything with the consent", async () => {
    ctx = await testApp();
    expect(await view(ctx)).toEqual({ consented_at: null, facts: [], documents: [], trends: [], suggestions: [] });
    const add = () => post(ctx!, "/api/records/facts", { kind: "intolerance", code: "lactose_intolerance", label: "Lactose intolerance" });
    expect((await add()).statusCode).toBe(409);

    await post(ctx, "/api/records/consent");
    expect((await add()).json()).toMatchObject({ kind: "intolerance", level: "limit", shared: true, status: "active" });
    // The same fact is added once.
    await add();
    await post(ctx, "/api/records/documents", { kind: "lab", taken_on: "2026-09-20", observations: [result()], suggestions: [draft()] });
    const full = await view(ctx);
    expect(full.consented_at).toBe(NOW_ISO);
    expect(full.facts).toHaveLength(1);
    expect(full.documents[0]).toMatchObject({ kind: "lab", title: "", observations: [{ name: "Ferritin", flag: "low" }] });
    expect(full.suggestions).toHaveLength(1);

    expect((await ctx.app.inject({ method: "DELETE", url: "/api/records", headers: ctx.headers })).statusCode).toBe(204);
    expect(await view(ctx)).toEqual({ consented_at: null, facts: [], documents: [], trends: [], suggestions: [] });
  });

  it("keep levels to foods, fill in a kind's level, and check dates", async () => {
    ctx = await consented();
    const add = (payload: object) => post(ctx!, "/api/records/facts", payload);
    expect((await add({ kind: "allergy", label: "Peanuts" })).json()).toMatchObject({ level: "never" });
    expect((await add({ kind: "food", label: "Mushrooms" })).json()).toMatchObject({ level: "avoid" });
    expect((await add({ kind: "food", label: "Oats", level: "prefer" })).json()).toMatchObject({ level: "prefer" });
    expect((await add({ kind: "injury", label: "Left knee", level: "never" })).json()).toMatchObject({ level: null });
    expect((await add({ kind: "condition", code: "other", label: "Gout" })).json()).toMatchObject({ code: null, label: "Gout" });
    expect((await add({ kind: "medication", label: "X", started_on: "2026-05-02", ended_on: "2026-05-01" })).statusCode).toBe(400);
    expect((await add({ kind: "sleep", label: "X" })).statusCode).toBe(400);
    expect((await add({ kind: "note", label: "" })).statusCode).toBe(400);
  });

  it("edit, hide from the coach and remove facts", async () => {
    ctx = await consented();
    const med = (await post(ctx, "/api/records/facts", { kind: "medication", label: "Metformin" })).json();
    const put = await ctx.app.inject({
      method: "PUT", url: `/api/records/facts/${med.id}`, headers: ctx.headers,
      payload: { kind: "medication", label: "Metformin", detail: "500 mg", ended_on: "2026-10-01", status: "resolved", shared: false },
    });
    expect(put.json()).toMatchObject({ detail: "500 mg", ended_on: "2026-10-01", status: "resolved", shared: false });
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/records/facts/${med.id}`, headers: ctx.headers })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/records/facts/${med.id}`, headers: ctx.headers })).statusCode).toBe(404);
  });

  it("save a checked record with the facts ticked, keep the others as its suggestions, and delete it", async () => {
    ctx = await consented();
    const saved = (await post(ctx, "/api/records/documents", {
      kind: "imaging", taken_on: "2026-06-18", title: "Knee MRI, left", source: "Radiologie am Rhein", language: "German",
      summary: "Small tear of the medial meniscus. No fracture.",
      facts: [draft({ kind: "injury", label: "Left knee, meniscus tear", detail: "No deep squats" })],
      suggestions: [draft({ kind: "note", label: "Physio advised" })],
    })).json();
    const record = saved.documents[0];
    expect(record).toMatchObject({ kind: "imaging", title: "Knee MRI, left", observations: [] });
    expect(saved.facts).toEqual([expect.objectContaining({ kind: "injury", document_id: record.id })]);
    expect(saved.suggestions).toEqual([expect.objectContaining({ document_id: record.id, status: "pending", fact: expect.objectContaining({ label: "Physio advised" }) })]);

    expect((await ctx.app.inject({ method: "DELETE", url: `/api/records/documents/${record.id}`, headers: ctx.headers })).statusCode).toBe(204);
    const after = await view(ctx);
    expect(after.documents).toEqual([]);
    expect(after.suggestions).toEqual([]);
    // The injury stays: it is the person's now, not the record's.
    expect(after.facts).toEqual([expect.objectContaining({ kind: "injury", document_id: null })]);
  });

  it("add a suggestion as found or edited, once however often it is tapped, and undo it", async () => {
    ctx = await consented();
    const saved = (await post(ctx, "/api/records/documents", { kind: "letter", taken_on: "2026-06-02", suggestions: [draft({ label: "Prediabetes", code: "prediabetes" }), draft({ kind: "medication", label: "Atorvastatin" })] })).json();
    const [first, second] = saved.suggestions;
    const added = (await post(ctx, `/api/records/suggestions/${first.id}/accept`)).json();
    expect(added).toMatchObject({ status: "added", fact_id: expect.any(String) });
    expect((await post(ctx, `/api/records/suggestions/${first.id}/accept`)).json()).toMatchObject({ fact_id: added.fact_id });
    expect((await view(ctx)).facts).toEqual([expect.objectContaining({ id: added.fact_id, code: "prediabetes", document_id: saved.documents[0].id })]);

    const edited = (await post(ctx, `/api/records/suggestions/${second.id}/accept`, { fact: draft({ kind: "medication", label: "Atorvastatin", detail: "10 mg" }) })).json();
    expect(edited.fact.detail).toBe("10 mg");
    expect((await post(ctx, `/api/records/suggestions/${second.id}/undo`)).json()).toMatchObject({ status: "pending", fact_id: null });
    expect((await post(ctx, `/api/records/suggestions/${second.id}/dismiss`)).json()).toMatchObject({ status: "dismissed" });
    const after = await view(ctx);
    expect(after.facts.map((f: { label: string }) => f.label)).toEqual(["Prediabetes"]);
    expect(after.suggestions).toEqual([]);
    expect((await post(ctx, "/api/records/suggestions/nope/accept")).statusCode).toBe(404);
  });

  it("export everything as a file", async () => {
    ctx = await consented();
    await post(ctx, "/api/records/facts", { kind: "diet", code: "vegetarian", label: "Vegetarian" });
    const res = await ctx.app.inject({ method: "GET", url: "/api/records/export", headers: ctx.headers });
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.json()).toMatchObject({ exported_at: NOW_ISO, facts: [expect.objectContaining({ code: "vegetarian" })] });
  });

  it("keep each person's records to themselves, in their own health.db", async () => {
    ctx = await consented({ guests: ["friend@example.com"] });
    await post(ctx, "/api/records/facts", { kind: "diet", code: "vegan", label: "Vegan" });
    const friend = await ctx.headersFor("friend@example.com");
    expect((await ctx.app.inject({ method: "GET", url: "/api/records", headers: friend })).json()).toMatchObject({ consented_at: null, facts: [] });
    // Nothing of it in the logbook's database.
    const tables = ctx.storeOf("owner@example.com").sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
    expect(tables).not.toContain("facts");
  });
});

describe("merging records", () => {
  it("joins a blood test to the one already saved that day, each marker once, the first result kept", () => {
    const db = openTestHealthDb();
    const first = addDocument(db.db, doc({ source: "City Lab", observations: [result({ value: 12 }), result({ code: "ldl", name: "LDL", value: 4.1, unit: "mmol/L", ref_low: null, ref_high: 3 })] }), NOW_ISO);
    const second = addDocument(db.db, doc({
      source: "City Lab",
      summary: "Thyroid panel.",
      observations: [result({ value: 13 }), result({ code: "other", name: "TSH", value: 2.1, unit: "mIU/L", ref_low: 0.4, ref_high: 4 })],
      facts: [draft({ label: "Hypothyroid watch" })],
      suggestions: [draft({ kind: "note", label: "Retest in 3 months" })],
    }), NOW_ISO);
    expect(second).toBe(first);
    const docs = listDocuments(db.db);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: first, source: "City Lab", summary: "Thyroid panel." });
    expect(docs[0]!.observations.map((o) => [o.name, o.value])).toEqual([["Ferritin", 12], ["LDL", 4.1], ["TSH", 2.1]]);
    expect(listFacts(db.db)).toEqual([expect.objectContaining({ label: "Hypothyroid watch", document_id: first })]);
    expect(pendingSuggestions(db.db)).toEqual([expect.objectContaining({ document_id: first })]);
    db.close();
  });

  it("keeps other days, and other kinds of the same day, apart", () => {
    const db = openTestHealthDb();
    addDocument(db.db, doc(), NOW_ISO);
    addDocument(db.db, doc({ taken_on: "2026-09-21" }), NOW_ISO);
    addDocument(db.db, doc({ kind: "imaging", observations: [], title: "Knee MRI" }), NOW_ISO);
    addDocument(db.db, doc({ kind: "imaging", observations: [], title: "Chest X-ray" }), NOW_ISO);
    expect(listDocuments(db.db)).toHaveLength(4);
    db.close();
  });

  it("folds the records the person picks into one, whatever their day, and follows the chat's link", () => {
    const db = openTestHealthDb();
    const scan = addDocument(db.db, doc({ kind: "imaging", taken_on: "2026-06-18", title: "Knee MRI", observations: [], summary: "Small tear." }), NOW_ISO);
    const letter = addDocument(db.db, doc({ kind: "letter", taken_on: "2026-06-20", observations: [], summary: "Physio advised." }), NOW_ISO);
    db.db.insert(chat).values({ id: "11111111-1111-4111-8111-111111111111", role: "coach", text: "Saved", details: { saved_document_id: letter }, created_at: NOW_ISO }).run();
    addChatSuggestions(db.db, "11111111-1111-4111-8111-111111111111", [], NOW_ISO);
    expect(mergeDocuments(db.db, scan, [letter], NOW_ISO)).toBe(true);
    const docs = listDocuments(db.db);
    expect(docs).toEqual([expect.objectContaining({ id: scan, taken_on: "2026-06-18", title: "Knee MRI", summary: "Small tear.\n\nPhysio advised." })]);
    expect(db.db.select().from(chat).get()?.details).toEqual({ saved_document_id: scan });
    expect(mergeDocuments(db.db, "missing", [scan], NOW_ISO)).toBe(false);
    db.close();
  });

  it("merges the blood tests saved apart on one day before, once", () => {
    const db = openTestHealthDb();
    for (const value of [12, 13]) {
      db.db.insert(documents).values({ id: `d${value}`, kind: "lab", taken_on: "2026-09-20", title: "", created_at: `2026-10-0${value - 10}T09:00:00.000Z`, updated_at: NOW_ISO }).run();
      db.db.insert(observations).values({ id: `o${value}`, document_id: `d${value}`, position: 0, code: value === 12 ? "ferritin" : "ldl", name: String(value), value }).run();
    }
    expect(mergeSameDayRecords(db.db, NOW_ISO)).toBe(1);
    expect(mergeSameDayRecords(db.db, NOW_ISO)).toBe(0);
    expect(listDocuments(db.db)).toEqual([expect.objectContaining({ id: "d12", observations: [expect.objectContaining({ value: 12 }), expect.objectContaining({ value: 13 })] })]);
    db.close();
  });

  it("merge from the record's page", async () => {
    ctx = await consented();
    await post(ctx, "/api/records/documents", { kind: "imaging", taken_on: "2026-06-18", title: "Knee MRI" });
    const both = (await post(ctx, "/api/records/documents", { kind: "letter", taken_on: "2026-06-20", summary: "Physio advised." })).json();
    const [letter, scan] = both.documents;
    const merged = await post(ctx, `/api/records/documents/${scan.id}/merge`, { ids: [letter.id] });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().documents).toEqual([expect.objectContaining({ id: scan.id, summary: "Physio advised." })]);
    expect((await post(ctx, `/api/records/documents/${scan.id}/merge`, { ids: [] })).statusCode).toBe(400);
    expect((await post(ctx, "/api/records/documents/nope/merge", { ids: [scan.id] })).statusCode).toBe(404);
  });
});

describe("marker trends", () => {
  it("follow a marker across records in its latest unit, oldest first", () => {
    const db = openTestHealthDb();
    addDocument(db.db, doc({ taken_on: "2026-03-01", observations: [result({ value: 15 })] }), NOW_ISO);
    addDocument(db.db, doc({ taken_on: "2026-06-01", observations: [result({ value: 9, unit: "ng/mL" })] }), NOW_ISO);
    addDocument(db.db, doc({ taken_on: "2026-09-01", observations: [result({ value: 25 }), result({ code: "other", name: "Zinc", value: 11, unit: "umol/L", ref_low: null, ref_high: null })] }), NOW_ISO);
    const trends = markerTrends(listDocuments(db.db));
    expect(trends.find((t) => t.key === "ferritin")?.points.map((p) => p.value)).toEqual([15, 25]);
    expect(trends.find((t) => t.key === "other:zinc")?.points).toHaveLength(1);
    db.close();
  });

  it("stand beside the nutrient they relate to in the food log", async () => {
    ctx = await consented();
    const log = (date: string, foods: ReturnType<typeof sampleFood>[]) => insertEntry(ctx!.db, sampleEntry({ date, logged_at: `${date}T08:00:00.000Z`, foods }), NOW_ISO);
    log("2026-09-02", [sampleFood({ name: "Cheddar", saturated_fat_g: 20 }), sampleFood({ name: "Oats", saturated_fat_g: 2 })]);
    log("2026-09-03", [sampleFood({ name: "Cheddar", saturated_fat_g: 10 })]);
    log("2026-10-01", [sampleFood({ name: "Croissant", saturated_fat_g: 8 })]);
    addDocument(ctx.health, doc({ taken_on: "2026-09-20", observations: [result({ code: "ldl", name: "LDL", value: 4.1, unit: "mmol/L", ref_low: null, ref_high: 3 })] }), NOW_ISO);
    const res = (await ctx.app.inject({ method: "GET", url: "/api/records/markers/ldl", headers: ctx.headers })).json();
    expect(res.trend).toMatchObject({ code: "ldl", points: [{ value: 4.1, flag: "high" }] });
    expect(res.nutrient.key).toBe("saturated_fat_g");
    expect(res.nutrient.months).toEqual([{ month: "2026-09", average: 16, days: 2 }, { month: "2026-10", average: 8, days: 1 }]);
    expect(res.nutrient.sources[0]).toEqual({ name: "Cheddar", share: 0.75 });
    expect((await ctx.app.inject({ method: "GET", url: "/api/records/markers/nope", headers: ctx.headers })).statusCode).toBe(404);
    // A marker with no related nutrient still has its trend.
    expect(markerFood(ctx.db, { ...res.trend, code: "tsh" }, "2026-10-03").nutrient).toBeNull();
  });
});

describe("the coach's health context", () => {
  it("is absent until the person agrees, then holds what the coach may see", () => {
    const db = openTestHealthDb();
    addFact(db.db, fact({ kind: "medication", label: "Atorvastatin", detail: "20 mg", started_on: "2026-05-01" }), NOW_ISO);
    addFact(db.db, fact({ kind: "medication", label: "Metformin", status: "resolved", ended_on: "2026-04-01" }), NOW_ISO);
    addFact(db.db, fact({ kind: "injury", label: "Left knee, meniscus tear", detail: "no deep squats" }), NOW_ISO);
    addFact(db.db, fact({ kind: "allergy", label: "Peanuts", level: "never" }), NOW_ISO);
    addFact(db.db, fact({ kind: "condition", label: "Psoriasis", shared: false }), NOW_ISO);
    addFact(db.db, fact({ kind: "target", label: "Saturated fat under 15 g" }), NOW_ISO);
    addDocument(db.db, doc({ taken_on: "2026-03-01", observations: [result({ value: 15 })] }), NOW_ISO);
    addDocument(db.db, doc({ taken_on: "2026-09-01", observations: [
      result(),
      result({ code: "hdl", name: "HDL", value: 1.4, unit: "mmol/L", ref_low: 1, ref_high: null }),
      result({ code: "other", name: "Blood group", printed_name: "Gruppo sanguigno", value: null, text_value: "A Rh+", unit: "", ref_low: null, ref_high: null }),
    ] }), NOW_ISO);
    addDocument(db.db, doc({ kind: "imaging", taken_on: "2026-06-18", title: "Knee MRI", summary: "Small meniscus tear.", observations: [] }), NOW_ISO);
    expect(healthContext(db.db)).toBeNull();

    grantConsent(db.db, NOW_ISO);
    const health = healthContext(db.db);
    expect(health).toEqual({
      injuries: ["Left knee, meniscus tear (no deep squats)"],
      current_medications: ["Atorvastatin (20 mg; since 2026-05-01)"],
      stopped_medications: ["Metformin (until 2026-04-01)"],
      foods: [{ food: "Peanuts", level: "never" }],
      targets: ["Saturated fat under 15 g"],
      latest_blood_results: {
        taken_on: "2026-09-01",
        outside_range: [{ marker: "Ferritin", value: 12, unit: "ug/L", range: "30-400", flag: "low", earlier: [{ taken_on: "2026-03-01", value: 15 }] }],
        other_results: ["HDL", "Blood group: A Rh+"],
      },
      other_records: [{ kind: "imaging", taken_on: "2026-06-18", title: "Knee MRI", summary: "Small meniscus tear." }],
    });
    const main = openTestDb();
    const view = buildDayView(main.db, makeProfile(), "2026-10-03", "2026-10-03", NOW_ISO, []);
    const context = JSON.parse(buildTurnContext(view, NOW, "Europe/London", "en", false, [], health).split("\n")[1]);
    expect(context.health.injuries).toHaveLength(1);
    expect(JSON.parse(buildTurnContext(view, NOW, "Europe/London", "en").split("\n")[1])).not.toHaveProperty("health");
    main.close();
    db.close();
  });

  it("rides in the message the coach receives", async () => {
    const db = openTestDb();
    const health = openTestHealthDb();
    saveProfile(db.db, makeProfile(), NOW_ISO);
    grantConsent(health.db, NOW_ISO);
    addFact(health.db, fact({ kind: "medication", label: "Warfarin" }), NOW_ISO);
    insertUserMessage(db.db, { id: "11111111-1111-4111-8111-111111111111", date: "2026-10-03", text: "Is kale ok?", photoIds: [], sentAt: NOW_ISO, nowIso: NOW_ISO });
    const ai = fakeAi([textReply("Kale is rich in vitamin K…")]);
    await processMessage(
      { db: db.db, health: health.db, ai, now: () => NOW, budgetMs: 10_000, photoDir: fs.mkdtempSync("/tmp/p-"), dailyCallCap: 10 },
      "11111111-1111-4111-8111-111111111111",
    );
    const first = ai.requests[0]!.messages.at(-1)!.content as { type: string; text?: string }[];
    expect(first[0]!.text).toContain("Warfarin");
    expect(ai.requests[0]!.system).toContain("Foods by level");
    db.close();
    health.close();
  });
});

const READ = {
  readable: true,
  kind: "lab",
  title: "",
  taken_on: "2026-09-20",
  source: "City Lab",
  language: "Italian",
  summary: "",
  results: [
    result({ printed_name: "Ferritina" }),
    result({ code: "ldl", name: "LDL", value: 3.4, unit: "mmol/L", ref_low: null, ref_high: 3 }),
    result({ code: "other", name: "Urine glucose", printed_name: "Glucosio urine", value: null, text_value: "Negative", unit: "", ref_low: null, ref_high: null }),
  ],
  facts: [
    { kind: "medication", code: null, label: "Atorvastatin", detail: "10 mg once a day", level: null, started_on: "2026-06", ended_on: null },
    { kind: "condition", code: "prediabetes", label: "Prediabetes", detail: "", level: "never", started_on: null, ended_on: null },
  ],
};

describe("reading a record", () => {
  it("returns it for checking, saves nothing, counts the call and deletes the photos", async () => {
    const ai = fakeAi([], [jsonReply(READ)]);
    ctx = await consented({ ai });
    const id = await uploadPhoto(ctx);
    const res = await post(ctx, "/api/records/read", { photo_ids: [id] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      kind: "lab", taken_on: "2026-09-20", title: "", source: "City Lab", language: "Italian", summary: "", observations: READ.results,
      // A month alone is no date; a level on a condition is dropped.
      facts: [
        { kind: "medication", code: null, label: "Atorvastatin", detail: "10 mg once a day", level: null, started_on: null, ended_on: null },
        { kind: "condition", code: "prediabetes", label: "Prediabetes", detail: "", level: null, started_on: null, ended_on: null },
      ],
    });
    expect(ai.structuredRequests[0]!.system).toBe(READ_INSTRUCTIONS);
    expect(ai.structuredRequests[0]!.effort).toBe("medium");
    const prompt = ai.structuredRequests[0]!.prompt as { type: string; text?: string }[];
    expect(prompt[0]!.type).toBe("image");
    expect(prompt.at(-1)!.text).toContain("in English");
    expect(ctx.db.select().from(photos).all()).toEqual([]);
    expect(fs.readdirSync(ctx.photoDir).filter((f) => f.endsWith(".jpg"))).toEqual([]);
    expect(callsOn(ctx.db, "2026-10-03")).toBe(1);
    expect((await view(ctx)).documents).toEqual([]);
  });

  it("reads a scan's report with only a summary", async () => {
    const scan = { ...READ, kind: "imaging", title: "Knee MRI, left", summary: "Small tear of the medial meniscus.", results: [], facts: [] };
    ctx = await consented({ ai: fakeAi([], [jsonReply(scan)]) });
    const res = await post(ctx, "/api/records/read", { photo_ids: [await uploadPhoto(ctx)] });
    expect(res.json()).toMatchObject({ kind: "imaging", title: "Knee MRI, left", observations: [] });
  });

  it("says when the photos aren't a readable record, or Claude fails", async () => {
    ctx = await consented({ ai: fakeAi([], [jsonReply({ ...READ, readable: false, results: [], facts: [] }), stopWith("refusal"), new AiError("api_error", "x")]) });
    const read = async () => post(ctx!, "/api/records/read", { photo_ids: [await uploadPhoto(ctx!)] });
    expect((await read()).json()).toEqual({ error: "read_unreadable" });
    expect((await read()).json()).toEqual({ error: "read_refused" });
    expect((await read()).json()).toEqual({ error: "read_unavailable" });
    expect(ctx.db.select().from(photos).all()).toEqual([]);
  });

  it("needs consent, the coach, photos of this person's own, and room under the cap", async () => {
    ctx = await testApp({ ai: fakeAi([], []) });
    saveProfile(ctx.db, makeProfile(), NOW_ISO);
    const id = await uploadPhoto(ctx);
    const read = (photo_ids: string[]) => post(ctx!, "/api/records/read", { photo_ids });
    expect((await read([id])).statusCode).toBe(409);
    await post(ctx, "/api/records/consent");
    expect((await read(["0".repeat(32)])).json()).toEqual({ error: "photo_not_found" });
    await ctx.close();
    ctx = await consented({ ai: fakeAi([], []), callCaps: { owner: 0, guest: 0 } });
    expect((await read([await uploadPhoto(ctx)])).statusCode).toBe(429);
    // Refused or not, the photo is gone.
    expect(ctx.db.select().from(photos).all()).toEqual([]);
  });
});

describe("the Health chat", () => {
  const ID = "22222222-2222-4222-8222-222222222222";
  const REPLY = {
    reply: "Sorry about your back. Shall I add these to your profile?",
    facts: [
      { kind: "intolerance", code: "lactose_intolerance", label: "Lactose intolerance", detail: "hard cheese is fine", level: null, started_on: null, ended_on: null },
      { kind: "injury", code: null, label: "Lower back pain", detail: "no heavy deadlifts", level: null, started_on: "2026-08-01", ended_on: null },
    ],
    options: ["Bending forward", "Leaning back", "Not sure", "Too many"],
  };

  it("answers on the quick model and proposes facts that wait for a tap", async () => {
    const ai = fakeAi([], [jsonReply(REPLY)]);
    ctx = await consented({ ai });
    await post(ctx, "/api/records/facts", { kind: "diet", code: "vegetarian", label: "Vegetarian" });
    const res = await post(ctx, "/api/records/chat", { id: ID, text: "I'm lactose intolerant and my back hurts since August" });
    expect(res.statusCode).toBe(200);
    const [question, answer] = res.json().messages;
    expect(question).toMatchObject({ id: ID, role: "user", text: "I'm lactose intolerant and my back hurts since August" });
    expect(answer).toMatchObject({ role: "coach", text: REPLY.reply, options: ["Bending forward", "Leaning back", "Not sure"], read: null });
    expect(answer.suggestions.map((s: { fact: FactDraft; status: string }) => [s.fact.label, s.fact.level, s.status])).toEqual([
      ["Lactose intolerance", "limit", "pending"],
      ["Lower back pain", null, "pending"],
    ]);
    const request = ai.structuredRequests[0]!;
    expect([request.fast, request.effort]).toEqual([true, "low"]);
    expect(request.prompt).toContain("Today is 2026-10-03.");
    expect(request.prompt).toContain("Vegetarian");
    expect(request.system).toContain("never say you have added anything");
    // Nothing in the profile yet, and the home counts them as waiting.
    const health = await view(ctx);
    expect(health.facts).toHaveLength(1);
    expect(health.suggestions).toHaveLength(2);

    // Sent again (a lost answer): the same chat, no second call.
    expect((await post(ctx, "/api/records/chat", { id: ID, text: "again" })).json().messages).toHaveLength(2);
    expect(ai.structuredRequests).toHaveLength(1);
    expect(callsOn(ctx.db, "2026-10-03")).toBe(1);

    const added = (await post(ctx, `/api/records/suggestions/${answer.suggestions[1].id}/accept`)).json();
    const chatNow = (await ctx.app.inject({ method: "GET", url: "/api/records/chat", headers: ctx.headers })).json();
    expect(chatNow.messages[1].suggestions[1]).toMatchObject({ status: "added", fact_id: added.fact_id });
  });

  it("rereads the conversation so far", async () => {
    const ai = fakeAi([], [jsonReply({ reply: "Which knee?", facts: [], options: ["Left", "Right"] }), jsonReply({ reply: "Noted.", facts: [], options: [] })]);
    ctx = await consented({ ai });
    await post(ctx, "/api/records/chat", { id: ID, text: "My knee hurts on stairs" });
    await post(ctx, "/api/records/chat", { id: "33333333-3333-4333-8333-333333333333", text: "Left" });
    const prompt = ai.structuredRequests[1]!.prompt as string;
    expect(prompt).toContain("My knee hurts on stairs");
    expect(prompt).toContain("Which knee?");
  });

  it("reads photos as a record to check, and marks it saved", async () => {
    ctx = await consented({ ai: fakeAi([], [jsonReply(READ)]) });
    const res = await post(ctx, "/api/records/chat", { id: ID, text: "My blood test", photo_ids: [await uploadPhoto(ctx)] });
    const [question, answer] = res.json().messages;
    expect(question.photos).toBe(1);
    expect(answer).toMatchObject({ text: "", read: { kind: "lab", source: "City Lab" }, suggestions: [] });
    expect(ctx.db.select().from(photos).all()).toEqual([]);
    await post(ctx, "/api/records/documents", { kind: "lab", taken_on: "2026-09-20", observations: [result()], message_id: answer.id });
    const after = (await ctx.app.inject({ method: "GET", url: "/api/records/chat", headers: ctx.headers })).json();
    expect(after.messages[1].saved_document_id).toEqual(expect.any(String));
  });

  it("leaves nothing behind when the coach fails, so sending again is a clean retry", async () => {
    ctx = await consented({ ai: fakeAi([], [new AiError("api_error", "x"), jsonReply({ reply: "Hi", facts: [], options: [] })]) });
    expect((await post(ctx, "/api/records/chat", { id: ID, text: "Hi" })).json()).toEqual({ error: "chat_unavailable" });
    expect(ctx.health.select().from(chat).all()).toEqual([]);
    expect((await post(ctx, "/api/records/chat", { id: ID, text: "Hi" })).json().messages).toHaveLength(2);
  });

  it("needs words or a photo, and consent", async () => {
    ctx = await testApp({ ai: fakeAi([], []) });
    saveProfile(ctx.db, makeProfile(), NOW_ISO);
    expect((await post(ctx, "/api/records/chat", { id: ID, text: "hi" })).statusCode).toBe(409);
    await post(ctx, "/api/records/consent");
    expect((await post(ctx, "/api/records/chat", { id: ID, text: " " })).statusCode).toBe(400);
  });

  it("is deleted once older than the chat window, with its pending suggestions; added facts stay", async () => {
    ctx = await consented({ ai: fakeAi([], [jsonReply(REPLY)]) });
    const answer = (await post(ctx, "/api/records/chat", { id: ID, text: "lactose, back" })).json().messages[1];
    await post(ctx, `/api/records/suggestions/${answer.suggestions[0].id}/accept`);
    expect(purgeHealthChat(ctx.health, new Date("2026-10-06T12:00:00Z"), "Europe/London")).toBe(0);
    expect(purgeHealthChat(ctx.health, new Date("2026-10-07T12:00:00Z"), "Europe/London")).toBe(2);
    const after = await view(ctx);
    expect(after.suggestions).toEqual([]);
    expect(after.facts.map((f: { label: string }) => f.label)).toEqual(["Lactose intolerance"]);
  });
});
