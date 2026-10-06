import type { Messages } from "./i18n/index.tsx";
import type { DayView } from "./shared.ts";

export type GreetingMoment = keyof Messages["greeting"];

/** A meal or workout on top of the target counts as over only past this share of it. */
const OVER_BY = 1.05;
/** In the evening, this much room left is worth a mention. */
const EVENING_ROOM_KCAL = 300;

/**
 * Which greeting fits today right now (the name and greeting design, 3B): late at night first, then how the day is
 * going (over target, protein hit, a workout, room left in the evening), then the time of day when nothing is logged.
 */
export function greetingMoment(view: DayView, now: Date): { moment: GreetingMoment; left: number } {
  const hour = now.getHours();
  const target = view.targets.adjusted;
  const left = Math.round(target.kcal - view.totals.kcal);
  const logged = view.entries.length > 0;
  const pick = (moment: GreetingMoment) => ({ moment, left });
  if (hour < 5) return pick("lateNight");
  if (!logged) return pick(hour < 12 ? "morningEmpty" : hour < 18 ? "afternoonEmpty" : "eveningEmpty");
  if (view.totals.kcal > target.kcal * OVER_BY) return pick("over");
  if (target.protein_g > 0 && view.totals.protein_g >= target.protein_g) return pick("proteinHit");
  if (view.entries.some((entry) => entry.exercises.length > 0)) return pick("workout");
  if (hour >= 18 && left >= EVENING_ROOM_KCAL) return pick("eveningRoom");
  return pick("going");
}

/**
 * Fills a greeting template: `[…]` holds the part that names the person and is left out when there is no name,
 * `{n}` is the name inside it, and `{left}` the kcal still to eat. "Gm[ {n}]!" reads "Gm Bin!" or "Gm!".
 */
export function fillGreeting(template: string, name: string | null, left: number): string {
  return template
    .replace(/\[([^\]]*)\]/g, (_all, part: string) => (name ? part.replaceAll("{n}", name) : ""))
    .replaceAll("{left}", String(left));
}

/** Zabaione's hello at the top of today's chat, in the app's language, with the person's name when there is one. */
export function greetingFor(view: DayView, name: string | null, now: Date, t: Messages): string {
  const { moment, left } = greetingMoment(view, now);
  return fillGreeting(t.greeting[moment], name, left);
}
