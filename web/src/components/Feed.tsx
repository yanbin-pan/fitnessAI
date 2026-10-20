import { useState } from "react";
import { useStep } from "../coach/live.ts";
import { dayLabel, failureText } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { chatOpen } from "../shared.ts";
import type { ChatMessage, CompanionId, CompanionStatus, DayView, Entry } from "../shared.ts";
import { CompanionAvatar, useHoldHint } from "./CompanionButton.tsx";
import { COMPANION_NAMES } from "../shared.ts";
import { EntryCard } from "./EntryCard.tsx";
import { Markdown } from "./Markdown.tsx";
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

/** Who speaks for the coach: the companion and its week. An older server sends no mood, and then there is none. */
export type Speaker = { id: CompanionId; status: CompanionStatus };

/**
 * The coach's newest row in the chat (2026-10-20): the companion moves there. `working-<id>` while a reply is on its
 * way, the greeting's "greeting", a reply's id; null when the chat shows nothing from the coach.
 */
export function newestCoachRow(view: DayView, logOnly: boolean, greeting: string | null | undefined): string | null {
  if (logOnly) return null;
  let newest: string | null = greeting ? "greeting" : null;
  for (const item of buildFeed(view, false)) {
    if (item.kind !== "message") continue;
    const { message } = item;
    if (message.role === "user" && message.status === "pending") newest = `working-${message.id}`;
    else if (message.role !== "user" && message.text) newest = message.id;
  }
  return newest;
}

/** Under the newest reply until the companion has been peeked at or opened once. */
function HoldHint({ speaker }: { speaker: Speaker }) {
  const t = useT();
  const show = useHoldHint();
  if (!show) return null;
  return <p className="ml-10 text-xs text-muted">{t.companion.holdHint(COMPANION_NAMES[speaker.id])}</p>;
}

/** The coach's mark beside a row: the companion, or the coach's whistle where there is no companion to show. */
function CoachMark({ speaker, live }: { speaker?: Speaker; live: boolean }) {
  if (speaker) return <CompanionAvatar companion={speaker.id} status={speaker.status} live={live} />;
  return (
    <span className="well-tint tint-custard flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
      <Icon name="sports" size={16} />
    </span>
  );
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
  /** Zabaione's hello at the top of today's chat (the name and greeting design, 3B); never stored, made on the phone. */
  greeting?: string | null;
  /** The companion, which stands beside the coach's replies and moves on the newest. */
  speaker?: Speaker;
}

/** Zabaione's hello, drawn like one of its replies. */
function Greeting({ text, speaker, live }: { text: string; speaker?: Speaker; live: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="mr-6 flex items-end gap-2">
        <CoachMark speaker={speaker} live={live} />
        <p className="raised-tint tint-custard rounded-2xl rounded-bl-md px-3 py-2">{text}</p>
      </div>
      {speaker && live && <HoldHint speaker={speaker} />}
    </div>
  );
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
function CoachWorking({ id, speaker, live }: { id: string; speaker?: Speaker; live: boolean }) {
  const t = useT();
  const step = useStep(id) ?? t.coach.thinking;
  return (
    <div className="mr-6 mt-3 flex items-center gap-2">
      <CoachMark speaker={speaker} live={live} />
      <span role="status" className="flex items-center gap-2">
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" style={{ animationDelay: `${dot * 200}ms` }} />
          ))}
        </span>
        <span className="text-sm text-muted">{step}</span>
      </span>
    </div>
  );
}

function Bubble({
  message, entries, date, today, onRetry, onEdit, onUndo, retrying, speaker, newest,
}: { message: ChatMessage; entries: Map<string, Entry>; date: string; today: string; newest: string | null } & Pick<FeedProps, "onRetry" | "onEdit" | "onUndo" | "retrying" | "speaker">) {
  const t = useT();
  if (message.role === "user") {
    // An older server may not send photo_ids yet.
    const photoIds = message.photo_ids ?? [];
    return (
      <>
        <div className="ml-10 flex flex-col items-end">
          <div className="raised-tint tint-green max-w-full rounded-2xl rounded-br-md p-1.5">
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
        {message.status === "pending" && <CoachWorking id={message.id} speaker={speaker} live={newest === `working-${message.id}`} />}
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
        <div className="flex items-end gap-2">
          <CoachMark speaker={speaker} live={newest === message.id} />
          <Markdown text={message.text} className="raised-tint tint-custard min-w-0 rounded-2xl rounded-bl-md px-3 py-2" />
        </div>
      )}
      {message.text && speaker && newest === message.id && <HoldHint speaker={speaker} />}
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

export function Feed({ view, logOnly, onRetry, onEdit, onUndo, retrying, greeting, speaker }: FeedProps) {
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
  // The hello belongs to the chat, so Log only leaves it out.
  const hello = greeting && !logOnly ? greeting : null;
  const newest = newestCoachRow(view, logOnly, hello);
  // A greeting already invites the first message, so it stands in for the empty-day text.
  if (items.length === 0 && hello) {
    return (
      <div className="px-4 py-4">
        <Greeting text={hello} speaker={speaker} live />
      </div>
    );
  }
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
        {hello && (
          <li>
            <Greeting text={hello} speaker={speaker} live={newest === "greeting"} />
          </li>
        )}
        {items.map((item) =>
          item.kind === "entry" ? (
            <li key={`e-${item.entry.id}`}>
              <EntryCard entry={item.entry} onEdit={onEdit} />
            </li>
          ) : (
            <li key={`m-${item.message.id}`}>
              <Bubble message={item.message} entries={entries} date={view.date} today={view.today} onRetry={onRetry} onEdit={onEdit} onUndo={onUndo} retrying={retrying} speaker={speaker} newest={newest} />
            </li>
          ),
        )}
      </ol>
      {note}
    </>
  );
}
