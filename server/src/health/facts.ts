import { z } from "zod";
import { FACT_KINDS, FOOD_LEVELS, FactDraftInput, HEALTH_CONDITIONS } from "../shared.ts";
import type { FactDraft } from "../shared.ts";

// A fact as Claude writes one, for reading a record and for the Health chat (2026-10-19 health tab design §2, §4).
// Structured outputs need every field present, so nothing is optional here; FactDraftInput then applies the app's rules.

export const FACT_FIELDS = {
  kind: z.enum(FACT_KINDS).describe("condition, injury, medication, allergy, intolerance, diet (a way of eating), food (a food to avoid, limit or choose more), target (a daily amount to keep under or reach), note"),
  code: z.enum(HEALTH_CONDITIONS).nullable().describe("The matching code when there is one; null otherwise"),
  label: z.string().describe("A short name in the person's language, such as \"Lactose intolerance\", \"Lower back pain\", \"Atorvastatin\" or \"Saturated fat under 15 g a day\""),
  detail: z.string().describe("A few words that matter for food or training: a dose and how often, what to avoid, how much is fine; empty when there is nothing"),
  level: z.enum(FOOD_LEVELS).nullable().describe("For allergies, intolerances and foods: never (never eaten), limit (small amounts are fine), avoid (leave out where easy), prefer (choose more often); null otherwise"),
  started_on: z.string().nullable().describe("YYYY-MM-DD when it is said when it started (a month alone is its first day); null otherwise"),
  ended_on: z.string().nullable().describe("YYYY-MM-DD when it is said that it stopped or healed; null otherwise"),
};

const isoOrNull = (date: string | null) => (date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null);

/** Claude's facts through the app's rules: tidied, dated only with real dates, and dropped when they break them. */
export function factsFrom(raw: readonly { [K in keyof typeof FACT_FIELDS]: z.infer<(typeof FACT_FIELDS)[K]> }[]): FactDraft[] {
  return raw.flatMap((fact) => {
    const parsed = FactDraftInput.safeParse({
      ...fact,
      label: fact.label.trim().slice(0, 100),
      detail: fact.detail.trim().slice(0, 200),
      started_on: isoOrNull(fact.started_on),
      ended_on: isoOrNull(fact.ended_on),
    });
    return parsed.success ? [parsed.data] : [];
  });
}
