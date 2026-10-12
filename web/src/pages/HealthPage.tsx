import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { ApiError, api } from "../api.ts";
import { fieldClass, primaryButton, quietButton } from "../components/ui.tsx";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { preparePhoto } from "../photos/prepare.ts";
import { useHealth } from "../queries.ts";
import { HEALTH_CONDITIONS, LAB_MARKERS, MAX_LAB_PHOTOS, labFlag } from "../shared.ts";
import type {
  ConditionView, HealthCondition, HealthParseView, HealthView, LabFlag, LabMarker, LabReadView, LabReportInput, LabResultView, MarkerTrend,
  MedicationInput, MedicationView, PhotoUpload,
} from "../shared.ts";

// The Health tab (2026-10-12 health context design, compact rework): what the coach keeps in mind about you as chips,
// only the blood results that need attention, and one input at the bottom, as on Today, that takes a sentence, a tap on
// a common option, or photos of a report in any language.

const FLAG_FILL: Record<LabFlag, string> = { low: "bg-watch", normal: "bg-good", high: "bg-watch", unknown: "bg-muted/40" };
const OUTSIDE = (flag: LabFlag) => flag === "low" || flag === "high";

const FIRST_OPTIONS: readonly HealthCondition[] = [
  "vegetarian", "vegan", "halal", "kosher", "lactose_intolerance", "coeliac", "nut_allergy", "shellfish_allergy",
];
/** Common options, in the order offered: diets, then allergies and intolerances, then conditions. */
const OPTION_ORDER: readonly HealthCondition[] = [
  ...FIRST_OPTIONS,
  ...HEALTH_CONDITIONS.filter((kind) => kind !== "other" && !FIRST_OPTIONS.includes(kind)),
];

/** A test's date with its year: tests are months apart. */
export function testDate(date: string, t: Messages): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(t.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function amount(value: number, t: Messages): string {
  return value.toLocaleString(t.locale, { maximumFractionDigits: 2 });
}

export function rangeText(low: number | null, high: number | null, t: Messages): string {
  if (low !== null && high !== null) return `${amount(low, t)}–${amount(high, t)}`;
  if (low !== null) return `> ${amount(low, t)}`;
  if (high !== null) return `< ${amount(high, t)}`;
  return "";
}

function conditionName(condition: { kind: HealthCondition; label: string | null }, t: Messages): string {
  return condition.kind === "other" ? (condition.label ?? t.health.conditionNames.other) : t.health.conditionNames[condition.kind];
}

function useRecordsWrite<T>(fn: (input: T) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: ["health"] }) });
}

function Sheet({ label, onClose, children, onSubmit }: { label: string; onClose: () => void; children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-40 flex items-end bg-black/40 sm:items-center">
      <form
        onSubmit={onSubmit}
        onKeyDown={(event) => event.key === "Escape" && onClose()}
        className="raised max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:mx-auto sm:max-w-xl sm:rounded-3xl"
      >
        {children}
      </form>
    </div>
  );
}

