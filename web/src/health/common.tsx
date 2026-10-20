import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router";
import { ApiError, api } from "../api.ts";
import { primaryButton } from "../components/ui.tsx";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import { preparePhoto } from "../photos/prepare.ts";
import { useHealth } from "../queries.ts";
import { MAX_LAB_PHOTOS } from "../shared.ts";
import type { DocumentKind, DocumentView, FactDraft, FactKind, HealthView, PhotoUpload } from "../shared.ts";

// What the Health tab's screens share (2026-10-19 health tab design): the page frame, the consent gate, names and dates,
// and the one way every screen writes.

/** A record's date with its year: records are months apart. */
export function recordDate(date: string, t: Messages): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(t.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Mar 2026": a month of the food log, or of a record when the day doesn't matter. */
export function monthName(date: string, t: Messages): string {
  return new Date(`${date.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString(t.locale, { month: "short", year: "numeric", timeZone: "UTC" });
}

export function amount(value: number, t: Messages): string {
  return value.toLocaleString(t.locale, { maximumFractionDigits: 2 });
}

export function rangeText(low: number | null, high: number | null, t: Messages): string {
  if (low !== null && high !== null) return `${amount(low, t)}–${amount(high, t)}`;
  if (low !== null) return `> ${amount(low, t)}`;
  if (high !== null) return `< ${amount(high, t)}`;
  return "";
}

/** A fact's name: the app's own for a known code, in the language shown now; otherwise the words it was saved with. */
export function factName(fact: Pick<FactDraft, "code" | "label">, t: Messages): string {
  return fact.code ? t.health.conditionNames[fact.code] : fact.label;
}

/** A record's title, or what kind of record it is when it has none ("Blood test"). */
export function documentTitle(doc: Pick<DocumentView, "title" | "kind">, t: Messages): string {
  return doc.title || t.health.documentKinds[doc.kind];
}

export const FACT_ICONS: Record<FactKind, IconName> = {
  condition: "stethoscope", injury: "healing", medication: "medication", allergy: "nutrition", intolerance: "nutrition",
  diet: "nutrition", food: "nutrition", target: "info", note: "info",
};

export const DOCUMENT_ICONS: Record<DocumentKind, IconName> = {
  lab: "bloodtype", imaging: "radiology", letter: "description", prescription: "prescriptions", other: "medical_information",
};

/** The home's four tiles, and which kinds each holds. */
export const SECTIONS = {
  conditions: ["condition"],
  injuries: ["injury"],
  medications: ["medication"],
  diet: ["diet", "allergy", "intolerance", "food", "target"],
} as const satisfies Record<string, readonly FactKind[]>;
export type Section = keyof typeof SECTIONS;

export function sectionOf(kind: FactKind): Section | null {
  for (const [section, kinds] of Object.entries(SECTIONS) as [Section, readonly FactKind[]][]) if (kinds.includes(kind)) return section;
  return null;
}

/** Every write on the Health tab refreshes the tab: the view, the chat and the markers. */
export function useRecordsWrite<I, O = unknown>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: ["health"] }) });
}

export function failure(error: unknown, t: Messages, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === "read_unreadable") return t.health.readFailed.unreadable;
    if (error.code === "ai_cap") return t.health.readFailed.cap;
    if (error.code === "ai_unavailable") return t.health.readFailed.off;
  }
  return fallback;
}

/** Uploads photos of a record (at most MAX_LAB_PHOTOS) and returns their ids, for a read or the chat. */
export async function uploadPhotos(files: readonly File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files.slice(0, MAX_LAB_PHOTOS)) {
    const { blob } = await preparePhoto(file);
    ids.push((await api<PhotoUpload>("/api/photos", { blob })).id);
  }
  return ids;
}

/** A screen of the tab: a title, the way back, and room under it for the tab bar. */
export function Screen({ title, subtitle, back, action, children }: { title: string; subtitle?: string; back?: string; action?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <main className="mx-auto max-w-xl px-4 pt-[calc(env(safe-area-inset-top)_+_1rem)] pb-[calc(var(--tabbar-h)_+_env(safe-area-inset-bottom)_+_2rem)]">
      <header className="flex items-center gap-3">
        {back && (
          <Link to={back} aria-label={t.health.back} className="tap raised-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
            <Icon name="chevron_left" size={22} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className={back ? "truncate text-lg font-semibold" : "text-2xl font-bold tracking-tight"}>{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}

/** A section's heading inside a screen, with an optional action on its right. */
export function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-baseline justify-between gap-2 px-0.5">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

/** A small heading in capitals, for a group of rows. */
export function Label({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 mb-2 px-0.5 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>;
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

/** The tab's data once it has loaded and the person has agreed; until then, loading, the error, or the consent card. */
export function WithHealth({ children }: { children: (view: HealthView) => ReactNode }) {
  const t = useT();
  const health = useHealth();
  const view = health.data;
  if (!view) {
    return (
      <p className={`mt-4 text-sm ${health.isError ? "text-danger" : "text-muted"}`} role={health.isError ? "alert" : undefined}>
        {health.isError ? t.health.loadFailed : t.common.loading}
      </p>
    );
  }
  if (!view.consented_at) return <Consent />;
  return <>{children(view)}</>;
}

/** A bottom sheet holding a form. */
export function Sheet({ label, onClose, children, onSubmit }: { label: string; onClose: () => void; children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
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

/**
 * Where a value sits against its range: the range shaded on a pressed track, the value as a dot, red when outside. The
 * track runs from below the range to above it, with room either side so a value outside still shows.
 */
export function RangeBar({ value, low, high, outside }: { value: number; low: number | null; high: number | null; outside: boolean }) {
  const ends = [value, low ?? value, high ?? value];
  const pad = (Math.max(...ends) - Math.min(...ends)) * 0.25 || Math.abs(value) * 0.25 || 1;
  const min = Math.min(...ends) >= 0 ? Math.max(0, Math.min(...ends) - pad) : Math.min(...ends) - pad;
  const max = Math.max(...ends) + pad;
  const pct = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const bandLeft = low === null ? 0 : (low - min) / (max - min);
  const bandRight = high === null ? 1 : (high - min) / (max - min);
  return (
    <span aria-hidden="true" className="pressed relative block h-2 rounded-full">
      <span className="absolute inset-y-0 rounded-full bg-tint-within" style={{ left: `${bandLeft * 100}%`, width: `${(bandRight - bandLeft) * 100}%` }} />
      <span
        className={`absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-[var(--nm-base)] ${outside ? "bg-act" : "bg-good"}`}
        style={{ left: pct(value) }}
      />
    </span>
  );
}
