import { api } from "../api.ts";
import { Toggle } from "../components/ui.tsx";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { useHealth } from "../queries.ts";
import type { FactInput, FactKind, FactView, HealthView } from "../shared.ts";
import { Label, Screen, WithHealth, documentTitle, factName, recordDate, useRecordsWrite } from "./common.tsx";

// What the coach sees (2026-10-19 health tab design §6): every fact with a switch to hide it from the coach, the records it
// reads, how the records are kept, and the way to take them away or delete them.

const GROUPS: readonly { kinds: readonly FactKind[]; title: (t: Messages) => string }[] = [
  { kinds: ["condition", "injury"], title: (t) => `${t.health.sections.conditions} · ${t.health.sections.injuries}` },
  { kinds: ["medication"], title: (t) => t.health.sections.medications },
  { kinds: ["diet", "allergy", "intolerance", "food", "target", "note"], title: (t) => t.health.sections.diet },
];

function ShareRow({ fact }: { fact: FactView }) {
  const t = useT();
  const save = useRecordsWrite((shared: boolean) => {
    const { kind, code, label, detail, level, started_on, ended_on, status } = fact;
    const body: FactInput = { kind, code, label, detail, level, started_on, ended_on, status, shared };
    return api<FactView>(`/api/records/facts/${fact.id}`, { method: "PUT", json: body });
  });
  const name = factName(fact, t);
  return (
    <li className="flex min-h-11 items-center gap-3 py-1.5 pl-4 pr-2">
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] ${fact.shared ? "" : "text-muted"}`}>{name}</span>
        <span className="block text-xs text-muted">
          {[fact.level && t.health.levels[fact.level], fact.detail, fact.status === "resolved" && t.health.past].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Toggle label={t.health.show(name)} hideLabel checked={fact.shared} onChange={(shared) => save.mutate(shared)} />
    </li>
  );
}

/** The sentence the coach effectively reads, in the app's words: what is shared and active. */
function summaryLine(view: HealthView, t: Messages): string {
  return view.facts
    .filter((f) => f.shared && f.status === "active")
    .map((f) => [factName(f, t), f.detail].filter(Boolean).join(" (") + (f.detail ? ")" : ""))
    .join(" · ");
}

function Sees({ view }: { view: HealthView }) {
  const t = useT();
  const deleteAll = useRecordsWrite(() => api<void>("/api/records", { method: "DELETE" }));
  const line = summaryLine(view, t);
  const latest = view.documents.slice(0, 3);
  return (
    <>
      <p className="pressed mt-4 rounded-3xl p-4 text-[15px] leading-relaxed">{line || t.health.coachNothing}</p>
      {GROUPS.map(({ kinds, title }) => {
        const facts = view.facts.filter((f) => kinds.includes(f.kind));
        if (facts.length === 0) return null;
        return (
          <section key={title(t)}>
            <Label>{title(t)}</Label>
            <ul className="raised divide-y divide-muted/15 rounded-3xl">
              {facts.map((fact) => <ShareRow key={fact.id} fact={fact} />)}
            </ul>
          </section>
        );
      })}
      {latest.length > 0 && (
        <section>
          <Label>{t.health.latestResults}</Label>
          <ul className="raised divide-y divide-muted/15 rounded-3xl">
            {latest.map((doc) => (
              <li key={doc.id} className="px-4 py-3">
                <span className="block text-[15px]">{documentTitle(doc, t)}</span>
                <span className="block text-xs text-muted">{recordDate(doc.taken_on, t)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="raised mt-6 flex flex-col gap-3 rounded-3xl p-4">
        <h2 className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span className="text-accent-ink"><Icon name="lock" size={20} /></span>
          {t.health.keptApart}
        </h2>
        <p className="text-sm text-muted">{t.health.keptApartBody}</p>
        {deleteAll.isError && <p role="alert" className="text-sm text-danger">{t.health.saveFailed}</p>}
        <div className="grid grid-cols-2 gap-2.5">
          <a href="/api/records/export" download="health-records.json" className="tap raised-sm flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-medium">
            <Icon name="download" size={18} />
            {t.health.exportAll}
          </a>
          <button
            type="button"
            disabled={deleteAll.isPending}
            onClick={() => window.confirm(t.health.confirmDeleteAll) && deleteAll.mutate(undefined)}
            className="tap raised-sm flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-danger"
          >
            <Icon name="delete" size={18} />
            {t.health.deleteAll}
          </button>
        </div>
      </section>
    </>
  );
}

export function CoachView() {
  const t = useT();
  return (
    <Screen title={t.health.coachTitle} subtitle={t.health.coachSubtitle} back="/health">
      <WithHealth>{(view) => <Sees view={view} />}</WithHealth>
    </Screen>
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
