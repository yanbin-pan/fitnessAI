import { useNavigate } from "react-router";
import { dayLabel } from "../format.ts";
import { addDays } from "../shared.ts";

export function DayNav({ date, today }: { date: string; today: string }) {
  const navigate = useNavigate();
  const go = (target: string) => navigate(target >= today ? "/day/today" : `/day/${target}`);
  const arrow = "h-10 w-10 rounded-full text-2xl leading-none disabled:opacity-30";
  return (
    <nav aria-label="Day" className="flex items-center justify-between gap-2 py-2">
      <button type="button" aria-label="Previous day" className={arrow} onClick={() => go(addDays(date, -1))}>
        ‹
      </button>
      <div className="flex flex-col items-center">
        <span className="font-semibold">{dayLabel(date, today)}</span>
        <input
          type="date"
          aria-label="Pick a day"
          value={date}
          max={today}
          onChange={(event) => {
            if (event.target.value) go(event.target.value);
          }}
          className="bg-transparent text-xs text-slate-500"
        />
      </div>
      <button type="button" aria-label="Next day" className={arrow} disabled={date >= today} onClick={() => go(addDays(date, 1))}>
        ›
      </button>
    </nav>
  );
}
