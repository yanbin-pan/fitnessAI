import { describe, expect, it } from "vitest";
import {
  EntryPatch, ExerciseItemInput, FoodItemInput, ManualEntryInput, MessageInput, ProfileInput,
} from "../src/schemas.ts";
import { isTimeZone } from "../src/dates.ts";

const UUID = "0b9c7f4e-6a51-4f5e-9d4c-2f1f8f6f1a10";
const food = { name: "Porridge", kcal: 300, protein_g: 10, carbs_g: 50, fat_g: 6 };

describe("FoodItemInput", () => {
  it("fills the optional nutrients and groups with defaults", () => {
    expect(FoodItemInput.parse(food)).toMatchObject({
      quantity: "", grams: null, fibre_g: 0, saturated_fat_g: 0, sugars_g: 0, salt_g: 0,
      fluid_ml: 0, alcohol_units: 0, assumption: "", groups: [],
    });
  });

  it("rejects negative amounts and unknown food groups", () => {
    expect(FoodItemInput.safeParse({ ...food, kcal: -1 }).success).toBe(false);
    expect(FoodItemInput.safeParse({ ...food, groups: [{ group: "candy", portions: 1 }] }).success).toBe(false);
  });
});

describe("ExerciseItemInput", () => {
  it("accepts a MET-based item and defaults the rest to null", () => {
    const item = ExerciseItemInput.parse({ name: "Run", category: "cardio", duration_min: 30, met: 9 });
    expect(item).toMatchObject({ kcal: null, sets: null, reps: null, muscles: [], assumption: "" });
  });

  it("rejects muscles outside the fixed list", () => {
    const curl = { name: "Curl", category: "strength", muscles: [{ muscle: "pecs", role: "primary" }] };
    expect(ExerciseItemInput.safeParse(curl).success).toBe(false);
  });

  it("defaults the activity to other and accepts only the fixed list", () => {
    const base = { name: "Session", category: "sport" as const };
    expect(ExerciseItemInput.parse(base).activity).toBe("other");
    expect(ExerciseItemInput.parse({ ...base, activity: "kitesurfing" }).activity).toBe("kitesurfing");
    expect(ExerciseItemInput.parse({ ...base, activity: "surfing" }).activity).toBe("surfing");
    expect(ExerciseItemInput.safeParse({ ...base, activity: "squash" }).success).toBe(false); // filed under other, not an activity of its own
  });
});

describe("ManualEntryInput and EntryPatch", () => {
  it("require at least one item", () => {
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-10-03" }).success).toBe(false);
    expect(EntryPatch.safeParse({ foods: [], exercises: [] }).success).toBe(false);
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-10-03", foods: [food] }).success).toBe(true);
  });

  it("validate the time as HH:MM and the date as a real date", () => {
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-10-03", time: "7:30", foods: [food] }).success).toBe(false);
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-10-03", time: "07:30", foods: [food] }).success).toBe(true);
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-02-30", foods: [food] }).success).toBe(false);
  });
});

describe("ProfileInput", () => {
  const minimal = {
    sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60,
    activity_level: "light", goal: "maintain", goal_rate_kg_week: 0,
  };

  it("applies the spec's defaults", () => {
    expect(ProfileInput.parse(minimal)).toMatchObject({
      protein_g_per_kg: 1.8, fat_pct: 30, fibre_g: 30, add_back_pct: 50, timezone: "Europe/London",
      body_goal_priority: "high", context_days: 5, goal_notes: "on", units_mass: "kg", units_length: "cm",
      override_kcal: null, override_protein_g: null, override_carbs_g: null, override_fat_g: null, override_fibre_g: null,
    });
  });

  it("rejects an unknown timezone", () => {
    expect(ProfileInput.safeParse({ ...minimal, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(isTimeZone("Europe/London")).toBe(true);
  });
});

describe("MessageInput", () => {
  const base = { id: UUID, sent_at: "2026-10-03T12:00:00.000Z" };
  const photo = (c: string) => c.repeat(32);

  it("needs a UUID and a UTC timestamp", () => {
    const ok = { ...base, text: "2 eggs" };
    expect(MessageInput.safeParse(ok).success).toBe(true);
    expect(MessageInput.safeParse({ ...ok, id: "abc" }).success).toBe(false);
    expect(MessageInput.safeParse({ ...ok, sent_at: "2026-10-03 12:00" }).success).toBe(false);
  });

  it("takes text, photos, or both", () => {
    expect(MessageInput.parse({ ...base, text: " eggs " })).toMatchObject({ text: "eggs", photo_ids: [] });
    expect(MessageInput.parse({ ...base, photo_ids: [photo("a")] })).toMatchObject({ text: "", photo_ids: [photo("a")] });
    expect(MessageInput.parse({ ...base, text: "lunch", photo_ids: [photo("a"), photo("b")] }).photo_ids).toHaveLength(2);
  });

  it("needs text or a photo, at most four photos, each once, each a photo id", () => {
    expect(MessageInput.safeParse({ ...base, text: "   " }).success).toBe(false);
    expect(MessageInput.safeParse({ ...base, photo_ids: ["a", "b", "c", "d", "e"].map(photo) }).success).toBe(false);
    expect(MessageInput.safeParse({ ...base, photo_ids: [photo("a"), photo("a")] }).success).toBe(false);
    expect(MessageInput.safeParse({ ...base, photo_ids: ["../../x"] }).success).toBe(false);
  });
});
