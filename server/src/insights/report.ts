import { z } from "zod";
import type { AiResponse } from "../ai/client.ts";
import { LANGUAGE_NAMES } from "../shared.ts";
import type { InsightReport, InsightStats, Profile } from "../shared.ts";
import { ageOn } from "../targets/targets.ts";

// The coach's weekly analysis (2026-10-06 design §3.3): one structured-output call per person per week, written from
// the numbers in stats.ts. The schema below is what the reply must match, and what it is checked against on arrival.

const Finding = z.strictObject({
  title: z.string().describe("At most six words"),
  detail: z.string().describe("One or two sentences, quoting the numbers it rests on"),
  severity: z.enum(["good", "watch", "act"]).describe("good: going well; watch: worth keeping an eye on; act: worth changing this week"),
  foods: z.array(z.string()).describe("Two to four everyday foods that would close this gap; empty when no food applies"),
});

export const InsightReportSchema = z.strictObject({
  headline: z.string().describe("One sentence: the most important thing about these four weeks"),
  nutrition: z.strictObject({
    summary: z.string().describe("Two or three sentences on how they eat"),
    findings: z.array(Finding).describe("Two to five findings, the most important first; include what is going well"),
  }),
  training: z.strictObject({
    summary: z.string().describe("Two or three sentences on how they train"),
    findings: z.array(Finding).describe("One to four findings; foods is empty for these"),
  }),
  recovery: z.strictObject({
    status: z.enum(["fresh", "balanced", "fatigued", "overreaching"]),
    detail: z.string().describe("Two sentences: what the training load and fuelling suggest about rest this week"),
  }),
  focus: z.array(z.string()).describe("One to three concrete things to do this week, each one short sentence"),
});

/** The schema as structured outputs takes it: plain JSON Schema with every object closed. */
export function reportJsonSchema(): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(InsightReportSchema) as Record<string, unknown>;
  return schema;
}

export const INSIGHTS_INSTRUCTIONS = `You are the coach inside Zabaione, a food and training logbook. Once a week you write one person's analysis of their last four weeks, for them to read on their phone.

You receive their profile and the numbers from their log, already worked out exactly. Write only from those numbers: quote them, rounded, so the person can check them, and never invent figures or events. When too little was logged to judge something (few days with food, no training at all), say so instead of guessing.

Nutrition
- kcal, protein, carbs, fat and fibre targets are the person's own, adjusted each day for exercise. Saturated fat, sugars and salt targets are upper limits (UK reference intakes); being under them is good. Sugars are total sugars, so fruit and milk count.
- Fluid counts only drinks that were logged, and water is often not logged: mention a low figure gently, as a reminder to drink and to log water.
- Food groups are average portions a day. Five a day: vegetables, fruit and legumes together (legumes count once). Oily fish: about one portion a week (0.14 a day). Red and processed meat together: at most about one portion a day. Fewer ultra-processed foods, fried foods and sugary drinks is better.
- For every gap, name two to four specific everyday foods that would close it, suited to what they already eat and to their goal.

Training
- General guidance: 150 minutes of moderate or 75 of vigorous activity a week, and strength training on at least two days. For muscle growth, about 10 to 20 sets per muscle a week; point out clear imbalances (much chest and little back, no legs).
- Judge recovery from the load ratio (the last 7 days' active kcal over the four-week weekly average: about 0.8 to 1.3 is steady, above 1.5 a sharp rise), the training days in the last 7, the longest run of days without rest, and how well that training is fuelled (a large calorie deficit or low protein with a high load raises the risk of fatigue). This is an estimate from the log, not a measurement of the body: say "suggests", not "is".

Always
- Give general nutrition and training information, never medical advice or a diagnosis, and never comment on how someone's body looks.
- Be warm, direct and brief. Use metric units.
- Write every text field in the language you are asked to write in.`;

/** The user turn: who they are, and the numbers. */
export function insightPrompt(profile: Profile, stats: InsightStats, today: string): string {
  const goal = profile.goal === "maintain" ? "maintain weight" : `${profile.goal} ${profile.goal_rate_kg_week} kg a week`;
  const person = {
    sex: profile.sex,
    age: ageOn(profile.birth_date, today),
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    body_goal: goal,
    everyday_activity_excluding_workouts: profile.activity_level,
  };
  return [
    `Write in ${LANGUAGE_NAMES[profile.language]}.`,
    `Today is ${today}. The numbers cover ${stats.period_start} to ${stats.period_end}.`,
    `Person (JSON): ${JSON.stringify(person)}`,
    `Numbers (JSON): ${JSON.stringify(stats)}`,
  ].join("\n");
}

export type ReportFailure = "refused" | "max_tokens" | "invalid";

/** The report in a reply, or why there is none. */
export function readReport(response: AiResponse): { ok: true; report: InsightReport } | { ok: false; failure: ReportFailure } {
  if (response.stop_reason === "refusal") return { ok: false, failure: "refused" };
  if (response.stop_reason === "max_tokens") return { ok: false, failure: "max_tokens" };
  const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  try {
    const parsed = InsightReportSchema.safeParse(JSON.parse(text));
    return parsed.success ? { ok: true, report: parsed.data } : { ok: false, failure: "invalid" };
  } catch {
    return { ok: false, failure: "invalid" };
  }
}
