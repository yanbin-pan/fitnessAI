import { kcal10 } from "../format.ts";
import type { DayView } from "../shared.ts";

function Bar({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span>
          {Math.round(value)} / {Math.round(target)} g
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.min(Math.round(value), Math.round(target))}
        aria-valuetext={`${Math.round(value)} of ${Math.round(target)} g`}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
        className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Summary({ view }: { view: DayView }) {
  const target = view.targets.adjusted;
  const eaten = view.totals;
  return (
    <section aria-label="Day summary" className="pb-2">
      <p className="text-2xl font-semibold">
        <span>{Math.round(eaten.kcal)}</span> <span className="text-base font-normal text-slate-500">/ {kcal10(target.kcal)} kcal</span>
      </p>
      {view.targets.add_back_kcal > 0 && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          +{kcal10(view.targets.add_back_kcal)} kcal from {Math.round(view.targets.workout_kcal)} kcal of exercise
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Bar label="Protein" value={eaten.protein_g} target={target.protein_g} />
        <Bar label="Carbs" value={eaten.carbs_g} target={target.carbs_g} />
        <Bar label="Fat" value={eaten.fat_g} target={target.fat_g} />
        <Bar label="Fibre" value={eaten.fibre_g} target={target.fibre_g} />
      </div>
    </section>
  );
}
