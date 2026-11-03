import { useId, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { ADDED_SUGARS_MAX_G, MODERATE, SATURATED_FAT_MAX_G, SIGNAL_KEYS, fatSugarDay } from "../shared.ts";
import type { FatSugarDay, FoodItem, Micro, MicroDetail, NutrientLevel, NutrientSignals, Sex, SignalKey } from "../shared.ts";

// Vitamins, fats and sugar (2026-10-06 nutrients design): a word for each over the last 7 days, never a number against a
// target, so that part reads as a nudge rather than a scorecard. Nothing there is ever red: "a bit low" is grey, "a lot" a
// soft amber. Above it, the day's own fat and free sugars in grams against the UK maxima (2026-10-17 fat & sugar design):
// asked for precisely, so those are numbers, and red once over.

type Tone = "good" | "calm" | "heads-up";
const DOT: Record<Tone, string> = { good: "bg-good", calm: "bg-muted/50", "heads-up": "bg-watch" };

export function toneOf(key: SignalKey, level: NutrientLevel): Tone {
  // Low on something to keep moderate is fine, but not an achievement: a neutral dot (2026-11-03 design review).
  if (MODERATE.includes(key)) return level === "high" ? "heads-up" : level === "low" ? "calm" : "good";
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

const POSITION: Record<NutrientLevel, number> = { low: 0, ok: 1, high: 2 };

/**
 * One nutrient on a low / good / high scale (2026-11-03, Bin's pick "C"): a dot in the third that matches its level,
 * coloured by tone, so which way each one is off reads at a glance and still no number is shown.
 */
function ScaleRow({ name, word, tone, level }: { name: string; word: string; tone: Tone; level: NutrientLevel }) {
  return (
    <li className="flex items-center justify-between gap-3 border-t border-line py-1.5 text-sm first:border-t-0">
      <span className="min-w-0 truncate">{name}</span>
      <span className="sr-only">{word}</span>
      <span aria-hidden="true" className="pressed relative grid h-3 w-28 shrink-0 grid-cols-3 rounded-full">
        <span className="col-start-2 my-[3px] rounded-full bg-good/20" />
        <span
          data-level={level}
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-(--nm-base) ${DOT[tone]}`}
          style={{ left: `${((POSITION[level] * 2 + 1) / 6) * 100}%` }}
        />
      </span>
    </li>
  );
}

/** The reference scale runs from nothing to twice the reference; past that the dot rests at the end. */
const REF_MAX = 2;
const at = (share: number) => `${(Math.min(Math.max(share, 0), REF_MAX) / REF_MAX) * 100}%`;
/** The good band, as the levels draw it (66 % to 150 % of the reference). */
const BAND = { from: 0.66, to: 1.5 };

/**
 * A vitamin or mineral against its daily reference (2026-11-03, Bin's pick "C"): the dot sits at the 7-day share of the
 * reference, a tick marks the reference, and a tap opens one line with the share rounded to 10 %, the amount and the
 * foods it came from. Still calm by default: the exact figure only on demand.
 */
function MicroRow({ id, name, word, tone, detail, open, onToggle }: {
  id: Micro; name: string; word: string; tone: Tone; detail: MicroDetail; open: boolean; onToggle: () => void;
}) {
  const t = useT();
  const panel = useId();
  const share = detail.pct_of_reference / 100;
  const pct = (Math.round(detail.pct_of_reference / 10) / 10).toLocaleString(t.locale, { style: "percent" });
  const unit = id.endsWith("_ug") ? "µg" : "mg";
  const num = (n: number) => n.toLocaleString(t.locale, { maximumFractionDigits: n >= 10 ? 0 : 1 });
  const parts = [
    t.nutrients.detail.share(pct),
    t.nutrients.detail.amount(num(detail.avg_daily), num(detail.daily_reference), unit),
    ...(detail.top_sources.length > 0 ? [t.nutrients.detail.from(detail.top_sources.join(", "))] : []),
  ];
  return (
    <li className="border-t border-line first:border-t-0">
      <button type="button" aria-expanded={open} aria-controls={open ? panel : undefined} onClick={onToggle} className="flex w-full items-center justify-between gap-3 py-1.5 text-left text-sm">
        <span className="min-w-0 truncate">{name}</span>
        <span className="sr-only">{word}</span>
        <span aria-hidden="true" className="pressed relative h-3 w-28 shrink-0 rounded-full">
          <span className="absolute inset-y-[3px] rounded-full bg-good/20" style={{ left: at(BAND.from), right: `calc(100% - ${at(BAND.to)})` }} />
          <span className="absolute inset-y-0 left-1/2 w-px bg-ink/40" />
          <span
            data-share={detail.pct_of_reference}
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-(--nm-base) ${DOT[tone]}`}
            style={{ left: at(share) }}
          />
        </span>
      </button>
      {open && <p id={panel} className="pb-2 text-xs text-muted">{parts.join(" · ")}</p>}
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
    // Rows divided by a hairline rather than set in cards inside the card (2026-11-03 design review).
    <li className="min-w-0 border-t border-line pt-2.5 first:border-t-0 first:pt-0">
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
    <ul aria-label={title} className="mt-2 flex min-w-0 flex-col gap-1 border-t border-line pt-2">
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
      <h3 className="text-sm font-semibold">{title}</h3>
      {/* A flex column, not a grid: a grid's implicit column grows to a long food name and pushes the page sideways. */}
      <ul aria-label={title} className="mt-2 flex flex-col gap-2.5">
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
  const [openMicro, setOpenMicro] = useState<SignalKey | null>(null);
  const word = (key: SignalKey, level: NutrientLevel) => (MODERATE.includes(key) ? t.nutrients.moderate : t.nutrients.enough)[level];
  const group = (title: string, keys: readonly SignalKey[]) => {
    const shown = keys.filter((key) => signals.levels[key] !== undefined);
    if (shown.length === 0) return null;
    return (
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="min-w-0 text-xs font-medium text-muted">{title}</h3>
          {keys === MICROS && signals.micros ? (
            <span aria-hidden="true" className="w-28 shrink-0 text-center text-[0.625rem] text-muted">{t.nutrients.scale.reference}</span>
          ) : (
            <span aria-hidden="true" className="grid w-28 shrink-0 grid-cols-3 text-center text-[0.625rem] text-muted">
              <span>{t.nutrients.scale.low}</span><span>{t.nutrients.scale.good}</span><span>{t.nutrients.scale.high}</span>
            </span>
          )}
        </div>
        <ul aria-label={title} className="mt-1.5 flex flex-col">
          {shown.map((key) => {
            const level = signals.levels[key] as NutrientLevel;
            const detail = signals.micros?.[key as Micro];
            if (detail) {
              return (
                <MicroRow
                  key={key} id={key as Micro} name={t.nutrients.names[key]} word={word(key, level)} tone={toneOf(key, level)} detail={detail}
                  open={openMicro === key} onToggle={() => setOpenMicro(openMicro === key ? null : key)}
                />
              );
            }
            return <ScaleRow key={key} name={t.nutrients.names[key]} word={word(key, level)} tone={toneOf(key, level)} level={level} />;
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
              <h3 className="mt-5 border-t border-line pt-4 text-sm font-semibold">{t.fatSugar.week}</h3>
            </>
          )}
          {!hasFats ? (
            <p className="text-sm text-muted">{t.nutrients.empty}</p>
          ) : (
            <>
              {group(t.nutrients.fats, FATS)}
              {group(t.nutrients.micros, MICROS)}
              {!hasMicros && <p className="mt-3 text-xs text-muted">{t.nutrients.microsPending}</p>}
              {signals.levels.vitamin_d_ug === "low" && <p className="mt-3 text-xs text-muted">{t.nutrients.sunlight}</p>}
              <p className="mt-2 text-xs text-muted">{t.nutrients.disclaimer}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
