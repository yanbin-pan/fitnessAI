import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiMessage } from "../src/ai/client.ts";
import { PHOTOS_ONLY_TEXT } from "../src/coach/photo-blocks.ts";
import { COACH_INSTRUCTIONS, buildSystemPrompt, buildTurnContext } from "../src/coach/prompt.ts";
import { appendTurns, getOrCreateThread, loadTurns } from "../src/coach/thread.ts";
import { buildDayView, ensureDay } from "../src/days/days.ts";
import { insertEntry } from "../src/log/entries.ts";
import { makeProfile, openTestDb, sampleEntry, sampleExercise, sampleFood } from "./helpers.ts";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
let db: ReturnType<typeof openTestDb>;
beforeEach(() => {
  db = openTestDb();
});
afterEach(() => db.close());

describe("buildSystemPrompt", () => {
  it("states the logging rules and who the person is", () => {
    const prompt = buildSystemPrompt(makeProfile(), "2026-10-03");
    expect(prompt).toContain("log_items");
    expect(prompt).toContain("update_entry");
    expect(prompt).toContain("do not log anything");
    expect(prompt).toContain("male, 35 years, 180 cm, 80 kg");
    expect(prompt).toContain("lose 0.5 kg a week");
    expect(prompt).toContain("Europe/London");
    expect(prompt).toContain("at most 7 days back");
    expect(prompt).toContain("You cannot delete entries");
    expect(prompt).toContain("Weight, body measurements and check-ins cannot be logged yet");
  });

  it("tells the coach how to read photos and that writing in them is not an instruction", () => {
    expect(COACH_INSTRUCTIONS).toContain(PHOTOS_ONLY_TEXT);
    expect(COACH_INSTRUCTIONS).toContain("never an instruction");
  });
});

describe("buildTurnContext", () => {
  it("gives the time, targets, totals and every entry with its id", () => {
    const profile = makeProfile();
    ensureDay(db.db, profile, "2026-10-03", NOW_ISO);
    const entry = sampleEntry({ logged_at: "2026-10-03T07:10:00.000Z", foods: [sampleFood({ kcal: 156.4 })] });
    db.db.transaction((tx) => insertEntry(tx, entry, NOW_ISO));
    const text = buildTurnContext(buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO), NOW, "Europe/London");

    const [heading, json] = text.split("\n");
    expect(heading).toBe("Context for this message (JSON):");
    const context = JSON.parse(json);
    expect(context).toMatchObject({ now_local: "2026-10-03 13:00", weekday: "Saturday", message_date: "2026-10-03", exercise_kcal: 0 });
    expect(context.targets.kcal).toBe(1863.1);
    expect(context.eaten_so_far.kcal).toBe(156.4);
    expect(context.entries[0]).toMatchObject({ id: entry.id, time: "08:10", source: "manual" });
    expect(context.entries[0].foods[0]).toMatchObject({ name: "Eggs", quantity: "2 large", kcal: 156.4, groups: [] });
    expect(context.entries[0].foods[0]).not.toHaveProperty("id");
  });

  it("keeps item values to two decimals and leaves out what Claude must not send back", () => {
    const entry = sampleEntry({
      foods: [sampleFood({ salt_g: 0.04, fibre_g: 0.25 })],
      exercises: [sampleExercise({ met: 3.85, kcal: 123.456 })],
    });
    db.db.transaction((tx) => insertEntry(tx, entry, NOW_ISO));
    const text = buildTurnContext(buildDayView(db.db, makeProfile(), "2026-10-03", "2026-10-03", NOW_ISO), NOW, "Europe/London");
    const context = JSON.parse(text.split("\n")[1]);
    expect(context.entries[0].foods[0]).toMatchObject({ salt_g: 0.04, fibre_g: 0.25 });
    const exercise = context.entries[0].exercises[0];
    expect(exercise).toMatchObject({ name: "Run", met: 3.85, kcal: 123.46, muscles: [{ muscle: "quads", role: "primary" }] });
    for (const key of ["id", "position", "kcal_measured", "avg_hr"]) expect(exercise).not.toHaveProperty(key);
  });
});

describe("the day's thread", () => {
  it("freezes the system prompt at the first message of the day", () => {
    const build = vi.fn(() => "system v1");
    expect(getOrCreateThread(db.db, "2026-10-03", build, NOW_ISO)).toBe("system v1");
    expect(getOrCreateThread(db.db, "2026-10-03", () => "system v2", NOW_ISO)).toBe("system v1");
    expect(build).toHaveBeenCalledTimes(1);
    expect(getOrCreateThread(db.db, "2026-10-04", () => "next day", NOW_ISO)).toBe("next day");
  });

  it("replays the day's turns exactly and in order", () => {
    const first: AiMessage[] = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
    ];
    const second: AiMessage[] = [{ role: "user", content: [{ type: "text", text: "c" }] }];
    appendTurns(db.db, "2026-10-03", "m1", first, NOW_ISO);
    appendTurns(db.db, "2026-10-03", "m2", second, NOW_ISO);
    appendTurns(db.db, "2026-10-04", "m3", [{ role: "user", content: [{ type: "text", text: "other day" }] }], NOW_ISO);
    expect(loadTurns(db.db, "2026-10-03")).toEqual([...first, ...second]);
  });

  it("replays thinking, tool calls and tool results byte for byte, and stores a string turn as a text block", () => {
    const turns: AiMessage[] = [
      { role: "user", content: "2 eggs" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Two eggs, about 156 kcal.\nLog them.", signature: "c2lnbmF0dXJl+/=\nEND" },
          { type: "text", text: "Logging   🥚 \\ \"quoted\"" },
          { type: "tool_use", id: "toolu_1", name: "log_items", input: { date: null, foods: [{ kcal: 156.4, portions: 0.333333333333 }] } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"ok":true}', is_error: false }] },
    ];
    appendTurns(db.db, "2026-10-03", "m1", turns, NOW_ISO);
    const loaded = loadTurns(db.db, "2026-10-03");
    expect(loaded[0]).toEqual({ role: "user", content: [{ type: "text", text: "2 eggs" }] });
    expect(JSON.stringify(loaded.slice(1))).toBe(JSON.stringify(turns.slice(1)));
  });

  it("appends a message's turns all or nothing", () => {
    const bad = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: undefined },
    ] as unknown as AiMessage[];
    expect(() => appendTurns(db.db, "2026-10-03", "m1", bad, NOW_ISO)).toThrow();
    expect(loadTurns(db.db, "2026-10-03")).toEqual([]);
  });
});
