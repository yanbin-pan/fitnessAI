import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDay } from "../src/days/days.ts";
import { getEntry, insertEntry } from "../src/log/entries.ts";
import { applyStaging, executeTool, newStaging } from "../src/coach/staging.ts";
import type { ToolContext } from "../src/coach/staging.ts";
import { COACH_TOOLS, LogItemsInput, strictJsonSchema } from "../src/coach/tools.ts";
import { TOOL_EGGS, TOOL_RUN, logItemsInput, makeProfile, openTestDb, sampleEntry } from "./helpers.ts";

const NOW_ISO = "2026-10-03T12:00:00.000Z";
let db: ReturnType<typeof openTestDb>;
beforeEach(() => {
  db = openTestDb();
});
afterEach(() => db.close());

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  let n = 0;
  return {
    sql: db.db,
    profile: makeProfile(),
    messageId: "msg-1",
    messageDate: "2026-10-03",
    sentAt: new Date("2026-10-03T11:58:00.000Z"),
    today: "2026-10-03",
    weightKg: () => 80,
    staging: newStaging(),
    newId: () => `entry-${++n}`,
    ...overrides,
  };
}

const FORBIDDEN = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "$schema"];

function strictProblems(node: unknown, path: string, problems: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child, i) => strictProblems(child, `${path}[${i}]`, problems));
    return problems;
  }
  if (node === null || typeof node !== "object") return problems;
  const obj = node as Record<string, unknown>;
  for (const key of FORBIDDEN) if (key in obj) problems.push(`${path}: ${key}`);
  if (Array.isArray(obj.type)) problems.push(`${path}: type is an array`);
  if (obj.type === "object") {
    if (obj.additionalProperties !== false) problems.push(`${path}: additionalProperties is not false`);
    const keys = Object.keys((obj.properties ?? {}) as object).sort();
    const required = [...((obj.required ?? []) as string[])].sort();
    if (keys.join() !== required.join()) problems.push(`${path}: not every property is required`);
  }
  for (const [key, value] of Object.entries(obj)) strictProblems(value, `${path}.${key}`, problems);
  return problems;
}

describe("tool definitions", () => {
  it("are log_items, strict, and update_entry", () => {
    expect(COACH_TOOLS.map((t) => [t.name, t.strict])).toEqual([["log_items", true], ["update_entry", false]]);
  });

  it("ask for each exercise's activity from the fixed list", () => {
    const schema = COACH_TOOLS[0].input_schema as { properties: { exercises: { items: { properties: Record<string, { enum?: string[] }>; required: string[] } } } };
    const exercise = schema.properties.exercises.items;
    expect(exercise.properties.activity.enum).toEqual(["tennis", "gym", "wakeboarding", "kitesurfing", "other"]);
    expect(exercise.required).toContain("activity");
  });

  it("make at most one tool strict, because the API rejects the grammar of both together", () => {
    // Live check, 4 Oct 2026: both strict gave 400 "The compiled grammar is too large"; either one alone was accepted.
    expect(COACH_TOOLS.filter((t) => t.strict).length).toBeLessThanOrEqual(1);
  });

  it("use only JSON Schema that strict tool use accepts", () => {
    for (const tool of COACH_TOOLS) expect(strictProblems(tool.input_schema, tool.name)).toEqual([]);
  });

  it("express nullable fields as anyOf", () => {
    const props = (node: unknown) => (node as { properties: Record<string, unknown> }).properties;
    const foods = props(strictJsonSchema(LogItemsInput)).foods as { items: unknown };
    expect(props(foods.items).grams).toMatchObject({ anyOf: [{ type: "number" }, { type: "null" }] });
  });
});

