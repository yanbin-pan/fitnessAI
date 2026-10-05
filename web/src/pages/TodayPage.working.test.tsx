import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_STEP_MS, resetLive } from "../coach/live.ts";
import type { ChatMessage, DayView, MessageInput } from "../shared.ts";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { TodayPage } from "./TodayPage.tsx";

vi.mock("../photos/prepare.ts", () => ({
  preparePhoto: vi.fn(async () => ({ blob: new Blob(["resized"], { type: "image/jpeg" }), width: 1568, height: 1176 })),
}));

/** A streamed answer whose events the test writes one at a time. */
function controlledStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } }),
    send: (event: string, data: unknown) => controller?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    end: () => controller?.close(),
  };
}

/** A server whose POST /api/messages answers with the stream; `days` answers each GET of the day (numbered from 1) and sees the id sent. */
function server(stream: ReturnType<typeof controlledStream>, days: (load: number, id: string) => DayView) {
  const state = { id: "", loads: 0 };
  mockFetch((url, init) => {
    if (url === "/api/messages") {
      state.id = (JSON.parse(String(init?.body)) as MessageInput).id;
      return stream.response;
    }
    state.loads += 1;
    return jsonResponse(days(state.loads, state.id));
  });
  return state;
}

const reply = (to: string) => message({ id: "r1", role: "assistant", text: "Logged 2 eggs.", status: null, reply_to: to, created_at: "2026-10-03T07:09:30.000Z" });

/** The coach's answer arrives and the stream ends. */
function answer(stream: ReturnType<typeof controlledStream>, pending: ChatMessage) {
  const done = { ...pending, status: "done" as const };
  const logged = reply(pending.id);
  act(() => {
    stream.send("result", { user: done, reply: logged, day: dayView({ messages: [done, logged] }) });
    stream.end();
  });
}

const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
const renderToday = () => renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetLive();
});
afterEach(() => {
  resetLive();
  vi.useRealTimers();
});

