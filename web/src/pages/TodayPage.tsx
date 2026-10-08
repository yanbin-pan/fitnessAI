import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { ApiError, api } from "../api.ts";
import { dropLive, finishLive, firstStep, pushStep, startLive } from "../coach/live.ts";
import { markPending } from "../coach/pending.ts";
import { streamCoach } from "../coach/stream.ts";
import { ActivitiesCard } from "../components/ActivitiesCard.tsx";
import { Composer } from "../components/Composer.tsx";
import { DayNav } from "../components/DayNav.tsx";
import { EntryEditor } from "../components/EntryEditor.tsx";
import { NutrientCard } from "../components/NutrientCard.tsx";
import { Feed } from "../components/Feed.tsx";
import { CompanionPrompt } from "../components/CompanionPrompt.tsx";
import { NamePrompt } from "../components/NamePrompt.tsx";
import { SetupPrompt } from "../components/SetupPrompt.tsx";
import { FeedDivider } from "../components/FeedDivider.tsx";
import { Summary } from "../components/Summary.tsx";
import { SummaryStrip } from "../components/SummaryStrip.tsx";
import { quietButton } from "../components/ui.tsx";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { greetingFor } from "../greeting.ts";
import { storeDay, useDay, useLoadedProfile } from "../queries.ts";
import { COMPANIONS, DEFAULT_COMPANION, MAX_BACKDATE_DAYS, chatOpen, daysBetween } from "../shared.ts";
import type { DeleteResult, Entry } from "../shared.ts";

/**
 * The page's own scrolling: to the end of the feed, just above the composer where the next entry goes, or to the top,
 * where the summary is.
 */
function scrollPage(to: "latest" | "top", behavior: ScrollBehavior): void {
  const page = document.scrollingElement;
  if (!page?.scrollTo) return;
  // After the browser has laid the day out, so the height is the day's.
  requestAnimationFrame(() => page.scrollTo({ top: to === "latest" ? page.scrollHeight : 0, behavior }));
}

/**
 * Whether `element` has scrolled up under the day bar (`barHeight` px), so the summary strip should stand in for it.
 * Without IntersectionObserver (old browsers, tests) it never does.
 */
