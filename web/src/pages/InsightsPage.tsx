import { useState } from "react";
import type { ReactNode } from "react";
import { ApiError } from "../api.ts";
import { SetupPrompt } from "../components/SetupPrompt.tsx";
import { SportBadge, sportName } from "../components/SportBadge.tsx";
import { dayAndMonth, kcal10, thousands } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import { useInsightReport, useInsights, useInsightsHistory } from "../queries.ts";
import type { FindingSeverity, InsightFinding, InsightGoal, InsightGoalKind, InsightPayload, InsightReport, InsightStats, NutrientStat, RecoveryStatus, WeekPoint } from "../shared.ts";
import { InsightsTrends } from "./InsightsTrends.tsx";

// The weekly analysis (2026-10-06 design §3.4), with colour and icons and every past week kept (2026-11-01 insights
// history design). Severity always travels with its word or its own icon: the colour repeats it, never carries it alone.

export const SEVERITY_FILL: Record<FindingSeverity, string> = { good: "bg-good", watch: "bg-watch", act: "bg-act" };
/** Each severity's hue and icon, for its wells and chips. */
export const SEVERITY_TINT: Record<FindingSeverity, { tint: string; icon: IconName }> = {
  good: { tint: "tint-green", icon: "check" },
  watch: { tint: "tint-amber", icon: "info" },
  act: { tint: "tint-rose", icon: "warning" },
};
const RECOVERY_LEVEL: Record<RecoveryStatus, FindingSeverity> = { fresh: "good", balanced: "good", fatigued: "watch", overreaching: "act" };

type NutrientKey = keyof InsightStats["nutrients"];
/** How each nutrient is judged against its number: a target to meet, a band around it, or a limit to stay under. */
const NUTRIENTS: { key: NutrientKey; unit: "kcal" | "g" | "ml"; judge: "near" | "band" | "goal" | "limit" | "drink"; dot: string }[] = [
  { key: "kcal", unit: "kcal", judge: "near", dot: "bg-accent" },
  { key: "protein_g", unit: "g", judge: "goal", dot: "bg-protein" },
  { key: "carbs_g", unit: "g", judge: "band", dot: "bg-carbs" },
  { key: "fat_g", unit: "g", judge: "band", dot: "bg-fat" },
  { key: "fibre_g", unit: "g", judge: "goal", dot: "bg-fibre" },
  { key: "saturated_fat_g", unit: "g", judge: "limit", dot: "bg-fat-sat" },
  { key: "sugars_g", unit: "g", judge: "limit", dot: "bg-carbs" },
  { key: "salt_g", unit: "g", judge: "limit", dot: "bg-muted" },
  { key: "fluid_ml", unit: "ml", judge: "drink", dot: "bg-protein" },
];

export function nutrientLevel(stat: NutrientStat, judge: (typeof NUTRIENTS)[number]["judge"]): FindingSeverity {
  if (stat.target === null || stat.target <= 0) return "good";
  const ratio = stat.average / stat.target;
  const off = Math.abs(ratio - 1);
  switch (judge) {
    case "near":
      return off <= 0.1 ? "good" : off <= 0.2 ? "watch" : "act";
    case "band":
      return off <= 0.2 ? "good" : off <= 0.35 ? "watch" : "act";
    case "goal":
      return ratio >= 0.9 ? "good" : ratio >= 0.7 ? "watch" : "act";
    case "limit":
      return ratio <= 1 ? "good" : ratio <= 1.2 ? "watch" : "act";
    case "drink":
      // Water is often not logged: a low figure is a reminder, never an alarm.
      return ratio >= 0.8 ? "good" : "watch";
  }
}

export function loadWord(ratio: number | null, t: Messages): string {
  if (ratio === null) return t.insights.load.none;
  if (ratio < 0.8) return t.insights.load.easing;
  if (ratio <= 1.3) return t.insights.load.steady;
  if (ratio <= 1.5) return t.insights.load.rising;
  return t.insights.load.sharp;
}