function Label({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-center justify-between gap-2 px-0.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

function Dot({ flag }: { flag: LabFlag }) {
  return <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${FLAG_FILL[flag]}`} />;
}

function Consent() {
  const t = useT();
  const agree = useRecordsWrite(() => api<HealthView>("/api/records/consent", { method: "POST" }));
  return (
    <section className="raised mt-4 rounded-3xl p-4">
      <h2 className="font-semibold">{t.health.consentTitle}</h2>
      <p className="mt-2 text-sm">{t.health.consentBody}</p>
      {agree.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      <button type="button" className={`${primaryButton} mt-4`} disabled={agree.isPending} onClick={() => agree.mutate(undefined)}>
        {t.health.consentAction}
      </button>
    </section>
  );
}

function MedicationEditor({ medication, onClose }: { medication: MedicationView; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState({ name: medication.name, dose: medication.dose, started_on: medication.started_on ?? "", stopped_on: medication.stopped_on ?? "" });
  const body = (): MedicationInput => ({ name: form.name.trim(), dose: form.dose.trim(), started_on: form.started_on || null, stopped_on: form.stopped_on || null });
  const save = useRecordsWrite(() => api<MedicationView>(`/api/records/medications/${medication.id}`, { method: "PUT", json: body() }));
  const remove = useRecordsWrite(() => api<void>(`/api/records/medications/${medication.id}`, { method: "DELETE" }));
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }) });
  return (
    <Sheet label={t.health.medication} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      save.mutate(undefined, { onSuccess: onClose });
    }}>
      <h2 className="text-lg font-semibold">{t.health.medication}</h2>
      <label className="mt-3 block text-sm">
        {t.health.medName}
        <input required maxLength={100} {...field("name")} className={fieldClass} />
      </label>
      <label className="mt-3 block text-sm">
        {t.health.medDose}
        <input maxLength={100} placeholder={t.health.medDosePlaceholder} {...field("dose")} className={fieldClass} />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-sm">
          {t.health.medStarted}
          <input type="date" {...field("started_on")} className={fieldClass} />
        </label>
        <label className="block text-sm">
          {t.health.medStopped}
          <input type="date" min={form.started_on || undefined} {...field("stopped_on")} className={fieldClass} />
        </label>
      </div>
      {(save.isError || remove.isError) && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" className="font-medium text-danger" disabled={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: onClose })}>
          {t.common.delete}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={quietButton}>{t.common.cancel}</button>
          <button type="submit" disabled={save.isPending} className={primaryButton}>{t.common.save}</button>
        </div>
      </div>
    </Sheet>
  );
}

const chip = "flex items-center gap-1 rounded-full py-1 text-sm";

/** Conditions and medications together: everything the coach keeps in mind about you, as chips. */
function AboutYou({ view }: { view: HealthView }) {
  const t = useT();
  const [editing, setEditing] = useState<MedicationView | null>(null);
  const remove = useRecordsWrite((id: string) => api<void>(`/api/records/conditions/${id}`, { method: "DELETE" }));
  if (view.conditions.length === 0 && view.medications.length === 0) return null;
  return (
    <section aria-label={t.health.aboutYou}>
      <Label>{t.health.aboutYou}</Label>
      <ul className="flex flex-wrap gap-2">
        {view.conditions.map((condition) => {
          const name = conditionName(condition, t);
          return (
            <li key={condition.id} className={`raised-sm ${chip} pl-3 pr-1`}>
              {name}
              <button type="button" aria-label={t.health.removeItem(name)} onClick={() => remove.mutate(condition.id)} className="tap flex h-6 w-6 items-center justify-center rounded-full text-muted">
                <Icon name="close" size={14} />
              </button>
            </li>
          );
        })}
        {view.medications.map((m) => (
          <li key={m.id} className="max-w-full">
            <button
              type="button"
              aria-label={t.health.editMedication(m.name)}
              onClick={() => setEditing(m)}
              className={`tap raised-sm ${chip} max-w-full px-3 ${m.stopped_on ? "text-muted line-through" : ""}`}
            >
              <span className="shrink-0 text-muted">
                <Icon name="medication" size={15} />
              </span>
              <span className="truncate">
                {m.name}
                {m.dose && <span className="text-muted"> {m.dose}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {remove.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      {editing && <MedicationEditor medication={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** A marker's values across tests as a small line, the reference range shaded behind it. */
export function Sparkline({ trend }: { trend: MarkerTrend }) {
  const points = trend.points;
  if (points.length < 2) return null;
  const width = 56;
  const height = 20;
  const values = [...points.map((p) => p.value), ...(trend.ref_low !== null ? [trend.ref_low] : []), ...(trend.ref_high !== null ? [trend.ref_high] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const x = (i: number) => 3 + (i / (points.length - 1)) * (width - 6);
  const band = trend.ref_low !== null || trend.ref_high !== null ? { top: y(trend.ref_high ?? max), bottom: y(trend.ref_low ?? min) } : null;
  const last = points[points.length - 1]!;
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 text-muted">
      {band && <rect x={0} y={band.top} width={width} height={Math.max(1, band.bottom - band.top)} className="fill-good/15" />}
      <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={2.5} className={OUTSIDE(last.flag) ? "fill-watch" : "fill-ink"} />
    </svg>
  );
}

function MarkerRow({ trend }: { trend: MarkerTrend }) {
  const t = useT();
  const latest = trend.points[trend.points.length - 1];
  if (!latest) return null;
  const range = rangeText(trend.ref_low, trend.ref_high, t);
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{trend.name}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Dot flag={latest.flag} />
          {t.health.flags[latest.flag]}
          {range && ` · ${range}`}
        </span>
      </span>
      <Sparkline trend={trend} />
      <span className="shrink-0 text-right text-sm tabular-nums">
        {amount(latest.value, t)} <span className="text-xs text-muted">{trend.unit}</span>
      </span>
    </li>
  );
}

function WordsRow({ result }: { result: LabResultView }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{result.name}</span>
      <span className="shrink-0 text-sm">{result.text_value}</span>
    </li>
  );
}

function Blood({ view }: { view: HealthView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tests, setTests] = useState(false);
  const remove = useRecordsWrite((id: string) => api<void>(`/api/records/labs/${id}`, { method: "DELETE" }));
  const latest = view.reports[0];
  if (!latest) return null;
  const flagOf = (trend: MarkerTrend) => trend.points[trend.points.length - 1]?.flag ?? "unknown";
  const attention = view.trends.filter((trend) => OUTSIDE(flagOf(trend)));
  const rest = view.trends.filter((trend) => !OUTSIDE(flagOf(trend)));
  const words = latest.results.filter((r) => r.value === null);
  const hidden = rest.length + words.length;
  const showRest = open || attention.length === 0;
  const title = t.health.blood(testDate(latest.taken_on, t));
  return (
    <section aria-label={title}>
      <Label action={<button type="button" className="text-xs font-semibold text-accent-ink" onClick={() => setTests((v) => !v)}>{tests ? t.health.hideTests : t.health.allTests}</button>}>
        {title}
      </Label>
      {tests && (
        <ul className="pressed mb-3 rounded-2xl px-3 py-1.5 text-sm">
          {view.reports.map((report) => (
            <li key={report.id} className="flex items-center justify-between gap-2 py-0.5">
              <span>
                {testDate(report.taken_on, t)}
                {report.lab_name && <span className="text-muted"> · {report.lab_name}</span>}
              </span>
              <button
                type="button"
                aria-label={t.health.removeReport(testDate(report.taken_on, t))}
                onClick={() => window.confirm(t.health.confirmRemoveReport) && remove.mutate(report.id)}
                className="tap flex h-7 w-7 items-center justify-center rounded-full text-muted"
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul className="raised-sm divide-y divide-muted/15 overflow-hidden rounded-2xl">
        {attention.map((trend) => <MarkerRow key={trend.key} trend={trend} />)}
        {showRest && rest.map((trend) => <MarkerRow key={trend.key} trend={trend} />)}
        {showRest && words.map((result) => <WordsRow key={result.id} result={result} />)}
        {attention.length > 0 && hidden > 0 && (
          <li>
            <button type="button" onClick={() => setOpen((v) => !v)} className="tap flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
              {open ? (
                <span className="text-muted">{t.health.showLess}</span>
              ) : (
                <>
                  <Dot flag="normal" />
                  {t.health.moreInRange(hidden)}
                  <span className="text-muted"><Icon name="chevron_right" size={16} /></span>
                </>
              )}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

// --- Checking a report before it is saved ---

interface Row {
  key: string;
  marker: LabMarker;
  name: string;
  printed_name: string;
  /** A number, or words ("Negative"). */
  value: string;
  unit: string;
  ref_low: string;
  ref_high: string;
  /** Where the row is listed. Worked out again only when an edit is done, so a row never jumps away while typed in. */
  group: "outside" | "range" | "words";
}

const toText = (n: number | null) => (n === null ? "" : String(n));
/** Accepts a decimal comma, as many labs print it. */
const toNumber = (s: string): number | null => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() && Number.isFinite(n) ? n : null;
};
const rowFlag = (r: Pick<Row, "value" | "ref_low" | "ref_high">): LabFlag => labFlag(toNumber(r.value), toNumber(r.ref_low), toNumber(r.ref_high));
const groupOf = (r: Pick<Row, "value" | "ref_low" | "ref_high">): Row["group"] =>
  toNumber(r.value) === null ? (r.value.trim() ? "words" : "range") : OUTSIDE(rowFlag(r)) ? "outside" : "range";

function RowEditor({ row, onChange, onRemove, onDone }: { row: Row; onChange: (patch: Partial<Row>) => void; onRemove: () => void; onDone: () => void }) {
  const t = useT();
  const cell = "pressed mt-0.5 w-full min-w-0 rounded-lg px-2 py-1.5 text-sm text-ink";
  const input = (key: keyof Row, label: string, extra: object = {}) => (
    <label className="block min-w-0 text-xs text-muted">
      {label}
      <input value={row[key]} onChange={(event) => onChange({ [key]: event.target.value })} className={cell} {...extra} />
    </label>
  );
  return (
    <li className="px-3 py-2.5">
      {input("name", t.health.test, { maxLength: 100, autoFocus: !row.name })}
      <div className="mt-2 grid grid-cols-4 gap-2">
        {input("value", t.health.value, { maxLength: 60 })}
        {input("unit", t.health.unit, { maxLength: 30 })}
        {input("ref_low", t.health.low, { inputMode: "decimal" })}
        {input("ref_high", t.health.high, { inputMode: "decimal" })}
      </div>
      <div className="mt-2 flex justify-between">
        <button type="button" onClick={onRemove} className="text-sm font-medium text-danger">{t.common.delete}</button>
        <button type="button" onClick={onDone} className="text-sm font-semibold text-accent-ink">{t.health.done}</button>
      </div>
    </li>
  );
}

function ReportReview({ read, onClose }: { read: LabReadView; onClose: () => void }) {
  const t = useT();
  const [takenOn, setTakenOn] = useState(read.taken_on ?? "");
  const [lab, setLab] = useState(read.lab_name);
  const [rows, setRows] = useState<Row[]>(() =>
    read.results.map((r) => {
      const row = { value: r.value === null ? r.text_value : String(r.value), ref_low: toText(r.ref_low), ref_high: toText(r.ref_high) };
      return { key: crypto.randomUUID(), marker: r.marker, name: r.name, printed_name: r.printed_name, unit: r.unit, ...row, group: groupOf(row) };
    }),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const filled = rows.filter((r) => r.name.trim() && r.value.trim());
  const save = useRecordsWrite(() => {
    const body: LabReportInput = {
      taken_on: takenOn,
      lab_name: lab.trim(),
      results: filled.map((r) => {
        const value = toNumber(r.value);
        return {
          marker: LAB_MARKERS.includes(r.marker) ? r.marker : "other",
          name: r.name.trim(),
          printed_name: r.printed_name.trim(),
          value,
          text_value: value === null ? r.value.trim() : "",
          unit: r.unit.trim(),
          ref_low: toNumber(r.ref_low),
          ref_high: toNumber(r.ref_high),
        };
      }),
    };
    return api<HealthView>("/api/records/labs", { json: body });
  });
  const set = (key: string, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((list) => list.filter((r) => r.key !== key));

  const show = (r: Row) => {
    if (editing === r.key) {
      return <RowEditor key={r.key} row={r} onChange={(patch) => set(r.key, patch)} onRemove={() => removeRow(r.key)} onDone={() => {
        set(r.key, { group: groupOf(r) });
        setEditing(null);
      }} />;
    }
    const sub = [r.printed_name, rangeText(toNumber(r.ref_low), toNumber(r.ref_high), t)].filter(Boolean).join(" · ");
    return (
      <li key={r.key}>
        <button type="button" onClick={() => setEditing(r.key)} className="tap flex w-full items-center gap-3 px-3 py-2 text-left">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{r.name || "—"}</span>
            {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-sm tabular-nums">
            {toNumber(r.value) !== null && <Dot flag={rowFlag(r)} />}
            {r.value}
            {r.unit && <span className="text-xs text-muted">{r.unit}</span>}
          </span>
        </button>
      </li>
    );
  };
  const outside = rows.filter((r) => r.group === "outside");
  const inRange = rows.filter((r) => r.group === "range");
  const words = rows.filter((r) => r.group === "words");
  // Keep the row being edited on screen even when it would fold away.
  const visibleInRange = showAll ? inRange : inRange.filter((r, i) => i < 2 || r.key === editing);
  const group = (title: string, list: Row[], extra?: ReactNode) =>
    list.length > 0 && (
      <>
        <Label>{title}</Label>
        <ul className="raised-sm divide-y divide-muted/15 overflow-hidden rounded-2xl">
          {list.map(show)}
          {extra}
        </ul>
      </>
    );

  return (
    <Sheet label={t.health.readTitle(rows.length)} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      save.mutate(undefined, { onSuccess: onClose });
    }}>
      <h2 className="text-lg font-semibold">{t.health.readTitle(rows.length)}</h2>
      <p className="mt-0.5 text-sm text-muted">
        {read.language && `${t.health.readFrom(read.language)} `}
        {t.health.checkBody}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-sm">
          {t.health.takenOn}
          <input type="date" required value={takenOn} onChange={(event) => setTakenOn(event.target.value)} className={fieldClass} />
        </label>
        <label className="block text-sm">
          {t.health.lab}
          <input maxLength={100} value={lab} onChange={(event) => setLab(event.target.value)} className={fieldClass} />
        </label>
      </div>
      {group(t.health.outsideRange, outside)}
      {group(
        t.health.inRange(inRange.length),
        visibleInRange,
        visibleInRange.length < inRange.length && (
          <li>
            <button type="button" onClick={() => setShowAll(true)} className="tap flex w-full items-center gap-1 px-3 py-2 text-left text-sm text-muted">
              {t.health.more(inRange.length - visibleInRange.length)}
              <Icon name="chevron_right" size={16} />
            </button>
          </li>
        ),
      )}
      {group(t.health.otherFindings(words.length), words)}
      <button
        type="button"
        className="mt-3 flex items-center gap-1 text-sm font-medium text-accent-ink"
        onClick={() => {
          const key = crypto.randomUUID();
          setRows((list) => [...list, { key, marker: "other", name: "", printed_name: "", value: "", unit: "", ref_low: "", ref_high: "", group: "range" }]);
          setEditing(key);
        }}
      >
        <Icon name="add" size={16} />
        {t.health.addRow}
      </button>
      {save.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={quietButton}>{t.common.cancel}</button>
        <button type="submit" disabled={save.isPending || filled.length === 0 || !takenOn} className={primaryButton}>{t.health.saveCount(filled.length)}</button>
      </div>
    </Sheet>
  );
}

// --- The input at the bottom ---

type Suggestion =
  | { key: string; kind: "condition"; condition: HealthParseView["conditions"][number] }
  | { key: string; kind: "medication"; medication: HealthParseView["medications"][number] };

function failure(error: unknown, t: Messages, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === "lab_unreadable") return t.health.readFailed.unreadable;
    if (error.code === "ai_cap") return t.health.readFailed.cap;
    if (error.code === "ai_unavailable") return t.health.readFailed.off;
  }
  return fallback;
}

function SuggestionCard({ suggestion, view, onDone }: { suggestion: Suggestion; view: HealthView; onDone: () => void }) {
  const t = useT();
  const keep = useRecordsWrite(() => {
    if (suggestion.kind === "condition") return api<ConditionView>("/api/records/conditions", { json: suggestion.condition });
    const m = suggestion.medication;
    // "Stopped atorvastatin" or a new dose updates the medication already listed rather than adding it twice.
    const existing = view.medications.find((x) => x.name.trim().toLowerCase() === m.name.toLowerCase());
    if (!existing) return api<MedicationView>("/api/records/medications", { json: m satisfies MedicationInput });
    const body: MedicationInput = {
      name: existing.name,
      dose: m.dose || existing.dose,
      started_on: m.started_on ?? existing.started_on,
      stopped_on: m.stopped_on ?? existing.stopped_on,
    };
    return api<MedicationView>(`/api/records/medications/${existing.id}`, { method: "PUT", json: body });
  });
  let title: string;
  let detail: string;
  if (suggestion.kind === "condition") {
    title = conditionName(suggestion.condition, t);
    detail = t.health.condition;
  } else {
    const m = suggestion.medication;
    title = m.name;
    const when = m.stopped_on ? t.health.stoppedOn(testDate(m.stopped_on, t)) : m.started_on ? t.health.since(testDate(m.started_on, t)) : "";
    detail = [m.dose, when].filter(Boolean).join(" · ") || t.health.medication;
  }
  return (
    <li className="raised-sm flex items-center gap-2 rounded-2xl py-1.5 pl-3 pr-1.5">
      <span className="shrink-0 text-accent-ink">
        <Icon name={suggestion.kind === "condition" ? "ecg_heart" : "medication"} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className={`block truncate text-xs ${keep.isError ? "text-danger" : "text-muted"}`}>{keep.isError ? t.health.saveFailed : detail}</span>
      </span>
      <button type="button" aria-label={t.health.dismiss(title)} onClick={onDone} className="tap flex h-8 w-8 items-center justify-center rounded-full text-muted">
        <Icon name="close" size={16} />
      </button>
      <button
        type="button"
        aria-label={t.health.keep(title)}
        disabled={keep.isPending}
        onClick={() => keep.mutate(undefined, { onSuccess: onDone })}
        className="tap flex h-8 w-8 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-40"
      >
        <Icon name="check" size={16} />
      </button>
    </li>
  );
}

function HealthComposer({ view, onRead }: { view: HealthView; onRead: (read: LabReadView) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const add = useRecordsWrite((kind: HealthCondition) => api<ConditionView>("/api/records/conditions", { json: { kind } }));
  const parse = useMutation({
    mutationFn: (sentence: string) => api<HealthParseView>("/api/records/parse", { json: { text: sentence } }),
    onSuccess: (parsed) => {
      setText("");
      const found: Suggestion[] = [
        ...parsed.conditions.map((condition) => ({ key: crypto.randomUUID(), kind: "condition" as const, condition })),
        ...parsed.medications.map((medication) => ({ key: crypto.randomUUID(), kind: "medication" as const, medication })),
      ];
      setSuggestions(found);
      if (parsed.report) onRead(parsed.report);
      setNotice(found.length === 0 && !parsed.report ? t.health.nothingFound : null);
    },
  });
  const read = useMutation({
    mutationFn: async (files: File[]) => {
      const ids: string[] = [];
      for (const file of files.slice(0, MAX_LAB_PHOTOS)) {
        const { blob } = await preparePhoto(file);
        ids.push((await api<PhotoUpload>("/api/photos", { blob })).id);
      }
      return api<LabReadView>("/api/records/labs/read", { json: { photo_ids: ids } });
    },
    onSuccess: onRead,
  });
  const busy = parse.isPending || read.isPending;

  // As on Today: the page leaves room for the input, whose height changes with the suggestions above it.
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const element = form.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--composer-h", `${Math.ceil(element.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--composer-h");
    };
  }, []);

  const have = new Set(view.conditions.map((c) => c.kind));
  const options = OPTION_ORDER.filter((kind) => !have.has(kind));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() && !busy) parse.mutate(text.trim());
  };
  const status = parse.isPending ? t.health.thinking : read.isPending ? t.health.reading : notice;
  const error = parse.isError
    ? failure(parse.error, t, t.health.parseFailed)
    : read.isError
      ? failure(read.error, t, t.health.readFailed.failed)
      : add.isError
        ? t.health.saveFailed
        : null;
  return (
    <form ref={form} onSubmit={submit} className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)_+_env(safe-area-inset-bottom))] z-10 bg-base px-3 pt-2 pb-2">
      <div className="raised mx-auto max-w-xl rounded-3xl p-2">
        {suggestions.length > 0 && (
          <ul className="mb-2 flex flex-col gap-2 px-1 pt-1">
            {suggestions.map((s) => (
              <SuggestionCard key={s.key} suggestion={s} view={view} onDone={() => setSuggestions((list) => list.filter((x) => x.key !== s.key))} />
            ))}
          </ul>
        )}
        {suggestions.length === 0 && !text && options.length > 0 && (
          <ul aria-label={t.health.options} className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
            {options.map((kind) => (
              <li key={kind} className="shrink-0">
                <button type="button" disabled={add.isPending} onClick={() => add.mutate(kind)} className="tap raised-sm rounded-full px-3 py-1 text-sm whitespace-nowrap">
                  {t.health.conditionNames[kind]}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <label className={`tap raised-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${busy ? "opacity-40" : "cursor-pointer"}`}>
            <Icon name="add_a_photo" size={22} />
            <input
              type="file"
              accept="image/*"
              multiple
              aria-label={t.health.photograph}
              disabled={busy}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length > 0) read.mutate(files);
              }}
              className="sr-only"
            />
          </label>
          <textarea
            aria-label={t.health.placeholder}
            rows={1}
            value={text}
            maxLength={500}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) submit(event);
            }}
            placeholder={t.health.placeholder}
            className="pressed field-sizing-content max-h-36 min-h-11 flex-1 resize-none rounded-2xl px-3 py-2.5 text-base text-ink placeholder:text-muted"
          />
          <button
            type="submit"
            aria-label={t.health.send}
            disabled={!text.trim() || busy}
            className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent shadow-[3px_3px_6px_var(--nm-lo),-3px_-3px_6px_var(--nm-hi)] disabled:opacity-40"
          >
            <Icon name="arrow_upward" size={22} />
          </button>
        </div>
        {status && <p role="status" className="mt-1.5 px-2 text-xs text-muted">{status}</p>}
        {error && <p role="alert" className="mt-1.5 px-2 text-sm text-danger">{error}</p>}
      </div>
    </form>
  );
}

