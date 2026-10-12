import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { ApiError, api } from "../api.ts";
import { fieldClass, primaryButton, quietButton } from "../components/ui.tsx";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import { preparePhoto } from "../photos/prepare.ts";
import { useHealth } from "../queries.ts";
import { HEALTH_CONDITIONS, LAB_MARKERS, MAX_LAB_PHOTOS } from "../shared.ts";
import type {
  ConditionView, HealthCondition, HealthView, LabFlag, LabMarker, LabReadView, LabReportInput, MarkerTrend, MedicationInput, MedicationView,
  PhotoUpload,
} from "../shared.ts";

// The Health tab (2026-10-12 health context design): conditions, medications and blood results the coach keeps in mind.
// Compact on purpose: chips and short rows, with each add behind one small button.

const FLAG_FILL: Record<LabFlag, string> = { low: "bg-watch", normal: "bg-good", high: "bg-watch", unknown: "bg-muted/40" };

/** A blood test's date with its year: tests are months apart. */
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

function conditionName(condition: ConditionView, t: Messages): string {
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
        className="raised max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:mx-auto sm:max-w-xl sm:rounded-3xl"
      >
        <h2 className="text-lg font-semibold">{label}</h2>
        {children}
      </form>
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {action}
    </div>
  );
}

/** A small round button in a section header: the one way to add to it. */
function AddButton({ label, icon = "add", onClick, disabled }: { label: string; icon?: IconName; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="tap raised-sm flex h-8 w-8 items-center justify-center rounded-full text-accent-ink disabled:opacity-50">
      <Icon name={icon} size={18} />
    </button>
  );
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

function Conditions({ conditions }: { conditions: ConditionView[] }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const add = useRecordsWrite((input: { kind: HealthCondition; label?: string }) => api<ConditionView>("/api/records/conditions", { json: input }));
  const remove = useRecordsWrite((id: string) => api<void>(`/api/records/conditions/${id}`, { method: "DELETE" }));
  const have = new Set(conditions.map((c) => c.kind));
  const offered = HEALTH_CONDITIONS.filter((kind) => kind !== "other" && !have.has(kind));
  const chip = "rounded-full px-3 py-1.5 text-sm";
  return (
    <section aria-label={t.health.conditions} className="mt-6">
      <SectionHeader title={t.health.conditions} action={<AddButton label={t.health.add} onClick={() => setPicking((open) => !open)} />} />
      {conditions.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {conditions.map((condition) => {
            const name = conditionName(condition, t);
            return (
              <li key={condition.id} className={`raised-sm flex items-center gap-1 ${chip} pr-1.5`}>
                {name}
                <button type="button" aria-label={t.health.removeItem(name)} onClick={() => remove.mutate(condition.id)} className="tap flex h-6 w-6 items-center justify-center rounded-full text-muted">
                  <Icon name="close" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {picking && (
        <div className="pressed mt-3 rounded-2xl p-3">
          <ul className="flex flex-wrap gap-2">
            {offered.map((kind) => (
              <li key={kind}>
                <button type="button" onClick={() => add.mutate({ kind })} className={`tap raised-sm ${chip}`}>
                  {t.health.conditionNames[kind]}
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => setOther("")} className={`tap raised-sm ${chip} text-accent-ink`}>
                {t.health.other}
              </button>
            </li>
          </ul>
          {other !== null && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!other.trim()) return;
                add.mutate({ kind: "other", label: other.trim() }, { onSuccess: () => setOther(null) });
              }}
            >
              <input autoFocus value={other} maxLength={80} placeholder={t.health.otherPlaceholder} aria-label={t.health.other} onChange={(event) => setOther(event.target.value)} className={`${fieldClass} mt-0`} />
              <button type="submit" className={quietButton}>{t.health.add}</button>
            </form>
          )}
        </div>
      )}
      {(add.isError || remove.isError) && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
    </section>
  );
}

function MedicationEditor({ medication, onClose }: { medication: MedicationView | null; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState({
    name: medication?.name ?? "",
    dose: medication?.dose ?? "",
    started_on: medication?.started_on ?? "",
    stopped_on: medication?.stopped_on ?? "",
  });
  const body = (): MedicationInput => ({ name: form.name.trim(), dose: form.dose.trim(), started_on: form.started_on || null, stopped_on: form.stopped_on || null });
  const save = useRecordsWrite(() =>
    medication
      ? api<MedicationView>(`/api/records/medications/${medication.id}`, { method: "PUT", json: body() })
      : api<MedicationView>("/api/records/medications", { json: body() }),
  );
  const remove = useRecordsWrite(() => api<void>(`/api/records/medications/${medication?.id}`, { method: "DELETE" }));
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }) });
  return (
    <Sheet label={medication ? t.health.editMedication : t.health.addMedication} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      save.mutate(undefined, { onSuccess: onClose });
    }}>
      <label className="mt-3 block text-sm">
        {t.health.medName}
        <input required maxLength={100} autoFocus={!medication} {...field("name")} className={fieldClass} />
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
        {medication ? (
          <button type="button" className="font-medium text-danger" disabled={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: onClose })}>
            {t.common.delete}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={quietButton}>{t.common.cancel}</button>
          <button type="submit" disabled={save.isPending} className={primaryButton}>{t.common.save}</button>
        </div>
      </div>
    </Sheet>
  );
}

