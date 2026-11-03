import { useState } from "react";
import type { ReactNode } from "react";
import { thousands } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import { Reorderable } from "../components/Reorderable.tsx";
import type { Grip } from "../components/Reorderable.tsx";
import { SportBadge, sportName } from "../components/SportBadge.tsx";
import type { InsightsHistory, InsightSummary, WeekPoint } from "../shared.ts";
import { Well, shortDate } from "./InsightsPage.tsx";

// Trends (2026-11-01 insights history design): each finished week's averages over time, worked out from the log, and
// every past report kept and reachable. Nothing here calls the model.

type Range = "8" | "26" | "all";

interface Metric {
  id: string;
  name: (t: Messages) => string;
  unit: (t: Messages) => string;
  value: (w: WeekPoint) => number;
  target?: (w: WeekPoint) => number | null;
  /** Nutrition is averaged over days with food: a week without food has no point. */
  food: boolean;
  colour: string;
  tint: string;
  icon: IconName;
  digits: number;
  bars?: boolean;
}

const MAIN: Metric[] = [
  { id: "kcal", name: (t) => t.insights.calories, unit: (t) => t.insights.trends.kcalDay, value: (w) => w.kcal, target: (w) => w.kcal_target, food: true, colour: "var(--nm-accent)", tint: "tint-green", icon: "restaurant", digits: 0 },
  { id: "protein", name: (t) => t.insights.protein, unit: (t) => t.insights.trends.gDay, value: (w) => w.protein_g, target: (w) => w.protein_target, food: true, colour: "var(--color-protein)", tint: "tint-blue", icon: "fitness_center", digits: 0 },
  { id: "carbs", name: (t) => t.insights.nutrients.carbs_g, unit: (t) => t.insights.trends.gDay, value: (w) => w.carbs_g, target: (w) => w.carbs_target, food: true, colour: "var(--color-carbs)", tint: "tint-amber", icon: "restaurant", digits: 0 },
  { id: "fat", name: (t) => t.insights.nutrients.fat_g, unit: (t) => t.insights.trends.gDay, value: (w) => w.fat_g, target: (w) => w.fat_target, food: true, colour: "var(--color-fat)", tint: "tint-rose", icon: "restaurant", digits: 0 },
  { id: "fibre", name: (t) => t.insights.fibre, unit: (t) => t.insights.trends.gDay, value: (w) => w.fibre_g, target: (w) => w.fibre_target, food: true, colour: "var(--color-fibre)", tint: "tint-teal", icon: "nutrition", digits: 0 },
  { id: "sessions", name: (t) => t.insights.trainingTile, unit: (t) => t.insights.sessionsWeek, value: (w) => w.sessions, food: false, colour: "#f08a4b", tint: "tint-orange", icon: "directions_run", digits: 0, bars: true },
];

/** The rest, behind chips: fat split into its two kinds, the upper limits drawn where there is one. */
const MORE: Metric[] = [
  { id: "saturated", name: (t) => t.nutrients.names.saturated_fat, unit: (t) => t.insights.trends.gDay, value: (w) => w.saturated_fat_g, target: (w) => w.saturated_fat_max, food: true, colour: "var(--color-fat-sat)", tint: "tint-rose", icon: "restaurant", digits: 0 },
  { id: "unsaturated", name: (t) => t.nutrients.names.unsaturated_fat, unit: (t) => t.insights.trends.gDay, value: (w) => Math.max(0, Math.round((w.fat_g - w.saturated_fat_g) * 10) / 10), food: true, colour: "var(--color-fat)", tint: "tint-rose", icon: "restaurant", digits: 0 },
  { id: "sugars", name: (t) => t.insights.nutrients.sugars_g, unit: (t) => t.insights.trends.gDay, value: (w) => w.sugars_g, target: (w) => w.sugars_max, food: true, colour: "var(--color-carbs)", tint: "tint-amber", icon: "restaurant", digits: 0 },
  { id: "salt", name: (t) => t.insights.nutrients.salt_g, unit: (t) => t.insights.trends.gDay, value: (w) => w.salt_g, target: (w) => w.salt_max, food: true, colour: "var(--color-muted)", tint: "tint-slate", icon: "restaurant", digits: 1 },
  { id: "alcohol", name: (t) => t.insights.trends.alcohol, unit: (t) => t.insights.trends.unitsWeek, value: (w) => w.alcohol_units, food: true, colour: "#8a6ff0", tint: "tint-violet", icon: "wine_bar", digits: 1 },
  { id: "active", name: (t) => t.insights.trends.active, unit: (t) => t.insights.trends.kcalWeek, value: (w) => w.active_kcal, food: false, colour: "#f2a93b", tint: "tint-amber", icon: "sunny", digits: 0 },
  { id: "minutes", name: (t) => t.insights.trends.minutes, unit: (t) => t.insights.trends.minWeek, value: (w) => w.minutes, food: false, colour: "#f08a4b", tint: "tint-orange", icon: "directions_run", digits: 0 },
];