/** "27 Oct" in the app's language. */
export function shortDate(date: string, t: Messages): string {
  return new Intl.DateTimeFormat(t.locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** A small hued well holding an icon: the touch of colour on each card. */
export function Well({ tint, icon, size = 28, iconSize = 16 }: { tint: string; icon: IconName; size?: number; iconSize?: number }) {
  return (
    <span aria-hidden="true" className={`well-tint ${tint} inline-flex shrink-0 items-center justify-center rounded-[10px]`} style={{ width: size, height: size }}>
      <Icon name={icon} size={iconSize} />
    </span>
  );
}

function SeverityLabel({ level }: { level: FindingSeverity }) {
  const t = useT();
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${SEVERITY_FILL[level]}`} />
      {t.insights.severity[level]}
    </span>
  );
}

/** A change on the week before, in grey: the number's own colour already says whether it is good. */
function Delta({ change, digits = 0 }: { change: number | null; digits?: number }) {
  const t = useT();
  if (change === null) return null;
  const rounded = Number(change.toFixed(digits));
  if (rounded === 0) return null;
  const shown = Math.abs(rounded).toLocaleString(t.locale, { maximumFractionDigits: digits });
  return (
    <span className="text-[11px] font-semibold text-muted" title={t.insights.vsBefore}>
      <span aria-hidden="true">{rounded > 0 ? "▲" : "▼"}</span> {shown}
      <span className="sr-only">
        {" "}
        {rounded > 0 ? "+" : "−"}
        {shown} {t.insights.vsBefore}
      </span>
    </span>
  );
}

function Tile({ tint, icon, label, value, note, change }: { tint: string; icon: IconName; label: string; value: string; note: string; change: ReactNode }) {
  return (
    <div className="raised-sm rounded-2xl p-3">
      <p className="flex items-center gap-2 text-xs text-muted">
        <Well tint={tint} icon={icon} size={26} iconSize={15} />
        {label}
      </p>
      <p className="mt-1.5 text-xl font-semibold">{value}</p>
      <p className="flex items-baseline justify-between gap-2 text-xs text-muted">
        <span>{note}</span>
        {change}
      </p>
    </div>
  );
}

/** A nutrient's daily average on a track that runs to 150 % of its number, with a tick at the number itself. */
function Meter({ name, dot, stat, unit, level }: { name: string; dot: string; stat: NutrientStat; unit: string; level: FindingSeverity }) {
  const t = useT();
  const target = stat.target ?? 0;
  const share = target > 0 ? Math.min(stat.average / target, 1.5) / 1.5 : 0;
  // Grams of salt or fibre need their decimal; calories and millilitres don't.
  const shown = (n: number) => (n < 100 ? n.toLocaleString(t.locale, { maximumFractionDigits: 1 }) : thousands(n, t));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
          {name}
        </span>
        <span className="text-xs text-muted">
          {shown(stat.average)} / {shown(unit === "kcal" ? kcal10(target) : target)} {unit}
        </span>
      </div>
      <div className="relative mt-1">
        <div
          role="meter"
          aria-label={name}
          aria-valuenow={Math.round(stat.average)}
          aria-valuemin={0}
          aria-valuemax={Math.round(target * 1.5)}
          aria-valuetext={`${shown(stat.average)} / ${shown(target)} ${unit}, ${t.insights.severity[level]}`}
          className="pressed h-2.5 rounded-full"
        >
          <div className={`h-2.5 rounded-full ${SEVERITY_FILL[level]}`} style={{ width: `${share * 100}%` }} />
        </div>
        <span aria-hidden="true" className="absolute -top-0.5 h-3.5 w-0.5 rounded-full bg-ink/60" style={{ left: `${(1 / 1.5) * 100}%` }} />
      </div>
    </div>
  );
}

function Finding({ finding }: { finding: InsightFinding }) {
  const t = useT();
  const { tint, icon } = SEVERITY_TINT[finding.severity];
  return (
    <li className="pressed flex gap-2.5 rounded-2xl p-3">
      <Well tint={tint} icon={icon} size={26} iconSize={15} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium">{finding.title}</p>
          <SeverityLabel level={finding.severity} />
        </div>
        <p className="mt-1 text-sm">{finding.detail}</p>
        {finding.foods.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">{t.insights.tryFoods}</span>
            {finding.foods.map((food) => (
              <span key={food} className={`well-tint ${tint} rounded-full px-2.5 py-1`}>
                {food}
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

/** Each goal's icon: what it is about, while its well's hue says how the week went. */
const GOAL_ICON: Record<InsightGoalKind, IconName> = {
  lose_fat: "monitoring", build_muscle: "fitness_center", stay_in_shape: "directions_run", skin: "sunny", bloods: "bloodtype",
  energy: "bolt", gut: "nutrition", event: "calendar_month", body_goal: "ecg_heart", health: "medical_information",
};

function Chips({ label, items, tint }: { label: string; items: string[]; tint: string }) {
  if (items.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">{label}</span>
      {items.map((item) => (
        <span key={item} className={`well-tint ${tint} rounded-full px-2.5 py-1`}>
          {item}
        </span>
      ))}
    </p>
  );
}

/** How the week went for each of the person's goals (2026-11-02 goals section): what helped, and what to do next. */
function Goal({ goal }: { goal: InsightGoal }) {
  const t = useT();
  const { tint } = SEVERITY_TINT[goal.status];
  return (
    <li className="pressed flex gap-2.5 rounded-2xl p-3">
      <Well tint={tint} icon={GOAL_ICON[goal.kind] ?? "star"} size={26} iconSize={15} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium">{goal.title}</p>
          <SeverityLabel level={goal.status} />
        </div>
        <p className="mt-1 text-sm">{goal.detail}</p>
        <Chips label={t.insights.helped} items={goal.helped} tint="tint-green" />
        <Chips label={t.insights.nextWeek} items={goal.next} tint="tint-custard" />
      </div>
    </li>
  );
}

function Section({ title, icon, tint, aside, children }: { title: string; icon: IconName; tint: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="raised mt-4 rounded-3xl p-4">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <Well tint={tint} icon={icon} />
        {title}
        {aside && <span className="ml-auto normal-case tracking-normal">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

function Tally({ report }: { report: InsightReport }) {
  const t = useT();
  const counts: Record<FindingSeverity, number> = { good: 0, watch: 0, act: 0 };
  for (const f of [...report.nutrition.findings, ...report.training.findings]) counts[f.severity]++;
  return (
    <p className="mt-3 flex flex-wrap gap-1.5">
      {(["good", "watch", "act"] as const)
        .filter((level) => counts[level] > 0)
        .map((level) => (
          <span key={level} className={`well-tint ${SEVERITY_TINT[level].tint} inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold`}>
            <Icon name={SEVERITY_TINT[level].icon} size={13} />
            {t.insights.tally[level](counts[level])}
          </span>
        ))}
    </p>
  );
}

function Numbers({ stats, previous }: { stats: InsightStats; previous: WeekPoint | null }) {
  const t = useT();
  const kcal = stats.nutrients.kcal;
  const fibre = stats.nutrients.fibre_g;
  const change = (now: number, before: number | undefined) => (previous && previous.food_days > 0 && stats.food_days > 0 && before !== undefined ? now - before : null);
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <Tile
        tint="tint-green"
        icon="restaurant"
        label={t.insights.calories}
        value={thousands(kcal.average, t)}
        note={kcal.target !== null ? t.insights.of(`${thousands(kcal10(kcal.target), t)} ${t.units.kcal}`) : t.insights.perDay}
        change={<Delta change={change(kcal.average, previous?.kcal)} />}
      />
      <Tile
        tint="tint-blue"
        icon="fitness_center"
        label={t.insights.protein}
        value={stats.protein_g_per_kg.toLocaleString(t.locale)}
        note={t.insights.perKg}
        change={<Delta change={change(stats.protein_g_per_kg, previous?.protein_g_per_kg)} digits={1} />}
      />
      <Tile
        tint="tint-teal"
        icon="nutrition"
        label={t.insights.fibre}
        value={`${Math.round(fibre.average)} ${t.units.g}`}
        note={fibre.target !== null ? t.insights.of(`${Math.round(fibre.target)} ${t.units.g}`) : t.insights.perDay}
        change={<Delta change={change(fibre.average, previous?.fibre_g)} />}
      />
      <Tile
        tint="tint-orange"
        icon="directions_run"
        label={t.insights.trainingTile}
        value={stats.training.sessions_per_week.toLocaleString(t.locale)}
        note={t.insights.sessionsWeek}
        change={<Delta change={previous ? stats.training.sessions_per_week - previous.sessions : null} digits={1} />}
      />
    </div>
  );
}

/** The week's days, lit where there was training: only for one-week reports, which list their training dates. */
function TrainingDays({ stats }: { stats: InsightStats }) {
  const t = useT();
  const dates = stats.training.dates;
  if (!dates) return null;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${stats.period_start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  if (days[6] !== stats.period_end) return null;
  const weekday = new Intl.DateTimeFormat(t.locale, { weekday: "narrow", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(t.locale, { weekday: "long", timeZone: "UTC" });
  return (
    <ul aria-label={t.insights.trainingDays} className="mt-3 flex gap-1.5">
      {days.map((day) => {
        const trained = dates.includes(day);
        const date = new Date(`${day}T00:00:00Z`);
        return (
          <li key={day} className="flex-1 text-center text-[10px] text-muted" aria-label={`${long.format(date)}${trained ? " ✓" : ""}`}>
            <span aria-hidden="true" className={`mb-1 block h-4 rounded-md ${trained ? "raised-sm" : "pressed"}`} style={trained ? { backgroundColor: "#f08a4b" } : undefined} />
            <span aria-hidden="true">{weekday.format(date)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function FiveADay({ stats }: { stats: InsightStats }) {
  const t = useT();
  const portions = (stats.food_groups.vegetables ?? 0) + (stats.food_groups.fruit ?? 0) + Math.min(stats.food_groups.legumes ?? 0, 1);
  const shown = portions.toLocaleString(t.locale, { maximumFractionDigits: 1 });
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-sm" aria-label={`${t.insights.fruitVeg}: ${shown}, ${t.insights.aimFive}`} role="group">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-fibre" />
        {t.insights.fruitVeg}
      </span>
      <span className="flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => {
          const fill = Math.max(0, Math.min(1, portions - i));
          return (
            <span key={i} className="pressed relative h-3 w-3 overflow-hidden rounded-full">
              <span className="absolute inset-y-0 left-0 bg-fibre" style={{ width: `${fill * 100}%` }} />
            </span>
          );
        })}
        <span className="ml-1 text-xs text-muted">{shown} / 5</span>
      </span>
    </div>
  );
}

function Report({ report, stats, previous }: { report: InsightReport | null; stats: InsightStats; previous: WeekPoint | null }) {
  const t = useT();
  return (
    <>
      {report && (
        <section className="raised-tint tint-custard mt-4 rounded-3xl p-4">
          <div className="flex items-start gap-3">
            <Well tint="tint-custard" icon="lightbulb" size={38} iconSize={22} />
            <p className="text-lg font-semibold leading-snug">{report.headline}</p>
          </div>
          <Tally report={report} />
        </section>
      )}
      <Numbers stats={stats} previous={previous} />
      {report?.goals && report.goals.length > 0 && (
        <Section title={t.insights.goals} icon="star" tint="tint-custard">
          <ul className="mt-3 flex flex-col gap-2.5">
            {report.goals.map((goal) => (
              <Goal key={`${goal.kind}-${goal.title}`} goal={goal} />
            ))}
          </ul>
        </Section>
      )}
      <Section title={t.insights.nutrition} icon="restaurant" tint="tint-amber">
        {report && <p className="mt-3 text-sm">{report.nutrition.summary}</p>}
        <div className="mt-3 grid gap-2.5">
          {NUTRIENTS.filter(({ key }) => stats.nutrients[key].target !== null).map(({ key, unit, judge, dot }) => {
            const stat = stats.nutrients[key];
            const name = judge === "limit" ? t.insights.limit(t.insights.nutrients[key]) : t.insights.nutrients[key];
            return <Meter key={key} name={name} dot={dot} stat={stat} unit={unit === "kcal" ? t.units.kcal : unit === "g" ? t.units.g : "ml"} level={nutrientLevel(stat, judge)} />;
          })}
        </div>
        <FiveADay stats={stats} />
        {report && (
          <ul className="mt-4 flex flex-col gap-2.5">
            {report.nutrition.findings.map((finding) => (
              <Finding key={finding.title} finding={finding} />
            ))}
          </ul>
        )}
      </Section>
      <Section
        title={t.insights.training}
        icon="fitness_center"
        tint="tint-orange"
        aside={
          <span className="text-xs font-medium text-muted">
            {t.insights.loadTile}: {loadWord(stats.training.load_ratio, t)}
            {stats.training.load_ratio !== null && ` · ${stats.training.load_ratio.toLocaleString(t.locale)}×`}
          </span>
        }
      >
        {report && <p className="mt-3 text-sm">{report.training.summary}</p>}
        <TrainingDays stats={stats} />
        {stats.training.by_activity.length > 0 && (
          <ul aria-label={t.insights.byActivity} className="mt-3 flex flex-wrap gap-3">
            {stats.training.by_activity.map((a) => (
              <li key={a.activity} className="flex items-center gap-2 text-sm">
                <SportBadge activity={a.activity} size={30} labelled={false} />
                <span>
                  {sportName(a.activity, t).label}
                  <span className="block text-xs text-muted">
                    {a.sessions}× · {a.minutes} min
                  </span>
                </span>
              </li>
            ))}
            <li className="flex items-center gap-2 text-sm">
              <Well tint="tint-amber" icon="sunny" size={30} iconSize={17} />
              <span>
                {thousands(stats.training.active_kcal_per_week, t)} {t.units.kcal}
                <span className="block text-xs text-muted">{t.insights.activeTile}</span>
              </span>
            </li>
          </ul>
        )}
        {report && (
          <ul className="mt-4 flex flex-col gap-2.5">
            {report.training.findings.map((finding) => (
              <Finding key={finding.title} finding={finding} />
            ))}
          </ul>
        )}
      </Section>
      {report && (
        <>
          <Section title={t.insights.recovery} icon="bedtime" tint="tint-violet">
            <div className="mt-3">
              <span className={`well-tint ${SEVERITY_TINT[RECOVERY_LEVEL[report.recovery.status]].tint} inline-flex rounded-full px-3 py-1 text-sm font-semibold`}>
                {t.insights.status[report.recovery.status]}
              </span>
              <p className="mt-2 text-sm">{report.recovery.detail}</p>
            </div>
          </Section>
          <Section title={t.insights.focus} icon="lightbulb" tint="tint-custard">
            <ol className="mt-3 flex flex-col gap-2 text-sm">
              {report.focus.map((item, i) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="well-tint tint-custard flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                    {i + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}
      <p className="mt-4 px-2 text-center text-xs text-muted">{t.insights.disclaimer}</p>
    </>
  );
}

function RoundButton({ icon, label, onClick, disabled }: { icon: IconName; label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="raised-sm tap flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-35">
      <Icon name={icon} size={18} />
    </button>
  );
}

/** The report's week, and arrows to step through the stored ones. */
function WeekStepper({ payload, weeks, onPick, nextUpdate }: { payload: InsightPayload; weeks: string[]; onPick: (week: string) => void; nextUpdate: string | null }) {
  const t = useT();
  const at = weeks.indexOf(payload.week_start);
  const earlier = at >= 0 && at + 1 < weeks.length ? weeks[at + 1] : null;
  const later = at > 0 ? weeks[at - 1] : null;
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <RoundButton icon="chevron_left" label={t.insights.earlier} onClick={() => earlier && onPick(earlier)} disabled={!earlier} />
        <span className="text-sm font-semibold">
          {shortDate(payload.stats.period_start, t)} – {shortDate(payload.stats.period_end, t)}
        </span>
        <RoundButton icon="chevron_right" label={t.insights.later} onClick={() => later && onPick(later)} disabled={!later} />
      </div>
      {nextUpdate && <span className="text-xs text-muted">{t.insights.nextReport(dayAndMonth(nextUpdate, t))}</span>}
    </div>
  );
}

function Tabs({ tab, onTab }: { tab: "week" | "trends"; onTab: (tab: "week" | "trends") => void }) {
  const t = useT();
  const item = (id: "week" | "trends", icon: IconName, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => onTab(id)}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${tab === id ? "well-tint tint-green" : "text-muted"}`}
    >
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label={t.insights.tabs.label} className="pressed flex gap-1 rounded-full p-1">
      {item("week", "calendar_month", t.insights.tabs.week)}
      {item("trends", "monitoring", t.insights.tabs.trends)}
    </div>
  );
}

