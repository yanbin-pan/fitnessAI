import type { Messages } from "./i18n/en.ts";
import { addDays } from "./shared.ts";

// Every formatter takes the words of the chosen language (useT()); their locale decides how dates and numbers read.

/** "Today", "Yesterday", or e.g. "Thu 1 Oct". */
export function dayLabel(date: string, today: string, t: Messages): string {
  if (date === today) return t.day.today;
  if (date === addDays(today, -1)) return t.day.yesterday;
  return new Intl.DateTimeFormat(t.locale, { weekday: "short", day: "numeric", month: t.dateMonth, timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** Targets are shown to the nearest 10 kcal (spec §7.1). */
export const kcal10 = (kcal: number): number => Math.round(kcal / 10) * 10;

/** The wall-clock time of an ISO timestamp on the phone's own clock. */
export function timeOf(iso: string, t: Messages): string {
  return new Intl.DateTimeFormat(t.locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function failureText(code: string | null, t: Messages): string {
  return code !== null && Object.hasOwn(t.failures, code) ? t.failures[code as keyof Messages["failures"]] : t.failures.internal;
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** The day bar's second line (spec §11.1): the date in words under Today and Yesterday, the year under an older day. */
export function daySubtitle(date: string, today: string, t: Messages): string {
  if (date !== today && date !== addDays(today, -1)) return date.slice(0, 4);
  return new Intl.DateTimeFormat(t.locale, { weekday: "short", day: "numeric", month: t.dateMonth, timeZone: "UTC" }).format(utc(date));
}

/** "October 2026" for "2026-10". */
export function monthTitle(month: string, t: Messages): string {
  return new Intl.DateTimeFormat(t.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(`${month}-01`));
}

/** "3 October", as a calendar day reads aloud. */
export function dayAndMonth(date: string, t: Messages): string {
  return new Intl.DateTimeFormat(t.locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(utc(date));
}

/** 2363.4 → "2,363" (or "2.363", "2 363" in the languages that write it so). */
export function thousands(value: number, t: Messages): string {
  return Math.round(value).toLocaleString(t.locale);
}
