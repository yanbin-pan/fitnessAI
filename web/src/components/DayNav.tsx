import { useNavigate } from "react-router";
import { dayLabel } from "../format.ts";
import { Icon } from "../icons/Icon.tsx";
import { addDays } from "../shared.ts";

export function DayNav({ date, today }: { date: string; today: string }) {
  const navigate = useNavigate();
  const go = (target: string) => navigate(target >= today ? "/day/today" : `/day/${target}`);
  const arrow = "tap raised-sm flex h-10 w-10 items-center justify-center rounded-full text-ink disabled:opacity-30";
  return (
    <nav aria-label="Day" className="flex items-center justify-between gap-2 py-3">
      <button type="button" aria-label="Previous day" className={arrow} onClick={() => go(addDays(date, -1))}>
        <Icon name="chevron_left" size={24} />
      </button>
      <div className="flex flex-col items-center">
        <span className="text-base font-semibold">{dayLabel(date, today)}</span>
        <input
          type="date"
          aria-label="Pick a day"
          value={date}
          max={today}
          onChange={(event) => {
            if (event.target.value) go(event.target.value);
          }}
          className="bg-transparent text-center text-xs text-muted"
        />
      </div>
      <button type="button" aria-label="Next day" className={arrow} disabled={date >= today} onClick={() => go(addDays(date, 1))}>
        <Icon name="chevron_right" size={24} />
      </button>
    </nav>
  );
}
