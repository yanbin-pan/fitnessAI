import { useParams } from "react-router";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { useMarker } from "../queries.ts";
import type { MarkerFoodView, MarkerNutrient, MarkerTrend } from "../shared.ts";
import { Label, Screen, WithHealth, amount, monthName, rangeText } from "./common.tsx";

// A marker beside the nutrient it relates to in the food log (2026-10-19 health tab design §5): its values across
// records against the printed range, then the nutrient's monthly averages on the same months, and the foods behind it.

const WIDTH = 320;
const PAD = 18;
const OUTSIDE = (flag: string) => flag === "low" || flag === "high";
/** Each nutrient in its colour on Today: saturated fat darker than fat, added sugar the carbs'; the rest the accent. */
const FAT = { fill: "fill-fat-sat", bg: "bg-fat-sat" };
const SUGAR = { fill: "fill-carbs", bg: "bg-carbs" };
const OTHER = { fill: "fill-accent", bg: "bg-accent" };
// Whole class names, so Tailwind finds them in the source.
const NUTRIENT_COLOUR: Record<MarkerNutrient, { fill: string; bg: string }> = {
  saturated_fat_g: FAT, added_sugars_g: SUGAR, iron_mg: OTHER, vitamin_d_ug: OTHER, vitamin_b12_ug: OTHER, folate_ug: OTHER,
};

/** Fewer days than this make a month's average a rough one: drawn lighter. */
const FULL_MONTH_DAYS = 8;

