import { kcal10 } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { DayView } from "../shared.ts";

const MACROS = [
  { key: "protein_g", word: "protein", fill: "bg-protein" },
  { key: "carbs_g", word: "carbs", fill: "bg-carbs" },
  { key: "fat_g", word: "fat", fill: "bg-fat" },
  { key: "fibre_g", word: "fibre", fill: "bg-fibre" },
] as const;

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Calories left, or how far over, inside a ring that fills as the target is eaten. The numbers carry the meaning; the ring repeats it. */
function CalorieRing({ eaten, target }: { eaten: number; target: number }) {
  const t = useT();
  const shown = kcal10(target);
  const share = shown > 0 ? Math.min(1, eaten / shown) : 0;
  // Counted from the rounded figure on the line beside the ring, so the two never disagree; the arc can use the raw eaten.
  const left = shown - Math.round(eaten);
  return (
    <div className="pressed relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full">
      <svg viewBox="0 0 88 88" aria-hidden="true" className="absolute inset-0 h-full w-full -rotate-90">
        {share > 0 && (
          <circle
            cx="44" cy="44" r={RADIUS} fill="none" strokeWidth="7" strokeLinecap="round"
            className={left < 0 ? "stroke-danger" : "stroke-accent"}
            strokeDasharray={`${CIRCUMFERENCE * share} ${CIRCUMFERENCE}`}
          />
        )}
      </svg>
      <p className="text-center leading-tight">
        <span className="block text-lg font-semibold">{Math.abs(left)}</span>
        <span className="block text-xs text-muted">{left < 0 ? t.summary.over : t.summary.left}</span>
      </p>
    </div>
  );
}

function Bar({ label, fill, value, target }: { label: string; fill: string; value: number; target: number }) {
  const t = useT();
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted">
          {Math.round(value)} / {Math.round(target)} {t.units.g}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.min(Math.round(value), Math.round(target))}
        aria-valuetext={t.summary.grams(Math.round(value), Math.round(target))}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
        className="pressed mt-0.5 h-2 rounded-full"
      >
        <div className={`h-2 rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Summary({ view }: { view: DayView }) {
  const t = useT();
  const target = view.targets.adjusted;
  const eaten = view.totals;
  return (
    <section aria-label={t.summary.label} className="raised flex items-center gap-4 rounded-3xl p-4">
      <CalorieRing eaten={eaten.kcal} target={target.kcal} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-semibold">{Math.round(eaten.kcal)}</span> <span className="text-muted">/ {kcal10(target.kcal)} {t.units.kcal}</span>
        </p>
        {view.targets.add_back_kcal > 0 && (
          <p className="text-xs text-accent-ink">
            {t.summary.addBack(kcal10(view.targets.add_back_kcal), Math.round(view.targets.workout_kcal))}
          </p>
        )}
        <div className="mt-2 grid gap-1.5">
          {MACROS.map((macro) => (
            <Bar key={macro.key} label={t.macros[macro.word]} fill={macro.fill} value={eaten[macro.key]} target={target[macro.key]} />
          ))}
        </div>
      </div>
    </section>
  );
}
