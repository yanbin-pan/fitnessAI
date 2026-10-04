import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api.ts";
import { storeDay } from "../queries.ts";
import type { MessageInput, MessageResult } from "../shared.ts";

function sendError(error: unknown): string {
  if (error instanceof ApiError && error.kind === "offline") return "You're offline, so the message may not have been sent. Tap Send to try again.";
  if (error instanceof ApiError && error.kind === "signed_out") return "You're signed out. Sign in again, then resend.";
  if (error instanceof ApiError && error.code === "in_progress") return "The coach is still working on that message. Give it a moment, then tap Send.";
  return "Couldn't send. Try again.";
}

/** Talks to the coach about today. Voice works through the keyboard's microphone. */
export function Composer() {
  const client = useQueryClient();
  const [text, setText] = useState("");
  // The id and timestamp belong to the unsent message, not to each tap on Send. If a response is
  // lost after the server has already run the coach, sending the same text again must carry the
  // same id, so the server hands back what it stored instead of logging the meal twice (spec 6.3).
  const attempt = useRef<MessageInput | null>(null);
  const send = useMutation({
    mutationFn: (body: MessageInput) => api<MessageResult>("/api/messages", { json: body }),
    onSuccess: (result) => {
      attempt.current = null;
      storeDay(client, result.day);
      setText("");
    },
    // A lost reply may still have reached the server: look again, and the pending poll shows the reply when it lands.
    onError: () => void client.invalidateQueries({ queryKey: ["day"] }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || send.isPending) return;
    if (attempt.current?.text !== trimmed) {
      attempt.current = { id: crypto.randomUUID(), sent_at: new Date().toISOString(), text: trimmed };
    }
    send.mutate(attempt.current);
  }

  return (
    <form
      onSubmit={submit}
      className="fixed inset-x-0 bottom-[calc(3rem_+_env(safe-area-inset-bottom))] z-10 border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
    >
      <div className="mx-auto flex max-w-xl items-end gap-2">
        <textarea
          aria-label="Message your coach"
          rows={2}
          value={text}
          // Locked while a send is out, so nothing typed can be wiped when the reply arrives.
          readOnly={send.isPending}
          onChange={(event) => setText(event.target.value)}
          placeholder="What did you eat or do?"
          className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={send.isPending || !text.trim()}
          className="h-11 rounded-xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-40"
        >
          {send.isPending ? "…" : "Send"}
        </button>
      </div>
      {send.isError && (
        <p role="alert" className="mx-auto mt-1 max-w-xl text-sm text-red-600">
          {sendError(send.error)}
        </p>
      )}
    </form>
  );
}
