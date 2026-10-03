import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiMessage } from "../src/ai/client.ts";
import { buildSystemPrompt, buildTurnContext } from "../src/coach/prompt.ts";
import { appendTurns, getOrCreateThread, loadTurns } from "../src/coach/thread.ts";
import { buildDayView, ensureDay } from "../src/days/days.ts";
import { insertEntry } from "../src/log/entries.ts";
import { makeProfile, openTestDb, sampleEntry, sampleFood } from "./helpers.ts";

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
});
