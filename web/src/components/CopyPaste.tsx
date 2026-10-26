import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { clearCopied, entryNames, toggleCopied, useCopied } from "../copied.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { storeDay } from "../queries.ts";
import type { EntriesResult, Entry } from "../shared.ts";

/** The small copy button in an entry card's corner: adds the entry to what is copied, or takes it out again. */
export function CopyButton({ entry }: { entry: Entry }) {
  const t = useT();
  const copied = useCopied()?.entries.some((e) => e.id === entry.id) ?? false;
  return (
    <button
      type="button"
      aria-label={`${t.copy.copy}: ${entryNames(entry)}`}
      aria-pressed={copied}
      onClick={() => toggleCopied(entry)}
      className={`tap absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full ${copied ? "text-accent-ink" : "text-muted"}`}
    >
      <Icon name={copied ? "check" : "content_copy"} size={16} />
    </button>
  );
}

/** Pastes what was copied onto `date`, as a small round icon; the server duplicates the entries, so no tokens are spent. */
export function PasteChip({ date }: { date: string }) {
  const t = useT();
  const client = useQueryClient();
  const copied = useCopied();
  // The last paste that was sent. Pasting again with nothing changed (after a lost reply) is the same request, so it
  // keeps its ids and the server stores the copies once; after a paste that worked, another one adds them again.
  const attempt = useRef<{ key: string; ids: string[] } | null>(null);
  // A tick on the icon for a moment after a paste lands; the entries stay copied, to paste on another day too.
  const [pasted, setPasted] = useState(false);
  useEffect(() => {
    if (!pasted) return;
    const timer = setTimeout(() => setPasted(false), 1500);
    return () => clearTimeout(timer);
  }, [pasted]);
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
      setPasted(true);
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
  const alert = failure && <p role="alert" className="basis-full text-sm text-danger">{failure}</p>;
  if (!copied) return alert || null;
  const count = copied.entries.length;
  return (
    <>
      {/* A small round paste icon, raised like the composer's camera, with the count on it when more than one is copied. */}
      <span className="inline-flex items-center">
        <button
          type="button"
          aria-label={t.copy.paste(count)}
          disabled={paste.isPending}
          onClick={() => paste.mutate()}
          title={copied.entries.map((e) => e.names).join("; ")}
          className="tap raised-sm relative flex h-9 w-9 items-center justify-center rounded-full text-accent-ink disabled:opacity-50"
        >
          <Icon name={pasted ? "check" : "content_paste"} size={18} />
          {count > 1 && (
            <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
              {count}
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label={t.copy.clear}
          onClick={() => {
            paste.reset();
            clearCopied();
          }}
          className="tap flex h-8 w-8 items-center justify-center rounded-full text-muted"
        >
          <Icon name="close" size={14} />
        </button>
      </span>
      {alert}
    </>
  );
}
