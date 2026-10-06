import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_STEP_MS, isLive, resetLive } from "../coach/live.ts";
import { STREAM_IDLE_MS } from "../coach/stream.ts";
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
    const box = await screen.findByLabelText("Message Zabaione");
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
    await user.type(await screen.findByLabelText("Message Zabaione"), "2 eggs");
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
    const box = await screen.findByLabelText("Message Zabaione");
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
    await user.type(await screen.findByLabelText("Message Zabaione"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    act(() => stream.send("stored", { day: dayView({ messages: [message({ id: sent.id, text: "2 eggs", status: "pending" })] }) }));
    act(() => stream.send("step", { text: "Logging eggs…" }));
    await act(() => vi.advanceTimersByTimeAsync(MIN_STEP_MS));
    act(() => stream.end());
    await waitFor(() => expect(sent.loads).toBe(2)); // the day is fetched again once the stream has dropped
    expect(screen.getByRole("status")).toHaveTextContent("Logging eggs…");
  });

  it("hands a message over to the poll when its stream goes quiet after it was stored, so Send isn't stuck", async () => {
    const stream = controlledStream();
    const sent = server(stream, (_load, id) => dayView({ messages: id ? [message({ id, text: "2 eggs", status: "pending" })] : [] }));
    renderToday();
    const box = await screen.findByLabelText("Message Zabaione");
    await user.type(box, "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    act(() => stream.send("stored", { day: dayView({ messages: [message({ id: sent.id, text: "2 eggs", status: "pending" })] }) }));
    await waitFor(() => expect(box).not.toHaveAttribute("readonly"));
    await user.type(box, "and toast");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(isLive(sent.id)).toBe(true);

    // Not another byte, not even a keep-alive: the connection is dead although it never said so.
    await act(() => vi.advanceTimersByTimeAsync(STREAM_IDLE_MS));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(isLive(sent.id)).toBe(false);
    await waitFor(() => expect(sent.loads).toBe(2)); // the day is fetched again, and the poll takes the message from there
    expect(box).toHaveValue("and toast"); // and what was typed meanwhile is still there to send
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
    await user.type(await screen.findByLabelText("Message Zabaione"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    await waitFor(() => expect(loads).toBe(2));
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });

  it("leaves the server's own copy of a message in the feed when sending it again is refused", async () => {
    let id = "";
    let posts = 0;
    let loads = 0;
    mockFetch((url, init) => {
      if (url === "/api/messages") {
        id = (JSON.parse(String(init?.body)) as MessageInput).id;
        posts += 1;
        if (posts === 1) throw new TypeError("Failed to fetch"); // the server got it, and the answer was lost on the way back
        return jsonResponse({ error: "in_progress" }, 409); // and the coach is still on it
      }
      loads += 1;
      if (loads === 1) return jsonResponse(dayView());
      if (loads === 2) return jsonResponse(dayView({ messages: [message({ id, text: "2 eggs", status: "pending" })] }));
      throw new TypeError("Failed to fetch"); // offline from here on, so nothing could bring a removed copy back
    });
    renderToday();
    await user.type(await screen.findByLabelText("Message Zabaione"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Thinking…")); // the server's copy
    await user.click(screen.getByRole("button", { name: "Send" })); // the same message again, with the same id
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("still working"));
    await waitFor(() => expect(loads).toBe(3));
    expect(posts).toBe(2);
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…"); // the server's copy is still in the feed
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

  it("marks a Retry live before it shows the message pending, so no write leaves a pending message the poll would chase", async () => {
    const stream = controlledStream();
    const failed = message({ id: "m1", text: "2 eggs", status: "failed", error_code: "timeout" });
    mockFetch((url) => (url === "/api/messages/m1/retry" ? stream.response : jsonResponse(dayView({ messages: [failed] }))));
    const { client } = renderToday();
    const retry = await screen.findByRole("button", { name: "Retry" });
    // At every write that leaves m1 pending: was its stream open? A pending message that isn't live arms the 3 s poll.
    const live: boolean[] = [];
    client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const view = event.query.state.data as DayView | undefined;
      if (view?.messages.some((m) => m.id === "m1" && m.status === "pending")) live.push(isLive("m1"));
    });
    await user.click(retry);
    const pending = { ...failed, status: "pending" as const, error_code: null };
    act(() => stream.send("stored", { day: dayView({ messages: [pending] }) }));
    answer(stream, pending);
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
    expect(live.length).toBeGreaterThan(0);
    expect(live).not.toContain(false);
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
    await act(() => vi.advanceTimersByTimeAsync(50)); // let the screen settle after the drop
    expect(screen.getByRole("status")).toHaveTextContent("Logging eggs…");
    expect(screen.queryByRole("alert")).toBeNull(); // the retry went through: as after a Send, there is nothing to report
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
