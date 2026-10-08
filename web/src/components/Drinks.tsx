import { useId } from "react";
import type { CSSProperties } from "react";
import { timeOf } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import { ALCOHOL_WEEK_GUIDE, KCAL_PER_UNIT, isDrink } from "../shared.ts";
import type { AlcoholStatus, AlcoholWeek, DayView, Drink, Entry, FoodItem } from "../shared.ts";
import { quietButton } from "./ui.tsx";

// Drinks on Today (2026-10-08 alcohol design): a badge per kind had on the day, and the units of the 7 days ending on
// it as a pill, each opening a panel under the row, as the sport badges do.

interface DrinkStyle {
  icon: IconName;
  /** The pictogram's colour on the light base and on the dark base; both reach 3:1 or more. */
  light: string;
  dark: string;
}

/** Each kind's pictogram and colours; `other` is a drink with alcohol but no kind (logged before kinds existed). */
export const DRINK_STYLES: Record<Drink | "other", DrinkStyle> = {
  beer: { icon: "sports_bar", light: "#94650F", dark: "#E3C07A" },
  wine: { icon: "wine_bar", light: "#8E3B5A", dark: "#E0A3BC" },
  cocktail: { icon: "local_bar", light: "#2F7884", dark: "#8FCAD6" },
  other: { icon: "local_bar", light: "#6F7785", dark: "#B7BECA" },
};

