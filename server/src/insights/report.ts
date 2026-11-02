import { z } from "zod";
import type { AiResponse } from "../ai/client.ts";
import { COMPANION_NAMES, DEFAULT_COMPANION, FOCUSES, LANGUAGE_NAMES } from "../shared.ts";
import type { CompanionId, InsightReport, InsightStats, Profile, WeekPoint } from "../shared.ts";
import type { HealthContext } from "../health/records.ts";
import { ageOn } from "../targets/targets.ts";

// The coach's weekly analysis (2026-10-06 design §3.3): one structured-output call per person per week, written from
// the numbers in stats.ts. The schema below is what the reply must match, and what it is checked against on arrival.

const Finding = z.strictObject({
  title: z.string().describe("At most six words"),
  detail: z.string().describe("One or two sentences, quoting the numbers it rests on"),
  severity: z.enum(["good", "watch", "act"]).describe("good: going well; watch: worth keeping an eye on; act: worth changing this week"),
  foods: z.array(z.string()).describe("Two to four everyday foods that would close this gap; empty when no food applies"),
});

const Goal = z.strictObject({
  kind: z.enum([...FOCUSES, "body_goal", "health"]).describe("Which goal this is: one of their focus goals, their body goal, or a health target or result"),
  title: z.string().describe("The goal in at most four words, e.g. 'Build muscle' or 'Skin glow'"),
  status: z.enum(["good", "watch", "act"]).describe("good: the week moved towards it; watch: mixed; act: the week worked against it"),
  detail: z.string().describe("One or two sentences on how the week went for this goal, quoting the numbers or foods it rests on"),
  helped: z.array(z.string()).describe("Up to four foods from Foods eaten that helped this goal, named as they were logged; empty when none did"),
  next: z.array(z.string()).describe("One to three short things to eat or do next week for this goal, each a few words"),
});