describe("log_items", () => {
  it("stages the entry and works out the exercise calories", () => {
    const ctx = context();
    const outcome = executeTool("log_items", logItemsInput({ exercises: [TOOL_RUN] }), ctx);
    expect(outcome.isError).toBe(false);
    expect(JSON.parse(outcome.content)).toEqual({
      ok: true, entry_id: "entry-1", date: "2026-10-03",
      foods: [{ name: "Scrambled eggs", kcal: 180 }], exercises: [{ name: "Run", kcal: 320 }],
    });
    expect(ctx.staging.creates[0]).toMatchObject({ id: "entry-1", source: "coach", message_id: "msg-1", logged_at: "2026-10-03T11:58:00.000Z" });
    expect(ctx.staging.creates[0].exercises[0]).toMatchObject({ kcal: 320, kcal_measured: false, avg_hr: null });
    expect(getEntry(db.db, "entry-1")).toBeNull(); // staged, not written
  });

  it("keeps the activity Claude chose", () => {
    const ctx = context();
    executeTool("log_items", logItemsInput({ foods: [], exercises: [{ ...TOOL_RUN, name: "Tennis", category: "sport", activity: "tennis" }] }), ctx);
    expect(ctx.staging.creates[0].exercises[0].activity).toBe("tennis");
  });

  it("places a stated time and an earlier date", () => {
    const ctx = context();
    executeTool("log_items", logItemsInput({ date: "2026-10-02", time: "07:30" }), ctx);
    expect(ctx.staging.creates[0]).toMatchObject({ date: "2026-10-02", logged_at: "2026-10-02T06:30:00.000Z" });
  });

  it("puts an earlier day without a time at midday", () => {
    const ctx = context();
    executeTool("log_items", logItemsInput({ date: "2026-10-01" }), ctx);
    expect(ctx.staging.creates[0].logged_at).toBe("2026-10-01T11:00:00.000Z");
  });

  it("refuses future, too-old and malformed dates and times", () => {
    for (const bad of [{ date: "2026-10-04" }, { date: "2026-09-25" }, { date: "2026/10/01" }, { time: "7:30" }]) {
      const outcome = executeTool("log_items", logItemsInput(bad), context());
      expect(outcome.isError).toBe(true);
    }
    expect(executeTool("log_items", logItemsInput({ date: "2026-09-26" }), context()).isError).toBe(false);
  });

  it("refuses negative amounts and empty calls, naming the problem", () => {
    const negative = executeTool("log_items", logItemsInput({ foods: [{ ...TOOL_EGGS, kcal: -5 }] }), context());
    expect(negative.isError).toBe(true);
    expect(negative.content).toContain("foods.0.kcal");
    const empty = executeTool("log_items", logItemsInput({ foods: [] }), context());
    expect(empty.content).toContain("at least one");
  });

  it("reports schema violations with their path", () => {
    const outcome = executeTool("log_items", { date: null, time: null, exercises: [] }, context());
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("foods");
  });
});

describe("update_entry", () => {
  it("changes an entry staged earlier in the same message", () => {
    const ctx = context();
    executeTool("log_items", logItemsInput(), ctx);
    const outcome = executeTool("update_entry", { entry_id: "entry-1", foods: [{ ...TOOL_EGGS, name: "3 scrambled eggs", kcal: 270 }], exercises: [] }, ctx);
    expect(outcome.isError).toBe(false);
    expect(ctx.staging.creates[0].foods[0]).toMatchObject({ name: "3 scrambled eggs", kcal: 270 });
    expect(ctx.staging.updates.size).toBe(0);
  });

  it("stages a change to a stored entry", () => {
    db.db.transaction((tx) => insertEntry(tx, sampleEntry({ id: "stored-1" }), NOW_ISO));
    const ctx = context();
    const outcome = executeTool("update_entry", { entry_id: "stored-1", foods: [TOOL_EGGS], exercises: [] }, ctx);
    expect(outcome.isError).toBe(false);
    expect(ctx.staging.updates.get("stored-1")?.foods[0].name).toBe("Scrambled eggs");
  });

  it("refuses unknown ids", () => {
    expect(executeTool("update_entry", { entry_id: "nope", foods: [TOOL_EGGS], exercises: [] }, context()).isError).toBe(true);
  });
});

describe("executeTool and applyStaging", () => {
  it("reject unknown tools", () => {
    expect(executeTool("delete_everything", {}, context()).isError).toBe(true);
  });

  it("write the staged creates and updates and return their ids", () => {
    db.db.transaction((tx) => insertEntry(tx, sampleEntry({ id: "stored-1" }), NOW_ISO));
    const ctx = context();
    executeTool("log_items", logItemsInput(), ctx);
    executeTool("update_entry", { entry_id: "stored-1", foods: [TOOL_EGGS], exercises: [] }, ctx);
    const ids = db.db.transaction((tx) => applyStaging(tx, ctx.staging, ctx.profile, NOW_ISO));
    expect(ids).toEqual(["entry-1", "stored-1"]);
    expect(getEntry(db.db, "entry-1")).toMatchObject({ source: "coach", message_id: "msg-1" });
    expect(getEntry(db.db, "stored-1")).toMatchObject({ edited: true });
    expect(getDay(db.db, "2026-10-03")).not.toBeNull();
  });
});

