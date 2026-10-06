import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_STEP_MS, resetLive } from "../coach/live.ts";
import type { MessageInput } from "../shared.ts";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { TodayPage } from "./TodayPage.tsx";

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

const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetLive();
});
afterEach(() => {
  resetLive();
  vi.useRealTimers();
});

describe("TodayPage, sending (spec §11.1)", () => {
  it("puts the message in the feed at once, shows the coach's steps, then the reply", async () => {
    const stream = controlledStream();
    let posted: MessageInput | null = null;
    mockFetch((url, init) => {
      if (url === "/api/messages") {
        posted = JSON.parse(String(init?.body)) as MessageInput;
        return stream.response;
      }
      return jsonResponse(dayView());
    });
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    await user.type(await screen.findByLabelText("Message Zabaione"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("2 eggs")).toBeInTheDocument();
    expect(screen.getByLabelText("Message Zabaione")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");

    const id = (posted as MessageInput | null)?.id ?? "";
    const pending = message({ id, text: "2 eggs", status: "pending", sent_at: "2026-10-03T07:09:00.000Z" });
    act(() => stream.send("stored", { day: dayView({ messages: [pending] }) }));
    act(() => stream.send("step", { text: "Logging eggs…" }));
    await act(() => vi.advanceTimersByTimeAsync(MIN_STEP_MS));
    expect(screen.getByRole("status")).toHaveTextContent("Logging eggs…");

    const reply = message({ id: "r1", role: "assistant", text: "Logged 2 eggs.", status: null, reply_to: id, created_at: "2026-10-03T07:09:30.000Z" });
    act(() => {
      stream.send("result", { user: { ...pending, status: "done" }, reply, day: dayView({ messages: [{ ...pending, status: "done" }, reply] }) });
      stream.end();
    });
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("puts the text back in the composer when the message never reached the server", async () => {
    mockFetch((url) => {
      if (url === "/api/messages") throw new TypeError("Failed to fetch");
      return jsonResponse(dayView());
    });
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    await user.type(await screen.findByLabelText("Message Zabaione"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("Message Zabaione")).toHaveValue("2 eggs");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lets the poll find the reply when the stream drops after the message was stored", async () => {
    const stream = controlledStream();
    let id = "";
    let loads = 0;
    mockFetch((url, init) => {
      if (url === "/api/messages") {
        id = (JSON.parse(String(init?.body)) as MessageInput).id;
        return stream.response;
      }
      loads += 1;
      const pending = message({ id, text: "2 eggs", status: "pending" });
      if (loads <= 2) return jsonResponse(dayView({ messages: id ? [pending] : [] }));
      const reply = message({ id: "r1", role: "assistant", text: "Logged 2 eggs.", status: null, reply_to: id, created_at: "2026-10-03T07:09:30.000Z" });
      return jsonResponse(dayView({ messages: [{ ...pending, status: "done" }, reply] }));
    });
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    await user.type(await screen.findByLabelText("Message Zabaione"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    act(() => stream.send("stored", { day: dayView({ messages: [message({ id, text: "2 eggs", status: "pending" })] }) }));
    act(() => stream.end());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Thinking…"));
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });

  it("streams a Retry: the failed message shows the coach working again, then the reply", async () => {
    const stream = controlledStream();
    const failed = message({ id: "m1", text: "2 eggs", status: "failed", error_code: "timeout" });
    mockFetch((url) => (url === "/api/messages/m1/retry" ? stream.response : jsonResponse(dayView({ messages: [failed] }))));
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    const pending = { ...failed, status: "pending" as const, error_code: null };
    act(() => stream.send("stored", { day: dayView({ messages: [pending] }) }));
    const reply = message({ id: "r1", role: "assistant", text: "Logged 2 eggs.", status: null, reply_to: "m1", created_at: "2026-10-03T07:09:30.000Z" });
    act(() => {
      stream.send("result", { user: { ...pending, status: "done" }, reply, day: dayView({ messages: [{ ...pending, status: "done" }, reply] }) });
      stream.end();
    });
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });
});