export const InsightReportSchema = z.strictObject({
  headline: z.string().describe("One sentence: the most important thing about the past week"),
  goals: z.array(Goal).describe("One per goal in Goals: each focus goal (skin counts as one), then the body goal, then health when Health has a target or a result outside its range; at most five"),
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

/** The weekly analysis's instructions, written as the person's companion (2026-10-08 companions design §7). */
export function insightsInstructions(companion: CompanionId): string {
  const name = COMPANION_NAMES[companion];
  return `You are ${name}, the coach of the Zabaione app, a food and training logbook. Once a week you write one person's analysis of their past week, for them to read on their phone. Write as ${name} speaking to them ("you", and "I" for yourself when needed), never about "the coach".

You receive their profile and the numbers from their log for the past seven days, already worked out exactly, and when there is one, the same numbers for the week before. Write about the past week; use the week before only to say what improved or slipped, briefly. Write only from those numbers: quote them, rounded, so the person can check them, and never invent figures or events. When too little was logged to judge something (few days with food, no training at all), say so instead of guessing.

Nutrition
- kcal, protein, carbs, fat and fibre targets are the person's own, adjusted each day for exercise. Saturated fat, sugars and salt targets are upper limits (UK reference intakes); being under them is good. Sugars are total sugars, so fruit and milk count.
- Fluid counts only drinks that were logged, and water is often not logged: mention a low figure gently, as a reminder to drink and to log water.
- Food groups are average portions a day. Five a day: vegetables, fruit and legumes together (legumes count once). Oily fish: about one portion a week (0.14 a day). Red and processed meat together: at most about one portion a day. Fewer ultra-processed foods, fried foods and sugary drinks is better.
- signals are calm words for the week's fats, sugar, salt and estimated vitamins and minerals: "low", "ok" or "high" against everyday reference intakes (for saturated fat, sugars and salt, "low" is good). Vitamin and mineral amounts are rough estimates from the log: mention only a clear gap, gently, with foods that would help, and never give a number for them. Vitamin D comes mostly from sunlight, so a low reading from food alone is common.
- For every gap, name two to four specific everyday foods that would close it, suited to what they already eat and to their goal.

Training
- General guidance: 150 minutes of moderate or 75 of vigorous activity a week, and strength training on at least two days. For muscle growth, about 10 to 20 sets per muscle a week; point out clear imbalances (much chest and little back, no legs).
- Training figures per week are the past week's own. Judge recovery from the load ratio (the past week's active kcal over the weekly average of the four weeks it ends: about 0.8 to 1.3 is steady, above 1.5 a sharp rise), the training days in the week (dates lists them), the longest run of days without rest, and how well that training is fuelled (a large calorie deficit or low protein with a high load raises the risk of fatigue). This is an estimate from the log, not a measurement of the body: say "suggests", not "is".

Goals
- Goals (JSON) is what the person told the app they want: their body goal, the goals they want to work on (focus), their goal weight, their skin goals, type and what they think sets it off, and how they train. The goals field of your report takes the week goal by goal, in that order: for each, say plainly whether the week moved them towards it and why, name in helped the foods from Foods eaten that did the most for it (as logged: salmon and walnuts for skin, chicken and Greek yoghurt for building muscle, oats and beans for gut health or an LDL target), and in next one to three things to add or change next week.
- Foods eaten (JSON) lists the week's foods by name with how many times each was logged, most often first. Use only those names in helped; never invent a food they did not log.
- Keep the link between a food and a goal to well-established nutrition: protein and training for muscle; fibre, plants and fermented foods for the gut; omega-3, colourful vegetables and fruit, water and less added sugar and alcohol for skin; iron, B vitamins, steady meals and sleep for energy. For skin, never diagnose a skin condition or promise a result.
- Without any focus goal, there is still the body goal; with no health target or out-of-range result, leave health out.

Health records
- When you receive Health (JSON), it is what the person keeps on the app's Health tab: conditions, injuries, medications, diet, foods with a level (never, limit, avoid, prefer), daily targets, their latest blood test and summaries of other records. Relate the week to it where it genuinely helps (salt with high blood pressure, saturated fat with high LDL or against a saturated fat target, iron-rich foods with low ferritin), say plainly whether the log is moving the right way for a result outside its range, never suggest a food they keep out, keep training suggestions clear of an injury, and mention a well-known food interaction with a current medication when the log shows that food.
- Never name a disease from a result, never comment on a medication or its dose, and say to talk to their doctor about results outside the range. With an eating disorder history listed, leave calorie deficits out entirely.

Always
- Give general nutrition and training information, never medical advice or a diagnosis, and never comment on how someone's body looks.
- Be warm, direct and brief. Use metric units.
- Write every text field in the language you are asked to write in.`;
}

export const INSIGHTS_INSTRUCTIONS = insightsInstructions(DEFAULT_COMPANION);

/** The user turn: who they are, and the numbers. */
export function insightPrompt(
  profile: Profile,
  stats: InsightStats,
  today: string,
  health: HealthContext | null = null,
  previous: WeekPoint | null = null,
  foods: { name: string; times: number }[] = [],
): string {
  const goal = profile.goal === "maintain" ? "maintain weight" : `${profile.goal} ${profile.goal_rate_kg_week} kg a week`;
  const person = {
    sex: profile.sex,
    age: ageOn(profile.birth_date, today),
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    body_goal: goal,
    everyday_activity_excluding_workouts: profile.activity_level,
  };
  const a = profile.about;
  const goals = {
    body_goal: goal,
    focus: a.focus,
    ...(a.target_weight_kg !== null && profile.goal !== "maintain" ? { goal_weight_kg: a.target_weight_kg } : {}),
    ...(a.skin_goals.length || a.skin_type || a.skin_triggers.length ? { skin: { goals: a.skin_goals, type: a.skin_type, triggers: a.skin_triggers } } : {}),
    ...(a.sports.length ? { sports: a.sports } : {}),
    ...(a.sessions_week !== null ? { sessions_week: a.sessions_week } : {}),
  };
  return [
    `Write in ${LANGUAGE_NAMES[profile.language]}.`,
    `Today is ${today}. The numbers cover ${stats.period_start} to ${stats.period_end}.`,
    `Person (JSON): ${JSON.stringify(person)}`,
    `Numbers (JSON): ${JSON.stringify(stats)}`,
    ...(previous && previous.food_days + previous.sessions > 0 ? [`Week before, daily averages and weekly training (JSON): ${JSON.stringify(previous)}`] : []),
    `Goals (JSON): ${JSON.stringify(goals)}`,
    `Foods eaten (JSON): ${JSON.stringify(foods)}`,
    ...(health ? [`Health (JSON): ${JSON.stringify(health)}`] : []),
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