/** Units as the app writes them: one decimal place, in the app's language. */
export function unitsText(units: number, t: Messages): string {
  return units.toLocaleString(t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function drinkName(drink: Drink | null, t: Messages): string {
  return t.drinks[drink ?? "other"];
}

export interface DrinkGroup {
  drink: Drink | null;
  items: { food: FoodItem; entry: Entry }[];
  units: number;
  kcal: number;
}

/** The day's drinks by kind, beer, wine and cocktails first, in the order they were had. */
export function drinkGroups(view: DayView): DrinkGroup[] {
  const groups = new Map<Drink | null, DrinkGroup>();
  for (const entry of view.entries) {
    for (const food of entry.foods) {
      if (!isDrink(food)) continue;
      const drink = food.drink ?? null;
      const group = groups.get(drink) ?? { drink, items: [], units: 0, kcal: 0 };
      group.items.push({ food, entry });
      group.units += food.alcohol_units;
      group.kcal += food.kcal;
      groups.set(drink, group);
    }
  }
  const order = (drink: Drink | null) => (drink === null ? 99 : ["beer", "wine", "cocktail"].indexOf(drink));
  return [...groups.values()].sort((a, b) => order(a.drink) - order(b.drink));
}

/** A kind's pictogram on a matte disc, with how many were had on the day. */
export function DrinkBadge({ drink, count, size = 44, pressed = false }: { drink: Drink | null; count: number; size?: number; pressed?: boolean }) {
  const style = DRINK_STYLES[drink ?? "other"];
  const vars = { "--sport-light": style.light, "--sport-dark": style.dark, width: size, height: size } as CSSProperties;
  return (
    <span
      className={`${pressed ? "pressed" : "raised-sm"} relative inline-flex shrink-0 items-center justify-center rounded-full text-(color:--sport-light) dark:text-(color:--sport-dark)`}
      style={vars}
    >
      <Icon name={style.icon} size={Math.round(size * 0.58)} />
      <span className="raised-sm absolute -right-1.5 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.6875rem] font-semibold text-ink tabular-nums">
        {count}
      </span>
    </span>
  );
}

const STATUS_STRIPES: Record<AlcoholStatus, string> = { within: "stripes-kcal", near: "stripes-near", over: "stripes-over" };
const PILL_R = 14;
const PILL_C = 2 * Math.PI * PILL_R;

/** The week's units: a small striped ring filling towards the 14-unit guide, then the number. */
export function AlcoholPill({ week, pressed, onClick, controls }: { week: AlcoholWeek; pressed: boolean; onClick: () => void; controls?: string }) {
  const t = useT();
  const pattern = useId();
  const share = Math.min(1, week.units / ALCOHOL_WEEK_GUIDE);
  const status = week.status === "over" ? t.alcohol.status.over(unitsText(week.units - ALCOHOL_WEEK_GUIDE, t)) : t.alcohol.status[week.status];
  return (
    <button
      type="button"
      aria-expanded={pressed}
      aria-controls={controls}
      aria-label={t.alcohol.pill(unitsText(week.units, t), status)}
      onClick={onClick}
      className={`tap ${pressed ? "pressed" : "raised-sm"} flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3`}
    >
      <span className={`relative flex h-9 w-9 items-center justify-center ${STATUS_STRIPES[week.status]}`}>
        <svg viewBox="0 0 36 36" aria-hidden="true" className="absolute inset-0 h-full w-full -rotate-90">
          <defs>
            <pattern id={pattern} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" style={{ fill: "var(--s-bg)" }} />
              <rect width="1.8" height="4" style={{ fill: "var(--s-fg)" }} />
            </pattern>
          </defs>
          <circle cx="18" cy="18" r={PILL_R} fill="none" strokeWidth="5" className="stroke-(--nm-lo) opacity-60" />
          {share > 0 && <circle cx="18" cy="18" r={PILL_R} fill="none" strokeWidth="5" stroke={`url(#${pattern})`} strokeDasharray={`${PILL_C * share} ${PILL_C}`} />}
        </svg>
        {week.status === "over" && <span className="relative text-[0.625rem] font-bold text-danger">!</span>}
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span className={`text-[0.9375rem] font-semibold tabular-nums ${week.status === "over" ? "text-danger" : ""}`}>{t.alcohol.units(unitsText(week.units, t))}</span>
        <span className="text-[0.6875rem] text-muted">{t.alcohol.pillDays}</span>
      </span>
    </button>
  );
}

function weekday(date: string, t: Messages): string {
  return new Intl.DateTimeFormat(t.locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** The week behind the pill: the units against the guide, day by day, and by kind of drink. */
export function AlcoholWeekPanel({ week, id }: { week: AlcoholWeek; id: string }) {
  const t = useT();
  const stripes = STATUS_STRIPES[week.status];
  // The scale leaves room past the guide, so its marker stays in view and a heavy week still fits.
  const scale = Math.max(week.units, ALCOHOL_WEEK_GUIDE) * 1.15;
  const heaviest = Math.max(...week.days.map((day) => day.units), 1);
  const last = week.days.length - 1;
  const status = week.status === "over" ? t.alcohol.status.over(unitsText(week.units - ALCOHOL_WEEK_GUIDE, t)) : t.alcohol.status[week.status];
  return (
    <div id={id} role="region" aria-label={t.alcohol.week} className="pressed mt-3 rounded-2xl p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{t.alcohol.week}</h3>
        <span className="text-xs text-muted">{t.alcohol.freeDays(week.alcohol_free_days)}</span>
      </div>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-2xl font-semibold tabular-nums ${week.status === "over" ? "text-danger" : ""}`}>{unitsText(week.units, t)}</span>
        <span className="text-sm text-muted">{t.alcohol.ofGuide(ALCOHOL_WEEK_GUIDE)}</span>
      </p>
      <div aria-hidden="true" className="raised-sm relative mt-2 h-3 overflow-hidden rounded-full">
        <span className={`stripes ${stripes} absolute inset-y-0 left-0`} style={{ width: `${(week.units / scale) * 100}%` }} />
        <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${(ALCOHOL_WEEK_GUIDE / scale) * 100}%` }} />
      </div>
      <p className={`mt-2 text-xs ${week.status === "over" ? "text-danger" : "text-muted"}`}>{status}</p>
      <ol aria-label={t.alcohol.byDay} className="mt-3 grid h-24 grid-cols-7 items-end gap-2">
        {week.days.map((day, i) => (
          <li key={day.date} className="flex h-full flex-col items-center justify-end gap-1">
            {day.units > 0 && <span className="text-[0.625rem] tabular-nums text-muted">{unitsText(day.units, t)}</span>}
            <span
              className={`w-full rounded-md ${day.units > 0 ? `stripes ${stripes}` : "bg-(--nm-lo) opacity-50"} ${i === last ? "outline-2 outline-offset-2 outline-accent" : ""}`}
              style={{ height: day.units > 0 ? `${Math.max(8, (day.units / heaviest) * 56)}px` : "3px" }}
            />
            <span className={`text-[0.6875rem] ${i === last ? "font-semibold text-ink" : "text-muted"}`}>
              <span className="sr-only">{`${unitsText(day.units, t)} `}</span>
              {weekday(day.date, t)}
            </span>
          </li>
        ))}
      </ol>
      <h4 className="mt-3 text-xs font-semibold text-muted">{t.alcohol.byDrink}</h4>
      <ul className="mt-1 flex flex-col gap-1.5">
        {week.drinks.map((total) => (
          <li key={total.drink ?? "other"} className="flex items-center gap-2 text-sm">
            <span className="text-(color:--sport-light) dark:text-(color:--sport-dark)" style={{ "--sport-light": DRINK_STYLES[total.drink ?? "other"].light, "--sport-dark": DRINK_STYLES[total.drink ?? "other"].dark } as CSSProperties}>
              <Icon name={DRINK_STYLES[total.drink ?? "other"].icon} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              {drinkName(total.drink, t)}, {t.alcohol.drinkCount(total.count)}
            </span>
            <span className="tabular-nums text-muted">{t.alcohol.units(unitsText(total.units, t))}</span>
            <span className="w-20 text-right font-semibold tabular-nums">
              {Math.round(total.kcal)} {t.units.kcal}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One kind's drinks on the day: each with its units and calories, and how much of that is the alcohol itself. */
export function DrinkPanel({ group, id, onEdit }: { group: DrinkGroup; id: string; onEdit: (entry: Entry) => void }) {
  const t = useT();
  const alcoholKcal = Math.round(group.units * KCAL_PER_UNIT);
  const entries = [...new Map(group.items.map(({ entry }) => [entry.id, entry])).values()];
  return (
    <div id={id} role="region" aria-label={t.alcohol.todayTitle(drinkName(group.drink, t))} className="pressed mt-3 rounded-2xl p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{t.alcohol.todayTitle(drinkName(group.drink, t))}</h3>
        <span className="text-xs text-muted tabular-nums">
          {t.alcohol.units(unitsText(group.units, t))} · {Math.round(group.kcal)} {t.units.kcal}
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {group.items.map(({ food, entry }) => (
          <li key={food.id} className="flex items-baseline gap-2 text-sm">
            <span className="min-w-0 flex-1">
              {food.name}
              {food.quantity && <span className="text-muted"> · {food.quantity}</span>}
            </span>
            <span className="text-xs text-muted">{timeOf(entry.logged_at, t)}</span>
            <span className="tabular-nums text-muted">{t.alcohol.units(unitsText(food.alcohol_units, t))}</span>
            <span className="w-16 text-right font-semibold tabular-nums">{Math.round(food.kcal)}</span>
          </li>
        ))}
      </ul>
      {alcoholKcal > 0 && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span aria-hidden="true" className="stripes stripes-kcal inline-block h-2 w-5 rounded-full" />
          {t.alcohol.alcoholKcal(Math.min(alcoholKcal, Math.round(group.kcal)))}
        </p>
      )}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {entries.map((entry) => (
          <button key={entry.id} type="button" onClick={() => onEdit(entry)} className={`${quietButton} min-h-11 text-sm text-accent-ink`}>
            {entries.length > 1 ? `${t.common.edit} · ${timeOf(entry.logged_at, t)}` : t.common.edit}
          </button>
        ))}
      </div>
    </div>
  );
}
