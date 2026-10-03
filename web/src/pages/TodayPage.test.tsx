import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SignedOutBanner } from "../components/SignedOutBanner.tsx";
import { SessionProvider } from "../session.tsx";
import { dayView, entry, foodItem, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { TodayPage } from "./TodayPage.tsx";

function renderDay(route = "/day/today") {
  return renderWithProviders(<TodayPage />, { route, path: "/day/:date" });
}

const named = (id: string, name: string, extra = {}) => entry({ id, source: "coach", foods: [foodItem({ id: `f-${id}`, name })], ...extra });
const eggs = named("a", "Scrambled eggs", { message_id: "m1" });
const toast = named("b", "Toast", { message_id: "m1" });
const porridge = named("old", "Porridge", { message_id: "m0", edited: true });
const question = message({ id: "m1", text: "eggs and toast" });
// The reply logged two entries and also corrected an older one.
const answer = message({
  id: "m2", role: "assistant", status: null, reply_to: "m1", text: "Logged.",
  cards: [{ type: "entry", id: "a" }, { type: "entry", id: "b" }, { type: "entry", id: "old" }],
});

/** A tiny stand-in server: GET shows what has not been deleted; DELETE removes one entry and returns the day. */
function fakeServer() {
  const gone = new Set<string>();
  const failing = new Set<string>();
  const calls: string[] = [];
  const view = () => dayView({ entries: [eggs, toast, porridge].filter((e) => !gone.has(e.id)), messages: [question, answer] });
  mockFetch((url, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (method !== "DELETE") return jsonResponse(view());
    const id = url.split("/").pop() ?? "";
    if (failing.has(id)) return jsonResponse({ error: "internal" }, 500);
    if (gone.has(id)) return jsonResponse({ error: "not_found" }, 404);
    gone.add(id);
    return jsonResponse({ day: view() });
  });
  return { calls, failing, deletes: () => calls.filter((c) => c.startsWith("DELETE")) };
}

describe("TodayPage", () => {
  it("offers profile setup until a profile exists", async () => {
    mockFetch(() => jsonResponse({ error: "no_profile" }, 409));
    renderDay();
    expect(await screen.findByRole("link", { name: "Set up profile" })).toHaveAttribute("href", "/settings");
  });

  it("opens /day/today from the server and gives only today a composer", async () => {
    const fetchMock = mockFetch(() => jsonResponse(dayView()));
    renderDay("/day/today");
    expect(await screen.findByLabelText("Message your coach")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/days/today");
  });

  it("shows a past day without a composer", async () => {
    const fetchMock = mockFetch(() => jsonResponse(dayView({ date: "2026-10-02" })));
    renderDay("/day/2026-10-02");
    expect(await screen.findByText("Yesterday")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message your coach")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/days/2026-10-02");
  });

  it("Undo deletes what the reply's own message logged, never the older entry it corrected, and shows the server's day", async () => {
    const server = fakeServer();
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument());
    expect(server.deletes()).toEqual(["DELETE /api/entries/a", "DELETE /api/entries/b"]);
    expect(screen.getAllByText("Entry removed")).toHaveLength(2);
    expect(screen.getByText("Porridge")).toBeInTheDocument();
  });

  it("Retry posts to the message's retry route and shows what the coach then logged", async () => {
    const failed = message({ id: "m9", text: "porridge", status: "failed", error_code: "timeout" });
    const done = message({ id: "m9", text: "porridge", status: "done" });
    const logged = named("n1", "Porridge", { message_id: "m9" });
    const reply = message({ id: "r9", role: "assistant", status: null, reply_to: "m9", text: "Logged porridge.", cards: [{ type: "entry", id: "n1" }] });
    const fetchMock = mockFetch((_url, init) =>
      init?.method === "POST"
        ? jsonResponse({ user: done, reply, day: dayView({ entries: [logged], messages: [done, reply] }) })
        : jsonResponse(dayView({ messages: [failed] })),
    );
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Logged porridge.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/messages/m9/retry", expect.objectContaining({ method: "POST" }));
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("Log only hides the conversation and keeps the entries", async () => {
    mockFetch(() => jsonResponse(dayView({ entries: [eggs], messages: [question, { ...answer, cards: [{ type: "entry", id: "a" }] }] })));
    renderDay();
    expect(await screen.findByText("eggs and toast")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Log only"));
    expect(screen.queryByText("eggs and toast")).not.toBeInTheDocument();
    expect(screen.getByText("Scrambled eggs")).toBeInTheDocument();
  });

  it("raises the signed-out banner when Retry finds the Access session expired", async () => {
    const failed = message({ id: "m9", status: "failed", error_code: "timeout" });
    mockFetch((_url, init) => (init?.method === "POST" ? new Response(null, { status: 401 }) : jsonResponse(dayView({ messages: [failed] }))));
    renderWithProviders(
      <SessionProvider>
        <SignedOutBanner />
        <TodayPage />
      </SessionProvider>,
      { route: "/day/today", path: "/day/:date" },
    );
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Signed out\./)).toBeInTheDocument();
  });

  it("says so when Retry cannot reach the server, and keeps Retry available", async () => {
    const failed = message({ id: "m9", status: "failed", error_code: "timeout" });
    mockFetch((_url, init) => {
      if (init?.method === "POST") throw new TypeError("Failed to fetch");
      return jsonResponse(dayView({ messages: [failed] }));
    });
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("a half-finished Undo refreshes from the server and says so", async () => {
    const server = fakeServer();
    server.failing.add("b");
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Entry removed")).toHaveLength(1)); // "a" is gone, "b" is still logged
    expect(screen.getByText("Toast")).toBeInTheDocument();
  });

  it("a second Undo reaches the entries a half-finished one left behind", async () => {
    const server = fakeServer();
    server.failing.add("b");
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.deletes()).toEqual(["DELETE /api/entries/a", "DELETE /api/entries/b"]));
    server.failing.delete("b"); // the connection is back
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument());
    expect(screen.getAllByText("Entry removed")).toHaveLength(2);
    expect(screen.getByText("Porridge")).toBeInTheDocument();
  });

  it("Undo carries on past an entry that is already gone", async () => {
    const both = [{ type: "entry" as const, id: "a" }, { type: "entry" as const, id: "b" }];
    const deleted: string[] = [];
    mockFetch((url, init) => {
      if (init?.method !== "DELETE") return jsonResponse(dayView({ entries: [eggs, toast], messages: [question, { ...answer, cards: both }] }));
      deleted.push(url);
      // "a" was already removed elsewhere (another tab, an earlier half-finished Undo).
      return url.endsWith("/a") ? jsonResponse({ error: "not_found" }, 404) : jsonResponse({ day: dayView({ entries: [eggs], messages: [question, { ...answer, cards: both }] }) });
    });
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(deleted).toEqual(["/api/entries/a", "/api/entries/b"]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
