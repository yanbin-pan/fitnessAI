import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { storeDay } from "../queries.ts";
import type { DeleteResult, Entry, EntryResult, QuickItem } from "../shared.ts";
import { sportOf } from "./SportBadge.tsx";

// The chat bar's quick logging (2026-11-01 frequent items): a star button that opens the pinned and suggested items in a
// card floating above the bar, and matches offered while typing. A tap logs with no word to the coach, so no tokens.

/** Lowercase, without accents, for matching what is typed against names. */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** Items whose name has a word starting with each word typed ("chi ri" finds "Chicken rice bowl"), best first. */
export function matchQuick(items: QuickItem[], typed: string, limit = 6): QuickItem[] {
  const words = fold(typed).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0 || fold(typed).trim().length < 2) return [];
  return items
    .filter((item) => {
      const nameWords = fold(item.name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      return words.every((w) => nameWords.some((n) => n.startsWith(w)));
    })
    .slice(0, limit);
}

/** The part of a name that matches what was typed, in bold: the first word that starts with the first typed word. */
function Highlighted({ name, typed }: { name: string; typed?: string }) {
  const first = typed ? fold(typed).split(/[^\p{L}\p{N}]+/u).find(Boolean) : undefined;
  if (!first) return <>{name}</>;
  const folded = fold(name);
  // Folding can change length (é → e + accent): only highlight when it did not.
  if (folded.length !== name.length) return <>{name}</>;
  const at = folded.split("").findIndex((_, i) => (i === 0 || /[^\p{L}\p{N}]/u.test(folded[i - 1])) && folded.startsWith(first, i));
  if (at < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <mark className="rounded bg-accent/15 font-semibold text-ink">{name.slice(at, at + first.length)}</mark>
      {name.slice(at + first.length)}
    </>
  );
}