describe("TodayPage, while the coach works (spec §11.1)", () => {
  it("unlocks the box once the message is stored: typing is fine, Send waits for the reply", async () => {
    const stream = controlledStream();
    const sent = server(stream, () => dayView());
    renderToday();
    const box = await screen.findByLabelText("Message your coach");
    await user.type(box, "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(box).toHaveAttribute("readonly");

    const pending = message({ id: sent.id, text: "2 eggs", status: "pending" });
    act(() => stream.send("stored", { day: dayView({ messages: [pending] }) }));
    await waitFor(() => expect(box).not.toHaveAttribute("readonly"));
    await user.type(box, "and toast");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    answer(stream, pending);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(box).toHaveValue("and toast");
  });

  it("puts the photos in the feed at once, with the words for photos", async () => {
    const stream = controlledStream();
    const photo = "9".repeat(32);
    let id = "";
    mockFetch((url, init) => {
      if (url === "/api/photos") return jsonResponse({ id: photo, media_type: "image/jpeg", bytes: 7, width: 1568, height: 1176 }, 201);
      if (url === "/api/messages") {
        id = (JSON.parse(String(init?.body)) as MessageInput).id;
        return stream.response;
      }
      return jsonResponse(dayView());
    });
    renderToday();
    await user.upload(await screen.findByLabelText("Add photos"), new File(["original"], "meal.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("status")).toHaveTextContent("Looking at your photo…");
    expect(screen.getByRole("img", { name: "Photo 1" })).toHaveAttribute("src", `/api/photos/${photo}`);
    answer(stream, message({ id, text: "", photo_ids: [photo], status: "pending" }));
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });

  it("leaves the poll alone while the stream is open", async () => {
    const stream = controlledStream();
    // A poll now would find no message at all, and take the bubble out of the feed.
    const sent = server(stream, () => dayView());
    renderToday();
    await user.type(await screen.findByLabelText("Message your coach"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const pending = message({ id: sent.id, text: "2 eggs", status: "pending" });
    act(() => stream.send("stored", { day: dayView({ messages: [pending] }) }));
    await act(() => vi.advanceTimersByTimeAsync(7000));
    expect(sent.loads).toBe(1);
    expect(screen.getByText("2 eggs")).toBeInTheDocument();
    answer(stream, pending);
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });

  it("takes a message that never reached the server out of the feed, even when the day can't be fetched either", async () => {
    let online = true;
    mockFetch(() => {
      if (!online) throw new TypeError("Failed to fetch");
      return jsonResponse(dayView());
    });
    renderToday();
    const box = await screen.findByLabelText("Message your coach");
    await user.type(box, "2 eggs");
    online = false;
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByText(/^Nothing logged yet/)).toBeInTheDocument(); // the feed is empty again: the text is back in the box
    expect(screen.queryByRole("status")).toBeNull();
    expect(box).toHaveValue("2 eggs");
  });

  it("keeps the last step on screen when the stream drops after the message was stored", async () => {
    const stream = controlledStream();
    const sent = server(stream, (_load, id) => dayView({ messages: id ? [message({ id, text: "2 eggs", status: "pending" })] : [] }));
    renderToday();
    await user.type(await screen.findByLabelText("Message your coach"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    act(() => stream.send("stored", { day: dayView({ messages: [message({ id: sent.id, text: "2 eggs", status: "pending" })] }) }));
    act(() => stream.send("step", { text: "Logging eggs…" }));
    await act(() => vi.advanceTimersByTimeAsync(MIN_STEP_MS));
    act(() => stream.end());
    await waitFor(() => expect(sent.loads).toBe(2)); // the day is fetched again once the stream has dropped
    expect(screen.getByRole("status")).toHaveTextContent("Logging eggs…");
  });

  it("lets the poll find the reply when a send failed before it was stored but the server had it all the same", async () => {
    let id = "";
    let loads = 0;
    mockFetch((url, init) => {
      if (url === "/api/messages") {
        id = (JSON.parse(String(init?.body)) as MessageInput).id;
        throw new TypeError("Failed to fetch"); // the server ran it, and the answer was lost on the way back
      }
      loads += 1;
      const pending = message({ id, text: "2 eggs", status: "pending" });
      if (loads === 1) return jsonResponse(dayView());
      if (loads === 2) return jsonResponse(dayView({ messages: [pending] }));
      return jsonResponse(dayView({ messages: [{ ...pending, status: "done" }, reply(id)] }));
    });
    renderToday();
    await user.type(await screen.findByLabelText("Message your coach"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    await waitFor(() => expect(loads).toBe(2));
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });

  it("lets the poll find the reply when a Retry failed before it was stored but the server had restarted the message", async () => {
    const failed = message({ id: "m1", text: "2 eggs", status: "failed", error_code: "timeout" });
    const pending = { ...failed, status: "pending" as const, error_code: null };
    let loads = 0;
    mockFetch((url) => {
      if (url === "/api/messages/m1/retry") throw new TypeError("Failed to fetch"); // the retry ran, and the answer was lost on the way back
      loads += 1;
      if (loads === 1) return jsonResponse(dayView({ messages: [failed] }));
      if (loads === 2) return jsonResponse(dayView({ messages: [pending] }));
      return jsonResponse(dayView({ messages: [{ ...pending, status: "done" }, reply("m1")] }));
    });
    renderToday();
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loads).toBe(2));
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });

  it("starts a Retry with the words for its photos, then shows each step the coach streams", async () => {
    const stream = controlledStream();
    const failed = message({ id: "m1", text: "2 eggs", photo_ids: ["a".repeat(32)], status: "failed", error_code: "timeout" });
    mockFetch((url) => (url === "/api/messages/m1/retry" ? stream.response : jsonResponse(dayView({ messages: [failed] }))));
    renderToday();
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(screen.getByRole("status")).toHaveTextContent("Looking at your photo…");
    const pending = { ...failed, status: "pending" as const, error_code: null };
    act(() => stream.send("stored", { day: dayView({ messages: [pending] }) }));
    act(() => stream.send("step", { text: "Logging eggs…" }));
    await act(() => vi.advanceTimersByTimeAsync(MIN_STEP_MS));
    expect(screen.getByRole("status")).toHaveTextContent("Logging eggs…");
    answer(stream, pending);
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });

  it("keeps a Retry's last step, and lets the poll find the reply, when its stream drops after the message was stored", async () => {
    const stream = controlledStream();
    const failed = message({ id: "m1", text: "2 eggs", status: "failed", error_code: "timeout" });
    const pending = { ...failed, status: "pending" as const, error_code: null };
    let loads = 0;
    mockFetch((url) => {
      if (url === "/api/messages/m1/retry") return stream.response;
      loads += 1;
      if (loads === 1) return jsonResponse(dayView({ messages: [failed] }));
      if (loads === 2) return jsonResponse(dayView({ messages: [pending] }));
      return jsonResponse(dayView({ messages: [{ ...pending, status: "done" }, reply("m1")] }));
    });
    renderToday();
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    act(() => stream.send("stored", { day: dayView({ messages: [pending] }) }));
    act(() => stream.send("step", { text: "Logging eggs…" }));
    await act(() => vi.advanceTimersByTimeAsync(MIN_STEP_MS));
    act(() => stream.end());
    await waitFor(() => expect(loads).toBe(2));
    expect(screen.getByRole("status")).toHaveTextContent("Logging eggs…");
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });
});