const ORDER_KEY = "trends-order";

/** The person's own order of the main charts, kept on this device; any chart it does not name goes at the end. */
function savedOrder(): string[] {
  const ids = MAIN.map((m) => m.id);
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "null");
    if (!Array.isArray(parsed)) return ids;
    const known = parsed.filter((id): id is string => typeof id === "string" && ids.includes(id));
    return [...new Set([...known, ...ids])];
  } catch {
    return ids;
  }
}

function saveOrder(ids: string[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    // Private mode: the order lasts until the page closes.
  }
}

/** Six dots: the handle a chart is dragged by. */
function GripButton({ grip, label }: { grip: Grip; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      {...grip.props}
      className={`-mr-1 flex h-8 w-6 shrink-0 select-none items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent ${grip.held ? "text-ink" : "text-muted"}`}
    >
      <svg viewBox="0 0 10 16" width={10} height={16} aria-hidden="true" fill="currentColor">
        {[2, 8, 14].flatMap((cy) => [<circle key={`a${cy}`} cx={2.5} cy={cy} r={1.5} />, <circle key={`b${cy}`} cx={7.5} cy={cy} r={1.5} />])}
      </svg>
    </button>
  );
}

const W = 320;
const H = 96;
const PAD = { l: 4, r: 4, t: 14, b: 18 };

function format(n: number, digits: number, t: Messages): string {
  return digits > 0 ? n.toLocaleString(t.locale, { maximumFractionDigits: digits }) : thousands(n, t);
}

