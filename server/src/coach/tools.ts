import { z } from "zod";
import type { AiTool } from "../ai/client.ts";
import { EXERCISE_CATEGORIES, FOOD_GROUPS, MUSCLES, MUSCLE_ROLES } from "../shared.ts";

// The coach's tool inputs (spec §6.1). Strict tool use needs every property
// required and every object closed, so optional values are nullable instead of
// optional, and range checks live in amountIssues() rather than in the schema.

const FoodToolItem = z.strictObject({
  name: z.string().describe("The food or drink, e.g. 'Porridge with semi-skimmed milk'"),
  quantity: z.string().describe("The portion as eaten, e.g. '1 bowl (250 g)'"),
  grams: z.number().nullable().describe("Weight in grams, known or estimated; null for a drink measured in ml"),
  kcal: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fibre_g: z.number(),
  saturated_fat_g: z.number(),
  sugars_g: z.number().describe("Total sugars, as on UK labels"),
  salt_g: z.number(),
  fluid_ml: z.number().describe("Volume of a non-alcoholic drink; 0 for food"),
  alcohol_units: z.number().describe("UK alcohol units; 0 if none"),
  groups: z
    .array(z.strictObject({ group: z.enum(FOOD_GROUPS), portions: z.number().describe("Portions of the group; fractions are fine") }))
    .describe("Food-group portions; empty when no group applies"),
  assumption: z.string().describe("What you assumed about the portion or recipe; empty if nothing was assumed"),
});
export type FoodToolItem = z.infer<typeof FoodToolItem>;

const ExerciseToolItem = z.strictObject({
  name: z.string().describe("The activity, e.g. 'Barbell bench press' or 'Outdoor run'"),
  category: z.enum(EXERCISE_CATEGORIES),
  duration_min: z.number().describe("Minutes, including rest between sets; estimate it when not stated"),
  met: z.number().describe("MET value of the activity at the intensity described"),
  sets: z.number().nullable(),
  reps: z.number().nullable(),
  weight_kg: z.number().nullable(),
  distance_km: z.number().nullable(),
  muscles: z
    .array(z.strictObject({ muscle: z.enum(MUSCLES), role: z.enum(MUSCLE_ROLES) }))
    .describe("Muscles worked; empty when the activity has no clear muscle focus"),
  assumption: z.string().describe("What you assumed, e.g. pace or rest time; empty if nothing"),
});
export type ExerciseToolItem = z.infer<typeof ExerciseToolItem>;

export const LogItemsInput = z.strictObject({
  date: z.string().nullable().describe("YYYY-MM-DD when it happened on an earlier day than the message; otherwise null"),
  time: z.string().nullable().describe("Local time HH:MM when it was stated; otherwise null"),
  foods: z.array(FoodToolItem),
  exercises: z.array(ExerciseToolItem),
});
export type LogItemsInput = z.infer<typeof LogItemsInput>;

export const UpdateEntryInput = z.strictObject({
  entry_id: z.string().describe("The id of the entry to correct, from the context block"),
  foods: z.array(FoodToolItem).describe("The entry's complete corrected food list, including unchanged items"),
  exercises: z.array(ExerciseToolItem).describe("The entry's complete corrected exercise list, including unchanged items"),
});
export type UpdateEntryInput = z.infer<typeof UpdateEntryInput>;

/** Rewrites `type: [X, "null"]` as anyOf, a form strict tool use documents as supported. */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = normalize(value);
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    const description = out.description;
    delete out.type;
    delete out.description;
    const anyOf = types.map((type) => (type === "null" ? { type: "null" } : { ...out, type }));
    return description === undefined ? { anyOf } : { description, anyOf };
  }
  return out;
}

export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return normalize(json) as Record<string, unknown>;
}

export const COACH_TOOLS: AiTool[] = [
  {
    name: "log_items",
    description:
      "Record food, drink and/or exercise that the person states they had or did. Call it once per message with every item from that message. Never use it for questions or hypotheticals.",
    strict: true,
    input_schema: strictJsonSchema(LogItemsInput) as AiTool["input_schema"],
  },
  {
    name: "update_entry",
    description:
      "Correct an entry that is already logged by replacing all of its items. Send the complete corrected list, including the items that did not change.",
    strict: true,
    input_schema: strictJsonSchema(UpdateEntryInput) as AiTool["input_schema"],
  },
];

const FOOD_AMOUNTS = [
  "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g",
  "saturated_fat_g", "sugars_g", "salt_g", "fluid_ml", "alcohol_units",
] as const;
const EXERCISE_OPTIONALS = ["sets", "reps", "weight_kg", "distance_km"] as const;

/** Range checks the schema cannot express under strict tool use. */
export function amountIssues(input: { foods: FoodToolItem[]; exercises: ExerciseToolItem[] }): string[] {
  const issues: string[] = [];
  if (input.foods.length + input.exercises.length === 0) issues.push("at least one food or exercise is required");
  input.foods.forEach((food, i) => {
    for (const key of FOOD_AMOUNTS) if (food[key] < 0) issues.push(`foods.${i}.${key} must not be negative`);
    if (food.grams !== null && food.grams <= 0) issues.push(`foods.${i}.grams must be positive or null`);
    food.groups.forEach((g, j) => {
      if (g.portions <= 0) issues.push(`foods.${i}.groups.${j}.portions must be positive`);
    });
  });
  input.exercises.forEach((item, i) => {
    if (item.duration_min <= 0) issues.push(`exercises.${i}.duration_min must be positive`);
    if (item.met < 1) issues.push(`exercises.${i}.met must be at least 1`);
    for (const key of EXERCISE_OPTIONALS) {
      const value = item[key];
      if (value !== null && value <= 0) issues.push(`exercises.${i}.${key} must be positive or null`);
    }
  });
  return issues;
}
