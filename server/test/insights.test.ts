import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { callsOn, recordRun } from "../src/coach/usage.ts";
import { ensureWeeklyInsight, latestInsight, weekStartOf } from "../src/insights/insights.ts";
import { INSIGHTS_INSTRUCTIONS, InsightReportSchema, insightsInstructions, reportJsonSchema } from "../src/insights/report.ts";
import { computeStats, loggedDays } from "../src/insights/stats.ts";
import { runInsights } from "../src/jobs.ts";
import { insertEntry } from "../src/log/entries.ts";
import type { ExerciseItemData, FoodItemData } from "../src/log/entries.ts";
import { getProfile, saveProfile } from "../src/profile/profile.ts";
import { addDays } from "../src/shared.ts";
import type { InsightReport, Profile } from "../src/shared.ts";
import { fakeAi, jsonReply, stopWith } from "./fake-ai.ts";
import { makeProfile, openTestDb, sampleEntry, sampleExercise, sampleFood, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

// 2026-10-05 is a Monday; 08:00 in London.
const MONDAY = new Date("2026-10-05T07:00:00.000Z");
const TODAY = "2026-10-05";

const REPORT: InsightReport = {
  headline: "Steady weeks: protein is on target, fibre is short.",
  nutrition: {
    summary: "You eat close to your calories.",
    findings: [
      { title: "Fibre is low", detail: "18 g a day against 30 g.", severity: "act", foods: ["Oats", "Lentils", "Pears"] },
      { title: "Protein on target", detail: "1.8 g per kg.", severity: "good", foods: [] },
    ],
  },
  training: { summary: "Three sessions a week.", findings: [{ title: "Legs missing", detail: "No leg sets.", severity: "watch", foods: [] }] },
  recovery: { status: "balanced", detail: "Load is steady at 1.0." },
  focus: ["Add a pear to lunch."],
};

type Db = ReturnType<typeof openTestDb>["db"];

function log(db: Db, date: string, items: { foods?: FoodItemData[]; exercises?: ExerciseItemData[] }) {
  db.transaction((tx) =>
    insertEntry(tx, sampleEntry({ id: randomUUID(), date, logged_at: `${date}T12:00:00.000Z`, foods: items.foods ?? [], exercises: items.exercises ?? [] }), MONDAY.toISOString()),
  );
}

/** Something logged on each of the `count` days before today. */
function days(db: Db, count: number) {
  for (let d = 1; d <= count; d++) log(db, addDays(TODAY, -d), { foods: [sampleFood({ kcal: 2000, protein_g: 140, fibre_g: 18 })] });
}

let test: ReturnType<typeof openTestDb>;
let db: Db;
let profile: Profile;
beforeEach(() => {
  test = openTestDb();
  db = test.db;
  saveProfile(db, makeProfile(), MONDAY.toISOString());
  profile = getProfile(db) as Profile;
});
afterEach(() => test.close());

describe("weekStartOf", () => {
  it("finds the Monday of a date's week", () => {
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-03")).toBe("2026-09-28"); // a Saturday
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05"); // a Sunday
  });
});

describe("computeStats", () => {
  it("averages nutrition over the days with food, against each day's targets and the upper limits", () => {
    log(db, "2026-10-01", { foods: [sampleFood({ kcal: 1800, protein_g: 120, fibre_g: 20, salt_g: 5, alcohol_units: 2, groups: [{ group: "vegetables", portions: 3 }] })] });
    log(db, "2026-10-02", { foods: [sampleFood({ kcal: 2200, protein_g: 160, fibre_g: 30, salt_g: 7, alcohol_units: 0, groups: [{ group: "vegetables", portions: 1 }] })] });
    const stats = computeStats(db, profile, "2026-10-04", MONDAY.toISOString());
    expect(stats).toMatchObject({ period_start: "2026-09-07", period_end: "2026-10-04", days_logged: 2, food_days: 2, protein_g_per_kg: 1.8 });
    expect(stats.nutrients.kcal.average).toBe(2000);
    expect(stats.nutrients.kcal.target).toBeCloseTo(1863.1, 1); // the profile's daily target (no exercise those days)
    expect(stats.nutrients.salt_g).toEqual({ average: 6, target: 6 });
    expect(stats.nutrients.saturated_fat_g.target).toBe(30); // male upper limit
    expect(stats.alcohol_units_per_week).toBe(7);
    expect(stats.food_groups).toEqual({ vegetables: 2 });
  });

  it("works out weekly training, sets per muscle, the run of training days and the load", () => {
    const gym = sampleExercise({ name: "Bench", activity: "gym", category: "strength", sets: 4, kcal: 200, duration_min: 45,
      muscles: [{ muscle: "chest", role: "primary" }, { muscle: "triceps", role: "secondary" }] });
    for (const date of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]) log(db, date, { exercises: [gym] });
    log(db, "2026-09-10", { exercises: [sampleExercise({ activity: "running", kcal: 400, duration_min: 40 })] });
    const t = computeStats(db, profile, "2026-10-04", MONDAY.toISOString()).training;
    expect(t).toMatchObject({
      sessions_per_week: 1.3, minutes_per_week: 55, active_kcal_per_week: 300, training_days_last_7: 4, longest_streak: 4,
      sets_per_muscle: { chest: 4, triceps: 2 },
    });
    expect(t.by_activity).toEqual([{ activity: "gym", sessions: 4, minutes: 180 }, { activity: "running", sessions: 1, minutes: 40 }]);
    expect(t.load_ratio).toBe(2.67); // 800 kcal this week against 300 a week on average: a sharp rise
  });

  it("says nothing it can't know: no food, no training", () => {
    const stats = computeStats(db, profile, "2026-10-04", MONDAY.toISOString());
    expect(stats).toMatchObject({ days_logged: 0, food_days: 0, protein_g_per_kg: 0 });
    expect(stats.nutrients.kcal).toEqual({ average: 0, target: null });
    expect(stats.training.load_ratio).toBeNull();
  });
});

