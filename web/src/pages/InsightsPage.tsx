import type { ReactNode } from "react";
import { ApiError } from "../api.ts";
import { SetupPrompt } from "../components/SetupPrompt.tsx";
import { SportBadge, sportName } from "../components/SportBadge.tsx";
import { dayAndMonth, kcal10, thousands } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import { useInsights } from "../queries.ts";
import type { FindingSeverity, InsightFinding, InsightReport, InsightStats, NutrientStat, RecoveryStatus } from "../shared.ts";
import { Progress } from "./RegularsPage.tsx";

// The weekly analysis (2026-10-06 design §3.4). Severity always travels with its word: the colour repeats it, never
// carries it alone (dataviz: status colours ship with a label). Text stays in the ink tokens.

const SEVERITY_FILL: Record<FindingSeverity, string> = { good: "bg-good", watch: "bg-watch", act: "bg-act" };
const RECOVERY_LEVEL: Record<RecoveryStatus, FindingSeverity> = { fresh: "good", balanced: "good", fatigued: "watch", overreaching: "act" };

type NutrientKey = keyof InsightStats["nutrients"];
/** How each nutrient is judged against its number: a target to meet, a band around it, or a limit to stay under. */
const NUTRIENTS: { key: NutrientKey; unit: "kcal" | "g" | "ml"; judge: "near" | "band" | "goal" | "limit" | "drink" }[] = [
  { key: "kcal", unit: "kcal", judge: "near" },
  { key: "protein_g", unit: "g", judge: "goal" },
  { key: "carbs_g", unit: "g", judge: "band" },
  { key: "fat_g", unit: "g", judge: "band" },
  { key: "fibre_g", unit: "g", judge: "goal" },
  { key: "saturated_fat_g", unit: "g", judge: "limit" },
  { key: "sugars_g", unit: "g", judge: "limit" },
  { key: "salt_g", unit: "g", judge: "limit" },
  { key: "fluid_ml", unit: "ml", judge: "drink" },
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

function SeverityLabel({ level }: { level: FindingSeverity }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${SEVERITY_FILL[level]}`} />
      {t.insights.severity[level]}
    </span>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="raised-sm rounded-2xl p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

/** A nutrient's daily average on a track that runs to 150 % of its number, with a tick at the number itself. */
function Meter({ name, stat, unit, level }: { name: string; stat: NutrientStat; unit: string; level: FindingSeverity }) {
  const t = useT();
  const target = stat.target ?? 0;
  const share = target > 0 ? Math.min(stat.average / target, 1.5) / 1.5 : 0;
  // Grams of salt or fibre need their decimal; calories and millilitres don't.
  const shown = (n: number) => (n < 100 ? n.toLocaleString(t.locale, { maximumFractionDigits: 1 }) : thousands(n, t));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{name}</span>
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
  return (
    <li className="pressed rounded-2xl p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{finding.title}</p>
        <SeverityLabel level={finding.severity} />
      </div>
      <p className="mt-1 text-sm">{finding.detail}</p>
      {finding.foods.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">{t.insights.tryFoods}</span>
          {finding.foods.map((food) => (
            <span key={food} className="raised-sm rounded-full px-2.5 py-1">
              {food}
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

function Section({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <section aria-label={title} className="raised mt-4 rounded-3xl p-4">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <Icon name={icon} size={16} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Numbers({ stats }: { stats: InsightStats }) {
  const t = useT();
  const fiveADay = (stats.food_groups.vegetables ?? 0) + (stats.food_groups.fruit ?? 0) + Math.min(stats.food_groups.legumes ?? 0, 1);
  const kcal = stats.nutrients.kcal;
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <Tile label={t.insights.calories} value={thousands(kcal.average, t)} note={kcal.target !== null ? t.insights.of(`${thousands(kcal10(kcal.target), t)} ${t.units.kcal}`) : t.insights.perDay} />
      <Tile label={t.insights.protein} value={stats.protein_g_per_kg.toLocaleString(t.locale)} note={t.insights.perKg} />
      <Tile
        label={t.insights.fibre}
        value={`${Math.round(stats.nutrients.fibre_g.average)} ${t.units.g}`}
        note={stats.nutrients.fibre_g.target !== null ? t.insights.of(`${Math.round(stats.nutrients.fibre_g.target)} ${t.units.g}`) : t.insights.perDay}
      />
      <Tile label={t.insights.fruitVeg} value={fiveADay.toLocaleString(t.locale, { maximumFractionDigits: 1 })} note={t.insights.aimFive} />
      <Tile label={t.insights.trainingTile} value={stats.training.sessions_per_week.toLocaleString(t.locale)} note={t.insights.sessionsWeek} />
      <Tile label={t.insights.activeTile} value={`${thousands(stats.training.active_kcal_per_week, t)} ${t.units.kcal}`} note={t.insights.perWeek} />
      <div className="col-span-2">
        <Tile
          label={t.insights.loadTile}
          value={loadWord(stats.training.load_ratio, t)}
          note={stats.training.load_ratio !== null ? `${stats.training.load_ratio.toLocaleString(t.locale)} ×` : "—"}
        />
      </div>
    </div>
  );
}

function Report({ report, stats }: { report: InsightReport | null; stats: InsightStats }) {
  const t = useT();
  return (
    <>
      {report && (
        <section className="raised mt-4 rounded-3xl p-4">
          <p className="text-lg font-semibold leading-snug">{report.headline}</p>
        </section>
      )}
      <Numbers stats={stats} />
      <Section title={t.insights.nutrition} icon="restaurant">
        {report && <p className="mt-2 text-sm">{report.nutrition.summary}</p>}
        <div className="mt-3 grid gap-2.5">
          {NUTRIENTS.filter(({ key }) => stats.nutrients[key].target !== null).map(({ key, unit, judge }) => {
            const stat = stats.nutrients[key];
            const name = judge === "limit" ? t.insights.limit(t.insights.nutrients[key]) : t.insights.nutrients[key];
            return <Meter key={key} name={name} stat={stat} unit={unit === "kcal" ? t.units.kcal : unit === "g" ? t.units.g : "ml"} level={nutrientLevel(stat, judge)} />;
          })}
        </div>
        {report && (
          <ul className="mt-4 flex flex-col gap-2.5">
            {report.nutrition.findings.map((finding) => (
              <Finding key={finding.title} finding={finding} />
            ))}
          </ul>
        )}
      </Section>
      <Section title={t.insights.training} icon="fitness_center">
        {report && <p className="mt-2 text-sm">{report.training.summary}</p>}
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
          <Section title={t.insights.recovery} icon="bedtime">
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 text-base font-semibold">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${SEVERITY_FILL[RECOVERY_LEVEL[report.recovery.status]]}`} />
                {t.insights.status[report.recovery.status]}
              </span>
              <p className="mt-1 text-sm">{report.recovery.detail}</p>
            </div>
          </Section>
          <Section title={t.insights.focus} icon="lightbulb">
            <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm">
              {report.focus.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </Section>
        </>
      )}
      <p className="mt-4 px-2 text-center text-xs text-muted">{t.insights.disclaimer}</p>
    </>
  );
}

