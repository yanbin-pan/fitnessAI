import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { buildTurnContext } from "../src/coach/prompt.ts";
import { processMessage } from "../src/coach/process.ts";
import { callsOn } from "../src/coach/usage.ts";
import { buildDayView } from "../src/days/days.ts";
import { photos } from "../src/db/schema.ts";
import { LAB_READ_INSTRUCTIONS } from "../src/health/labread.ts";
import { addLabReport, addMedication, grantConsent, healthContext, markerTrends, listLabReports } from "../src/health/records.ts";
import { insertUserMessage } from "../src/messages/messages.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { labFlag } from "../src/shared.ts";
import type { LabMarker } from "../src/shared.ts";
import { fakeAi, jsonReply, stopWith, textReply } from "./fake-ai.ts";
import { fakeJpeg } from "./images.ts";
import { NOW, makeProfile, openTestDb, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const NOW_ISO = NOW.toISOString();
type LabResult = { marker: LabMarker; name: string; value: number; unit: string; ref_low: number | null; ref_high: number | null };
const result = (overrides: Partial<LabResult> = {}): LabResult => ({
  marker: "ferritin", name: "Ferritin", value: 12, unit: "ug/L", ref_low: 30, ref_high: 400, ...overrides,
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
  it("refuses writes until the person agrees, and deleting takes everything with the consent", async () => {
    ctx = await testApp();
    const { app, headers } = ctx;
    expect((await app.inject({ method: "GET", url: "/api/records", headers })).json()).toMatchObject({ consented_at: null, conditions: [] });
    const add = () => app.inject({ method: "POST", url: "/api/records/conditions", headers, payload: { kind: "coeliac" } });
    expect((await add()).statusCode).toBe(409);

    await app.inject({ method: "POST", url: "/api/records/consent", headers });
    expect((await add()).statusCode).toBe(201);
    // A fixed chip is added once.
    expect((await add()).statusCode).toBe(201);
    await app.inject({ method: "POST", url: "/api/records/medications", headers, payload: { name: "Atorvastatin", dose: "20 mg", started_on: "2026-05-01" } });
    await app.inject({ method: "POST", url: "/api/records/labs", headers, payload: { taken_on: "2026-09-20", results: [result()] } });
    const view = (await app.inject({ method: "GET", url: "/api/records", headers })).json();
    expect(view.consented_at).toBe(NOW_ISO);
    expect(view.conditions).toHaveLength(1);
    expect(view.medications[0]).toMatchObject({ name: "Atorvastatin", dose: "20 mg", stopped_on: null });
    expect(view.reports[0].results[0]).toMatchObject({ name: "Ferritin", flag: "low" });

    expect((await app.inject({ method: "DELETE", url: "/api/records", headers })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/records", headers })).json()).toEqual({
      consented_at: null, conditions: [], medications: [], reports: [], trends: [],
    });
  });

  it("validates what it saves", async () => {
    ctx = await consented();
    const { app, headers } = ctx;
    const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers, payload: payload as object });
    expect((await post("/api/records/conditions", { kind: "other" })).statusCode).toBe(400);
    expect((await post("/api/records/conditions", { kind: "other", label: "Gout" })).json()).toMatchObject({ kind: "other", label: "Gout" });
    expect((await post("/api/records/conditions", { kind: "vegan", label: "ignored" })).json()).toMatchObject({ label: null });
    expect((await post("/api/records/medications", { name: "X", started_on: "2026-05-02", stopped_on: "2026-05-01" })).statusCode).toBe(400);
    expect((await post("/api/records/labs", { taken_on: "2026-09-20", results: [] })).statusCode).toBe(400);
  });

  it("edits and stops a medication, and removes records", async () => {
    ctx = await consented();
    const { app, headers } = ctx;
    const med = (await app.inject({ method: "POST", url: "/api/records/medications", headers, payload: { name: "Metformin" } })).json();
    const put = await app.inject({ method: "PUT", url: `/api/records/medications/${med.id}`, headers, payload: { name: "Metformin", dose: "500 mg", stopped_on: "2026-10-01" } });
    expect(put.json()).toMatchObject({ dose: "500 mg", stopped_on: "2026-10-01" });
    expect((await app.inject({ method: "DELETE", url: `/api/records/medications/${med.id}`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/records/medications/${med.id}`, headers })).statusCode).toBe(404);
    const view = (await app.inject({ method: "POST", url: "/api/records/labs", headers, payload: { taken_on: "2026-09-20", results: [result()] } })).json();
    expect((await app.inject({ method: "DELETE", url: `/api/records/labs/${view.reports[0].id}`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/records", headers })).json().reports).toEqual([]);
  });

  it("keeps each person's records to themselves", async () => {
    ctx = await consented({ guests: ["friend@example.com"] });
    await ctx.app.inject({ method: "POST", url: "/api/records/conditions", headers: ctx.headers, payload: { kind: "vegan" } });
    const friend = await ctx.headersFor("friend@example.com");
    expect((await ctx.app.inject({ method: "GET", url: "/api/records", headers: friend })).json()).toMatchObject({ consented_at: null, conditions: [] });
  });
});

describe("marker trends", () => {
  it("follow a marker across reports in its latest unit, oldest first", () => {
    const db = openTestDb();
    addLabReport(db.db, { taken_on: "2026-03-01", lab_name: "", results: [result({ value: 15 })] }, NOW_ISO);
    addLabReport(db.db, { taken_on: "2026-06-01", lab_name: "", results: [result({ value: 9, unit: "ng/mL" })] }, NOW_ISO);
    addLabReport(db.db, { taken_on: "2026-09-01", lab_name: "", results: [result({ value: 25 }), result({ marker: "other", name: "Zinc", value: 11, unit: "umol/L", ref_low: null, ref_high: null })] }, NOW_ISO);
    const trends = markerTrends(listLabReports(db.db));
    expect(trends.find((t) => t.key === "ferritin")?.points.map((p) => p.value)).toEqual([15, 25]);
    expect(trends.find((t) => t.key === "other:zinc")?.points).toHaveLength(1);
    db.close();
  });
});

describe("the coach's health context", () => {
  it("is absent until the person agrees, then holds conditions, medications and results outside the range", () => {
    const db = openTestDb();
    addMedication(db.db, { name: "Atorvastatin", dose: "20 mg", started_on: "2026-05-01", stopped_on: null }, NOW_ISO);
    addLabReport(db.db, { taken_on: "2026-03-01", lab_name: "", results: [result({ value: 15 })] }, NOW_ISO);
    addLabReport(db.db, { taken_on: "2026-09-01", lab_name: "", results: [result(), result({ marker: "hdl", name: "HDL", value: 1.4, unit: "mmol/L", ref_low: 1, ref_high: null })] }, NOW_ISO);
    expect(healthContext(db.db)).toBeNull();

    grantConsent(db.db, NOW_ISO);
    const health = healthContext(db.db);
    expect(health).toEqual({
      conditions: [],
      current_medications: [{ name: "Atorvastatin", dose: "20 mg", since: "2026-05-01" }],
      stopped_medications: [],
      latest_blood_results: {
        taken_on: "2026-09-01",
        outside_range: [{ marker: "Ferritin", value: 12, unit: "ug/L", range: "30-400", flag: "low", earlier: [{ taken_on: "2026-03-01", value: 15 }] }],
        other_results: ["HDL"],
      },
    });
    const profile = makeProfile();
    const view = buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO, []);
    const context = JSON.parse(buildTurnContext(view, NOW, "Europe/London", "en", false, [], health).split("\n")[1]);
    expect(context.health.current_medications[0].name).toBe("Atorvastatin");
    expect(JSON.parse(buildTurnContext(view, NOW, "Europe/London", "en").split("\n")[1])).not.toHaveProperty("health");
    db.close();
  });

  it("rides in the message the coach receives", async () => {
    const db = openTestDb();
    saveProfile(db.db, makeProfile(), NOW_ISO);
    grantConsent(db.db, NOW_ISO);
    addMedication(db.db, { name: "Warfarin", dose: "", started_on: null, stopped_on: null }, NOW_ISO);
    insertUserMessage(db.db, { id: "11111111-1111-4111-8111-111111111111", date: "2026-10-03", text: "Is kale ok?", photoIds: [], sentAt: NOW_ISO, nowIso: NOW_ISO });
    const ai = fakeAi([textReply("Kale is rich in vitamin K…")]);
    await processMessage({ db: db.db, ai, now: () => NOW, budgetMs: 10_000, photoDir: fs.mkdtempSync("/tmp/p-"), dailyCallCap: 10 }, "11111111-1111-4111-8111-111111111111");
    const first = ai.requests[0]!.messages.at(-1)!.content as { type: string; text?: string }[];
    expect(first[0]!.text).toContain("Warfarin");
    expect(ai.requests[0]!.system).toContain("Food and medication interactions");
    db.close();
  });
});

describe("reading a lab report", () => {
  const READ = {
    readable: true,
    taken_on: "2026-09-20",
    lab_name: "City Lab",
    results: [result(), { marker: "ldl", name: "LDL", value: 3.4, unit: "mmol/L", ref_low: null, ref_high: 3 }],
  };

  it("returns the rows for checking, saves nothing, counts the call and deletes the photos", async () => {
    const ai = fakeAi([], [jsonReply(READ)]);
    ctx = await consented({ ai });
    const id = await uploadPhoto(ctx);
    const res = await ctx.app.inject({ method: "POST", url: "/api/records/labs/read", headers: ctx.headers, payload: { photo_ids: [id] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ taken_on: "2026-09-20", lab_name: "City Lab", results: READ.results });
    expect(ai.structuredRequests[0]!.system).toBe(LAB_READ_INSTRUCTIONS);
    expect(ai.structuredRequests[0]!.effort).toBe("medium");
    expect((ai.structuredRequests[0]!.prompt as { type: string }[])[0]!.type).toBe("image");
    expect(ctx.db.select().from(photos).all()).toEqual([]);
    expect(fs.readdirSync(ctx.photoDir).filter((f) => f.endsWith(".jpg"))).toEqual([]);
    expect(callsOn(ctx.db, "2026-10-03")).toBe(1);
    expect((await ctx.app.inject({ method: "GET", url: "/api/records", headers: ctx.headers })).json().reports).toEqual([]);
  });

  it("says when the photos aren't a readable report, or Claude fails", async () => {
    ctx = await consented({ ai: fakeAi([], [jsonReply({ ...READ, readable: false, results: [] }), stopWith("refusal"), new AiError("api_error", "x")]) });
    const read = async () => ctx!.app.inject({ method: "POST", url: "/api/records/labs/read", headers: ctx!.headers, payload: { photo_ids: [await uploadPhoto(ctx!)] } });
    expect((await read()).json()).toEqual({ error: "lab_unreadable" });
    expect((await read()).json()).toEqual({ error: "lab_refused" });
    expect((await read()).json()).toEqual({ error: "lab_unavailable" });
    expect(ctx.db.select().from(photos).all()).toEqual([]);
  });

  it("needs consent, the coach and photos of this person's own", async () => {
    ctx = await testApp({ ai: fakeAi([], []) });
    saveProfile(ctx.db, makeProfile(), NOW_ISO);
    const id = await uploadPhoto(ctx);
    const read = (photo_ids: string[]) => ctx!.app.inject({ method: "POST", url: "/api/records/labs/read", headers: ctx!.headers, payload: { photo_ids } });
    expect((await read([id])).statusCode).toBe(409);
    await ctx.app.inject({ method: "POST", url: "/api/records/consent", headers: ctx.headers });
    expect((await read(["0".repeat(32)])).json()).toEqual({ error: "photo_not_found" });
  });

  it("is refused at the daily cap", async () => {
    ctx = await consented({ ai: fakeAi([], []), callCaps: { owner: 0, guest: 0 } });
    const res = await ctx.app.inject({ method: "POST", url: "/api/records/labs/read", headers: ctx.headers, payload: { photo_ids: [await uploadPhoto(ctx)] } });
    expect(res.statusCode).toBe(429);
  });
});
