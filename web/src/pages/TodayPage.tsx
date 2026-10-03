import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { ApiError, api } from "../api.ts";
import { Composer } from "../components/Composer.tsx";
import { DayNav } from "../components/DayNav.tsx";
import { EntryEditor } from "../components/EntryEditor.tsx";
import { Feed } from "../components/Feed.tsx";
import { SetupPrompt } from "../components/SetupPrompt.tsx";
import { Summary } from "../components/Summary.tsx";
import { storeDay, useDay } from "../queries.ts";
import { MAX_BACKDATE_DAYS, daysBetween } from "../shared.ts";
import type { DeleteResult, Entry, MessageResult } from "../shared.ts";

function actionError(error: unknown): string {
  if (error instanceof ApiError && error.kind === "offline") return "You're offline, so that didn't go through.";
  return "That didn't work. Try again.";
}

export function TodayPage() {
  const { date = "today" } = useParams();
  const day = useDay(date);
  const client = useQueryClient();
  const [logOnly, setLogOnly] = useState(false);
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  // After a failure the screen may be out of step with the server (a half-finished Undo, a message
  // that was already retried), so fetch the days again rather than trusting what is on screen.
  const refresh = () => void client.invalidateQueries({ queryKey: ["day"] });
  const retry = useMutation({
    mutationFn: (id: string) => api<MessageResult>(`/api/messages/${id}/retry`, { method: "POST" }),
    onSuccess: (result) => storeDay(client, result.day),
    onError: refresh,
  });
  const undo = useMutation({
    mutationFn: async (ids: string[]) => {
      let last: DeleteResult | null = null;
      for (const id of ids) {
        try {
          last = await api<DeleteResult>(`/api/entries/${id}`, { method: "DELETE" });
        } catch (error) {
          // Already gone (an earlier, half-finished Undo): carry on with the rest.
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        }
      }
      return last;
    },
    onSuccess: (last) => {
      if (last) storeDay(client, last.day);
      // The last DELETE answers with the day of the entry it removed. For an entry the coach
      // back-dated that is another day than the one on screen, so fetch the viewed day again.
      refresh();
    },
    onError: refresh,
  });

  if (day.error instanceof ApiError && day.error.code === "no_profile") return <SetupPrompt />;
  if (!day.data) {
    return <main className="mx-auto max-w-xl p-6 text-slate-500">{day.isError ? "Couldn't load this day." : "Loading…"}</main>;
  }
  const view = day.data;
  return (
    <main className="mx-auto max-w-xl pb-48">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <DayNav date={view.date} today={view.today} />
        <Summary view={view} />
        <label className="flex items-center gap-2 pb-2 text-xs text-slate-500">
          <input type="checkbox" checked={logOnly} onChange={(event) => setLogOnly(event.target.checked)} />
          Log only
        </label>
      </header>
      {(retry.isError || undo.isError) && (
        <p role="alert" className="px-4 pt-3 text-sm text-red-600">
          {actionError(undo.error ?? retry.error)}
        </p>
      )}
      <Feed
        view={view}
        logOnly={logOnly}
        onRetry={(id) => {
          undo.reset();
          retry.mutate(id);
        }}
        onEdit={setEditing}
        onUndo={(ids) => {
          retry.reset();
          undo.mutate(ids);
        }}
      />
      {/* The server refuses a new entry dated more than MAX_BACKDATE_DAYS back (too_old), so don't offer one there. */}
      {daysBetween(view.date, view.today) <= MAX_BACKDATE_DAYS && (
        <div className="px-4">
          <button type="button" onClick={() => setEditing("new")} className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            + Add manually
          </button>
        </div>
      )}
      {view.date === view.today && <Composer />}
      {editing && <EntryEditor date={view.date} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  );
}
