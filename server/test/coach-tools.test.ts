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
  it("are log_items and update_entry, both strict", () => {
    expect(COACH_TOOLS.map((t) => [t.name, t.strict])).toEqual([["log_items", true], ["update_entry", true]]);
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
