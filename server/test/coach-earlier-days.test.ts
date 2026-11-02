import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSystemPrompt, buildTurnContext } from "../src/coach/prompt.ts";
import { buildDayView } from "../src/days/days.ts";
import { dedupeFoods, earlierDays } from "../src/days/history.ts";
import { insertEntry } from "../src/log/entries.ts";
import { makeProfile, openTestDb, sampleEntry, sampleExercise, sampleFood } from "./helpers.ts";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
let db: ReturnType<typeof openTestDb>;
beforeEach(() => {
  db = openTestDb();
});
afterEach(() => db.close());

const log = (date: string, entry: Parameters<typeof sampleEntry>[0]) =>
  db.db.transaction((tx) => insertEntry(tx, sampleEntry({ date, logged_at: `${date}T09:00:00.000Z`, ...entry }), NOW_ISO));

describe("dedupeFoods", () => {
  it("counts the same food once a day, its portions joined and macros summed", () => {
    const foods = dedupeFoods([
      sampleFood({ name: "Apple", quantity: "1 medium (150 g)", kcal: 78, protein_g: 0.4, carbs_g: 21, fat_g: 0.3 }),
      sampleFood({ name: "Toast", quantity: "2 slices", kcal: 160, protein_g: 6, carbs_g: 30, fat_g: 2 }),
      sampleFood({ name: " apple ", quantity: "½ medium (75 g)", kcal: 39, protein_g: 0.2, carbs_g: 10.5, fat_g: 0.15 }),
    ]);
    expect(foods).toEqual([
      { name: "Apple", times: 2, quantity: "1 medium (150 g) + ½ medium (75 g)", kcal: 117, protein_g: 1, carbs_g: 32, fat_g: 0 },
      { name: "Toast", quantity: "2 slices", kcal: 160, protein_g: 6, carbs_g: 30, fat_g: 2 },
    ]);
  });

  it("treats accents and case as the same food", () => {
    expect(dedupeFoods([sampleFood({ name: "Caffè" }), sampleFood({ name: "caffe" })])).toHaveLength(1);
  });
});

describe("earlierDays", () => {
  it("gives the foods of the 2 days before and the workouts of the 7 days before, never the day itself", () => {
    log("2026-10-10", { foods: [sampleFood({ name: "Today's porridge" })], exercises: [sampleExercise({ name: "Today's run" })] });
    log("2026-10-09", { foods: [sampleFood({ name: "Pasta" })] });
    log("2026-10-08", { foods: [sampleFood({ name: "Salmon" })], exercises: [sampleExercise({ name: "Squats", activity: "gym", category: "strength", muscles: [{ muscle: "glutes", role: "secondary" }, { muscle: "quads", role: "primary" }] })] });
    log("2026-10-07", { foods: [sampleFood({ name: "Too far back" })] });
    log("2026-10-03", { foods: [], exercises: [sampleExercise({ name: "Tennis", activity: "tennis" })] });
    log("2026-10-02", { foods: [], exercises: [sampleExercise({ name: "Eight days back" })] });

    const earlier = earlierDays(db.db, "2026-10-10");
    expect(earlier.recent_foods.map((d) => [d.date, d.weekday, d.foods.map((f) => f.name)])).toEqual([
      ["2026-10-08", "Thursday", ["Salmon"]],
      ["2026-10-09", "Friday", ["Pasta"]],
    ]);
    expect(earlier.recent_workouts.map((d) => [d.date, d.workouts.map((w) => w.name)])).toEqual([
      ["2026-10-03", ["Tennis"]],
      ["2026-10-08", ["Squats"]],
    ]);
    expect(earlier.recent_workouts[1].workouts[0]).toEqual({ name: "Squats", activity: "gym", minutes: 30, kcal: 320, muscles: ["quads", "glutes"] });
    expect(earlier.training_days).toBe(2);
  });

  it("goes into the day's system prompt", () => {
    log("2026-10-09", { foods: [sampleFood({ name: "Pasta" })] });
    const prompt = buildSystemPrompt(makeProfile(), "2026-10-10", earlierDays(db.db, "2026-10-10"));
    expect(prompt).toContain("Their last days (JSON):");
    expect(prompt).toContain('"name":"Pasta"');
    expect(buildSystemPrompt(makeProfile(), "2026-10-10")).not.toContain("Their last days (JSON):");
  });
});

describe("the context block's mood and drinks", () => {
  it("gives the companion's mood, and the drinks bar's week only when there were drinks", () => {
    const profile = makeProfile();
    const context = () => JSON.parse(buildTurnContext(buildDayView(db.db, profile, "2026-10-10", "2026-10-10", NOW_ISO, []), NOW, "Europe/London", "en").split("\n")[1]);
    expect(context().companion).toEqual({ mood: "inactive" });
    expect(context()).not.toHaveProperty("alcohol_week");

    log("2026-10-08", { foods: [sampleFood({ name: "Wine", drink: "wine", alcohol_units: 9, kcal: 400 })] });
    log("2026-10-10", { foods: [sampleFood({ name: "Beer", drink: "beer", alcohol_units: 6, kcal: 400 })] });
    const after = context();
    expect(after.companion).toEqual({ mood: "okay", woozy: true });
    expect(after.alcohol_week).toEqual({
      units: 15,
      guide_units: 14,
      status: "over",
      alcohol_free_days: 5,
      drinks: [{ drink: "beer", count: 1, units: 6 }, { drink: "wine", count: 1, units: 9 }],
      by_day: [{ date: "2026-10-08", units: 9 }, { date: "2026-10-10", units: 6 }],
    });
  });
});
