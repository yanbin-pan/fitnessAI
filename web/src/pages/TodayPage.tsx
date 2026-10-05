import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { ApiError, api } from "../api.ts";
import { dropLive, finishLive, firstStep, pushStep, startLive } from "../coach/live.ts";
import { markPending } from "../coach/pending.ts";
import { streamCoach } from "../coach/stream.ts";
import { ActivitiesCard } from "../components/ActivitiesCard.tsx";
import { Composer } from "../components/Composer.tsx";
import { DayNav } from "../components/DayNav.tsx";
import { EntryEditor } from "../components/EntryEditor.tsx";
import { Feed } from "../components/Feed.tsx";
import { SetupPrompt } from "../components/SetupPrompt.tsx";
import { Summary } from "../components/Summary.tsx";
import { Toggle, quietButton } from "../components/ui.tsx";
import { storeDay, useDay } from "../queries.ts";
import { MAX_BACKDATE_DAYS, daysBetween } from "../shared.ts";
import type { DeleteResult, Entry } from "../shared.ts";

function actionError(error: unknown): string {
  if (error instanceof ApiError && error.kind === "offline") return "You're offline, so that didn't go through.";
  return "That didn't work. Try again.";
}

export function TodayPage() {
  const { date = "today" } = useParams();
  const day = useDay(date);
  const client = useQueryClient();
  const [logOnly, setLogOnly] = useState(false);
  // An open editor belongs to the day it was opened on; Back or Forward to another day must not carry it along.
  const [editing, setEditing] = useState<{ date: string; entry: Entry | null } | null>(null);
  // After a failure the screen may be out of step with the server (a half-finished Undo, a message
  // that was already retried), so fetch the days again rather than trusting what is on screen.
  const refresh = () => void client.invalidateQueries({ queryKey: ["day"] });
  const retry = useMutation({
    mutationFn: async (id: string) => {
      const shown = day.data;
      const photos = shown?.messages.find((m) => m.id === id)?.photo_ids.length ?? 0;
      startLive(id, firstStep(photos));
      if (shown) markPending(client, shown, id);
      let stored = false;
      try {
        const result = await streamCoach(`/api/messages/${id}/retry`, undefined, (step) => {
          if (step.type === "stored") {
            stored = true;
            storeDay(client, step.day);
          } else {
            pushStep(id, step.text);
          }
        });
        finishLive(id);
        return result;
      } catch (error) {
        if (stored) {
          // The server has the message and the coach is on it, as after a Send: the pending poll shows the reply
          // when it lands, so there is nothing to report. The day is fetched again for the poll to take over.
          dropLive(id);
          refresh();
          return null;
        }
        finishLive(id);
        // Not restarted after all: show the message as it was until the fresh fetch arrives.
        if (shown) storeDay(client, shown);
        throw error;
      }
    },
    onSuccess: (result) => {
      if (result) storeDay(client, result.day);
    },
    onError: (error) => {
      refresh();
      // 409 not_failed: the message was restarted in the meantime (an earlier tap, another tab). That retry is
      // doing the work, so there is nothing to report; the fresh fetch shows where it has got to.
      if (error instanceof ApiError && error.code === "not_failed") retry.reset();
    },
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
    return <main className="mx-auto max-w-xl p-6 text-muted">{day.isError ? "Couldn't load this day." : "Loading…"}</main>;
  }
  const view = day.data;
  return (
    // The bottom padding leaves the end of the feed clear of the tab bar and of the composer, whose height changes
    // (photos, notices, a longer message) and is published as --composer-h. A day without a composer uses the fallback.
    <main className="mx-auto max-w-xl pb-[calc(var(--composer-h,8rem)_+_var(--tabbar-h)_+_env(safe-area-inset-bottom)_+_1rem)]">
      {/* Only the day navigation stays pinned; the summary scrolls away with the feed. Sticky is bounded by its parent, so this must stay a direct child of main. */}
      <div className="sticky top-0 z-10 bg-base px-4 pt-[env(safe-area-inset-top)]">
        <DayNav date={view.date} today={view.today} />
      </div>
      {/* The top padding gives the card's raised highlight room below the solid bar, which would otherwise paint over it. */}
      <div className="px-4 py-3">
        <Summary view={view} />
        <ActivitiesCard view={view} onEdit={(entry) => setEditing({ date: view.date, entry })} />
        <div className="mt-3 flex justify-end">
          <Toggle label="Log only" checked={logOnly} onChange={setLogOnly} />
        </div>
      </div>
      {(retry.isError || undo.isError) && (
        <p role="alert" className="px-4 pt-3 text-sm text-danger">
          {actionError(undo.error ?? retry.error)}
        </p>
      )}
      <Feed
        view={view}
        logOnly={logOnly}
        retrying={retry.isPending ? retry.variables : null}
        onRetry={(id) => {
          undo.reset();
          retry.mutate(id);
        }}
        onEdit={(entry) => setEditing({ date: view.date, entry })}
        onUndo={(ids) => {
          retry.reset();
          undo.mutate(ids);
        }}
      />
      {/* The server refuses a new entry dated more than MAX_BACKDATE_DAYS back (too_old), so don't offer one there. */}
      {view.date <= view.today && daysBetween(view.date, view.today) <= MAX_BACKDATE_DAYS && (
        <div className="px-4">
          <button type="button" onClick={() => setEditing({ date: view.date, entry: null })} className={`${quietButton} text-sm text-accent-ink`}>
            + Add manually
          </button>
        </div>
      )}
      {view.date === view.today && <Composer />}
      {editing?.date === view.date && <EntryEditor date={view.date} entry={editing.entry} featured={view.featured} onClose={() => setEditing(null)} />}
    </main>
  );
}
