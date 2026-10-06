import { useState } from "react";
import { useStep } from "../coach/live.ts";
import { dayLabel, failureText } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { chatOpen } from "../shared.ts";
import type { ChatMessage, DayView, Entry } from "../shared.ts";
import { EntryCard } from "./EntryCard.tsx";
import { quietButton } from "./ui.tsx";

export type FeedItem = { kind: "message"; at: string; message: ChatMessage } | { kind: "entry"; at: string; entry: Entry };

const byTime = (items: FeedItem[]) => [...items].sort((a, b) => a.at.localeCompare(b.at));

/** The day as one timeline: the conversation, with coach-made entries under their reply. */
export function buildFeed(view: DayView, logOnly: boolean): FeedItem[] {
  const asItems = (list: Entry[]): FeedItem[] => list.map((entry) => ({ kind: "entry", at: entry.logged_at, entry }));
  if (logOnly) return byTime(asItems(view.entries));
  const carded = new Set(view.messages.flatMap((m) => m.cards.map((c) => c.id)));
  return byTime([
    ...view.messages.map((message): FeedItem => ({ kind: "message", at: message.created_at, message })),
    ...asItems(view.entries.filter((e) => !carded.has(e.id))),
  ]);
}

interface FeedProps {
  view: DayView;
  logOnly: boolean;
  onRetry: (messageId: string) => void;
  onEdit?: (entry: Entry) => void;
  /** Deletes what a reply logged (spec §6.1: Undo is a delete). */
  onUndo?: (entryIds: string[]) => void;
  /** The message whose retry is on its way: its Retry stays disabled until the request ends. */
  retrying?: string | null;
}

function PhotoThumb({ id, index, single }: { id: string; index: number; single: boolean }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const size = single ? "h-32 w-44" : "h-20 w-20";
  if (failed) {
    return <span className={`pressed flex ${size} items-center justify-center rounded-xl p-2 text-center text-xs text-muted`}>{t.feed.photoUnavailable}</span>;
  }
  return <img src={`/api/photos/${id}`} alt={t.common.photo(index + 1)} loading="lazy" onError={() => setFailed(true)} className={`${size} rounded-xl object-cover`} />;
}

/** The coach's row while it works on a message (spec §11.1): dots, and what it is doing. Screen readers hear each step. */
function CoachWorking({ id }: { id: string }) {
  const t = useT();
  const step = useStep(id) ?? t.coach.thinking;
  return (
    <div role="status" className="mr-6 mt-3 flex items-center gap-2">
      <span className="raised-sm flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-accent-ink">
        <Icon name="sports" size={16} />
      </span>
      <span aria-hidden="true" className="flex gap-1">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" style={{ animationDelay: `${dot * 200}ms` }} />
        ))}
      </span>
      <span className="text-sm text-muted">{step}</span>
    </div>
  );
}

function Bubble({
  message, entries, date, today, onRetry, onEdit, onUndo, retrying,
}: { message: ChatMessage; entries: Map<string, Entry>; date: string; today: string } & Pick<FeedProps, "onRetry" | "onEdit" | "onUndo" | "retrying">) {
  const t = useT();
  if (message.role === "user") {
    // An older server may not send photo_ids yet.
    const photoIds = message.photo_ids ?? [];
    return (
      <>
        <div className="ml-10 flex flex-col items-end">
          <div className="raised-sm max-w-full rounded-2xl rounded-br-md p-1.5">
            {photoIds.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {photoIds.map((id, index) => (
                  <PhotoThumb key={id} id={id} index={index} single={photoIds.length === 1} />
                ))}
              </div>
            )}
            {message.text && <p className="whitespace-pre-wrap px-2 py-1">{message.text}</p>}
          </div>
          {message.status === "failed" && (
            <span className="mt-1 text-xs text-danger">
              {failureText(message.error_code, t)}{" "}
              {/* Padding makes the tap area 44 px tall (a fingertip); the matching negative margins keep the line where it was. */}
              <button
                type="button"
                disabled={retrying === message.id}
                className="-mx-2 -my-3.5 px-2 py-3.5 font-semibold underline disabled:opacity-40"
                onClick={() => onRetry(message.id)}
              >
                {t.common.retry}
              </button>
            </span>
          )}
        </div>
        {message.status === "pending" && <CoachWorking id={message.id} />}
      </>
    );
  }
  // Undo removes only what this reply's own message logged; an older entry it
  // corrected stays (open it to change or delete it).
  const undoable = message.cards
    .map((card) => entries.get(card.id))
    .filter((entry): entry is Entry => entry !== undefined && message.reply_to !== null && entry.message_id === message.reply_to)
    .map((entry) => entry.id);
  return (
    <div className="mr-6 flex flex-col gap-2">
      {message.text && (
        <div className="flex items-start gap-2">
          <span className="raised-sm flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-accent-ink">
            <Icon name="sports" size={16} />
          </span>
          <p className="whitespace-pre-wrap pt-0.5">{message.text}</p>
        </div>
      )}
      {message.cards.map((card) => {
        const entry = entries.get(card.id);
        if (!entry) {
          return (
            <p key={card.id} className="text-xs text-muted">
              {t.feed.removed}
            </p>
          );
        }
        if (entry.date === date) return <EntryCard key={card.id} entry={entry} onEdit={onEdit} />;
        // Back-dated by the coach ("yesterday I had..."): it belongs to another day, so say which.
        return (
          <div key={card.id} className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t.feed.loggedTo(dayLabel(entry.date, today, t))}</span>
            <EntryCard entry={entry} onEdit={onEdit} />
          </div>
        );
      })}
      {onUndo && undoable.length > 0 && (
        <button type="button" onClick={() => onUndo(undoable)} className={`${quietButton} min-h-11 self-start text-sm text-muted`}>
          {t.feed.undo}
        </button>
      )}
    </div>
  );
}

export function Feed({ view, logOnly, onRetry, onEdit, onUndo, retrying }: FeedProps) {
  const t = useT();
  const items = buildFeed(view, logOnly);
  // A card can point at an entry dated another day (back-dated), which travels in linked_entries.
  // (An older server does not send the field yet.)
  const entries = new Map([...view.entries, ...(view.linked_entries ?? [])].map((e) => [e.id, e]));
  // Only today and the CHAT_WINDOW_DAYS before it keep their conversation (spec §6.6): say so on an older day.
  const open = chatOpen(view.date, view.today);
  const note =
    !logOnly && !open && view.date < view.today ? (
      <p className="px-4 pb-4 text-center text-xs text-muted">{t.feed.kept}</p>
    ) : null;
  if (items.length === 0) {
    return (
      <>
        <p className="px-4 py-10 text-center text-sm text-muted">
          {open ? t.feed.emptyToday : t.feed.emptyDay}
        </p>
        {note}
      </>
    );
  }
  return (
    <>
      <ol className="flex flex-col gap-3 px-4 py-4">
        {items.map((item) =>
          item.kind === "entry" ? (
            <li key={`e-${item.entry.id}`}>
              <EntryCard entry={item.entry} onEdit={onEdit} />
            </li>
          ) : (
            <li key={`m-${item.message.id}`}>
              <Bubble message={item.message} entries={entries} date={view.date} today={view.today} onRetry={onRetry} onEdit={onEdit} onUndo={onUndo} retrying={retrying} />
            </li>
          ),
        )}
      </ol>
      {note}
    </>
  );
}