export function HealthPage() {
  const t = useT();
  const health = useHealth();
  const [review, setReview] = useState<LabReadView | null>(null);
  const view = health.data;
  const ready = Boolean(view?.consented_at);
  const empty = view && view.conditions.length === 0 && view.medications.length === 0 && view.reports.length === 0;
  const bottom = ready ? "pb-[calc(var(--composer-h,8rem)_+_var(--tabbar-h)_+_env(safe-area-inset-bottom)_+_1rem)]" : "pb-28";
  return (
    <main className={`mx-auto max-w-xl px-4 pt-[calc(env(safe-area-inset-top)_+_1rem)] ${bottom}`}>
      <h1 className="text-xl font-semibold">{t.health.title}</h1>
      {!view ? (
        <p className={`mt-4 text-sm ${health.isError ? "text-danger" : "text-muted"}`} role={health.isError ? "alert" : undefined}>
          {health.isError ? t.health.loadFailed : t.common.loading}
        </p>
      ) : !view.consented_at ? (
        <Consent />
      ) : (
        <>
          {empty && <p className="mt-2 text-sm text-muted">{t.health.empty}</p>}
          <AboutYou view={view} />
          <Blood view={view} />
          <HealthComposer view={view} onRead={setReview} />
          {review && <ReportReview read={review} onClose={() => setReview(null)} />}
        </>
      )}
    </main>
  );
}

/** "Delete my health data", in Settings: shown once there is something to delete. */
export function HealthDataSettings() {
  const t = useT();
  const health = useHealth();
  const deleteAll = useRecordsWrite(() => api<void>("/api/records", { method: "DELETE" }));
  if (!health.data?.consented_at) return null;
  return (
    <section className="raised mt-6 rounded-3xl p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t.health.data}</h2>
      <p className="mt-2 text-xs text-muted">{t.health.dataNote}</p>
      {deleteAll.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      <button
        type="button"
        className="mt-3 text-sm font-medium text-danger"
        disabled={deleteAll.isPending}
        onClick={() => window.confirm(t.health.confirmDeleteAll) && deleteAll.mutate(undefined)}
      >
        {t.health.deleteAll}
      </button>
    </section>
  );
}
