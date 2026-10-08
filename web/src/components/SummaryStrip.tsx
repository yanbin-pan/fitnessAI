import { kcal10 } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { DayView } from "../shared.ts";
import { MACROS } from "./Summary.tsx";

/**
 * The summary in one line, under the day bar once the full card has scrolled away: kcal left and the four macros as
 * small bars. A tap goes back up to the card. It floats over the page, so showing it never moves the page.
 */
export function SummaryStrip({ view, onClick }: { view: DayView; onClick: () => void }) {
  const t = useT();
  const target = view.targets.adjusted;
  const eaten = view.totals;
  const left = kcal10(target.kcal) - Math.round(eaten.kcal);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${Math.abs(left)} ${left < 0 ? t.summary.over : t.summary.left}. ${t.summary.toTop}`}
      className="summary-strip tap raised-sm flex w-full items-center gap-3 rounded-2xl px-3 py-2"
    >
      <span className="flex shrink-0 items-baseline gap-1">
        <span className={`text-sm font-semibold tabular-nums ${left < 0 ? "text-danger" : ""}`}>{Math.abs(left)}</span>
        <span className="text-xs text-muted">{left < 0 ? t.summary.over : t.summary.left}</span>
      </span>
      <span aria-hidden="true" className="flex min-w-0 flex-1 gap-1.5">
        {MACROS.map((macro) => (
          <span key={macro.key} className="pressed h-1.5 flex-1 overflow-hidden rounded-full">
            <span className={`block h-full rounded-full ${macro.fill}`} style={{ width: `${target[macro.key] > 0 ? Math.min(100, (eaten[macro.key] / target[macro.key]) * 100) : 0}%` }} />
          </span>
        ))}
      </span>
      <Icon name="chevron_left" size={18} className="shrink-0 rotate-90 text-muted" />
    </button>
  );
}