/** Every month from the first to the last, as YYYY-MM. */
function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let [year, month] = first.split("-").map(Number) as [number, number];
  const [endYear, endMonth] = last.split("-").map(Number) as [number, number];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function MarkerChart({ trend, months, t }: { trend: MarkerTrend; months: string[]; t: Messages }) {
  const height = 150;
  const x = (month: string) => PAD + (months.length === 1 ? (WIDTH - 2 * PAD) / 2 : (months.indexOf(month) / (months.length - 1)) * (WIDTH - 2 * PAD));
  const values = [...trend.points.map((p) => p.value), ...(trend.ref_low !== null ? [trend.ref_low] : []), ...(trend.ref_high !== null ? [trend.ref_high] : [])];
  const span = Math.max(...values) - Math.min(...values) || Math.abs(values[0] ?? 1) || 1;
  const min = Math.min(...values) - span * 0.2;
  const max = Math.max(...values) + span * 0.3;
  const y = (v: number) => height - 22 - ((v - min) / (max - min)) * (height - 40);
  const bandTop = y(Math.min(trend.ref_high ?? max, max));
  const bandBottom = y(Math.max(trend.ref_low ?? min, min));
  const label = trend.points.map((p) => `${monthName(p.taken_on, t)} ${amount(p.value, t)}`).join(", ");
  const range = rangeText(trend.ref_low, trend.ref_high, t);
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" role="img" aria-label={`${trend.name}: ${label}${range ? `; ${t.health.normal(range)}` : ""}`}>
      {(trend.ref_low !== null || trend.ref_high !== null) && (
        <rect x={0} y={bandTop} width={WIDTH} height={Math.max(1, bandBottom - bandTop)} className="fill-tint-within" opacity={0.8} />
      )}
      <line x1={0} x2={WIDTH} y1={height - 22} y2={height - 22} className="stroke-muted/40" />
      <polyline
        points={trend.points.map((p) => `${x(p.taken_on.slice(0, 7))},${y(p.value)}`).join(" ")}
        fill="none"
        className="stroke-ink"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {trend.points.map((p, i) => {
        const last = i === trend.points.length - 1;
        const cx = x(p.taken_on.slice(0, 7));
        return (
          <g key={`${p.taken_on}-${i}`}>
            <circle cx={cx} cy={y(p.value)} r={last ? 6 : 5} className={last && OUTSIDE(p.flag) ? "fill-act" : "fill-ink"} />
            <text x={cx} y={y(p.value) - 11} textAnchor="middle" fontSize={12} fontWeight={last ? 700 : 400} className={last && OUTSIDE(p.flag) ? "fill-act" : "fill-ink"}>
              {amount(p.value, t)}
            </text>
            <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} className="fill-muted">{monthName(p.taken_on, t).split(" ")[0]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function NutrientChart({ nutrient, months, t }: { nutrient: NonNullable<MarkerFoodView["nutrient"]>; months: string[]; t: Messages }) {
  const height = 110;
  const step = (WIDTH - 2 * PAD) / Math.max(1, months.length - 1);
  const bar = Math.max(6, Math.min(22, step * 0.6));
  const x = (month: string) => PAD + (months.length === 1 ? (WIDTH - 2 * PAD) / 2 : months.indexOf(month) * step);
  const max = Math.max(...nutrient.months.map((m) => m.average), 1);
  const h = (v: number) => (v / max) * (height - 36);
  const fill = NUTRIENT_COLOUR[nutrient.key].fill;
  const name = t.health.nutrientNames[nutrient.key];
  const label = nutrient.months.map((m) => `${monthName(m.month, t)} ${amount(m.average, t)} ${nutrient.unit}`).join(", ");
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" role="img" aria-label={`${name}: ${label}`}>
      <line x1={0} x2={WIDTH} y1={height - 20} y2={height - 20} className="stroke-muted/40" />
      {nutrient.months.map((m) => (
        <g key={m.month}>
          <rect
            x={x(m.month) - bar / 2}
            y={height - 20 - h(m.average)}
            width={bar}
            height={h(m.average)}
            rx={4}
            className={fill}
            opacity={m.days >= FULL_MONTH_DAYS ? 1 : 0.5}
          />
          <text x={x(m.month)} y={height - 24 - h(m.average)} textAnchor="middle" fontSize={10} className="fill-muted">{Math.round(m.average)}</text>
          <text x={x(m.month)} y={height - 5} textAnchor="middle" fontSize={11} className="fill-muted">{monthName(m.month, t).split(" ")[0]}</text>
        </g>
      ))}
    </svg>
  );
}

function Marker({ data }: { data: MarkerFoodView }) {
  const t = useT();
  const { trend, nutrient } = data;
  const last = trend.points.at(-1);
  const firstMonth = [trend.points[0]?.taken_on.slice(0, 7), nutrient?.months[0]?.month].filter((m): m is string => Boolean(m)).sort()[0];
  const lastMonth = [last?.taken_on.slice(0, 7), nutrient?.months.at(-1)?.month].filter((m): m is string => Boolean(m)).sort().at(-1);
  const months = firstMonth && lastMonth ? monthsBetween(firstMonth, lastMonth) : [];
  return (
    <>
      {last && (
        <p className="mt-4 flex items-baseline gap-2.5">
          <span className="text-4xl font-bold tracking-tight">{amount(last.value, t)}</span>
          <span className="text-sm text-muted">{trend.unit}</span>
          <span className={`text-sm font-semibold ${OUTSIDE(last.flag) ? "text-act" : "text-good"}`}>{t.health.flags[last.flag]}</span>
        </p>
      )}
      <section className="raised mt-4 flex flex-col gap-4 rounded-3xl px-3.5 pt-4 pb-3">
        <div>
          <h2 className="text-sm font-semibold">{t.health.fromRecords(trend.name)}</h2>
          <MarkerChart trend={trend} months={months} t={t} />
        </div>
        {nutrient && nutrient.months.length > 0 && (
          <div>
            <h2 className="flex justify-between gap-2 text-sm">
              <span className="font-semibold">{t.health.fromLog(t.health.nutrientNames[nutrient.key])}</span>
              <span className="text-muted">{t.health.monthlyAverage} · {nutrient.unit === "ug" ? "µg" : nutrient.unit}</span>
            </h2>
            <NutrientChart nutrient={nutrient} months={months} t={t} />
          </div>
        )}
      </section>
      {!nutrient && <p className="mt-3 px-0.5 text-sm text-muted">{t.health.noFoodLink}</p>}
      {nutrient && nutrient.months.length === 0 && <p className="mt-3 px-0.5 text-sm text-muted">{t.health.noFoodYet}</p>}
      {nutrient && nutrient.sources.length > 0 && (
        <>
          <Label>{t.health.whereFrom}</Label>
          <ul className="raised flex flex-col gap-3 rounded-3xl px-4 py-3.5">
            {nutrient.sources.map((s) => (
              <li key={s.name} className="flex flex-col gap-1.5">
                <span className="flex justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{s.name}</span>
                  <span className="font-semibold tabular-nums">{Math.round(s.share * 100)}%</span>
                </span>
                <span aria-hidden="true" className="pressed flex h-1.5 rounded-full">
                  <span className={`rounded-full ${NUTRIENT_COLOUR[nutrient.key].bg}`} style={{ width: `${s.share * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {nutrient && nutrient.months.length > 0 && <p className="mt-3 px-0.5 text-xs text-muted">{t.health.sideBySide}</p>}
      <p className="mt-2 px-0.5 text-xs text-muted">{t.health.disclaimer}</p>
    </>
  );
}

export function MarkerPage() {
  const t = useT();
  const { key = "" } = useParams();
  const marker = useMarker(key);
  return (
    <Screen title={marker.data?.trend.name ?? t.health.records} back="/health">
      <WithHealth>
        {() =>
          marker.data ? (
            <Marker data={marker.data} />
          ) : (
            <p className={`mt-4 text-sm ${marker.isError ? "text-danger" : "text-muted"}`} role={marker.isError ? "alert" : undefined}>
              {marker.isError ? t.health.notFound : t.common.loading}
            </p>
          )
        }
      </WithHealth>
    </Screen>
  );
}