function useScrolledAway(element: HTMLElement | null, barHeight: number): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([seen]) => setAway(!seen.isIntersecting && seen.boundingClientRect.top < barHeight),
      { rootMargin: `-${barHeight}px 0px 0px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, barHeight]);
  return away;
}

function actionError(error: unknown, t: Messages): string {
  if (error instanceof ApiError && error.kind === "offline") return t.day.actionOffline;
  return t.day.actionFailed;
}

export function TodayPage() {
  const { date = "today" } = useParams();
  const t = useT();
  const day = useDay(date);
  const profile = useLoadedProfile();
  const client = useQueryClient();
  const [logOnly, setLogOnly] = useState(false);
  const [summaryCard, setSummaryCard] = useState<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  // Below the day bar, which is 4.25rem under the safe area: what's under it is hidden.
  const summaryAway = useScrolledAway(summaryCard, bar.current?.offsetHeight ?? 68);
  // Today opens at its latest entry, just above the composer, as a chat does; another day opens at the top, on its
  // summary, and so does a today with nothing in it yet. Something new arriving (a message sent, a reply, an entry)
  // brings the page down to it. Undo and edits don't move it.
  const shownDate = day.data?.date;
  const shownToday = day.data ? day.data.date === day.data.today : false;
  const itemCount = day.data ? day.data.entries.length + day.data.messages.length : 0;
  const lastShown = useRef<{ date?: string; count: number }>({ count: 0 });
  useLayoutEffect(() => {
    if (!shownDate) return;
    const previous = lastShown.current;
    if (previous.date !== shownDate) scrollPage(shownToday && itemCount > 0 ? "latest" : "top", "instant");
    else if (itemCount > previous.count) scrollPage("latest", "smooth");
    lastShown.current = { date: shownDate, count: itemCount };
  }, [shownDate, shownToday, itemCount]);
  // An open editor belongs to the day it was opened on; Back or Forward to another day must not carry it along.
  const [editing, setEditing] = useState<{ date: string; entry: Entry | null } | null>(null);
  // After a failure the screen may be out of step with the server (a half-finished Undo, a message
  // that was already retried), so fetch the days again rather than trusting what is on screen.
  const refresh = () => void client.invalidateQueries({ queryKey: ["day"] });
  const retry = useMutation({
    mutationFn: async (id: string) => {
      const shown = day.data;
      const photos = shown?.messages.find((m) => m.id === id)?.photo_ids.length ?? 0;
      startLive(id, firstStep(photos, t));
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
    return <main className="mx-auto max-w-xl p-6 text-muted">{day.isError ? t.day.loadFailed : t.common.loading}</main>;
  }
  const view = day.data;
  const stored = profile.data?.profile ?? null;
  const isToday = view.date === view.today;
  // An older server sends no name fields: then there is nothing to ask and the hello has no name.
  const greeting = isToday ? greetingFor(view, stored?.name ?? null, new Date(), t) : null;
  // An older server sends no companion fields: Zabaione, and no mood to show.
  const companion = stored && COMPANIONS.includes(stored.companion) ? stored.companion : DEFAULT_COMPANION;
  return (
    // The bottom padding leaves the end of the feed clear of the tab bar and of the composer, whose height changes
    // (photos, notices, a longer message) and is published as --composer-h. A day without a composer uses the fallback.
    <main className="mx-auto max-w-xl pb-[calc(var(--composer-h,8rem)_+_var(--tabbar-h)_+_env(safe-area-inset-bottom)_+_1rem)]">
      {/* Only the day navigation stays pinned; the summary scrolls away with the feed. Sticky is bounded by its parent, so this must stay a direct child of main. */}
      <div ref={bar} className="sticky top-0 z-10 bg-base px-4 pt-[env(safe-area-inset-top)]">
        {summaryAway && (
          <div className="absolute inset-x-4 top-full">
            <SummaryStrip view={view} onClick={() => summaryCard?.scrollIntoView?.({ block: "start", behavior: "smooth" })} />
          </div>
        )}
        <DayNav date={view.date} today={view.today} companion={view.companion ? { id: companion, status: view.companion } : undefined} />
      </div>
      {/* The top padding gives the card's raised highlight room below the solid bar, which would otherwise paint over it. */}
      <div className="px-4 pt-3">
        {isToday && stored?.name_prompt === "show" && <NamePrompt profile={stored} />}
        {/* One question at a time: the name first, then the companion. */}
        {isToday && stored && stored.name_prompt !== "show" && stored.companion_prompt === "show" && <CompanionPrompt profile={stored} />}
        {/* Scrolled to, under the day bar, when the summary strip is tapped. */}
        <div ref={setSummaryCard} className="scroll-mt-[calc(env(safe-area-inset-top)_+_4.75rem)]">
          <Summary view={view} />
        </div>
        {/* An older server sends no signals. */}
        {view.nutrients && <NutrientCard signals={view.nutrients} />}
        <ActivitiesCard view={view} onEdit={(entry) => setEditing({ date: view.date, entry })} />
      </div>
      <FeedDivider chat={chatOpen(view.date, view.today)} logOnly={logOnly} onChange={setLogOnly} />
      {(retry.isError || undo.isError) && (
        <p role="alert" className="px-4 pt-3 text-sm text-danger">
          {actionError(undo.error ?? retry.error, t)}
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
        greeting={greeting}
      />
      {/* The server refuses a new entry dated more than MAX_BACKDATE_DAYS back (too_old), so don't offer one there. */}
      {view.date <= view.today && daysBetween(view.date, view.today) <= MAX_BACKDATE_DAYS && (
        <div className="px-4">
          <button type="button" onClick={() => setEditing({ date: view.date, entry: null })} className={`${quietButton} text-sm text-accent-ink`}>
            {t.day.addManually}
          </button>
        </div>
      )}
      {/* Each day open to chat gets its own composer, so a draft never moves to another day. An older server sends no suggestions. */}
      {chatOpen(view.date, view.today) && <Composer key={view.date} date={view.date} suggestions={view.suggestions ?? []} />}
      {editing?.date === view.date && (
        <EntryEditor
          date={view.date}
          entry={editing.entry}
          // An older server does not send featured yet.
          featured={view.featured ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
