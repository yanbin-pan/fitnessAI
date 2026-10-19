import { useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import { fieldClass, primaryButton, quietButton } from "../components/ui.tsx";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { DOCUMENT_KINDS, LAB_MARKERS, labFlag } from "../shared.ts";
import type { DocumentInput, DocumentKind, DocumentReadView, FactDraft, HealthView, LabFlag, LabMarker } from "../shared.ts";
import { Label, Sheet, factName, rangeText, useRecordsWrite } from "./common.tsx";

// Checking a record before it is saved (2026-10-19 health tab design §2): what was read, every line editable, and the
// facts it states, ticked to add now or left on the record for later.

interface Row {
  key: string;
  code: LabMarker;
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

const OUTSIDE = (flag: LabFlag) => flag === "low" || flag === "high";
const toText = (n: number | null) => (n === null ? "" : String(n));
/** Accepts a decimal comma, as many labs print it. */
const toNumber = (s: string): number | null => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() && Number.isFinite(n) ? n : null;
};
const rowFlag = (r: Pick<Row, "value" | "ref_low" | "ref_high">): LabFlag => labFlag(toNumber(r.value), toNumber(r.ref_low), toNumber(r.ref_high));
const groupOf = (r: Pick<Row, "value" | "ref_low" | "ref_high">): Row["group"] =>
  toNumber(r.value) === null ? (r.value.trim() ? "words" : "range") : OUTSIDE(rowFlag(r)) ? "outside" : "range";

function Dot({ flag }: { flag: LabFlag }) {
  const fill = flag === "normal" ? "bg-good" : OUTSIDE(flag) ? "bg-act" : "bg-muted/40";
  return <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${fill}`} />;
}

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

export function ReviewSheet({ read, messageId = null, onClose, onSaved }: { read: DocumentReadView; messageId?: string | null; onClose: () => void; onSaved?: (view: HealthView) => void }) {
  const t = useT();
  const [kind, setKind] = useState<DocumentKind>(read.kind);
  const [title, setTitle] = useState(read.title);
  const [takenOn, setTakenOn] = useState(read.taken_on ?? "");
  const [source, setSource] = useState(read.source);
  const [summary, setSummary] = useState(read.summary);
  const [ticked, setTicked] = useState<boolean[]>(() => read.facts.map(() => true));
  const [rows, setRows] = useState<Row[]>(() =>
    read.observations.map((r) => {
      const row = { value: r.value === null ? r.text_value : String(r.value), ref_low: toText(r.ref_low), ref_high: toText(r.ref_high) };
      return { key: crypto.randomUUID(), code: r.code, name: r.name, printed_name: r.printed_name, unit: r.unit, ...row, group: groupOf(row) };
    }),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const filled = rows.filter((r) => r.name.trim() && r.value.trim());
  const save = useRecordsWrite(() => {
    const facts: FactDraft[] = read.facts.filter((_, i) => ticked[i]);
    const body: DocumentInput = {
      kind,
      taken_on: takenOn,
      title: title.trim(),
      source: source.trim(),
      language: read.language,
      summary: summary.trim(),
      observations: filled.map((r) => {
        const value = toNumber(r.value);
        return {
          code: LAB_MARKERS.includes(r.code) ? r.code : "other",
          name: r.name.trim(),
          printed_name: r.printed_name.trim(),
          value,
          text_value: value === null ? r.value.trim() : "",
          unit: r.unit.trim(),
          ref_low: toNumber(r.ref_low),
          ref_high: toNumber(r.ref_high),
        };
      }),
      facts,
      suggestions: read.facts.filter((_, i) => !ticked[i]),
      message_id: messageId,
    };
    return api<HealthView>("/api/records/documents", { json: body });
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
    const sub = [r.printed_name && `“${r.printed_name}”`, rangeText(toNumber(r.ref_low), toNumber(r.ref_high), t)].filter(Boolean).join(" · ");
    return (
      <li key={r.key}>
        <button type="button" onClick={() => setEditing(r.key)} className="tap flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left">
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
  const visibleInRange = showAll || outside.length === 0 ? inRange : inRange.filter((r, i) => i < 2 || r.key === editing);
  const group = (heading: string, list: Row[], extra?: ReactNode) =>
    list.length > 0 && (
      <>
        <Label>{heading}</Label>
        <ul className="raised-sm divide-y divide-muted/15 overflow-hidden rounded-2xl">
          {list.map(show)}
          {extra}
        </ul>
      </>
    );
  const canSave = Boolean(takenOn) && (filled.length > 0 || summary.trim() !== "" || read.facts.length > 0);

  return (
    <Sheet label={t.health.checkTitle} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      save.mutate(undefined, {
        onSuccess: (view) => {
          onSaved?.(view as HealthView);
          onClose();
        },
      });
    }}>
      <h2 className="text-lg font-semibold">{t.health.checkTitle}</h2>
      <p className="mt-0.5 text-sm text-muted">{t.health.checkNote}</p>
      {read.language && (
        <p className="pressed mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
          <span className="shrink-0 text-accent-ink"><Icon name="translate" size={18} /></span>
          {t.health.readFrom(read.language)}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-sm">
          {t.health.kind}
          <select value={kind} onChange={(event) => setKind(event.target.value as DocumentKind)} className={fieldClass}>
            {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{t.health.documentKinds[k]}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          {t.health.takenOn}
          <input type="date" required value={takenOn} onChange={(event) => setTakenOn(event.target.value)} className={fieldClass} />
        </label>
        <label className="block text-sm">
          {t.health.titleField}
          <input maxLength={100} value={title} placeholder={t.health.documentKinds[kind]} onChange={(event) => setTitle(event.target.value)} className={fieldClass} />
        </label>
        <label className="block text-sm">
          {t.health.source}
          <input maxLength={100} value={source} onChange={(event) => setSource(event.target.value)} className={fieldClass} />
        </label>
      </div>
      {(summary || kind !== "lab") && (
        <label className="mt-3 block text-sm">
          {t.health.summary}
          <textarea rows={3} maxLength={1000} value={summary} onChange={(event) => setSummary(event.target.value)} className={`${fieldClass} resize-none`} />
        </label>
      )}
      {read.facts.length > 0 && (
        <>
          <Label>{t.health.foundFacts}</Label>
          <ul className="raised-sm divide-y divide-muted/15 overflow-hidden rounded-2xl">
            {read.facts.map((fact, i) => (
              <li key={i}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={ticked[i] ?? false}
                    onChange={(event) => setTicked((list) => list.map((v, j) => (j === i ? event.target.checked : v)))}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--nm-accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{t.health.kinds[fact.kind]}</span>
                    <span className="block text-sm font-medium">{factName(fact, t)}</span>
                    {fact.detail && <span className="block text-xs text-muted">{fact.detail}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 px-0.5 text-xs text-muted">{t.health.foundNote}</p>
        </>
      )}
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
        className="mt-3 flex min-h-11 items-center gap-1 text-sm font-medium text-accent-ink"
        onClick={() => {
          const key = crypto.randomUUID();
          setRows((list) => [...list, { key, code: "other", name: "", printed_name: "", value: "", unit: "", ref_low: "", ref_high: "", group: "range" }]);
          setEditing(key);
        }}
      >
        <Icon name="add" size={16} />
        {t.health.addRow}
      </button>
      {save.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={quietButton}>{t.health.discard}</button>
        <button type="submit" disabled={save.isPending || !canSave} className={primaryButton}>{t.health.saveRecord}</button>
      </div>
    </Sheet>
  );
}
