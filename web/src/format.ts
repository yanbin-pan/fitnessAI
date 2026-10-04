import { addDays } from "./shared.ts";

/** "Today", "Yesterday", or e.g. "Thu 1 Oct". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** Targets are shown to the nearest 10 kcal (spec §7.1). */
export const kcal10 = (kcal: number): number => Math.round(kcal / 10) * 10;

/** The wall-clock time of an ISO timestamp on the phone's own clock. */
export function timeOf(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const FAILURES: Record<string, string> = {
  ai_unavailable: "The coach is switched off. Add it manually instead.",
  timeout: "The coach took too long.",
  ai_error: "The coach couldn't be reached.",
  ai_rate_limited: "The coach is busy. Try again in a minute.",
  refused: "The coach declined this message.",
  max_tokens: "The reply was cut off.",
  tool_loop_limit: "The coach got stuck on this one.",
  interrupted: "Interrupted by a restart.",
  no_profile: "Set up your profile first.",
  internal: "Something went wrong.",
};

export function failureText(code: string | null): string {
  return code !== null && Object.hasOwn(FAILURES, code) ? FAILURES[code] : "Something went wrong.";
}