describe("loggedDays", () => {
  it("counts days with anything logged, ever", () => {
    days(db, 3);
    log(db, "2025-01-01", { foods: [sampleFood()] });
    expect(loggedDays(db)).toBe(4);
  });
});

describe("the report's schema", () => {
  it("is closed everywhere and free of constraints structured outputs can't take", () => {
    const text = JSON.stringify(reportJsonSchema());
    expect(text.match(/"type":"object"/g)?.length).toBe(text.match(/"additionalProperties":false/g)?.length);
    expect(text).not.toMatch(/minItems|maxItems|minLength|maxLength|"\$schema"/);
    expect(InsightReportSchema.parse(REPORT)).toEqual(REPORT);
  });
});

describe("ensureWeeklyInsight", () => {
  const deps = (ai: ReturnType<typeof fakeAi> | null, overrides: Partial<{ now: Date; dailyCallCap: number }> = {}) => ({
    sql: db, profile: getProfile(db) as Profile, ai, now: MONDAY, dailyCallCap: 200, ...overrides,
  });

  it("waits for fourteen days of data, without calling Claude", async () => {
    days(db, 13);
    const ai = fakeAi([], []);
    expect(await ensureWeeklyInsight(deps(ai))).toBe("collecting");
    expect(ai.structuredRequests).toHaveLength(0);
  });

  it("writes as the person's companion", async () => {
    days(db, 14);
    saveProfile(db, makeProfile({ companion: "meringa" }), MONDAY.toISOString());
    const ai = fakeAi([], [jsonReply(REPORT)]);
    expect(await ensureWeeklyInsight(deps(ai))).toBe("written");
    expect(ai.structuredRequests[0].system).toBe(insightsInstructions("meringa"));
    expect(ai.structuredRequests[0].system).toContain("You are Meringa, the coach of the Zabaione app");
  });

  it("writes the week's analysis from the numbers, in the person's language, and counts the call", async () => {
    days(db, 14);
    saveProfile(db, makeProfile({ language: "it" }), MONDAY.toISOString());
    const ai = fakeAi([], [jsonReply(REPORT)]);
    expect(await ensureWeeklyInsight(deps(ai))).toBe("written");
    const [request] = ai.structuredRequests;
    expect(request.system).toBe(INSIGHTS_INSTRUCTIONS);
    expect(request.prompt).toContain("Write in Italian.");
    expect(request.prompt).toContain('"period_end":"2026-10-04"');
    expect(request.schema).toEqual(reportJsonSchema());
    expect(latestInsight(db)).toMatchObject({ week_start: TODAY, language: "it", report: REPORT });
    expect(callsOn(db, TODAY)).toBe(1);
  });

  it("writes once a week, again when the language changes, and anew the next Monday", async () => {
    days(db, 14);
    const ai = fakeAi([], [jsonReply(REPORT), jsonReply(REPORT), jsonReply(REPORT)]);
    expect(await ensureWeeklyInsight(deps(ai))).toBe("written");
    expect(await ensureWeeklyInsight(deps(ai, { now: new Date("2026-10-09T07:00:00.000Z") }))).toBe("current");
    saveProfile(db, makeProfile({ language: "de" }), MONDAY.toISOString());
    expect(await ensureWeeklyInsight(deps(ai))).toBe("written");
    expect(await ensureWeeklyInsight(deps(ai, { now: new Date("2026-10-12T07:00:00.000Z") }))).toBe("written");
    expect(ai.structuredRequests).toHaveLength(3);
    expect(latestInsight(db)?.week_start).toBe("2026-10-12");
  });

  it("is off without the coach, and waits while the day's cap is used up", async () => {
    days(db, 14);
    expect(await ensureWeeklyInsight(deps(null))).toBe("off");
    recordRun(db, { messageId: "m", date: TODAY, model: null, calls: 5, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, nowIso: MONDAY.toISOString() });
    const ai = fakeAi([], []);
    expect(await ensureWeeklyInsight(deps(ai, { dailyCallCap: 5 }))).toBe("capped");
    expect(ai.structuredRequests).toHaveLength(0);
  });

  it("stores nothing when Claude fails, refuses or answers off-schema, and still counts the call", async () => {
    days(db, 14);
    const ai = fakeAi([], [new AiError("api_error", "overloaded"), stopWith("refusal"), jsonReply({ headline: "half" })]);
    for (let i = 0; i < 3; i++) expect(await ensureWeeklyInsight(deps(ai))).toBe("failed");
    expect(latestInsight(db)).toBeNull();
    expect(callsOn(db, TODAY)).toBe(3);
  });

  it("writes one analysis however many ask at once", async () => {
    days(db, 14);
    const ai = fakeAi([], [jsonReply(REPORT)]);
    const outcomes = await Promise.all([ensureWeeklyInsight(deps(ai)), ensureWeeklyInsight(deps(ai))]);
    expect(outcomes).toEqual(["written", "written"]);
    expect(ai.structuredRequests).toHaveLength(1);
  });
});

