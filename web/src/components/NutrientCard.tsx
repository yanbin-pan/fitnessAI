import { useId, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { ADDED_SUGARS_MAX_G, MODERATE, SATURATED_FAT_MAX_G, SIGNAL_KEYS, fatSugarDay } from "../shared.ts";
import type { FatSugarDay, FoodItem, NutrientLevel, NutrientSignals, Sex, SignalKey } from "../shared.ts";

// Vitamins, fats and sugar (2026-10-06 nutrients design): a word for each over the last 7 days, never a number against a
// target, so that part reads as a nudge rather than a scorecard. Nothing there is ever red: "a bit low" is grey, "a lot" a
// soft amber. Above it, the day's own fat and free sugars in grams against the UK maxima (2026-10-17 fat & sugar design):
// asked for precisely, so those are numbers, and red once over.

type Tone = "good" | "calm" | "heads-up";
const DOT: Record<Tone, string> = { good: "bg-good", calm: "bg-muted/50", "heads-up": "bg-watch" };

export function toneOf(key: SignalKey, level: NutrientLevel): Tone {
  if (MODERATE.includes(key)) return level === "high" ? "heads-up" : "good";
  return level === "low" ? "calm" : "good";
}

const FATS: readonly SignalKey[] = SIGNAL_KEYS.slice(0, 4);
const MICROS: readonly SignalKey[] = SIGNAL_KEYS.slice(4);
const STORAGE_KEY = "nutrients-open";

function remembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function Tile({ name, word, tone }: { name: string; word: string; tone: Tone }) {
  return (
    <li className="pressed rounded-2xl px-3 py-2">
      <p className="truncate text-xs text-muted">{name}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
        {word}
      </p>
    </li>
  );
}

const whole = (grams: number) => Math.round(grams);

/** One of the day's rows: tapping it lists the foods behind it. */
function DayRow({ title, figure, figureClass = "text-muted", open, onToggle, children, details }: {
  title: string; figure: string; figureClass?: string; open: boolean; onToggle: () => void; children: React.ReactNode; details: React.ReactNode;
}) {
  const id = useId();
  return (
    <li className="pressed rounded-2xl px-3 py-2.5">
      <button type="button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle} className="block w-full text-left">
        <span className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">{title}</span>
          <span className={`text-xs tabular-nums ${figureClass}`}>{figure}</span>
        </span>
        {children}
      </button>
      {open && <div id={id}>{details}</div>}
    </li>
  );
}

function Sources({ rows, title }: { rows: { key: string; name: string; grams: number }[]; title?: string }) {
  const t = useT();
  return (
    <ul aria-label={title} className="mt-2 flex flex-col gap-1 border-t border-(--nm-lo) pt-2">
      {title && <li aria-hidden="true" className="text-[0.6875rem] font-semibold text-muted">{title}</li>}
      {rows.map((row) => (
        <li key={row.key} className="flex items-baseline gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className="tabular-nums text-muted">{row.grams.toLocaleString(t.locale, { maximumFractionDigits: 1 })} {t.units.g}</span>
        </li>
      ))}
    </ul>
  );
}

/** The day's fat, unsaturated then saturated, and its free sugars against the daily maximum. */
function DaySection({ day, foods, title, saturatedMax }: { day: FatSugarDay; foods: readonly FoodItem[]; title: string; saturatedMax: number }) {
  const t = useT();
  const [open, setOpen] = useState<"fat" | "sugar" | null>(null);
  const toggle = (row: "fat" | "sugar") => setOpen(open === row ? null : row);
  const unsaturatedShare = day.fat_g > 0 ? (day.unsaturated_fat_g / day.fat_g) * 100 : 0;
  const added = day.added_sugars_g;
  // The scale leaves room past the maximum, so its marker stays in view and a heavy day still fits.
  const scale = added === null ? 1 : Math.max(added, ADDED_SUGARS_MAX_G) * 1.15;
  const within = added === null ? 0 : Math.min(added, ADDED_SUGARS_MAX_G);
  const over = added === null ? 0 : Math.max(0, added - ADDED_SUGARS_MAX_G);
  return (
    <div>
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul aria-label={title} className="mt-2 grid gap-2">
        {day.fat_g > 0 && (
          <DayRow
            title={t.fatSugar.fat}
            figure={`${whole(day.fat_g)} ${t.units.g}`}
            open={open === "fat"}
            onToggle={() => toggle("fat")}
            details={
              <Sources
                title={t.fatSugar.saturatedByFood}
                rows={foods
                  .filter((food) => food.saturated_fat_g >= 0.5)
                  .sort((a, b) => b.saturated_fat_g - a.saturated_fat_g)
                  .map((food) => ({ key: food.id, name: food.name, grams: Math.round(food.saturated_fat_g * 10) / 10 }))}
              />
            }
          >
            <span aria-hidden="true" className="mt-1.5 flex h-2 overflow-hidden rounded-full">
              {unsaturatedShare > 0 && <span className={`bg-fat ${unsaturatedShare < 100 ? "rounded-l-full" : "rounded-full"}`} style={{ width: `${unsaturatedShare}%` }} />}
              {unsaturatedShare < 100 && <span className={`bg-fat-sat ${unsaturatedShare > 0 ? "ml-px rounded-r-full" : "rounded-full"}`} style={{ width: `${100 - unsaturatedShare}%` }} />}
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              <span className="flex items-center gap-1">
                <span aria-hidden="true" className="h-1.5 w-2.5 rounded-full bg-fat" />
                {t.fatSugar.unsaturated(whole(day.unsaturated_fat_g))}
              </span>
              <span className={`flex items-center gap-1 ${day.saturated_fat_g > saturatedMax ? "font-medium text-danger" : ""}`}>
                <span aria-hidden="true" className="h-1.5 w-2.5 rounded-full bg-fat-sat" />
                {t.fatSugar.saturated(whole(day.saturated_fat_g), saturatedMax)}
              </span>
            </span>
          </DayRow>
        )}
        {added !== null && (
          <DayRow
            title={t.fatSugar.addedSugar}
            figure={`${whole(added)} / ${ADDED_SUGARS_MAX_G} ${t.units.g}`}
            figureClass={over > 0 ? "font-medium text-danger" : "text-muted"}
            open={open === "sugar"}
            onToggle={() => toggle("sugar")}
            details={
              <>
                <Sources
                  rows={foods
                    .filter((food) => (food.added_sugars_g ?? 0) >= 0.5)
                    .sort((a, b) => (b.added_sugars_g ?? 0) - (a.added_sugars_g ?? 0))
                    .map((food) => ({ key: food.id, name: food.name, grams: Math.round((food.added_sugars_g ?? 0) * 10) / 10 }))}
                />
                <p className="mt-1.5 text-[0.6875rem] text-muted">{t.fatSugar.sugarRule}</p>
              </>
            }
          >
            <span aria-hidden="true" className="raised-sm relative mt-1.5 flex h-2 overflow-hidden rounded-full">
              {within > 0 && <span className={`bg-carbs ${over > 0 ? "rounded-l-full" : "rounded-full"}`} style={{ width: `${(within / scale) * 100}%` }} />}
              {over > 0 && <span data-testid="sugar-over" className="stripes stripes-over rounded-r-full" style={{ width: `${(over / scale) * 100}%` }} />}
              <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${(ADDED_SUGARS_MAX_G / scale) * 100}%` }} />
            </span>
            <span className="mt-1.5 block text-xs text-muted">
              <span className={over > 0 ? "text-danger" : ""}>{over > 0 ? t.fatSugar.over(whole(over)) : t.fatSugar.left(whole(ADDED_SUGARS_MAX_G - added))}</span>
              {` · ${t.fatSugar.sugarsInAll(whole(day.sugars_g))}`}
              {day.unestimated > 0 && ` · ${t.fatSugar.uncounted(day.unestimated)}`}
            </span>
          </DayRow>
        )}
      </ul>
    </div>
  );
}

/** The closed card's subtitle once the day has fat or sugar to show: its two numbers, red once over the maximum. */
function DayCaption({ day, title, saturatedMax }: { day: FatSugarDay; title: string; saturatedMax: number }) {
  const t = useT();
  const added = day.added_sugars_g;
  const parts = [
    added !== null && <span key="sugar" className={added > ADDED_SUGARS_MAX_G ? "font-medium text-danger" : ""}>{t.fatSugar.captionSugar(whole(added))}</span>,
    day.fat_g > 0 && <span key="fat" className={day.saturated_fat_g > saturatedMax ? "font-medium text-danger" : ""}>{t.fatSugar.captionSaturated(whole(day.saturated_fat_g))}</span>,
  ].filter(Boolean);
  return (
    <span className="block text-xs text-muted">
      {title}: {parts.flatMap((part, i) => (i === 0 ? [part] : [" · ", part]))}
    </span>
  );
}

/**
 * `foods` are the day's food items, for its fat and sugar; without them (or with nothing in them) the card shows only
 * the 7-day words, as before.
 */
export function NutrientCard({ signals, foods = [], isToday = true, sex = "male" }: {
  signals: NutrientSignals; foods?: readonly FoodItem[]; isToday?: boolean; sex?: Sex;
}) {
  const t = useT();
  const [open, setOpen] = useState(remembered);
  const panel = useId();
  const toggle = () => {
    setOpen((was) => {
      try {
        localStorage.setItem(STORAGE_KEY, was ? "0" : "1");
      } catch {
        // Only whether it opens next time depends on it.
      }
      return !was;
    });
  };
  const word = (key: SignalKey, level: NutrientLevel) => (MODERATE.includes(key) ? t.nutrients.moderate : t.nutrients.enough)[level];
  const group = (title: string, keys: readonly SignalKey[]) => {
    const shown = keys.filter((key) => signals.levels[key] !== undefined);
    if (shown.length === 0) return null;
    return (
      <div className="mt-3">
        <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        <ul aria-label={title} className="mt-2 grid grid-cols-2 gap-2">
          {shown.map((key) => {
            const level = signals.levels[key] as NutrientLevel;
            return <Tile key={key} name={t.nutrients.names[key]} word={word(key, level)} tone={toneOf(key, level)} />;
          })}
        </ul>
      </div>
    );
  };
  const hasFats = FATS.some((key) => signals.levels[key] !== undefined);
  const hasMicros = MICROS.some((key) => signals.levels[key] !== undefined);
  const day = fatSugarDay(foods);
  const hasDay = day.fat_g > 0 || day.added_sugars_g !== null;
  const dayTitle = isToday ? t.fatSugar.today : t.fatSugar.day;
  const saturatedMax = SATURATED_FAT_MAX_G[sex];

  return (
    <section className="raised mt-3 rounded-3xl">
      <button type="button" aria-expanded={open} aria-controls={open ? panel : undefined} onClick={toggle} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
        <span>
          <span className="block text-sm font-medium">{t.nutrients.title}</span>
          {hasDay ? <DayCaption day={day} title={dayTitle} saturatedMax={saturatedMax} /> : <span className="block text-xs text-muted">{t.nutrients.caption}</span>}
        </span>
        <Icon name="chevron_right" size={22} className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      {open && (
        <div id={panel} className="px-4 pb-4">
          {hasDay && (
            <>
              <DaySection day={day} foods={foods} title={dayTitle} saturatedMax={saturatedMax} />
              <h3 className="mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t.fatSugar.week}</h3>
            </>
          )}
          {!hasFats ? (
            <p className="text-sm text-muted">{t.nutrients.empty}</p>
          ) : (
            <>
              {group(t.nutrients.fats, FATS)}
              {group(t.nutrients.micros, MICROS)}
              {!hasMicros && <p className="mt-3 px-1 text-xs text-muted">{t.nutrients.microsPending}</p>}
              {signals.levels.vitamin_d_ug === "low" && <p className="mt-3 px-1 text-xs text-muted">{t.nutrients.sunlight}</p>}
              <p className="mt-2 px-1 text-xs text-muted">{t.nutrients.disclaimer}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
