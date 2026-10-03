import { dayLabel, failureText } from "../format.ts";
import type { ChatMessage, DayView, Entry } from "../shared.ts";
import { EntryCard } from "./EntryCard.tsx";

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
}

function Bubble({
  message, entries, date, today, onRetry, onEdit, onUndo,
}: { message: ChatMessage; entries: Map<string, Entry>; date: string; today: string } & Pick<FeedProps, "onRetry" | "onEdit" | "onUndo">) {
  if (message.role === "user") {
    return (
      <div className="ml-10 flex flex-col items-end">
        <p className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-600 px-3 py-2 text-white">{message.text}</p>
        {message.status === "pending" && <span className="mt-1 text-xs text-slate-500">Sending…</span>}
        {message.status === "failed" && (
          <span className="mt-1 text-xs text-red-600">
            {failureText(message.error_code)}{" "}
            <button type="button" className="font-semibold underline" onClick={() => onRetry(message.id)}>
              Retry
            </button>
          </span>
        )}
      </div>
    );
  }
  // Undo removes only what this reply's own message logged; an older entry it
  // corrected stays (open it to change or delete it).
  const undoable = message.cards
    .map((card) => entries.get(card.id))
    .filter((entry): entry is Entry => entry !== undefined && message.reply_to !== null && entry.message_id === message.reply_to)
    .map((entry) => entry.id);
  return (
    <div className="mr-10 flex flex-col gap-2">
      {message.text && <p className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 dark:bg-slate-800">{message.text}</p>}
      {message.cards.map((card) => {
        const entry = entries.get(card.id);
        if (!entry) {
          return (
            <p key={card.id} className="text-xs text-slate-500">
              Entry removed
            </p>
          );
        }
        if (entry.date === date) return <EntryCard key={card.id} entry={entry} onEdit={onEdit} />;
        // Back-dated by the coach ("yesterday I had..."): it belongs to another day, so say which.
        return (
          <div key={card.id} className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Logged to {dayLabel(entry.date, today)}</span>
            <EntryCard entry={entry} onEdit={onEdit} />
          </div>
        );
      })}
      {onUndo && undoable.length > 0 && (
        <button type="button" onClick={() => onUndo(undoable)} className="self-start text-xs font-medium text-slate-500 underline">
          Undo
        </button>
      )}
    </div>
  );
}

export function Feed({ view, logOnly, onRetry, onEdit, onUndo }: FeedProps) {
  const items = buildFeed(view, logOnly);
  // A card can point at an entry dated another day (back-dated), which travels in linked_entries.
  const entries = new Map([...view.entries, ...view.linked_entries].map((e) => [e.id, e]));
  if (items.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-slate-500">
        {view.date === view.today ? "Nothing logged yet. Tell the coach what you ate or did." : "Nothing logged this day."}
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3 px-4 py-4">
      {items.map((item) =>
        item.kind === "entry" ? (
          <li key={`e-${item.entry.id}`}>
            <EntryCard entry={item.entry} onEdit={onEdit} />
          </li>
        ) : (
          <li key={`m-${item.message.id}`}>
            <Bubble message={item.message} entries={entries} date={view.date} today={view.today} onRetry={onRetry} onEdit={onEdit} onUndo={onUndo} />
          </li>
        ),
      )}
    </ol>
  );
}