function Medications({ medications }: { medications: MedicationView[] }) {
  const t = useT();
  const [editing, setEditing] = useState<MedicationView | "new" | null>(null);
  return (
    <section aria-label={t.health.medications} className="mt-6">
      <SectionHeader title={t.health.medications} action={<AddButton label={t.health.addMedication} icon="medication" onClick={() => setEditing("new")} />} />
      {medications.length === 0 ? (
        <p className="text-sm text-muted">{t.health.noMedications}</p>
      ) : (
        <ul className="raised-sm divide-y divide-muted/15 rounded-2xl">
          {medications.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setEditing(m)} className={`tap flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left ${m.stopped_on ? "text-muted" : ""}`}>
                <span className="min-w-0 truncate">
                  <span className="font-medium">{m.name}</span>
                  {m.dose && <span className="text-sm text-muted"> · {m.dose}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {m.stopped_on ? t.health.stoppedOn(testDate(m.stopped_on, t)) : m.started_on ? t.health.since(testDate(m.started_on, t)) : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <MedicationEditor medication={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** A marker's values across tests as a small line, the reference range shaded behind it. */
export function Sparkline({ trend }: { trend: MarkerTrend }) {
  const points = trend.points;
  if (points.length < 2) return null;
  const width = 64;
  const height = 22;
  const values = [...points.map((p) => p.value), ...(trend.ref_low !== null ? [trend.ref_low] : []), ...(trend.ref_high !== null ? [trend.ref_high] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const x = (i: number) => 3 + (i / (points.length - 1)) * (width - 6);
  const band = trend.ref_low !== null || trend.ref_high !== null
    ? { top: y(trend.ref_high ?? max), bottom: y(trend.ref_low ?? min) }
    : null;
  const last = points[points.length - 1]!;
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 text-muted">
      {band && <rect x={0} y={band.top} width={width} height={Math.max(1, band.bottom - band.top)} className="fill-good/15" />}
      <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={2.5} className={last.flag === "low" || last.flag === "high" ? "fill-watch" : "fill-ink"} />
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
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${FLAG_FILL[latest.flag]}`} />
          {t.health.flags[latest.flag]}
          {range && ` · ${range}`}
        </span>
      </span>
      <Sparkline trend={trend} />
      <span className="w-24 shrink-0 text-right text-sm tabular-nums">
        {amount(latest.value, t)} <span className="text-xs text-muted">{trend.unit}</span>
      </span>
    </li>
  );
}

interface Row {
  key: string;
  marker: LabMarker;
  name: string;
  value: string;
  unit: string;
  ref_low: string;
  ref_high: string;
}

const toText = (n: number | null) => (n === null ? "" : String(n));
/** Accepts a decimal comma, as many labs print it. */
const toNumber = (s: string): number | null => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() && Number.isFinite(n) ? n : null;
};

function ReportReview({ read, onClose }: { read: LabReadView | null; onClose: () => void }) {
  const t = useT();
  const [takenOn, setTakenOn] = useState(read?.taken_on ?? "");
  const [lab, setLab] = useState(read?.lab_name ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (read?.results ?? [{ marker: "other" as LabMarker, name: "", value: 0, unit: "", ref_low: null, ref_high: null }]).map((r) => ({
      key: crypto.randomUUID(),
      marker: r.marker,
      name: r.name,
      value: read ? String(r.value) : "",
      unit: r.unit,
      ref_low: toText(r.ref_low),
      ref_high: toText(r.ref_high),
    })),
  );
  const filled = rows.filter((r) => r.name.trim() && toNumber(r.value) !== null);
  const save = useRecordsWrite(() => {
    const body: LabReportInput = {
      taken_on: takenOn,
      lab_name: lab.trim(),
      results: filled.map((r) => ({
        marker: LAB_MARKERS.includes(r.marker) ? r.marker : "other",
        name: r.name.trim(),
        value: toNumber(r.value)!,
        unit: r.unit.trim(),
        ref_low: toNumber(r.ref_low),
        ref_high: toNumber(r.ref_high),
      })),
    };
    return api<HealthView>("/api/records/labs", { json: body });
  });
  const set = (key: string, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const cell = "pressed w-full min-w-0 rounded-lg px-2 py-1.5 text-sm text-ink";
  return (
    <Sheet label={t.health.checkTitle} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      save.mutate(undefined, { onSuccess: onClose });
    }}>
      <p className="mt-1 text-sm text-muted">{t.health.checkBody}</p>
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
      <table className="mt-4 w-full table-fixed border-separate border-spacing-x-1 border-spacing-y-1.5 text-left">
        <thead className="text-xs text-muted">
          <tr>
            <th className="w-[34%] font-normal">{t.health.test}</th>
            <th className="w-[17%] font-normal">{t.health.value}</th>
            <th className="w-[17%] font-normal">{t.health.unit}</th>
            <th className="w-[12%] font-normal">{t.health.low}</th>
            <th className="w-[12%] font-normal">{t.health.high}</th>
            <th className="w-[8%]" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td><input aria-label={t.health.test} value={r.name} maxLength={100} onChange={(event) => set(r.key, { name: event.target.value, marker: read ? r.marker : "other" })} className={cell} /></td>
              <td><input aria-label={t.health.value} inputMode="decimal" value={r.value} onChange={(event) => set(r.key, { value: event.target.value })} className={`${cell} tabular-nums`} /></td>
              <td><input aria-label={t.health.unit} value={r.unit} maxLength={30} onChange={(event) => set(r.key, { unit: event.target.value })} className={cell} /></td>
              <td><input aria-label={t.health.low} inputMode="decimal" value={r.ref_low} onChange={(event) => set(r.key, { ref_low: event.target.value })} className={`${cell} tabular-nums`} /></td>
              <td><input aria-label={t.health.high} inputMode="decimal" value={r.ref_high} onChange={(event) => set(r.key, { ref_high: event.target.value })} className={`${cell} tabular-nums`} /></td>
              <td>
                <button type="button" aria-label={t.health.removeItem(r.name)} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))} className="tap flex h-7 w-7 items-center justify-center rounded-full text-muted">
                  <Icon name="close" size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="mt-1 text-sm font-medium text-accent-ink" onClick={() => setRows((list) => [...list, { key: crypto.randomUUID(), marker: "other", name: "", value: "", unit: "", ref_low: "", ref_high: "" }])}>
        + {t.health.addRow}
      </button>
      {save.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={quietButton}>{t.common.cancel}</button>
        <button type="submit" disabled={save.isPending || filled.length === 0 || !takenOn} className={primaryButton}>{t.common.save}</button>
      </div>
    </Sheet>
  );
}

function readFailure(error: unknown, t: Messages): string {
  if (error instanceof ApiError) {
    if (error.code === "lab_unreadable") return t.health.readFailed.unreadable;
    if (error.code === "ai_cap") return t.health.readFailed.cap;
    if (error.code === "ai_unavailable") return t.health.readFailed.off;
  }
  return t.health.readFailed.failed;
}

function Blood({ view }: { view: HealthView }) {
  const t = useT();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<LabReadView | "blank" | null>(null);
  const read = useMutation({
    mutationFn: async (files: File[]) => {
      const ids: string[] = [];
      for (const file of files.slice(0, MAX_LAB_PHOTOS)) {
        const { blob } = await preparePhoto(file);
        ids.push((await api<PhotoUpload>("/api/photos", { blob })).id);
      }
      return api<LabReadView>("/api/records/labs/read", { json: { photo_ids: ids } });
    },
    onSuccess: setReview,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/records/labs/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["health"] }),
  });
  const latest = view.reports[0];
  return (
    <section aria-label={t.health.blood} className="mt-6">
      <SectionHeader
        title={t.health.blood}
        action={
          <span className="flex items-center gap-2">
            <button type="button" className="text-xs font-medium text-accent-ink" onClick={() => setReview("blank")}>
              {t.health.typeIn}
            </button>
            <AddButton label={t.health.readPhotos} icon="add_a_photo" disabled={read.isPending} onClick={() => input.current?.click()} />
          </span>
        }
      />
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) read.mutate(files);
        }}
      />
      {read.isPending && (
        <p role="status" className="mb-2 text-sm text-muted">
          {t.health.reading}
        </p>
      )}
      {read.isError && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {readFailure(read.error, t)}
        </p>
      )}
      {view.trends.length === 0 ? (
        <p className="text-sm text-muted">{t.health.noReports}</p>
      ) : (
        <>
          {latest && <p className="mb-2 text-xs text-muted">{testDate(latest.taken_on, t)}{latest.lab_name && ` · ${latest.lab_name}`}</p>}
          <ul className="raised-sm divide-y divide-muted/15 rounded-2xl">
            {view.trends.map((trend) => (
              <MarkerRow key={trend.key} trend={trend} />
            ))}
          </ul>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs text-muted">{t.health.tests} ({view.reports.length})</summary>
            <ul className="mt-2 space-y-1">
              {view.reports.map((report) => (
                <li key={report.id} className="flex items-center justify-between gap-2">
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
          </details>
        </>
      )}
      {review && <ReportReview read={review === "blank" ? null : review} onClose={() => setReview(null)} />}
    </section>
  );
}

export function HealthPage() {
  const t = useT();
  const health = useHealth();
  const deleteAll = useRecordsWrite(() => api<void>("/api/records", { method: "DELETE" }));
  const view = health.data;
  return (
    <main className="mx-auto max-w-xl px-4 pb-28 pt-[calc(env(safe-area-inset-top)_+_1rem)]">
      <h1 className="flex items-center gap-2 text-xl font-semibold">{t.health.title}</h1>
      <p className="mt-1 text-sm text-muted">{t.health.intro}</p>
      {!view ? (
        <p className={`mt-4 text-sm ${health.isError ? "text-danger" : "text-muted"}`} role={health.isError ? "alert" : undefined}>
          {health.isError ? t.health.loadFailed : t.common.loading}
        </p>
      ) : !view.consented_at ? (
        <Consent />
      ) : (
        <>
          <Conditions conditions={view.conditions} />
          <Medications medications={view.medications} />
          <Blood view={view} />
          <button
            type="button"
            className="mt-10 text-sm font-medium text-danger"
            disabled={deleteAll.isPending}
            onClick={() => window.confirm(t.health.confirmDeleteAll) && deleteAll.mutate(undefined)}
          >
            {t.health.deleteAll}
          </button>
        </>
      )}
    </main>
  );
}
