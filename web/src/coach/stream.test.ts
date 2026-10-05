import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSignedOut } from "../api.ts";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch } from "../test/render.tsx";
import { STREAM_IDLE_MS, streamCoach } from "./stream.ts";
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

/** A text/event-stream answer that stays open: the test writes into it, and `cancelled` runs if the reader gives up on it. */
function openStream() {
  const encoder = new TextEncoder();
  const cancelled = vi.fn();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel: cancelled,
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } }),
    send: (text: string) => controller?.enqueue(encoder.encode(text)),
    cancelled,
  };
}

/** Starts a call and reports, without waiting for it, whether it has settled. */
function begin() {
  let settled = false;
  const promise = streamCoach("/api/messages", {}, () => {});
  const note = () => {
    settled = true;
  };
  promise.then(note, note);
  return { promise, settled: () => settled };
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

  // A connection that goes dead without ever failing (half open, or a suspended app waking up) would otherwise
  // leave the composer waiting for ever. The server sends a keep-alive every 15 s; the client gives up after three missed.
  describe("when the connection goes quiet", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("gives up on a stream that says nothing for STREAM_IDLE_MS, and closes it", async () => {
      const stream = openStream();
      mockFetch(() => stream.response);
      const { promise, settled } = begin();
      stream.send(event("stored", { day: dayView() }));
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 1);
      expect(settled()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled()).toBe(true);
      await expect(promise).rejects.toMatchObject({ kind: "offline", code: "stream_dropped" });
      expect(stream.cancelled).toHaveBeenCalled();
    });

    it("is kept waiting by the server's keep-alives, however long the coach takes", async () => {
      const stream = openStream();
      mockFetch(() => stream.response);
      const { promise } = begin();
      stream.send(event("stored", { day: dayView() }));
      for (let i = 0; i < 8; i += 1) {
        await vi.advanceTimersByTimeAsync(15_000);
        stream.send(": keep-alive\n\n");
      }
      stream.send(event("result", result));
      await expect(promise).resolves.toEqual(result);
    });

    it("gives up on a request that gets no answer at all, and aborts it", async () => {
      const fetchMock = mockFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
          }),
      );
      const { promise, settled } = begin();
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 1);
      expect(settled()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled()).toBe(true);
      await expect(promise).rejects.toMatchObject({ kind: "offline", code: "offline" });
      expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
