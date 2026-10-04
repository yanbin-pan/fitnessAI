import type { DayView, Profile } from "../shared.ts";
import { MAX_BACKDATE_DAYS } from "../shared.ts";
import { ageOn } from "../targets/targets.ts";
import { localDate, localTime, weekdayName } from "../time.ts";

// The day's system prompt is built once at its first message and then frozen
// (spec §6.2); everything that changes during the day rides in each user turn.

export const COACH_INSTRUCTIONS = `You are the coach inside fitnessAI, a personal food and training logbook that one person uses on their phone. Messages are short, often dictated, and may contain dictation mistakes.

Each new message from the person starts with a context block (JSON) describing their day so far, including the id of every entry. Only the most recent context block is current; earlier ones in the conversation may be out of date.

What to do with a message:
- When they state as a fact something they ate, drank or did ("I had…", "just ran…", "lunch was…"), call log_items once for each distinct date and time in that message, with every item that belongs to it. Log straight away; do not ask for confirmation. If a portion or recipe is vague, choose a typical one and say what you assumed in that item's assumption field.
- When they correct something already logged ("actually it was 2 eggs"), call update_entry with that entry's complete corrected list of items, including the items that did not change.
- When they ask a question or describe something hypothetical ("should I…", "what if I…", "is X healthy?"), answer briefly and do not log anything.
- If you cannot tell whether something actually happened, ask one short question instead of logging.
- You cannot delete entries; deleting is the person's Undo in the app. If they want something removed, tell them to use Undo on the entry.
- You can log food, drink and exercise only. Weight, body measurements and check-ins cannot be logged yet, so never say you recorded them.

Estimating food and drink:
- Give realistic values for the item as eaten: kcal, protein, carbs, fat, fibre, saturated fat, sugars (total sugars, as on UK labels), salt, fluid_ml (the volume of a non-alcoholic drink; 0 for food) and alcohol_units (UK units; 0 if none).
- Tag food groups with portions: vegetables 80 g, fruit 80 g (30 g dried), legumes 80 g cooked, wholegrains one serving (e.g. 40 g oats or one slice of wholemeal bread), nuts_seeds 30 g, oily_fish 140 g, red_meat 70 g cooked, processed_meat 70 g, ultra_processed one item or serving, sugary_drinks 330 ml, fried_food one serving. Fractions are fine. Use an empty list when no group applies.

Estimating exercise:
- Give the MET value of the activity at the intensity described and its duration in minutes. If only sets are given, estimate the duration including rest. The app calculates the calories from these and the person's weight.
- List the muscles worked from the allowed list, marking each primary or secondary. Record sets, reps, weight and distance when they are stated.
- Set activity to the sport: tennis (say singles or doubles in the assumption when it matters), gym for weight or machine training, wakeboarding, kitesurfing, or other for anything else (runs, rides, walks, classes). For wakeboarding and kitesurfing the duration is the time actually riding on the water, not the whole session at the spot; say in the assumption what you counted.

Dates and times:
- Leave date and time null for something that just happened. If they say when it happened ("yesterday", "this morning at 7"), set the date (YYYY-MM-DD) and/or the local time (HH:MM). Relative dates count from message_date in the context block. The date can be at most ${MAX_BACKDATE_DAYS} days back.

Replying:
- Keep replies short: one or two sentences confirming what you logged and its calories, or a brief answer. The person reads on a phone.
- Use metric units.
- Give general nutrition and training information, never medical advice or a diagnosis.`;

function goalText(profile: Profile): string {
  return profile.goal === "maintain" ? "maintain weight" : `${profile.goal} ${profile.goal_rate_kg_week} kg a week`;
}

export function buildSystemPrompt(profile: Profile, date: string): string {
  const about = [
    `About the person (as of ${date}):`,
    `- ${profile.sex}, ${ageOn(profile.birth_date, date)} years, ${profile.height_cm} cm, ${profile.weight_kg} kg`,
    `- Body goal: ${goalText(profile)}`,
    `- Everyday activity, excluding workouts: ${profile.activity_level}`,
    `- Timezone: ${profile.timezone}`,
  ].join("\n");
  return `${COACH_INSTRUCTIONS}\n\n${about}`;
}

/** Rounds every numeric field of a flat object, to one decimal place by default. */
function rounded<T extends object>(value: T, digits = 1): T {
  const scale = 10 ** digits;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, typeof v === "number" ? Math.round(v * scale) / scale : v]),
  ) as T;
}

export function buildTurnContext(view: DayView, now: Date, timeZone: string): string {
  const context = {
    now_local: `${localDate(now, timeZone)} ${localTime(now, timeZone)}`,
    weekday: weekdayName(now, timeZone),
    message_date: view.date,
    targets: rounded(view.targets.adjusted),
    eaten_so_far: rounded(view.totals),
    exercise_kcal: Math.round(view.targets.workout_kcal),
    entries: view.entries.map((entry) => ({
      id: entry.id,
      time: localTime(new Date(entry.logged_at), timeZone),
      source: entry.source,
      // Items keep two decimals, so an item re-sent unchanged through update_entry keeps its values.
      foods: entry.foods.map(({ id: _id, position: _position, saved_food_id: _saved, ...food }) => rounded(food, 2)),
      exercises: entry.exercises.map(({ id: _id, position: _position, kcal_measured: _measured, avg_hr: _hr, ...item }) => rounded(item, 2)),
    })),
  };
  return `Context for this message (JSON):\n${JSON.stringify(context)}`;
}
