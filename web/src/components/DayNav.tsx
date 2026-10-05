import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { dayLabel, daySubtitle } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { addDays } from "../shared.ts";
import { Calendar } from "./Calendar.tsx";

const round = "tap flex h-11 w-11 items-center justify-center rounded-full text-ink disabled:opacity-30";

/** The day bar (spec §11.1): ‹ the day › in the middle, the calendar in the top right corner. */
export function DayNav({ date, today }: { date: string; today: string }) {
  const navigate = useNavigate();
  const t = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const go = (target: string) => navigate(target >= today ? "/day/today" : `/day/${target}`);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <nav aria-label={t.day.nav} className="flex items-center justify-between gap-2 py-3">
      {/* As wide as the calendar button, so the day stays centred. */}
      <span aria-hidden="true" className="h-11 w-11" />
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t.day.previous} className={`${round} raised-sm`} onClick={() => go(addDays(date, -1))}>
          <Icon name="chevron_left" size={24} />
        </button>
        <div className="flex min-w-24 flex-col items-center">
          <span className="text-base font-semibold">{dayLabel(date, today, t)}</span>
          <span className="text-xs text-muted">{daySubtitle(date, today, t)}</span>
        </div>
        <button type="button" aria-label={t.day.next} className={`${round} raised-sm`} disabled={date >= today} onClick={() => go(addDays(date, 1))}>
          <Icon name="chevron_right" size={24} />
        </button>
      </div>
      <button
        ref={button}
        type="button"
        aria-label={t.day.calendar}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${round} ${open ? "pressed text-accent-ink" : "raised-sm"}`}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="calendar_month" size={22} />
      </button>
      {open && (
        <Calendar
          date={date}
          today={today}
          onClose={close}
          onPick={(day) => {
            setOpen(false);
            go(day);
          }}
        />
      )}
    </nav>
  );
}
