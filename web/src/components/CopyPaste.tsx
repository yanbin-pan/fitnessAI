import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { clearCopied, copyEntries, entryNames, useCopied } from "../copied.ts";
import { dayLabel, timeOf } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { storeDay } from "../queries.ts";
import { MAX_COPIES } from "../shared.ts";
import type { EntriesResult, Entry } from "../shared.ts";
import { primaryButton, quietButton } from "./ui.tsx";

/** Picks which of a day's entries to copy, to paste onto another day without the coach. */
export function CopyPicker({ date, entries, onClose }: { date: string; entries: readonly Entry[]; onClose: () => void }) {
  const t = useT();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const all = chosen.size === entries.length;
  const toggle = (id: string) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div role="dialog" aria-modal="true" aria-label={t.copy.title} className="fixed inset-0 z-40 flex items-end bg-black/40 sm:items-center">
      <div className="raised max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:mx-auto sm:max-w-xl sm:rounded-3xl">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{t.copy.title}</h2>
          <button
            type="button"
            className="-my-3 px-2 py-3 text-sm font-medium text-accent-ink"
            onClick={() => setChosen(all ? new Set() : new Set(entries.map((e) => e.id)))}
          >
            {all ? t.copy.none : t.copy.all}
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">{t.copy.hint}</p>
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((entry) => {
            const kcal = Math.round(entry.foods.reduce((sum, f) => sum + f.kcal, 0) || entry.exercises.reduce((sum, x) => sum + x.kcal, 0));
            return (
              <li key={entry.id}>
                <label className="pressed flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                  <input type="checkbox" checked={chosen.has(entry.id)} onChange={() => toggle(entry.id)} className="h-5 w-5 shrink-0 accent-[var(--nm-accent)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{entryNames(entry)}</span>
                    <span className="block text-xs text-muted">
                      {timeOf(entry.logged_at, t)} · {kcal} {t.units.kcal}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={quietButton}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={chosen.size === 0 || chosen.size > MAX_COPIES}
            className={primaryButton}
            onClick={() => {
              copyEntries(date, entries.filter((e) => chosen.has(e.id)));
              onClose();
            }}
          >
            {t.copy.copy(chosen.size)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Pastes what was copied onto `date`: the server duplicates the entries, so no tokens are spent. */
export function PasteBar({ date, today }: { date: string; today: string }) {
  const t = useT();
  const client = useQueryClient();
  const copied = useCopied();
  // The last paste that was sent. Pasting again with nothing changed (after a lost reply) is the same request, so it
  // keeps its ids and the server stores the copies once; after a paste that worked, another one adds them again.
  const attempt = useRef<{ key: string; ids: string[] } | null>(null);
  const paste = useMutation({
    mutationFn: () => {
      if (!copied) throw new Error("nothing copied");
      const key = JSON.stringify({ date, from: copied.entries.map((e) => e.id) });
      if (attempt.current?.key !== key) attempt.current = { key, ids: copied.entries.map(() => crypto.randomUUID()) };
      const ids = attempt.current.ids;
      return api<EntriesResult>("/api/entries/copy", { json: { date, copies: copied.entries.map((e, i) => ({ id: ids[i], from: e.id })) } });
    },
    onSuccess: (result) => {
      attempt.current = null;
      storeDay(client, result.day);
    },
    onError: (error) => {
      // A copied entry was deleted since: nothing was pasted, and the copy can't be pasted anywhere.
      if (error instanceof ApiError && error.code === "not_found") clearCopied();
    },
  });
  const failure =
    paste.error instanceof ApiError && paste.error.code === "not_found" ? t.copy.gone
    : paste.error instanceof ApiError && paste.error.kind === "offline" ? t.day.actionOffline
    : paste.isError ? t.day.actionFailed
    : null;
  if (!copied) {
    return failure ? <p role="alert" className="mt-2 text-sm text-danger">{failure}</p> : null;
  }
  return (
    <div className="mt-3">
      <div className="pressed flex items-center gap-2 rounded-2xl p-2">
        <button
          type="button"
          disabled={paste.isPending}
          onClick={() => paste.mutate()}
          className={`${quietButton} flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-accent-ink`}
        >
          <Icon name="content_paste" size={18} />
          <span className="min-w-0">
            <span className="block">{t.copy.paste(copied.entries.length)}</span>
            <span className="block truncate text-xs font-normal text-muted">
              {t.copy.from(dayLabel(copied.from, today, t))}: {copied.entries.map((e) => e.names).join("; ")}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={t.copy.clear}
          onClick={() => {
            paste.reset();
            clearCopied();
          }}
          className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      {failure && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {failure}
        </p>
      )}
    </div>
  );
}