describe("staging guarantees", () => {
  it("does not touch a stored entry until applyStaging runs", () => {
    db.db.transaction((tx) => insertEntry(tx, sampleEntry({ id: "stored-1" }), NOW_ISO));
    const before = getEntry(db.db, "stored-1");
    const ctx = context();
    executeTool("update_entry", { entry_id: "stored-1", foods: [{ ...TOOL_EGGS, name: "changed" }], exercises: [] }, ctx);
    expect(getEntry(db.db, "stored-1")).toEqual(before); // staged, not written
  });

  it("limits a stored-entry update to 7 days back and prices it at that day's weight", () => {
    db.db.transaction((tx) => {
      insertEntry(tx, sampleEntry({ id: "old", date: "2026-09-25", logged_at: "2026-09-25T07:00:00.000Z" }), NOW_ISO);
      insertEntry(tx, sampleEntry({ id: "edge", date: "2026-09-26", logged_at: "2026-09-26T07:00:00.000Z" }), NOW_ISO);
    });
    const ctx = context({ weightKg: (date) => (date === "2026-09-26" ? 70 : 80) });
    const update = (id: string) => executeTool("update_entry", { entry_id: id, foods: [], exercises: [TOOL_RUN] }, ctx);
    expect(update("old").isError).toBe(true);
    expect(update("edge").isError).toBe(false);
    expect(ctx.staging.updates.get("edge")?.exercises[0].kcal).toBe(280); // (9 - 1) x 70 kg x 0.5 h
  });

  it("prices exercise at the weight frozen for the entry's own day, on create and on a same-message edit", () => {
    const ctx = context({ weightKg: (date) => (date === "2026-10-02" ? 70 : 80) });
    executeTool("log_items", logItemsInput({ date: "2026-10-02", foods: [], exercises: [TOOL_RUN] }), ctx);
    expect(ctx.staging.creates[0].exercises[0].kcal).toBe(280);
    executeTool("update_entry", { entry_id: ctx.staging.creates[0].id, foods: [], exercises: [{ ...TOOL_RUN, duration_min: 60 }] }, ctx);
    expect(ctx.staging.creates[0].exercises[0].kcal).toBe(560);
  });

  it("refuses an update that would empty an entry or carries a bad amount", () => {
    const ctx = context();
    executeTool("log_items", logItemsInput(), ctx);
    const id = ctx.staging.creates[0].id;
    expect(executeTool("update_entry", { entry_id: id, foods: [], exercises: [] }, ctx).isError).toBe(true);
    expect(executeTool("update_entry", { entry_id: id, foods: [{ ...TOOL_EGGS, kcal: -1 }], exercises: [] }, ctx).isError).toBe(true);
    expect(ctx.staging.creates[0].foods[0].kcal).toBe(180);
  });

  it("keeps the sent time when an offline message from an earlier day logs without a date", () => {
    const ctx = context({ messageDate: "2026-10-02", sentAt: new Date("2026-10-02T22:55:00.000Z") });
    executeTool("log_items", logItemsInput(), ctx);
    expect(ctx.staging.creates[0]).toMatchObject({ date: "2026-10-02", logged_at: "2026-10-02T22:55:00.000Z" });
  });

  it("returns an error, not an exception, for an impossible date", () => {
    for (const date of ["2026-02-30", "2026-1-3"]) {
      expect(executeTool("log_items", logItemsInput({ date }), context()).isError).toBe(true);
    }
  });

  it("gives no card to an entry deleted while the coach was thinking", () => {
    db.db.transaction((tx) => insertEntry(tx, sampleEntry({ id: "stored-1" }), NOW_ISO));
    const ctx = context();
    executeTool("log_items", logItemsInput(), ctx);
    executeTool("update_entry", { entry_id: "stored-1", foods: [TOOL_EGGS], exercises: [] }, ctx);
    db.sqlite.prepare("delete from entries where id = ?").run("stored-1");
    const ids = db.db.transaction((tx) => applyStaging(tx, ctx.staging, ctx.profile, NOW_ISO));
    expect(ids).toEqual(["entry-1"]);
    expect(getEntry(db.db, "stored-1")).toBeNull();
  });

  it.each([
    ["negative fluid", { foods: [{ ...TOOL_EGGS, fluid_ml: -1 }] }],
    ["zero grams", { foods: [{ ...TOOL_EGGS, grams: 0 }] }],
    ["zero portions", { foods: [{ ...TOOL_EGGS, groups: [{ group: "vegetables", portions: 0 }] }] }],
    ["a blank food name", { foods: [{ ...TOOL_EGGS, name: "  " }] }],
    ["zero duration", { foods: [], exercises: [{ ...TOOL_RUN, duration_min: 0 }] }],
    ["more than a day of exercise", { foods: [], exercises: [{ ...TOOL_RUN, duration_min: 1441 }] }],
    ["a MET below 1", { foods: [], exercises: [{ ...TOOL_RUN, met: 0.5 }] }],
    ["a MET above 25", { foods: [], exercises: [{ ...TOOL_RUN, met: 26 }] }],
    ["zero sets", { foods: [], exercises: [{ ...TOOL_RUN, sets: 0 }] }],
    ["a blank exercise name", { foods: [], exercises: [{ ...TOOL_RUN, name: "" }] }],
  ])("refuses %s", (_label, overrides) => {
    expect(executeTool("log_items", logItemsInput(overrides), context()).isError).toBe(true);
  });
});