export function InsightsPage() {
  const t = useT();
  const insights = useInsights();
  if (insights.error instanceof ApiError && insights.error.code === "no_profile") return <SetupPrompt />;
  const view = insights.data;
  return (
    <main className="mx-auto max-w-xl px-4 pb-28 pt-[calc(env(safe-area-inset-top)_+_1rem)]">
      <h1 className="text-xl font-semibold">{t.insights.title}</h1>
      {!view ? (
        <p className={`mt-4 text-sm ${insights.isError ? "text-danger" : "text-muted"}`} role={insights.isError ? "alert" : undefined}>
          {insights.isError ? t.insights.loadFailed : t.common.loading}
        </p>
      ) : view.status === "collecting" ? (
        <section className="raised mt-4 rounded-3xl p-4">
          <p className="flex items-center gap-2 font-medium">
            <Icon name="monitoring" size={20} className="text-accent-ink" />
            {t.insights.collectingTitle}
          </p>
          <p className="mt-1 text-sm text-muted">{t.insights.collecting(view.required_days)}</p>
          <Progress value={view.data_days} max={view.required_days} />
        </section>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            {view.insight && `${t.insights.week(dayAndMonth(view.insight.week_start, t))} · `}
            {t.insights.nextUpdate(dayAndMonth(view.next_update, t))}
          </p>
          {view.status === "pending" && (
            <p role="status" className="raised-sm mt-3 flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm">
              <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none" />
              {view.insight ? t.insights.updating : t.insights.pendingFirst}
            </p>
          )}
          {view.status === "off" && <p className="raised-sm mt-3 rounded-2xl px-3 py-2.5 text-sm">{t.insights.off}</p>}
          {view.insight && <Report report={view.insight.report} stats={view.insight.stats} />}
        </>
      )}
    </main>
  );
}
