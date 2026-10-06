import type { QueryClient } from "@tanstack/react-query";
import { dayKey, storeDay } from "../queries.ts";
import type { ChatMessage, DayView, MessageInput } from "../shared.ts";

/** The message as the feed shows it while it travels (spec §11.1): yours, pending, with its photos. */
export function pendingMessage(input: MessageInput, date: string): ChatMessage {
  return {
    id: input.id, date, role: "user", text: input.text, photo_ids: input.photo_ids, status: "pending", error_code: null,
    cards: [], reply_to: null, sent_at: input.sent_at, created_at: input.sent_at,
  };
}

/** The cached view of a day: under "today" while that alias holds it, which is what the Today screen shows, else under its date. */
function cachedDay(client: QueryClient, date: string): DayView | undefined {
  const alias = client.getQueryData<DayView>(dayKey("today"));
  return alias?.date === date ? alias : client.getQueryData<DayView>(dayKey(date));
}

/** Puts a message into its day's feed before the server has it. False when that left the feed as it was: the message is in it already, or the day isn't loaded. */
export function addPending(client: QueryClient, input: MessageInput, date: string): boolean {
  const view = cachedDay(client, date);
  if (!view || view.messages.some((m) => m.id === input.id)) return false;
  storeDay(client, { ...view, messages: [...view.messages, pendingMessage(input, view.date)] });
  return true;
}

/** Takes it out again when it never reached the server. */
export function removePending(client: QueryClient, id: string, date: string): void {
  const view = cachedDay(client, date);
  if (!view) return;
  storeDay(client, { ...view, messages: view.messages.filter((m) => m.id !== id) });
}

/** A Retry is on its way: show the failed message as pending again, on the day being viewed. */
export function markPending(client: QueryClient, view: DayView, id: string): void {
  storeDay(client, { ...view, messages: view.messages.map((m) => (m.id === id ? { ...m, status: "pending", error_code: null } : m)) });
}
