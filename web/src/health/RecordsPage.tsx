import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { useHealth } from "../queries.ts";
import type { DocumentKind, DocumentView, HealthView, ObservationView, SuggestionView } from "../shared.ts";
import { Label, RangeBar, Screen, WithHealth, amount, documentTitle, factName, monthName, rangeText, recordDate, useRecordsWrite } from "./common.tsx";
import { RecordRow } from "./HealthHome.tsx";

// Every record, filtered by kind, and one record's page (2026-10-19 health tab design §3).

const FILTERS = { all: null, lab: ["lab"], imaging: ["imaging"], notes: ["letter", "prescription", "other"] } as const satisfies Record<string, readonly DocumentKind[] | null>;
type Filter = keyof typeof FILTERS;

const OUTSIDE = (flag: string) => flag === "low" || flag === "high";

/** How a value is grouped across records, as the server groups it: by code, or by printed name for `other`. */
export function markerKey(result: Pick<ObservationView, "code" | "name">): string {
  return result.code === "other" ? `other:${result.name.trim().toLowerCase()}` : result.code;
}

function AllRecords({ view }: { view: HealthView }) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const kinds = FILTERS[filter] as readonly DocumentKind[] | null;
  const shown = view.documents.filter((doc) => !kinds || kinds.includes(doc.kind));
  return (
    <>
      <div role="group" aria-label={t.health.records} className="pressed mt-4 grid grid-cols-4 gap-1 rounded-2xl p-1">
        {(Object.keys(FILTERS) as Filter[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`h-9 rounded-xl text-sm ${filter === key ? "raised-sm font-semibold text-accent-ink" : "text-muted"}`}
          >
            {t.health.filters[key]}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 px-0.5 text-sm text-muted">{t.health.noRecords}</p>
      ) : (
        <ul className="raised mt-4 divide-y divide-muted/15 overflow-hidden rounded-3xl">
          {shown.map((doc) => <RecordRow key={doc.id} doc={doc} />)}
        </ul>
      )}
    </>
  );
}

export function RecordsPage() {
  const t = useT();
  return (
    <Screen title={t.health.records} back="/health">
      <WithHealth>{(view) => <AllRecords view={view} />}</WithHealth>
    </Screen>
  );
}

function ResultRow({ result, previous }: { result: ObservationView; previous: { taken_on: string; value: number } | null }) {
  const t = useT();
  const range = rangeText(result.ref_low, result.ref_high, t);
  const outside = OUTSIDE(result.flag);
  if (result.value === null) {
    return (
      <li className="flex min-h-11 items-center gap-3 px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[15px]">{result.name}</span>
        <span className="text-sm">{result.text_value}</span>
      </li>
    );
  }
  return (
    <li>
      <Link to={`/health/markers/${encodeURIComponent(markerKey(result))}`} className="tap flex flex-col gap-2.5 px-4 py-3.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-[15px] font-medium">{result.name}</span>
          <span className="shrink-0 text-[15px] font-bold tabular-nums">
            {amount(result.value, t)} <span className="text-xs font-normal text-muted">{result.unit}</span>
          </span>
        </span>
        {(result.ref_low !== null || result.ref_high !== null) && <RangeBar value={result.value} low={result.ref_low} high={result.ref_high} outside={outside} />}
        <span className="flex justify-between gap-2 text-xs text-muted">
          <span>
            <span className={outside ? "font-semibold text-act" : ""}>{t.health.flags[result.flag]}</span>
            {range && ` · ${t.health.normal(range)}`}
          </span>
          <span>{previous ? `${monthName(previous.taken_on, t)} ${amount(previous.value, t)} → ${amount(result.value, t)}` : t.health.firstTest}</span>
        </span>
      </Link>
    </li>
  );
}