/** One measure over the weeks: a line (or bars), the person's own target dashed behind it. Tap (or arrow keys) to read a week. */
function Chart({ metric, weeks, t, details, hint, grip, arranging = false }: { metric: Metric; weeks: WeekPoint[]; t: Messages; details?: (week: WeekPoint) => ReactNode; hint?: string; grip?: Grip; arranging?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const points = weeks.map((w, i) => ({ i, w, v: metric.food && w.food_days === 0 ? null : metric.value(w), target: metric.target?.(w) ?? null }));
  const values = points.flatMap((p) => (p.v === null ? [] : [p.v]));
  const targets = points.flatMap((p) => (p.target === null ? [] : [p.target]));
  const all = [...values, ...targets];
  if (values.length === 0) return null;
  const lo = metric.bars ? 0 : Math.min(...all);
  const hi = Math.max(...all, lo + 1);
  const span = hi - lo;
  const min = metric.bars ? 0 : Math.max(0, lo - span * 0.15);
  const max = hi + span * 0.15;
  const n = weeks.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD.l + (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
  const shown = points.filter((p): p is typeof p & { v: number } => p.v !== null);
  const last = shown[shown.length - 1];
  const targetPts = points.filter((p): p is typeof p & { target: number } => p.target !== null);
  const latestTarget = targetPts[targetPts.length - 1]?.target ?? null;
  const ticks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const summary = `${metric.name(t)}: ${shown.map((p) => `${shortDate(p.w.week_start, t)} ${format(p.v, metric.digits, t)}`).join(", ")}`;
  const barW = Math.max(4, Math.min(26, ((W - PAD.l - PAD.r) / n) * 0.6));
  const picked = selected === null ? null : (shown.find((p) => p.i === selected) ?? null);

  /** The week nearest a tap, among those with a value. */
  const nearest = (fraction: number) => {
    const at = fraction * W;
    return shown.reduce((best, p) => (Math.abs(x(p.i) - at) < Math.abs(x(best.i) - at) ? p : best), shown[0]);
  };
  // Tapping the marked week again closes it, and with it a bar's breakdown.
  const choose = (p: (typeof shown)[number]) => setSelected(selected === p.i ? null : p.i);
  const step = (by: number) => {
    const at = picked ? shown.indexOf(picked) : shown.length;
    const next = shown[Math.max(0, Math.min(shown.length - 1, at + by))];
    setSelected(next.i);
  };

  return (
    <section aria-label={metric.name(t)} className={`raised rounded-3xl px-3 pb-2 pt-3 ${grip ? "" : "mt-4"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Well tint={metric.tint} icon={metric.icon} />
          <div>
            <p className="text-sm font-semibold">{metric.name(t)}</p>
            <p className="text-xs text-muted">{metric.unit(t)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <p className="text-lg font-semibold">{format(last.v, metric.digits, t)}</p>
          {grip && arranging && <GripButton grip={grip} label={t.insights.trends.move(metric.name(t))} />}
        </div>
      </div>
      <div className="relative">
        {picked && !(metric.bars && details) && (
          <div
            role="status"
            className="raised-sm pointer-events-none absolute -top-1 z-10 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-xs"
            style={{ left: `${(x(picked.i) / W) * 100}%`, transform: `translateX(${x(picked.i) < W * 0.25 ? "-10%" : x(picked.i) > W * 0.75 ? "-90%" : "-50%"})` }}
          >
            <span className="block font-semibold">{t.insights.trends.weekOf(shortDate(picked.w.week_start, t))}</span>
            <span className="block">
              <span className="text-sm font-semibold" style={{ color: metric.bars ? undefined : metric.colour }}>
                {format(picked.v, metric.bars ? 1 : metric.digits, t)}
              </span>{" "}
              <span className="text-muted">{metric.unit(t)}</span>
            </span>
            {picked.target !== null && <span className="block text-muted">{t.insights.trends.target(format(picked.target, metric.digits, t))}</span>}
          </div>
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-1 block h-auto w-full cursor-pointer touch-manipulation overflow-visible outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-accent"
          role="img"
          aria-label={summary}
          tabIndex={0}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            if (box.width > 0) choose(nearest((event.clientX - box.left) / box.width));
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") step(-1);
            else if (event.key === "ArrowRight") step(1);
            else if ((event.key === "Enter" || event.key === " ") && picked) setSelected(null);
            else if (event.key === "Escape") setSelected(null);
            else return;
            event.preventDefault();
          }}
        >
          {picked && <line x1={x(picked.i)} x2={x(picked.i)} y1={PAD.t - 6} y2={H - PAD.b} stroke="var(--nm-muted)" strokeWidth={1} opacity={0.5} />}
          {targetPts.length > 0 && (
            <>
              <polyline points={targetPts.map((p) => `${x(p.i)},${y(p.target)}`).join(" ")} fill="none" stroke="var(--nm-muted)" strokeWidth={1.2} strokeDasharray="3 4" />
              {latestTarget !== null && !picked && (
                <text x={W - PAD.r} y={y(latestTarget) - 4} textAnchor="end" fontSize={10} fill="var(--nm-muted)">
                  {t.insights.trends.target(format(latestTarget, metric.digits, t))}
                </text>
              )}
            </>
          )}
          {metric.bars ? (
            shown.map((p) => (
              <g key={p.i}>
                <rect
                  x={x(p.i) - barW / 2}
                  y={y(p.v)}
                  width={barW}
                  height={Math.max(0, y(0) - y(p.v))}
                  rx={Math.min(7, barW / 2)}
                  fill={metric.colour}
                  opacity={picked ? (p === picked ? 1 : 0.35) : p === last ? 1 : 0.45}
                />
                {n <= 12 && !picked && (
                  <text x={x(p.i)} y={y(p.v) - 3} textAnchor="middle" fontSize={10} fill="var(--nm-muted)">
                    {format(p.v, 1, t)}
                  </text>
                )}
              </g>
            ))
          ) : (
            <>
              <polyline points={shown.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} fill="none" stroke={metric.colour} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              {shown.map((p) =>
                p === picked || (!picked && p === last) ? (
                  <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={4.5} fill={metric.colour} stroke="var(--nm-base)" strokeWidth={1.5} />
                ) : n <= 26 ? (
                  <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={2.6} fill="var(--nm-base)" stroke={metric.colour} strokeWidth={2} />
                ) : null,
              )}
            </>
          )}
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={H - 3} fontSize={10} fill="var(--nm-muted)" textAnchor={n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
              {shortDate(weeks[i].week_start, t)}
            </text>
          ))}
        </svg>
      </div>
      {picked && details ? details(picked.w) : hint && <p className="mt-1 text-center text-[11px] text-muted">{hint}</p>}
    </section>
  );
}

/** The training behind one week's bar, opened under the chart like Today's fats and sugar rows: a table of activities. */
function TrainingTable({ week }: { week: WeekPoint }) {
  const t = useT();
  const b = t.insights.trends.breakdown;
  const top = Math.max(1, ...week.by_activity.map((a) => a.kcal));
  const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);
  return (
    <div className="pressed mt-2 rounded-2xl px-3 py-2.5" aria-live="polite">
      <p className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{t.insights.trends.weekOf(shortDate(week.week_start, t))}</span>
        <span className="text-xs tabular-nums text-muted">
          {thousands(week.active_kcal, t)} {t.units.kcal} · {hours(week.minutes)}
        </span>
      </p>
      {week.by_activity.length === 0 ? (
        <p className="mt-2 border-t border-(--nm-lo) pt-2 text-xs text-muted">{b.none}</p>
      ) : (
        <table className="mt-2 w-full border-t border-(--nm-lo) text-xs">
          <caption className="sr-only">{`${b.title} · ${t.insights.trends.weekOf(shortDate(week.week_start, t))}`}</caption>
          <thead>
            <tr className="text-[0.6875rem] text-muted">
              <th scope="col" className="pt-2 text-left font-semibold">{b.byActivity}</th>
              <th scope="col" className="pt-2 text-right font-semibold">{b.sessions}</th>
              <th scope="col" className="pt-2 text-right font-semibold">{b.time}</th>
              <th scope="col" className="pt-2 text-right font-semibold">{t.units.kcal}</th>
            </tr>
          </thead>
          <tbody>
            {week.by_activity.map((a) => (
              <tr key={a.activity}>
                <th scope="row" className="py-1 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <SportBadge activity={a.activity} size={22} labelled={false} />
                    <span className="min-w-0">
                      <span className="block truncate">{sportName(a.activity, t).label}</span>
                      <span aria-hidden="true" className="mt-0.5 block h-1 rounded-full" style={{ width: `${Math.max(6, (a.kcal / top) * 100)}%`, backgroundColor: "#f08a4b" }} />
                    </span>
                  </span>
                </th>
                <td className="py-1 text-right tabular-nums">{a.sessions}×</td>
                <td className="py-1 text-right tabular-nums text-muted">{hours(a.minutes)}</td>
                <td className="py-1 text-right font-medium tabular-nums">{thousands(a.kcal, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The week's wins: a ring filled by the share of findings going well, the count of them inside. One calm colour, never red. */
function WinsRing({ report, size = 30, count = true }: { report: InsightSummary; size?: number; count?: boolean }) {
  const total = report.tally.good + report.tally.watch + report.tally.act;
  const share = total > 0 ? report.tally.good / total : 0;
  const stroke = size >= 24 ? 3.5 : 2.5;
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--nm-lo)" strokeOpacity={0.55} strokeWidth={stroke} />
        {share > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--nm-accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${share * length} ${length}`}
          />
        )}
      </svg>
      {count && <span className="absolute text-[11px] font-bold tabular-nums text-accent-ink">{report.tally.good}</span>}
    </span>
  );
}

