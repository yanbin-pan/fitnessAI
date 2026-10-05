import { ApiError, responseError } from "../api.ts";
import type { CoachStreamEvents, DayView, MessageResult } from "../shared.ts";

export type CoachEvent = { type: "stored"; day: DayView } | { type: "step"; text: string };

/** One event out of a text/event-stream block; comments (": keep-alive") and anything unreadable come back null. */
function parse(block: string): { name: string; data: unknown } | null {
  let name = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) name = line.slice(7);
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!name || !data) return null;
  try {
    return { name, data: JSON.parse(data) as unknown };
  } catch {
    return null;
  }
}

/**
 * Sends a message, or a Retry, and follows the coach's work as it happens (spec §6.3). Resolves with the
 * result. Throws an ApiError as api() does — and one with the code "stream_dropped" when the stream ends
 * without a result, in which case the message may still be with the coach.
 */
export async function streamCoach(path: string, json: unknown, onEvent: (event: CoachEvent) => void): Promise<MessageResult> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      redirect: "manual",
      credentials: "same-origin",
      headers: json === undefined ? { accept: "text/event-stream" } : { accept: "text/event-stream", "content-type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch {
    throw new ApiError("offline", 0, "offline", "You appear to be offline.");
  }
  const failure = await responseError(res);
  if (failure) throw failure;
  // A finished repeat, or a server from before live steps, answers in one piece.
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream") || !res.body) {
    try {
      return (await res.json()) as MessageResult;
    } catch {
      throw new ApiError("http", res.status, "bad_response", "The server sent something that is not JSON.");
    }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const parsed = parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
        if (!parsed) continue;
        if (parsed.name === "result") return parsed.data as CoachStreamEvents["result"];
        if (parsed.name === "stored") onEvent({ type: "stored", day: (parsed.data as CoachStreamEvents["stored"]).day });
        if (parsed.name === "step") onEvent({ type: "step", text: (parsed.data as CoachStreamEvents["step"]).text });
      }
    }
  } catch {
    // The connection broke mid-stream: the same as a stream that ended early.
  }
  throw new ApiError("offline", 0, "stream_dropped", "The connection closed before the reply arrived.");
}
