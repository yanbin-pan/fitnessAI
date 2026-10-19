import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { DocumentReadView, DocumentView, FactView, HealthView, MarkerTrend } from "../shared.ts";
import {
  DOCUMENT_ICONS, FACT_ICONS, Heading, SECTIONS, Screen, WithHealth, amount, documentTitle, factName, failure, monthName, recordDate,
  useReadRecord,
} from "./common.tsx";
import type { Section } from "./common.tsx";
import { ReviewSheet } from "./ReviewSheet.tsx";

// The Health tab's home (2026-10-19 health tab design §3, direction A): tell the coach or scan a record, what waits for
// your OK, the profile as four tiles, what the coach is watching, and the latest records.

const SECTION_ICON: Record<Section, Parameters<typeof Icon>[0]["name"]> = {
  conditions: FACT_ICONS.condition, injuries: FACT_ICONS.injury, medications: FACT_ICONS.medication, diet: FACT_ICONS.diet,
};

const OUTSIDE = (flag: string) => flag === "low" || flag === "high";

function Tell({ onRead }: { onRead: (read: DocumentReadView) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const read = useReadRecord(onRead);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The chat sends it: the conversation is where the coach answers and proposes.
    navigate("/health/chat", { state: { text: text.trim() } });
  };
  const picker = (label: string, capture: boolean) => (
    <label
      className={`tap raised-sm flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-2xl px-3 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${capture ? "text-accent-ink" : ""} ${read.isPending ? "opacity-40" : ""}`}
    >
      <Icon name={capture ? "photo_camera" : "upload"} size={20} />
      {label}
      <input
        type="file"
        accept="image/*"
        multiple
        {...(capture ? { capture: "environment" as const } : {})}
        disabled={read.isPending}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) read.mutate(files);
        }}
        className="sr-only"
      />
    </label>
  );
  return (
    <section className="raised mt-5 rounded-3xl p-4" aria-label={t.health.tellTitle}>
      <h2 className="text-base font-semibold">{t.health.tellTitle}</h2>
      <p className="mt-1 text-sm text-muted">{t.health.tellBody}</p>
      <form onSubmit={submit} className="pressed mt-3 flex items-center gap-2 rounded-2xl py-1 pr-1 pl-3">
        <input
          aria-label={t.health.tellTitle}
          value={text}
          maxLength={1000}
          onChange={(event) => setText(event.target.value)}
          placeholder={t.health.tellPlaceholder}
          className="min-w-0 flex-1 bg-transparent py-2 text-base text-ink placeholder:text-muted focus:outline-none"
        />
        <button
          type="submit"
          aria-label={t.health.send}
          className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent"
        >
          <Icon name="arrow_upward" size={20} />
        </button>
      </form>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {picker(t.health.scan, true)}
        {picker(t.health.upload, false)}
      </div>
      {read.isPending && <p role="status" className="mt-2 text-sm text-muted">{t.health.reading}</p>}
      {read.isError && <p role="alert" className="mt-2 text-sm text-danger">{failure(read.error, t, t.health.readFailed.failed)}</p>}
    </section>
  );
}

function Waiting({ view }: { view: HealthView }) {
  const t = useT();
  if (view.suggestions.length === 0) return null;
  const names = view.suggestions.map((s) => factName(s.fact, t)).join(" · ");
  // From the chat, the chat; from a record, that record.
  const first = view.suggestions[0]!;
  const to = first.document_id && !first.message_id ? `/health/records/${first.document_id}` : "/health/chat";
  return (
    <Link to={to} className="tap raised mt-4 flex items-center gap-3 rounded-3xl px-4 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-on-accent">{view.suggestions.length}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{t.health.waiting}</span>
        <span className="block truncate text-xs text-muted">{names}</span>
      </span>
      <span className="text-sm font-medium text-accent-ink">{t.health.review}</span>
    </Link>
  );
}

function tileLines(section: Section, facts: FactView[], t: Messages): { lines: string[]; footer: string } {
  const active = facts.filter((f) => f.status === "active");
  if (section === "diet") {
    const diet = active.filter((f) => f.kind === "diet").map((f) => factName(f, t));
    const foods = active.filter((f) => f.level === "never" || f.level === "limit").map((f) => factName(f, t));
    const targets = active.filter((f) => f.kind === "target").length;
    return { lines: [diet.join(" · "), foods.join(" · ")].filter(Boolean), footer: targets > 0 ? t.health.targetsSet(targets) : t.health.added(active.length) };
  }
  return {
    lines: active.slice(0, 2).map((f) => (section === "conditions" ? factName(f, t) : [factName(f, t), f.detail].filter(Boolean).join(" · "))),
    footer: t.health.added(active.length),
  };
}