function Suggests({ suggestions, added }: { suggestions: SuggestionView[]; added: string[] }) {
  const t = useT();
  const accept = useRecordsWrite((id: string) => api<SuggestionView>(`/api/records/suggestions/${id}/accept`, { method: "POST", json: {} }));
  if (suggestions.length === 0 && added.length === 0) return null;
  return (
    <>
      <Label>{t.health.suggests}</Label>
      <ul className="raised divide-y divide-muted/15 rounded-3xl px-4">
        {suggestions.map((s) => (
          <li key={s.id} className="flex min-h-11 items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{factName(s.fact, t)}</span>
              <span className="block text-xs text-muted">{[t.health.kinds[s.fact.kind], s.fact.detail].filter(Boolean).join(" · ")}</span>
            </span>
            <button
              type="button"
              disabled={accept.isPending}
              onClick={() => accept.mutate(s.id)}
              className="tap raised-sm h-9 rounded-xl px-3.5 text-sm font-semibold text-accent-ink"
            >
              {t.health.add}
            </button>
          </li>
        ))}
        {added.map((name) => (
          <li key={name} className="flex min-h-11 items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1 text-sm">{name}</span>
            <span className="flex items-center gap-1 text-sm font-medium text-accent-ink">
              <Icon name="check" size={16} />
              {t.health.addedLabel}
            </span>
          </li>
        ))}
      </ul>
      {accept.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      <p className="mt-1.5 px-0.5 text-xs text-muted">{t.health.onlyWhatYouAdd}</p>
    </>
  );
}

/** The other records, same kind first, nearest day first, to tick and fold into this one. */
function MergePicker({ view, doc, onDone }: { view: HealthView; doc: DocumentView; onDone: () => void }) {
  const t = useT();
  const [picked, setPicked] = useState<string[]>([]);
  const merge = useRecordsWrite((ids: string[]) => api<HealthView>(`/api/records/documents/${doc.id}/merge`, { json: { ids } }));
  const distance = (other: DocumentView) => Math.abs(Date.parse(other.taken_on) - Date.parse(doc.taken_on));
  const others = view.documents
    .filter((d) => d.id !== doc.id)
    .sort((a, b) => Number(b.kind === doc.kind) - Number(a.kind === doc.kind) || distance(a) - distance(b));
  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  return (
    <section aria-label={t.health.mergeTitle} className="pressed mt-4 rounded-3xl p-3">
      <h2 className="flex items-center gap-2 px-1 text-xs font-semibold text-accent-ink">
        <Icon name="call_merge" size={16} />
        {t.health.mergeTitle}
      </h2>
      <p className="mt-1 px-1 text-xs text-muted">{t.health.mergeHint}</p>
      {others.length === 0 ? (
        <p className="mt-3 px-1 text-sm text-muted">{t.health.nothingToMerge}</p>
      ) : (
        <ul className="mt-2 max-h-64 divide-y divide-muted/15 overflow-y-auto">
          {others.map((other) => {
            const on = picked.includes(other.id);
            return (
              <li key={other.id}>
                <button type="button" aria-pressed={on} onClick={() => toggle(other.id)} className="tap flex min-h-11 w-full items-center gap-3 px-1 py-2 text-left">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${on ? "raised-sm text-accent-ink" : "pressed text-transparent"}`}>
                    <Icon name="check" size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{documentTitle(other, t)}</span>
                    <span className="block truncate text-xs text-muted">
                      {[recordDate(other.taken_on, t), other.source, other.observations.length > 0 && t.health.resultsCount(other.observations.length)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {merge.isError && <p role="alert" className="mt-2 px-1 text-sm text-danger">{t.health.saveFailed}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onDone} className="tap h-9 rounded-xl px-3.5 text-sm text-muted">{t.common.cancel}</button>
        <button
          type="button"
          disabled={picked.length === 0 || merge.isPending}
          onClick={() => merge.mutate(picked, { onSuccess: onDone })}
          className="tap raised-sm h-9 rounded-xl px-3.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {t.health.mergeCount(picked.length)}
        </button>
      </div>
    </section>
  );
}

function Record({ view, doc }: { view: HealthView; doc: DocumentView }) {
  const t = useT();
  const navigate = useNavigate();
  const outside = doc.observations.filter((o) => OUTSIDE(o.flag));
  const [all, setAll] = useState(outside.length === 0);
  const [merging, setMerging] = useState(false);
  const remove = useRecordsWrite(() => api<void>(`/api/records/documents/${doc.id}`, { method: "DELETE" }));
  const trends = new Map(view.trends.map((trend) => [trend.key, trend.points]));
  const previous = (result: ObservationView) => {
    const earlier = (trends.get(markerKey(result)) ?? []).filter((p) => p.taken_on < doc.taken_on);
    return earlier.at(-1) ?? null;
  };
  const shown = all ? doc.observations : outside;
  const title = documentTitle(doc, t);
  return (
    <>
      {doc.summary && (
        <section className="pressed mt-4 rounded-3xl p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-accent-ink">
            <Icon name="description" size={16} />
            {t.health.inShort}
          </h2>
          <p className="mt-1.5 text-[15px] leading-snug">{doc.summary}</p>
        </section>
      )}
      {doc.language && (
        <p className="mt-3 flex items-center gap-2 px-0.5 text-xs text-muted">
          <Icon name="translate" size={16} />
          {t.health.readFrom(doc.language)}
        </p>
      )}
      {doc.observations.length > 0 && (
        <>
          {outside.length > 0 && (
            <div role="group" aria-label={t.health.records} className="pressed mt-4 grid grid-cols-2 gap-1 rounded-2xl p-1">
              <button type="button" aria-pressed={!all} onClick={() => setAll(false)} className={`h-9 rounded-xl text-sm ${!all ? "raised-sm font-semibold text-accent-ink" : "text-muted"}`}>
                {t.health.viewOutside(outside.length)}
              </button>
              <button type="button" aria-pressed={all} onClick={() => setAll(true)} className={`h-9 rounded-xl text-sm ${all ? "raised-sm font-semibold text-accent-ink" : "text-muted"}`}>
                {t.health.viewAll(doc.observations.length)}
              </button>
            </div>
          )}
          <ul className="raised mt-4 divide-y divide-muted/15 overflow-hidden rounded-3xl">
            {shown.map((result) => <ResultRow key={result.id} result={result} previous={previous(result)} />)}
          </ul>
        </>
      )}
      <Suggests
        suggestions={view.suggestions.filter((s) => s.document_id === doc.id)}
        added={view.facts.filter((f) => f.document_id === doc.id).map((f) => factName(f, t))}
      />
      <Link
        to="/health/chat"
        state={{ draft: t.health.askAboutText(title, recordDate(doc.taken_on, t)) }}
        className="tap raised-sm mt-6 flex h-13 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold text-accent-ink"
      >
        <Icon name="chat" size={18} />
        {t.health.askAbout}
      </Link>
      <p className="mt-3 px-2 text-center text-xs text-muted">{t.health.disclaimer}</p>
      {merging && <MergePicker view={view} doc={doc} onDone={() => setMerging(false)} />}
      {remove.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      <div className="mt-4 flex justify-center gap-6">
        {!merging && view.documents.length > 1 && (
          <button type="button" onClick={() => setMerging(true)} className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent-ink">
            <Icon name="call_merge" size={16} />
            {t.health.mergeRecord}
          </button>
        )}
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => window.confirm(t.health.confirmDeleteRecord) && remove.mutate(undefined, { onSuccess: () => navigate("/health/records", { replace: true }) })}
          className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-danger"
        >
          <Icon name="delete" size={16} />
          {t.health.deleteRecord}
        </button>
      </div>
    </>
  );
}

export function RecordPage() {
  const t = useT();
  const { id } = useParams();
  const found = useHealth().data?.documents.find((d) => d.id === id);
  return (
    <Screen
      title={found ? documentTitle(found, t) : t.health.records}
      subtitle={found ? [recordDate(found.taken_on, t), found.source].filter(Boolean).join(" · ") : undefined}
      back="/health/records"
    >
      <WithHealth>
        {(view) => {
          const doc = view.documents.find((d) => d.id === id);
          return doc ? <Record view={view} doc={doc} /> : <p className="mt-4 text-sm text-muted">{t.health.notFound}</p>;
        }}
      </WithHealth>
    </Screen>
  );
}