export function InsightsPage() {
  const t = useT();
  const insights = useInsights();
  const [tab, setTab] = useState<"week" | "trends">("week");
  const [picked, setPicked] = useState<string | null>(null);
  const view = insights.data;
  const latest = view?.insight ?? null;
  const hasReports = view !== undefined && view.status !== "collecting" && latest !== null;
  const history = useInsightsHistory(hasReports ? (latest?.generated_at ?? null) : null);
  const past = useInsightReport(picked !== null && picked !== latest?.week_start ? picked : null);
  if (insights.error instanceof ApiError && insights.error.code === "no_profile") return <SetupPrompt />;

  const reportWeeks = history.data?.reports.map((r) => r.week_start) ?? [];
  // Older reports come from the list; the newest is the one the tab already has (it may be the numbers alone).
  const shown: InsightPayload | null = picked !== null && picked !== latest?.week_start ? (past.data ?? null) : latest;
  const isPast = picked !== null && picked !== latest?.week_start;
  const open = (week: string) => {
    setPicked(week === latest?.week_start ? null : week);
    setTab("week");
    window.scrollTo?.({ top: 0 });
  };

  return (
    <main className="mx-auto max-w-xl px-4 pb-28 pt-[calc(env(safe-area-inset-top)_+_1rem)]">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t.insights.title}</h1>
        {hasReports && (
          <Tabs
            tab={tab}
            onTab={(next) => {
              setTab(next);
              window.scrollTo?.({ top: 0 });
            }}
          />
        )}
      </div>
      {!view ? (
        <p className={`mt-4 text-sm ${insights.isError ? "text-danger" : "text-muted"}`} role={insights.isError ? "alert" : undefined}>
          {insights.isError ? t.insights.loadFailed : t.common.loading}
        </p>
      ) : view.status === "collecting" ? (
        <section className="raised mt-4 rounded-3xl p-4">
          <p className="flex items-center gap-2 font-medium">
            <Well tint="tint-green" icon="monitoring" />
            {t.insights.collectingTitle}
          </p>
          <p className="mt-1 text-sm text-muted">{t.insights.collecting(view.required_days)}</p>
          <Progress value={view.data_days} max={view.required_days} />
        </section>
      ) : tab === "trends" && history.data ? (
        <InsightsTrends history={history.data} current={shown?.week_start ?? null} onOpen={open} />
      ) : (
        <>
          {view.status === "pending" && !isPast && (
            <p role="status" className="raised-sm mt-3 flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm">
              <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none" />
              {latest ? t.insights.updating : t.insights.pendingFirst}
            </p>
          )}
          {view.status === "off" && !isPast && <p className="raised-sm mt-3 rounded-2xl px-3 py-2.5 text-sm">{t.insights.off}</p>}
          {shown && <WeekStepper payload={shown} weeks={reportWeeks} onPick={open} nextUpdate={isPast ? null : view.next_update} />}
          {isPast && (
            <p className="mt-3 flex items-center justify-between gap-2">
              <span className="well-tint tint-slate rounded-full px-2.5 py-1 text-xs font-semibold">{t.insights.pastReport}</span>
              <button type="button" onClick={() => setPicked(null)} className="text-xs font-semibold text-accent-ink">
                {t.insights.backToLatest}
              </button>
            </p>
          )}
          {isPast && !past.data && <p className="mt-4 text-sm text-muted">{past.isError ? t.insights.loadFailed : t.common.loading}</p>}
          {shown && <Report report={shown.report} stats={shown.stats} previous={shown.previous} />}
        </>
      )}
    </main>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const t = useT();
  const share = Math.min(1, value / max);
  return (
    <div className="mt-3 flex items-center gap-3">
      <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-valuetext={t.insights.progress(value, max)} className="pressed h-2.5 flex-1 rounded-full">
        <div className="h-2.5 rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>
      <span className="shrink-0 text-sm tabular-nums text-muted">{t.insights.progress(value, max)}</span>
    </div>
  );
}
