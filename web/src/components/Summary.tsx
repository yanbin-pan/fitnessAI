import { useId } from "react";
import { kcal10 } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import { isDrink } from "../shared.ts";
import type { DayView } from "../shared.ts";

const MACROS = [
  { key: "protein_g", word: "protein", fill: "bg-protein", stripes: "stripes-protein" },
  { key: "carbs_g", word: "carbs", fill: "bg-carbs", stripes: "stripes-carbs" },
  { key: "fat_g", word: "fat", fill: "bg-fat", stripes: "stripes-fat" },
  { key: "fibre_g", word: "fibre", fill: "bg-fibre", stripes: "stripes-fibre" },
] as const;

type Shared = { kcal: number } & Record<(typeof MACROS)[number]["key"], number>;

/** What the day's drinks add to the calories and each macro (2026-10-08 alcohol design §2). */
export function drinkShare(view: DayView): Shared {
  const share: Shared = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
  for (const entry of view.entries) {
    for (const food of entry.foods) {
      if (!isDrink(food)) continue;
      share.kcal += food.kcal;
      for (const { key } of MACROS) share[key] += food[key];
    }
  }
  return share;
}

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Calories left, or how far over, inside a ring that fills as the target is eaten: food solid, then the drinks striped
 * after it. The numbers carry the meaning; the ring repeats it.
 */
function CalorieRing({ eaten, drinks, target }: { eaten: number; drinks: number; target: number }) {
  const t = useT();
  const pattern = useId();
  const shown = kcal10(target);
  const share = shown > 0 ? Math.min(1, eaten / shown) : 0;
  const drinkShare = shown > 0 && eaten > 0 ? Math.min(share, drinks / shown) : 0;
  const foodShare = share - drinkShare;
  // Counted from the rounded figure on the line beside the ring, so the two never disagree; the arc can use the raw eaten.
  const left = shown - Math.round(eaten);
  // A round cap reaches half the stroke past the end: the stripes start that far on, so they never sit under it.
  const gap = foodShare > 0 && drinkShare > 0 ? 4 : 0;
  return (
    <div className="pressed relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full">
      <svg viewBox="0 0 88 88" aria-hidden="true" className={`absolute inset-0 h-full w-full -rotate-90 ${left < 0 ? "stripes-over" : "stripes-kcal"}`}>
        <defs>
          <pattern id={pattern} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" style={{ fill: "var(--s-bg)" }} />
            <rect width="2.2" height="5" style={{ fill: "var(--s-fg)" }} />
          </pattern>
        </defs>
        {foodShare > 0 && (
          <circle
            cx="44" cy="44" r={RADIUS} fill="none" strokeWidth="7" strokeLinecap="round"
            className={left < 0 ? "stroke-danger" : "stroke-accent"}
            strokeDasharray={`${CIRCUMFERENCE * foodShare} ${CIRCUMFERENCE}`}
          />
        )}
        {drinkShare > 0 && (
          <circle
            data-testid="ring-drinks"
            cx="44" cy="44" r={RADIUS} fill="none" strokeWidth="7" stroke={`url(#${pattern})`}
            strokeDasharray={`0 ${CIRCUMFERENCE * foodShare + gap} ${Math.max(0, CIRCUMFERENCE * drinkShare - gap)} ${CIRCUMFERENCE}`}
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

function Bar({ label, fill, stripes, value, drinks, target }: { label: string; fill: string; stripes: string; value: number; drinks: number; target: number }) {
  const t = useT();
  const pct = (grams: number) => (target > 0 ? Math.min(100, (grams / target) * 100) : 0);
  const food = pct(Math.max(0, value - drinks));
  const extra = Math.min(100 - food, pct(drinks));
  const fromDrinks = Math.round(drinks);
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
        aria-valuetext={fromDrinks > 0 ? `${t.summary.grams(Math.round(value), Math.round(target))}, ${t.alcohol.gramsFromDrinks(fromDrinks)}` : t.summary.grams(Math.round(value), Math.round(target))}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
        className="pressed mt-0.5 flex h-2 overflow-hidden rounded-full"
      >
        {food > 0 && <div className={`h-2 ${extra > 0 ? "rounded-l-full" : "rounded-full"} ${fill}`} style={{ width: `${food}%` }} />}
        {extra > 0 && <div data-testid={`${label}-drinks`} className={`stripes ${stripes} h-2 ${food > 0 ? "ml-px rounded-r-full" : "rounded-full"}`} style={{ width: `${extra}%` }} />}
      </div>
    </div>
  );
}

export function Summary({ view }: { view: DayView }) {
  const t = useT();
  const target = view.targets.adjusted;
  const eaten = view.totals;
  const drinks = drinkShare(view);
  return (
    <section aria-label={t.summary.label} className="raised flex items-center gap-4 rounded-3xl p-4">
      <CalorieRing eaten={eaten.kcal} drinks={drinks.kcal} target={target.kcal} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-semibold">{Math.round(eaten.kcal)}</span> <span className="text-muted">/ {kcal10(target.kcal)} {t.units.kcal}</span>
        </p>
        {Math.round(drinks.kcal) > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span aria-hidden="true" className="stripes stripes-kcal inline-block h-2 w-3.5 rounded-full" />
            {t.alcohol.fromDrinks(Math.round(drinks.kcal))}
          </p>
        )}
        {view.targets.add_back_kcal > 0 && (
          <p className="text-xs text-accent-ink">
            {t.summary.addBack(kcal10(view.targets.add_back_kcal), Math.round(view.targets.workout_kcal))}
          </p>
        )}
        <div className="mt-2 grid gap-1.5">
          {MACROS.map((macro) => (
            <Bar
              key={macro.key} label={t.macros[macro.word]} fill={macro.fill} stripes={macro.stripes}
              value={eaten[macro.key]} drinks={drinks[macro.key]} target={target[macro.key]}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