describe("GET /api/insights", () => {
  let ctx: TestApp | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });
  const get = () => ctx!.app.inject({ method: "GET", url: "/api/insights", headers: ctx!.headers });

  it("says how many days are logged until there are fourteen", async () => {
    ctx = await testApp({ now: MONDAY });
    expect((await get()).statusCode).toBe(409);
    saveProfile(ctx.db, makeProfile(), MONDAY.toISOString());
    days(ctx.db, 6);
    expect((await get()).json()).toEqual({ status: "collecting", data_days: 6, required_days: 14, next_update: "2026-10-12", insight: null });
  });

  it("starts the week's analysis when it is due, and shows it once written", async () => {
    const ai = fakeAi([], [jsonReply(REPORT)]);
    ctx = await testApp({ now: MONDAY, ai });
    saveProfile(ctx.db, makeProfile(), MONDAY.toISOString());
    days(ctx.db, 14);
    expect((await get()).json()).toMatchObject({ status: "pending", insight: null });
    await expect.poll(async () => (await get()).json().status).toBe("ready");
    const view = (await get()).json();
    expect(view.insight).toMatchObject({ week_start: TODAY, report: REPORT, stats: { food_days: 14 } });
    expect(ai.structuredRequests).toHaveLength(1);
  });

  it("shows the numbers alone when the coach is off", async () => {
    ctx = await testApp({ now: MONDAY, ai: null });
    saveProfile(ctx.db, makeProfile(), MONDAY.toISOString());
    days(ctx.db, 14);
    expect((await get()).json()).toMatchObject({ status: "off", insight: { report: null, stats: { food_days: 14 } } });
  });
});

describe("runInsights", () => {
  it("writes each person's analysis when due, and leaves alone anyone without a profile", async () => {
    const ai = fakeAi([], [jsonReply(REPORT)]);
    const ctx = await testApp({ now: MONDAY, ai });
    try {
      saveProfile(ctx.db, makeProfile(), MONDAY.toISOString());
      days(ctx.db, 14);
      ctx.storeOf("guest@example.com"); // a folder, no profile
      const lines: unknown[] = [];
      const log = { info: (...args: unknown[]) => lines.push(args), error: (...args: unknown[]) => lines.push(args) };
      await runInsights({ people: ctx.people, ai, ownerKey: ctx.people.keys()[0], callCaps: { owner: 200, guest: 60 }, log: log as never }, () => MONDAY);
      expect(ai.structuredRequests).toHaveLength(1);
      expect(latestInsight(ctx.db)?.week_start).toBe(TODAY);
    } finally {
      await ctx.close();
    }
  });
});
