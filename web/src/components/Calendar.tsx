import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dayAndMonth, kcal10, monthTitle, thousands } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { useDaySummaries } from "../queries.ts";
import { addDays, calorieStatus } from "../shared.ts";
import type { CalorieStatus, DaySummary } from "../shared.ts";

/** The 42 days (six weeks, Monday first) of the grid that shows `month`, written "2026-10". */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** `month` moved by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

const TINT: Record<CalorieStatus, string> = { within: "bg-tint-within", near: "bg-tint-near", off: "bg-tint-off" };
// The day bar is 4.25rem tall below the safe area; the calendar and its scrim start under it, so the bar stays usable.
const BELOW_BAR = "top-[calc(env(safe-area-inset-top)_+_4.25rem)]";
const round = "tap raised-sm flex h-11 w-11 items-center justify-center rounded-full text-ink disabled:opacity-30";

interface CalendarProps {
  /** The day on screen and today, as YYYY-MM-DD. */
  date: string;
  today: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

/** The month that drops down under the day bar (spec §11.1): pick a day; past days are tinted by how they went. */
export function Calendar({ date, today, onPick, onClose }: CalendarProps) {
  const t = useT();
  const [month, setMonth] = useState(date.slice(0, 7));
  const cells = monthGrid(month);
  const summaries = useDaySummaries(cells[0], cells[cells.length - 1]);
  const byDate = new Map<string, DaySummary>((summaries.data?.days ?? []).map((day) => [day.date, day]));
  // Losing or maintaining, the wrong way is over; gaining, it is under (spec §11.1).
  const words = summaries.data?.goal === "gain" ? t.calendar.under : t.calendar.over;
  const opened = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    opened.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Today is still in progress, so only earlier days are judged.
  const statusOf = (day: string): CalorieStatus | null => {
    const summary = byDate.get(day);
    return day < today && summary && summaries.data ? calorieStatus(summary.kcal, summary.target_kcal, summaries.data.goal) : null;
  };
  const nameOf = (day: string, status: CalorieStatus | null): string => {
    if (day === today) return t.calendar.today(dayAndMonth(day, t));
    const summary = byDate.get(day);
    if (status && summary) {
      return t.calendar.summary(dayAndMonth(day, t), thousands(summary.kcal, t), thousands(kcal10(summary.target_kcal), t), words[status]);
    }
    return dayAndMonth(day, t);
  };

  return createPortal(
    <>
      <div data-testid="calendar-scrim" aria-hidden="true" onClick={onClose} className={`fixed inset-x-0 bottom-0 ${BELOW_BAR} z-40 bg-black/30`} />
      <div role="dialog" aria-label={t.calendar.title} className={`fixed inset-x-0 ${BELOW_BAR} z-50 mx-auto max-w-xl px-4`}>
        <div className="raised rounded-3xl p-3">
          <div className="flex items-center justify-between">
            <button type="button" aria-label={t.calendar.previousMonth} className={round} onClick={() => setMonth(shiftMonth(month, -1))}>
              <Icon name="chevron_left" size={22} />
            </button>
            <p aria-live="polite" className="text-sm font-semibold">
              {monthTitle(month, t)}
            </p>
            <button type="button" aria-label={t.calendar.nextMonth} className={round} disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>
              <Icon name="chevron_right" size={22} />
            </button>
          </div>
          <div aria-hidden="true" className="mt-2 grid grid-cols-7 text-center text-xs text-muted">
            {t.calendar.weekdays.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-y-1">
            {cells.map((day) => {
              if (day.slice(0, 7) !== month) return <span key={day} aria-hidden="true" />;
              const status = statusOf(day);
              const viewed = day === date;
              return (
                <button
                  key={day}
                  ref={viewed ? opened : undefined}
                  type="button"
                  disabled={day > today}
                  aria-label={nameOf(day, status)}
                  aria-current={day === today ? "date" : undefined}
                  aria-pressed={viewed}
                  onClick={() => onPick(day)}
                  // The viewed day is pressed in with the shadow alone, so a tint behind it still shows.
                  className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full text-sm tabular-nums disabled:opacity-40 ${status ? TINT[status] : ""} ${viewed ? "font-semibold shadow-[inset_3px_3px_6px_var(--nm-lo),inset_-3px_-3px_6px_var(--nm-hi)]" : ""} ${day === today ? "outline-2 outline-offset-1 outline-accent" : ""}`}
                >
                  {Number(day.slice(8))}
                </button>
              );
            })}
          </div>
          <p className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted">
            {(["within", "near", "off"] as const).map((status) => (
              <span key={status} className="inline-flex items-center gap-1">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${TINT[status]}`} />
                {words[status]}
              </span>
            ))}
          </p>
        </div>
      </div>
    </>,
    document.body,
  );
}