/** Logs quick items and keeps the last one for an undo. The entry id belongs to the tap, so a retry after a lost reply logs once. */
export function useQuickLog() {
  const client = useQueryClient();
  const ids = useRef(new Map<string, string>());
  const [last, setLast] = useState<{ entry: Entry; name: string } | null>(null);
  const log = useMutation({
    mutationFn: (item: QuickItem) => {
      const id = ids.current.get(item.ref) ?? crypto.randomUUID();
      ids.current.set(item.ref, id);
      const path = item.ref.startsWith("f:") ? `/api/frequent/${item.ref.slice(2)}/log` : `/api/regulars/${item.ref.slice(2)}/log`;
      return api<EntryResult>(path, { json: { id } });
    },
    onSuccess: (result, item) => {
      ids.current.delete(item.ref);
      storeDay(client, result.day);
      setLast({ entry: result.entry, name: item.name });
      void client.invalidateQueries({ queryKey: ["frequent"] });
    },
  });
  const undo = useMutation({
    mutationFn: (entry: Entry) => api<DeleteResult>(`/api/entries/${entry.id}`, { method: "DELETE" }),
    onSuccess: (result) => {
      storeDay(client, result.day);
      setLast(null);
      void client.invalidateQueries({ queryKey: ["frequent"] });
    },
  });
  const pin = useMutation({
    mutationFn: (item: QuickItem) => api<unknown>(`/api/regulars/${item.ref.slice(2)}/pin`, { json: { id: crypto.randomUUID() } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["day"] });
      void client.invalidateQueries({ queryKey: ["frequent"] });
    },
  });
  // Unpins a pinned item, or stops suggesting a regular (a swipe in the quick card).
  const remove = useMutation({
    mutationFn: (item: QuickItem) =>
      item.ref.startsWith("f:")
        ? api<void>(`/api/frequent/${item.ref.slice(2)}`, { method: "DELETE" })
        : api<void>(`/api/regulars/${item.ref.slice(2)}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["day"] });
      void client.invalidateQueries({ queryKey: ["frequent"] });
    },
  });
  // The undo is offered for a few seconds, then the toast goes.
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => setLast(null), 5000);
    return () => clearTimeout(timer);
  }, [last]);
  // A failure is shown for as long, then cleared so the bar is quiet again.
  const failed = log.isError || undo.isError;
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => {
      log.reset();
      undo.reset();
    }, 5000);
    return () => clearTimeout(timer);
  }, [failed]);
  return { log, undo, pin, remove, last, dismiss: () => setLast(null) };
}

export type QuickLog = ReturnType<typeof useQuickLog>;

function QuickChip({ item, quick, typed, onLogged }: { item: QuickItem; quick: QuickLog; typed?: string; onLogged?: () => void }) {
  const t = useT();
  const kcal = `${Math.round(item.kcal)} ${t.units.kcal}`;
  const icon = item.kind === "meal" ? "restaurant" : sportOf(item.activity ?? "other").icon;
  const busy = quick.log.isPending || quick.pin.isPending;
  const logButton = (
    <button
      type="button"
      disabled={busy}
      aria-label={t.quick.log(item.name, kcal) + (item.logged_today ? ` (${t.quick.loggedToday})` : "")}
      onClick={() => {
        quick.log.reset();
        quick.log.mutate(item, { onSuccess: onLogged });
      }}
      className={`tap flex max-w-64 items-center gap-1.5 rounded-full py-1.5 pl-2.5 text-sm disabled:opacity-50 ${item.pinned ? "raised-sm pr-3" : "pr-1.5"}`}
    >
      <Icon name={icon} size={16} className={`shrink-0 ${item.pinned ? "text-accent-ink" : "text-muted"}`} />
      <span className={`truncate ${item.pinned ? "" : "text-muted"}`}>
        <Highlighted name={item.name} typed={typed} />
      </span>
      <span className="shrink-0 text-xs text-muted">{Math.round(item.kcal)}</span>
      {item.logged_today && <Icon name="check" size={14} className="shrink-0 text-accent-ink" />}
    </button>
  );
  if (item.pinned) return logButton;
  // A suggestion is dashed and carries a small + that pins it.
  return (
    <span className="flex items-center gap-0.5 rounded-full border-[1.5px] border-dashed border-muted/50 pr-1">
      {logButton}
      <button
        type="button"
        disabled={busy}
        aria-label={t.quick.pin(item.name)}
        onClick={() => quick.pin.mutate(item)}
        className="tap raised-sm flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-accent-ink disabled:opacity-50"
      >
        <Icon name="add" size={14} />
      </button>
    </span>
  );
}

/** The star button beside the camera. It has no dot for what is due (2026-11-02): it was on nearly all the time. */
export function QuickButton({ open, onToggle, disabled }: { open: boolean; onToggle: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t.quick.open}
      aria-expanded={open}
      disabled={disabled}
      onClick={onToggle}
      className={`tap relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent-ink disabled:opacity-40 ${open ? "pressed" : "raised-sm"}`}
    >
      <Icon name="star" size={22} />
    </button>
  );
}

/** How far a row slides to show its remove button, and how far a swipe must go to leave it open. */
const SWIPE_OPEN = 88;
const SWIPE_MIN = 40;

/**
 * One item in the quick card: a tap logs it; a swipe to the left shows a button that unpins it (a pinned item) or stops
 * suggesting it (a regular). Vertical drags stay with the list, so it still scrolls.
 */
function SwipeRow({ item, quick, onLogged }: { item: QuickItem; quick: QuickLog; onLogged: () => void }) {
  const t = useT();
  const [offset, setOffset] = useState(0);
  const drag = useRef<{ x: number; y: number; from: number; moved: boolean; horizontal: boolean | null } | null>(null);
  const kcal = `${Math.round(item.kcal)} ${t.units.kcal}`;
  const icon = item.kind === "meal" ? "restaurant" : sportOf(item.activity ?? "other").icon;
  const busy = quick.log.isPending || quick.pin.isPending || quick.remove.isPending;
  const open = offset <= -SWIPE_MIN;
  return (
    <li className="relative overflow-hidden rounded-2xl">
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        disabled={busy}
        onClick={() => quick.remove.mutate(item)}
        className="absolute inset-y-0 right-0 flex items-center gap-1 rounded-2xl bg-danger px-3 text-sm font-semibold text-white"
        style={{ width: SWIPE_OPEN - 6 }}
      >
        <Icon name={item.pinned ? "delete" : "close"} size={16} />
        {item.pinned ? t.quick.unpin : t.quick.hide}
      </button>
      <div
        className="relative flex touch-pan-y items-center gap-2 bg-base py-1 pr-1 transition-transform duration-150"
        style={{ transform: `translateX(${offset}px)`, transitionDuration: drag.current?.moved ? "0ms" : undefined }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, from: offset, moved: false, horizontal: null };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (d.horizontal === null && Math.abs(dx) + Math.abs(dy) > 6) d.horizontal = Math.abs(dx) > Math.abs(dy);
          if (!d.horizontal) return;
          d.moved = true;
          setOffset(Math.max(-SWIPE_OPEN, Math.min(0, d.from + dx)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          if (d?.moved) setOffset((o) => (o <= -SWIPE_MIN ? -SWIPE_OPEN : 0));
        }}
        onPointerCancel={() => {
          drag.current = null;
          setOffset((o) => (o <= -SWIPE_MIN ? -SWIPE_OPEN : 0));
        }}
      >
        <button
          type="button"
          disabled={busy}
          aria-label={t.quick.log(item.name, kcal) + (item.logged_today ? ` (${t.quick.loggedToday})` : "")}
          onClick={() => {
            const d = drag.current;
            drag.current = null;
            if (d?.moved) return;
            // A tap on an open row closes it rather than logging.
            if (offset !== 0) {
              setOffset(0);
              return;
            }
            quick.log.reset();
            quick.log.mutate(item, { onSuccess: onLogged });
          }}
          className="tap flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1.5 pl-1.5 pr-2 text-left disabled:opacity-50"
        >
          {item.pinned ? (
            <span className={`well-tint ${item.kind === "meal" ? "tint-amber" : "tint-orange"} flex h-8 w-8 shrink-0 items-center justify-center rounded-xl`}>
              <Icon name={icon} size={17} />
            </span>
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-dashed border-muted/50 text-muted">
              <Icon name={icon} size={17} />
            </span>
          )}
          <span className={`min-w-0 flex-1 truncate text-sm ${item.pinned ? "font-medium" : "text-muted"}`}>{item.name}</span>
          {item.logged_today && <Icon name="check" size={15} className="shrink-0 text-accent-ink" />}
          <span className="shrink-0 text-xs text-muted">{kcal}</span>
        </button>
        {!item.pinned && (
          <button
            type="button"
            disabled={busy}
            aria-label={t.quick.pin(item.name)}
            onClick={() => quick.pin.mutate(item)}
            className="tap raised-sm flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-accent-ink disabled:opacity-50"
          >
            <Icon name="add" size={15} />
          </button>
        )}
      </div>
    </li>
  );
}

/** The card above the chat bar: every quick item in a list that scrolls, and ⋯ to manage them. */
export function QuickCard({ items, quick, onClose, onManage }: { items: QuickItem[]; quick: QuickLog; onClose: () => void; onManage: () => void }) {
  const t = useT();
  return (
    <>
      {/* A tap anywhere else closes the card. */}
      <div aria-hidden="true" className="fixed inset-0 z-0" onClick={onClose} />
      <div className="raised absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-[50dvh] flex-col rounded-3xl p-2">
        <div className="flex items-center justify-between pb-1 pl-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t.quick.items}</span>
          <button type="button" aria-label={t.quick.manage} onClick={onManage} className="tap raised-sm flex h-8 w-10 items-center justify-center rounded-full text-muted">
            <Icon name="more_horiz" size={20} />
          </button>
        </div>
        {items.length === 0 && <p className="px-2.5 pb-2 text-sm text-muted">{t.quick.empty}</p>}
        <ul aria-label={t.quick.items} className="flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {items.map((item) => (
            <SwipeRow key={item.ref} item={item} quick={quick} onLogged={onClose} />
          ))}
        </ul>
        {items.length > 0 && <p className="px-2.5 pt-1 text-[11px] text-muted">{t.quick.swipeHint}</p>}
      </div>
    </>
  );
}

/** Matches for what is being typed, in a slim row just above the text box. */
export function TypeAhead({ matches, typed, quick, onLogged }: { matches: QuickItem[]; typed: string; quick: QuickLog; onLogged: () => void }) {
  const t = useT();
  if (matches.length === 0) return null;
  return (
    <ul aria-label={t.quick.matches} className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
      {matches.map((item) => (
        <li key={item.ref} className="shrink-0">
          <QuickChip item={item} quick={quick} typed={typed} onLogged={onLogged} />
        </li>
      ))}
    </ul>
  );
}

/** "Logged …  Undo" for a few seconds after a tap, floating above the chat bar. */
export function UndoToast({ quick }: { quick: QuickLog }) {
  const t = useT();
  if (!quick.last && !quick.log.isError && !quick.undo.isError) return null;
  return (
    <div role="status" className="raised absolute inset-x-6 bottom-full z-10 mb-2 flex items-center gap-2 rounded-2xl py-2 pl-3.5 pr-2 text-sm">
      {quick.log.isError ? (
        <span className="text-danger">{t.quick.logFailed}</span>
      ) : quick.undo.isError ? (
        <span className="text-danger">{t.quick.undoFailed}</span>
      ) : (
        quick.last && (
          <>
            <Icon name="check" size={18} className="shrink-0 text-accent-ink" />
            <span className="min-w-0 flex-1 truncate">{t.quick.logged(quick.last.name)}</span>
            <button
              type="button"
              disabled={quick.undo.isPending}
              onClick={() => quick.last && quick.undo.mutate(quick.last.entry)}
              className="tap flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-accent-ink disabled:opacity-50"
            >
              <Icon name="undo" size={16} />
              {t.quick.undo}
            </button>
          </>
        )
      )}
    </div>
  );
}