function Profile({ view }: { view: HealthView }) {
  const t = useT();
  return (
    <section aria-label={t.health.profile}>
      <Heading action={<Link to="/health/coach" className="text-sm font-medium text-accent-ink">{t.health.coachSees}</Link>}>
        {t.health.profile}
      </Heading>
      <ul className="grid grid-cols-2 gap-3">
        {(Object.keys(SECTIONS) as Section[]).map((section) => {
          const facts = view.facts.filter((f) => (SECTIONS[section] as readonly string[]).includes(f.kind));
          const { lines, footer } = tileLines(section, facts, t);
          return (
            <li key={section}>
              <Link
                to={section === "diet" ? "/health/diet" : `/health/profile/${section}`}
                className="tap raised flex h-full min-h-32 flex-col gap-2 rounded-3xl p-3.5"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="text-accent-ink"><Icon name={SECTION_ICON[section]} size={20} /></span>
                  {t.health.sections[section]}
                </span>
                <span className="flex flex-col gap-0.5 text-[13px] leading-snug">
                  {lines.length > 0 ? lines.map((line) => <span key={line} className="line-clamp-2">{line}</span>) : <span className="text-muted">{t.health.noneYet}</span>}
                </span>
                {lines.length > 0 && <span className="mt-auto text-xs text-muted">{footer}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The latest result outside its range, worst first by how far it sits out: what the coach keeps an eye on. */
export function watched(trends: readonly MarkerTrend[]): MarkerTrend | null {
  const out = trends.filter((trend) => OUTSIDE(trend.points.at(-1)?.flag ?? "unknown"));
  const distance = (trend: MarkerTrend) => {
    const value = trend.points.at(-1)!.value;
    const edge = value > (trend.ref_high ?? Infinity) ? trend.ref_high! : (trend.ref_low ?? value);
    return Math.abs(value - edge) / (Math.abs(edge) || 1);
  };
  const latest = Math.max(...out.map((trend) => Date.parse(trend.points.at(-1)!.taken_on)));
  return out.filter((trend) => Date.parse(trend.points.at(-1)!.taken_on) === latest).sort((a, b) => distance(b) - distance(a))[0] ?? null;
}

function Watching({ view }: { view: HealthView }) {
  const t = useT();
  const trend = watched(view.trends);
  if (!trend) return null;
  const last = trend.points.at(-1)!;
  const first = trend.points[0]!;
  const line = trend.points.length > 1
    ? t.health.moved(trend.name, amount(first.value, t), amount(last.value, t), monthName(first.taken_on, t))
    : t.health.standsAt(trend.name, `${amount(last.value, t)} ${trend.unit}`, t.health.flags[last.flag]);
  return (
    <Link to={`/health/markers/${encodeURIComponent(trend.key)}`} className="tap pressed mt-5 flex flex-col gap-2 rounded-3xl p-4">
      <span className="flex items-center gap-2 text-xs font-semibold text-accent-ink">
        <Icon name="monitoring" size={18} />
        {t.health.watching}
      </span>
      <span className="text-[15px] leading-snug">{line}</span>
      <span className="flex items-center justify-end gap-0.5 text-sm font-medium text-accent-ink">
        {t.health.seeTrend}
        <Icon name="chevron_right" size={18} />
      </span>
    </Link>
  );
}

export function RecordRow({ doc }: { doc: DocumentView }) {
  const t = useT();
  const outside = doc.observations.filter((o) => OUTSIDE(o.flag)).length;
  const meta = [recordDate(doc.taken_on, t), doc.language, outside > 0 ? t.health.outOfRange(outside) : doc.source].filter(Boolean).join(" · ");
  return (
    <li>
      <Link to={`/health/records/${doc.id}`} className="tap flex min-h-11 items-center gap-3 px-4 py-3">
        <span className={`pressed flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${outside > 0 ? "text-act" : "text-muted"}`}>
          <Icon name={DOCUMENT_ICONS[doc.kind]} size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{documentTitle(doc, t)}</span>
          <span className="block truncate text-xs text-muted">{meta}</span>
        </span>
        <span className="text-muted"><Icon name="chevron_right" size={18} /></span>
      </Link>
    </li>
  );
}

function Records({ view }: { view: HealthView }) {
  const t = useT();
  return (
    <section aria-label={t.health.records}>
      <Heading action={view.documents.length > 3 && <Link to="/health/records" className="text-sm font-medium text-accent-ink">{t.health.allRecords(view.documents.length)}</Link>}>
        {t.health.records}
      </Heading>
      {view.documents.length === 0 ? (
        <p className="px-0.5 text-sm text-muted">{t.health.noRecords}</p>
      ) : (
        <ul className="raised divide-y divide-muted/15 overflow-hidden rounded-3xl">
          {view.documents.slice(0, 3).map((doc) => <RecordRow key={doc.id} doc={doc} />)}
        </ul>
      )}
    </section>
  );
}

export function HealthHome() {
  const t = useT();
  const navigate = useNavigate();
  const [review, setReview] = useState<DocumentReadView | null>(null);
  return (
    <Screen
      title={t.health.title}
      subtitle={t.health.subtitle}
      action={
        <Link to="/health/records" aria-label={t.health.records} className="tap raised-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-muted">
          <Icon name="search" size={20} />
        </Link>
      }
    >
      <WithHealth>
        {(view) => (
          <>
            <Tell onRead={setReview} />
            <Waiting view={view} />
            <Profile view={view} />
            <Watching view={view} />
            <Records view={view} />
            {review && (
              <ReviewSheet
                read={review}
                onClose={() => setReview(null)}
                onSaved={(saved) => saved.documents[0] && navigate(`/health/records/${saved.documents.find((d) => !view.documents.some((old) => old.id === d.id))?.id ?? saved.documents[0].id}`)}
              />
            )}
          </>
        )}
      </WithHealth>
    </Screen>
  );
}
