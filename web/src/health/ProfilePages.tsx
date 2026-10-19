import { useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { api } from "../api.ts";
import { Segmented, Toggle, fieldClass, primaryButton, quietButton } from "../components/ui.tsx";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { FOOD_LEVELS, LEVELLED_KINDS, hasLevel } from "../shared.ts";
import type { FactInput, FactKind, FactView, FoodLevel, HealthCondition, HealthView } from "../shared.ts";
import { FACT_ICONS, Heading, Label, SECTIONS, Screen, Sheet, WithHealth, factName, recordDate, useRecordsWrite } from "./common.tsx";
import type { Section } from "./common.tsx";

// The profile behind the home's tiles (2026-10-19 health tab design §3): a list per section, the editor every fact opens
// in, and Diet & allergies with its diet chips, foods by level and daily targets.

const DATED: readonly FactKind[] = ["condition", "injury", "medication"];
/** Ways of eating that exclude each other; halal and kosher go with any of them. */
const PATTERNS: readonly HealthCondition[] = ["vegetarian", "vegan", "pescatarian"];
const RULES: readonly HealthCondition[] = ["halal", "kosher"];

const LEVEL_STYLE: Record<FoodLevel, string> = {
  never: "bg-act text-white",
  limit: "bg-tint-near text-ink",
  avoid: "pressed text-ink",
  prefer: "bg-accent text-on-accent",
};

function toInput(fact: FactView): FactInput {
  const { kind, code, label, detail, level, started_on, ended_on, status, shared } = fact;
  return { kind, code, label, detail, level, started_on, ended_on, status, shared };
}

/** Adds or edits one fact. A new one starts from its kind; a known code keeps the app's name unless the words change. */
function FactSheet({ fact, kind, onClose }: { fact: FactView | null; kind: FactKind; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState<FactInput>(() =>
    fact ? toInput(fact) : { kind, code: null, label: "", detail: "", level: LEVELLED_KINDS[kind] ?? null, started_on: null, ended_on: null, status: "active", shared: true },
  );
  const name = fact ? factName(fact, t) : "";
  const [label, setLabel] = useState(name);
  const body = (): FactInput => ({ ...form, label: label.trim(), code: fact?.code && label.trim() === name ? fact.code : null });
  const save = useRecordsWrite(() =>
    fact ? api<FactView>(`/api/records/facts/${fact.id}`, { method: "PUT", json: body() }) : api<FactView>("/api/records/facts", { json: body() }),
  );
  const remove = useRecordsWrite(() => api<void>(`/api/records/facts/${fact!.id}`, { method: "DELETE" }));
  const heading = fact ? t.health.editItem(name) : t.health.kinds[kind];
  return (
    <Sheet label={heading} onClose={onClose} onSubmit={(event) => {
      event.preventDefault();
      save.mutate(undefined, { onSuccess: onClose });
    }}>
      <h2 className="text-lg font-semibold">{heading}</h2>
      <label className="mt-3 block text-sm">
        {form.kind === "target" ? t.health.newTarget : t.health.name}
        <input
          required
          maxLength={100}
          value={label}
          placeholder={form.kind === "target" ? t.health.targetHint : undefined}
          onChange={(event) => setLabel(event.target.value)}
          className={fieldClass}
        />
      </label>
      {t.health.detailHint[form.kind] !== undefined && (
        <label className="mt-3 block text-sm">
          {t.health.detail}
          <input maxLength={200} value={form.detail} placeholder={t.health.detailHint[form.kind]} onChange={(event) => setForm({ ...form, detail: event.target.value })} className={fieldClass} />
        </label>
      )}
      {hasLevel(form.kind) && form.level && (
        <div className="mt-3">
          <Segmented
            legend={t.health.level}
            options={FOOD_LEVELS.map((level) => ({ value: level, label: t.health.levels[level] }))}
            value={form.level}
            onChange={(level) => setForm({ ...form, level })}
          />
          <p className="mt-1 text-xs text-muted">{t.health.levelNotes[form.level]}</p>
        </div>
      )}
      {DATED.includes(form.kind) && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm">
            {t.health.started}
            <input type="date" value={form.started_on ?? ""} onChange={(event) => setForm({ ...form, started_on: event.target.value || null })} className={fieldClass} />
          </label>
          <label className="block text-sm">
            {t.health.ended}
            <input
              type="date"
              min={form.started_on ?? undefined}
              value={form.ended_on ?? ""}
              onChange={(event) => setForm({ ...form, ended_on: event.target.value || null, status: event.target.value ? "resolved" : "active" })}
              className={fieldClass}
            />
          </label>
        </div>
      )}
      <div className="mt-2 flex flex-wrap justify-between gap-2">
        <Toggle label={t.health.show(label || t.health.kinds[form.kind])} checked={form.shared ?? true} onChange={(shared) => setForm({ ...form, shared })} />
        {fact && (
          <Toggle label={t.health.resolve} checked={form.status === "resolved"} onChange={(resolved) => setForm({ ...form, status: resolved ? "resolved" : "active" })} />
        )}
      </div>
      {(save.isError || remove.isError) && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        {fact ? (
          <button
            type="button"
            className="min-h-11 font-medium text-danger"
            disabled={remove.isPending}
            onClick={() => window.confirm(t.health.confirmDelete(name)) && remove.mutate(undefined, { onSuccess: onClose })}
          >
            {t.common.delete}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={quietButton}>{t.common.cancel}</button>
          <button type="submit" disabled={save.isPending || !label.trim()} className={primaryButton}>{t.common.save}</button>
        </div>
      </div>
    </Sheet>
  );
}

function FactRow({ fact, onOpen }: { fact: FactView; onOpen: () => void }) {
  const t = useT();
  const when = [fact.started_on && t.health.since(recordDate(fact.started_on, t)), fact.ended_on && t.health.until(recordDate(fact.ended_on, t))].filter(Boolean);
  const sub = [fact.detail, ...when, !fact.shared && t.health.hidden].filter(Boolean).join(" · ");
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={t.health.editItem(factName(fact, t))} className="tap flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left">
        <span className={`shrink-0 ${fact.status === "active" ? "text-accent-ink" : "text-muted"}`}><Icon name={FACT_ICONS[fact.kind]} size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[15px] font-medium ${fact.status === "resolved" ? "text-muted" : ""}`}>{factName(fact, t)}</span>
          {sub && <span className="block text-xs text-muted">{sub}</span>}
        </span>
        {fact.level && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${LEVEL_STYLE[fact.level]}`}>{t.health.levels[fact.level]}</span>}
      </button>
    </li>
  );
}

function FactList({ facts, onOpen }: { facts: FactView[]; onOpen: (fact: FactView) => void }) {
  return (
    <ul className="raised divide-y divide-muted/15 overflow-hidden rounded-3xl">
      {facts.map((fact) => <FactRow key={fact.id} fact={fact} onOpen={() => onOpen(fact)} />)}
    </ul>
  );
}

function AddLinks({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <div className="mt-5 grid grid-cols-2 gap-3">
      <Link to="/health/chat" className="tap raised-sm flex min-h-12 items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-accent-ink">
        <Icon name="chat" size={18} />
        {t.health.addInChat}
      </Link>
      <button type="button" onClick={onAdd} className="tap raised-sm flex min-h-12 items-center justify-center gap-2 rounded-2xl text-sm font-medium">
        <Icon name="add" size={18} />
        {t.health.add}
      </button>
    </div>
  );
}

function SectionList({ view, section }: { view: HealthView; section: Exclude<Section, "diet"> }) {
  const t = useT();
  const [open, setOpen] = useState<{ fact: FactView | null } | null>(null);
  const kind = SECTIONS[section][0];
  const facts = view.facts.filter((f) => f.kind === kind);
  const active = facts.filter((f) => f.status === "active");
  const past = facts.filter((f) => f.status === "resolved");
  return (
    <>
      {facts.length === 0 && <p className="mt-4 px-0.5 text-sm text-muted">{t.health.sectionEmpty}</p>}
      {active.length > 0 && <div className="mt-4"><FactList facts={active} onOpen={(fact) => setOpen({ fact })} /></div>}
      {past.length > 0 && (
        <>
          <Label>{t.health.past}</Label>
          <FactList facts={past} onOpen={(fact) => setOpen({ fact })} />
        </>
      )}
      <AddLinks onAdd={() => setOpen({ fact: null })} />
      {open && <FactSheet fact={open.fact} kind={kind} onClose={() => setOpen(null)} />}
    </>
  );
}

export function SectionPage() {
  const t = useT();
  const { section } = useParams();
  if (section !== "conditions" && section !== "injuries" && section !== "medications") return <Navigate to="/health" replace />;
  return (
    <Screen title={t.health.sections[section]} back="/health">
      <WithHealth>{(view) => <SectionList view={view} section={section} />}</WithHealth>
    </Screen>
  );
}

function Diet({ view }: { view: HealthView }) {
  const t = useT();
  const [open, setOpen] = useState<{ fact: FactView | null; kind: FactKind } | null>(null);
  const active = view.facts.filter((f) => f.status === "active");
  const diets = active.filter((f) => f.kind === "diet");
  const write = useRecordsWrite(async ({ add, remove }: { add: HealthCondition | null; remove: FactView[] }) => {
    for (const fact of remove) await api<void>(`/api/records/facts/${fact.id}`, { method: "DELETE" });
    if (add) await api<FactView>("/api/records/facts", { json: { kind: "diet", code: add, label: t.health.conditionNames[add] } satisfies FactInput });
  });
  const has = (code: HealthCondition) => diets.find((f) => f.code === code);
  const patterns = diets.filter((f) => f.code && PATTERNS.includes(f.code));
  const chip = (on: boolean) => `tap h-10 rounded-full px-3.5 text-sm flex items-center gap-1.5 ${on ? "pressed font-semibold text-accent-ink" : "raised-sm"}`;
  const foods = active.filter((f) => f.kind === "allergy" || f.kind === "intolerance" || f.kind === "food");
  const targets = active.filter((f) => f.kind === "target");
  const documentDate = (id: string | null) => view.documents.find((d) => d.id === id)?.taken_on;
  return (
    <>
      <Heading>{t.health.howYouEat}</Heading>
      <ul className="flex flex-wrap gap-2">
        <li>
          <button type="button" aria-pressed={patterns.length === 0} disabled={write.isPending} onClick={() => write.mutate({ add: null, remove: patterns })} className={chip(patterns.length === 0)}>
            {t.health.everything}
          </button>
        </li>
        {[...PATTERNS, ...RULES].map((code) => {
          const on = Boolean(has(code));
          return (
            <li key={code}>
              <button
                type="button"
                aria-pressed={on}
                disabled={write.isPending}
                onClick={() =>
                  on
                    ? write.mutate({ add: null, remove: [has(code)!] })
                    : write.mutate({ add: code, remove: PATTERNS.includes(code) ? patterns : [] })
                }
                className={chip(on)}
              >
                {on && <Icon name="check" size={16} />}
                {t.health.conditionNames[code]}
              </button>
            </li>
          );
        })}
        {diets.filter((f) => !f.code || ![...PATTERNS, ...RULES].includes(f.code)).map((fact) => (
          <li key={fact.id}>
            <button type="button" onClick={() => setOpen({ fact, kind: "diet" })} className={chip(true)}>{factName(fact, t)}</button>
          </li>
        ))}
      </ul>
      {write.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}

      <Heading action={<button type="button" onClick={() => setOpen({ fact: null, kind: "food" })} className="min-h-11 text-sm font-medium text-accent-ink">{t.health.add}</button>}>
        {t.health.foodsToWatch}
      </Heading>
      {foods.length > 0 ? <FactList facts={foods} onOpen={(fact) => setOpen({ fact, kind: fact.kind })} /> : <p className="px-0.5 text-sm text-muted">{t.health.sectionEmpty}</p>}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 px-0.5 text-xs text-muted">
        {FOOD_LEVELS.map((level) => (
          <div key={level}>
            <dt className="inline font-semibold text-ink">{t.health.levels[level]}</dt> <dd className="inline">· {t.health.levelNotes[level]}</dd>
          </div>
        ))}
      </dl>

      <Heading action={<button type="button" onClick={() => setOpen({ fact: null, kind: "target" })} className="min-h-11 text-sm font-medium text-accent-ink">{t.health.add}</button>}>
        {t.health.targets}
      </Heading>
      {targets.length > 0 ? (
        <ul className="raised divide-y divide-muted/15 overflow-hidden rounded-3xl">
          {targets.map((fact) => {
            const from = documentDate(fact.document_id);
            return (
              <li key={fact.id}>
                <button type="button" onClick={() => setOpen({ fact, kind: "target" })} className="tap flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px]">{factName(fact, t)}</span>
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <Icon name="description" size={12} />
                      {from ? t.health.fromRecord(recordDate(from, t)) : t.health.byYou}
                    </span>
                  </span>
                  <span className="text-muted"><Icon name="chevron_right" size={18} /></span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-0.5 text-sm text-muted">{t.health.sectionEmpty}</p>
      )}

      <section className="pressed mt-6 flex flex-col gap-2.5 rounded-3xl p-4">
        <h2 className="text-sm font-semibold">{t.health.sayIt}</h2>
        <p className="text-sm text-muted">{t.health.sayItExample}</p>
        <Link to="/health/chat" className="tap raised-sm flex h-10 items-center gap-1.5 self-start rounded-xl px-3.5 text-sm font-medium text-accent-ink">
          <Icon name="edit" size={16} />
          {t.health.describeDiet}
        </Link>
      </section>
      {open && <FactSheet fact={open.fact} kind={open.kind} onClose={() => setOpen(null)} />}
    </>
  );
}

export function DietPage() {
  const t = useT();
  return (
    <Screen title={t.health.sections.diet} back="/health">
      <WithHealth>{(view) => <Diet view={view} />}</WithHealth>
    </Screen>
  );
}