/** The day alone, with the month on the first week and wherever the month changes: "1 Sept", "8", "15", "6 Oct". */
function glanceLabel(date: string, before: string | null, t: Messages): string {
  if (before !== null && before.slice(0, 7) === date.slice(0, 7)) return String(Number(date.slice(8)));
  return shortDate(date, t);
}

function tallyText(report: InsightSummary, t: Messages): string {
  return (["good", "watch", "act"] as const)
    .filter((level) => report.tally[level] > 0)
    .map((level) => t.insights.tally[level](report.tally[level]))
    .join(", ");
}

export function InsightsTrends({ history, current, onOpen }: { history: InsightsHistory; current: string | null; onOpen: (week: string) => void }) {
  const t = useT();
  const [range, setRange] = useState<Range>("8");
  const [extra, setExtra] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>(savedOrder);
  // The grips show only while arranging (2026-11-03 design review): six of them on every visit were noise.
  const [arranging, setArranging] = useState(false);
  const weeks = range === "all" ? history.weeks : history.weeks.slice(-Number(range));
  const glance = history.reports.slice(0, 8).reverse();
  const latest = history.reports[0]?.week_start;
  const more = MORE.find((m) => m.id === extra);

  return (
    <>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{t.insights.trends.averages(weeks.length)}</span>
        <div role="radiogroup" aria-label={t.insights.tabs.trends} className="pressed flex gap-0.5 rounded-full p-0.5">
          {(["8", "26", "all"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              onClick={() => setRange(r)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${range === r ? "well-tint tint-green" : "text-muted"}`}
            >
              {t.insights.trends.range[r]}
            </button>
          ))}
        </div>
      </div>

      {glance.length > 0 && (
        <section aria-label={t.insights.trends.glance} className="raised mt-4 rounded-3xl p-3">
          <h2 className="text-sm font-semibold text-muted">{t.insights.trends.glance}</h2>
          <ul className="mt-2.5 flex gap-1.5">
            {glance.map((r, i) => (
              <li key={r.week_start} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpen(r.week_start)}
                  aria-label={`${shortDate(r.period_start, t)} – ${shortDate(r.period_end, t)}: ${tallyText(r, t)}`}
                  className={`tap flex w-full items-center justify-center rounded-[10px] py-1.5 ${r.week_start === current ? "well-tint tint-green" : "raised-sm"}`}
                >
                  <WinsRing report={r} />
                </button>
                <span aria-hidden="true" className="mt-1 block whitespace-nowrap text-center text-[10px] text-muted">
                  {glanceLabel(r.period_start, i > 0 ? glance[i - 1].period_start : null, t)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t.insights.trends.openWeek}</p>
        </section>
      )}

      {weeks.length === 0 ? (
        <p className="mt-4 px-1 text-sm text-muted">{t.insights.trends.empty}</p>
      ) : weeks.length === 1 ? (
        // One week is one dot per chart (2026-11-03 design review): a line of text says when the lines begin instead.
        <p className="mt-4 px-1 text-sm text-muted">{t.insights.trends.oneWeek}</p>
      ) : (
        <>
          <p className="mt-3 flex items-center justify-between gap-2 px-1 text-xs text-muted">
            {t.insights.trends.tapChart}
            <button type="button" aria-pressed={arranging} onClick={() => setArranging((on) => !on)} className="min-h-9 shrink-0 px-1 text-xs font-semibold text-accent-ink">
              {arranging ? t.insights.trends.arrangeDone : t.insights.trends.arrange}
            </button>
          </p>
          <Reorderable
            ids={order}
            onReorder={(next) => {
              setOrder(next);
              saveOrder(next);
            }}
          >
            {(id, grip) => {
              const metric = MAIN.find((m) => m.id === id) as Metric;
              return (
                <Chart
                  metric={metric}
                  weeks={weeks}
                  t={t}
                  grip={grip}
                  arranging={arranging}
                  details={metric.bars ? (week) => <TrainingTable week={week} /> : undefined}
                  hint={metric.bars ? t.insights.trends.tapBar : undefined}
                />
              );
            }}
          </Reorderable>
          {more && <Chart metric={more} weeks={weeks} t={t} />}
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted">{t.insights.trends.more}</span>
            {MORE.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={extra === m.id}
                onClick={() => setExtra(extra === m.id ? null : m.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${extra === m.id ? `well-tint ${m.tint}` : "raised-sm tap"}`}
              >
                {m.name(t)}
              </button>
            ))}
          </div>
        </>
      )}

      {history.reports.length > 0 && (
        <section aria-label={t.insights.trends.past} className="mt-6">
          <h2 className="px-1 text-sm font-semibold text-muted">{t.insights.trends.past}</h2>
          <ul className="mt-1 flex flex-col gap-2.5">
            {history.reports.map((r) => {
              const isLatest = r.week_start === latest;
              const day = new Intl.DateTimeFormat(t.locale, { day: "numeric", timeZone: "UTC" }).format(new Date(`${r.period_start}T00:00:00Z`));
              const month = new Intl.DateTimeFormat(t.locale, { month: "short", timeZone: "UTC" }).format(new Date(`${r.period_start}T00:00:00Z`));
              return (
                <li key={r.week_start} className="mt-1">
                  <button
                    type="button"
                    onClick={() => onOpen(r.week_start)}
                    className={`tap flex w-full items-center gap-2.5 rounded-2xl p-2.5 text-left ${isLatest ? "raised-tint tint-green" : "raised-sm"}`}
                  >
                    <span aria-hidden="true" className={`well-tint ${isLatest ? "tint-green" : "tint-slate"} flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl font-bold leading-none`}>
                      {day}
                      <small className="mt-0.5 text-[10px] font-semibold">{month}</small>
                    </span>
                    <span className="min-w-0 flex-1">
                      {isLatest && <span className="block text-xs font-bold text-accent-ink">{t.insights.trends.latest}</span>}
                      <span className="sr-only">
                        {shortDate(r.period_start, t)} – {shortDate(r.period_end, t)}:{" "}
                      </span>
                      <span className="block truncate text-sm font-medium">{r.headline}</span>
                      <span className="mt-1 flex items-center gap-1">
                        <WinsRing report={r} size={16} count={false} />
                        <span className="ml-1 truncate text-xs text-muted">{tallyText(r, t)}</span>
                      </span>
                    </span>
                    <Icon name="chevron_right" size={18} className="shrink-0 text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-center text-xs text-muted">{t.insights.trends.kept}</p>
        </section>
      )}
    </>
  );
}
