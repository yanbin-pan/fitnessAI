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

/** Puts a message into today's feed before the server has it. False when that left the feed as it was: the message is in it already, or today isn't loaded. */
export function addPending(client: QueryClient, input: MessageInput): boolean {
  const view = client.getQueryData<DayView>(dayKey("today"));
  if (!view || view.messages.some((m) => m.id === input.id)) return false;
  storeDay(client, { ...view, messages: [...view.messages, pendingMessage(input, view.date)] });
  return true;
}

/** Takes it out again when it never reached the server. */
export function removePending(client: QueryClient, id: string): void {
  const view = client.getQueryData<DayView>(dayKey("today"));
  if (!view) return;
  storeDay(client, { ...view, messages: view.messages.filter((m) => m.id !== id) });
}

/** A Retry is on its way: show the failed message as pending again, on the day being viewed. */
export function markPending(client: QueryClient, view: DayView, id: string): void {
  storeDay(client, { ...view, messages: view.messages.map((m) => (m.id === id ? { ...m, status: "pending", error_code: null } : m)) });
}
