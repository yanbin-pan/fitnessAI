import { describe, expect, it, vi } from "vitest";
import { onSignedOut } from "../api.ts";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch } from "../test/render.tsx";
import { streamCoach } from "./stream.ts";
import type { CoachEvent } from "./stream.ts";

/** A text/event-stream answer that arrives in the given pieces. */
function sse(pieces: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const result = { user: message({ status: "done" }), reply: message({ id: "r1", role: "assistant", text: "Logged.", status: null }), day: dayView() };

describe("streamCoach", () => {
  it("asks for a stream, reports stored and each step, and resolves with the result", async () => {
    const whole = event("stored", { day: dayView() }) + ": keep-alive\n\n" + event("step", { text: "Thinking…" }) + event("result", result);
    // Cut mid-event, so the pieces must be put back together.
    const fetchMock = mockFetch(() => sse([whole.slice(0, 17), whole.slice(17, 90), whole.slice(90)]));
    const events: CoachEvent[] = [];
    await expect(streamCoach("/api/messages", { id: "m1", text: "eggs" }, (e) => events.push(e))).resolves.toEqual(result);
    expect(events).toEqual([{ type: "stored", day: dayView() }, { type: "step", text: "Thinking…" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/messages");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", credentials: "same-origin", body: JSON.stringify({ id: "m1", text: "eggs" }) });
    expect(init?.headers).toEqual({ accept: "text/event-stream", "content-type": "application/json" });
  });

  it("sends a Retry with no body", async () => {
    const fetchMock = mockFetch(() => sse([event("result", result)]));
    await streamCoach("/api/messages/m1/retry", undefined, () => {});
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ accept: "text/event-stream" });
  });

  it("takes a plain JSON answer as the result", async () => {
    mockFetch(() => jsonResponse(result));
    const onEvent = vi.fn();
    await expect(streamCoach("/api/messages", {}, onEvent)).resolves.toEqual(result);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("says offline when the request can't be made, and passes on the server's refusals", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(streamCoach("/api/messages", {}, () => {})).rejects.toMatchObject({ kind: "offline", code: "offline" });
    mockFetch(() => jsonResponse({ error: "photo_taken" }, 409));
    await expect(streamCoach("/api/messages", {}, () => {})).rejects.toMatchObject({ kind: "http", status: 409, code: "photo_taken" });
  });

  it("notices an expired sign-in", async () => {
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    mockFetch(() => new Response(null, { status: 401 }));
    await expect(streamCoach("/api/messages", {}, () => {})).rejects.toMatchObject({ kind: "signed_out" });
    expect(listener).toHaveBeenCalled();
    stop();
  });

  it("says the stream dropped when it ends without a result", async () => {
    mockFetch(() => sse([event("stored", { day: dayView() }), event("step", { text: "Thinking…" })]));
    await expect(streamCoach("/api/messages", {}, () => {})).rejects.toMatchObject({ kind: "offline", code: "stream_dropped" });
  });
});
