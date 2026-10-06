import type { ChatMessage, DayView, Entry, ExerciseItem, FoodItem, Regular } from "../shared.ts";

export function foodItem(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: "f1", position: 0, name: "Porridge", quantity: "1 bowl", grams: 250, kcal: 300, protein_g: 10,
    carbs_g: 50, fat_g: 6, fibre_g: 5, saturated_fat_g: 1.5, sugars_g: 8, salt_g: 0.2, fluid_ml: 0,
    alcohol_units: 0, assumption: "", saved_food_id: null, groups: [{ group: "wholegrains", portions: 1 }], micros: null,
    ...overrides,
  };
}

export function exerciseItem(overrides: Partial<ExerciseItem> = {}): ExerciseItem {
  return {
    id: "x1", position: 0, name: "Tennis", category: "sport", activity: "tennis", duration_min: 60, sets: null, reps: null,
    weight_kg: null, distance_km: null, avg_hr: null, met: 7, kcal: 480, kcal_measured: false, assumption: "", muscles: [],
    ...overrides,
  };
}

export function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "e1", date: "2026-10-03", logged_at: "2026-10-03T07:10:00.000Z", source: "manual",
    message_id: null, edited: false, foods: [foodItem()], exercises: [], ...overrides,
  };
}

export function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1", date: "2026-10-03", role: "user", text: "porridge", photo_ids: [], status: "done", error_code: null,
    cards: [], reply_to: null, sent_at: "2026-10-03T07:09:00.000Z", created_at: "2026-10-03T07:09:00.000Z",
    ...overrides,
  };
}

export function dayView(overrides: Partial<DayView> = {}): DayView {
  const targets = { kcal: 2310, protein_g: 150, carbs_g: 260, fat_g: 75, fibre_g: 30 };
  return {
    date: "2026-10-03", today: "2026-10-03",
    targets: { base: targets, adjusted: targets, add_back_kcal: 0, workout_kcal: 0 },
    totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0 },
    entries: [], linked_entries: [], messages: [], featured: ["tennis", "gym", "wakeboarding", "kitesurfing"], suggestions: [],
    nutrients: { days: 0, levels: {} }, ...overrides,
  };
}

export function regular(overrides: Partial<Regular> = {}): Regular {
  const porridge = {
    name: "Porridge", quantity: "1 bowl", grams: 250, kcal: 300, protein_g: 10, carbs_g: 50, fat_g: 6, fibre_g: 5,
    saturated_fat_g: 1.5, sugars_g: 8, salt_g: 0.2, fluid_ml: 0, alcohol_units: 0, assumption: "", groups: [], micros: null,
  };
  return {
    key: "0123456789abcdef", kind: "meal", name: "Porridge", foods: [porridge], exercises: [], kcal: 300,
    typical_time: "08:00", days_seen: 5, last_seen: "2026-10-02", edited: false, logged_today: false, ...overrides,
  };
}
