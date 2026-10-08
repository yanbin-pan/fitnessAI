import { onlineManager } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignedOutBanner } from "../components/SignedOutBanner.tsx";
import { SessionProvider } from "../session.tsx";
import type { DayView } from "../shared.ts";
import { dayView, entry, exerciseItem, foodItem, message } from "../test/fixtures.ts";
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

// One test goes offline on TanStack's own clock; every test ends back online.
afterEach(() => onlineManager.setOnline(true));

describe("TodayPage", () => {
  it("offers profile setup until a profile exists", async () => {
    mockFetch(() => jsonResponse({ error: "no_profile" }, 409));
    renderDay();
    expect(await screen.findByRole("link", { name: "Set up profile" })).toHaveAttribute("href", "/settings");
  });

  it("opens /day/today from the server and gives only today a composer", async () => {
    const fetchMock = mockFetch(() => jsonResponse(dayView()));
    renderDay("/day/today");
    expect(await screen.findByLabelText("Message Zabaione")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/days/today");
  });

  it("keeps the end of the feed clear of the composer by the height the composer publishes", async () => {
    mockFetch(() => jsonResponse(dayView()));
    renderDay();
    await screen.findByLabelText("Message Zabaione");
    // jsdom applies no CSS, so this pins the contract: the page's bottom padding is made of --composer-h (with a fallback
    // for days that have no composer), the tab bar and the home-indicator inset. The layout itself is checked in a browser.
    expect(screen.getByRole("main")).toHaveClass("pb-[calc(var(--composer-h,8rem)_+_var(--tabbar-h)_+_env(safe-area-inset-bottom)_+_1rem)]");
  });

  it("keeps the composer on the three days before today", async () => {
    const fetchMock = mockFetch(() => jsonResponse(dayView({ date: "2026-09-30" })));
    renderDay("/day/2026-09-30");
    expect(await screen.findByLabelText("Message Zabaione")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/days/2026-09-30");
  });

  it("shows a day before the chat window without a composer", async () => {
    const fetchMock = mockFetch(() => jsonResponse(dayView({ date: "2026-09-29" })));
    renderDay("/day/2026-09-29");
    expect(await screen.findByText("+ Add manually")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message Zabaione")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/days/2026-09-29");
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
    await userEvent.click(screen.getByRole("radio", { name: "Log" }));
    expect(screen.queryByText("eggs and toast")).not.toBeInTheDocument();
    expect(screen.getByText("Scrambled eggs")).toBeInTheDocument();
  });

  it("puts the activities card under the summary, and its Edit opens the editor", async () => {
    const ride = entry({ id: "e9", foods: [], exercises: [exerciseItem({ name: "Bike ride", activity: "cycling", kcal: 400 })] });
    mockFetch(() => jsonResponse(dayView({ entries: [ride] })));
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    const card = await screen.findByRole("region", { name: "Activity" });
    await userEvent.click(within(card).getByRole("button", { name: "Bike ride, 400 kcal" }));
    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit entry" })).toBeInTheDocument();
  });

  it("offers the day's featured activities in the editor", async () => {
    mockFetch(() => jsonResponse(dayView({ featured: ["climbing", "running", "walking", "cycling"] })));
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "+ Add manually" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    const picker = screen.getByRole("group", { name: "Activity for exercise 1" });
    expect(within(picker).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Climbing", "Running", "Walking", "Cycling", "Other"]);
  });

  it("still opens the editor when an older server leaves featured out", async () => {
    // A 2.2 copy of the app against a 2.1 server (a rollback): the day view has no featured row at all.
    const { featured: _featured, ...older } = dayView();
    mockFetch(() => jsonResponse(older as unknown as DayView));
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "+ Add manually" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    const picker = screen.getByRole("group", { name: "Activity for exercise 1" });
    expect(within(picker).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Other"]);
    await userEvent.click(within(picker).getByRole("button", { name: "More" }));
    expect(within(picker).getAllByRole("radio")).toHaveLength(33);
    expect(within(picker).queryByText("Your sports")).toBeNull();
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

  it("Undo of an entry the coach back-dated deletes it, then looks at the viewed day again", async () => {
    const backDated = named("back", "Scrambled eggs", { message_id: "m1", date: "2026-10-02" });
    const reply = message({ id: "m2", role: "assistant", status: null, reply_to: "m1", text: "Logged for yesterday.", cards: [{ type: "entry", id: "back" }] });
    const calls: string[] = [];
    let removed = false;
    mockFetch((url, init) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (method === "DELETE") {
        removed = true;
        // The DELETE answers with the day the entry was on (yesterday), not the day on screen.
        return jsonResponse({ day: dayView({ date: "2026-10-02" }) });
      }
      return jsonResponse(dayView({ linked_entries: removed ? [] : [backDated], messages: [question, reply] }));
    });
    renderDay();
    expect(await screen.findByText("Logged to Yesterday")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByText("Entry removed")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(calls).toEqual(["GET /api/days/today", "DELETE /api/entries/back", "GET /api/days/today"]);
  });

  it("offers + Add manually only as far back as the server takes a new entry", async () => {
    mockFetch((url) => jsonResponse(dayView({ date: url.split("/").pop() ?? "" })));
    // Today is 2026-10-03: the 26th of September is seven days back, the 25th is eight.
    const week = renderDay("/day/2026-09-26");
    await userEvent.click(await screen.findByRole("button", { name: "+ Add manually" }));
    expect(screen.getByRole("dialog", { name: "Add manually" })).toBeInTheDocument();
    week.unmount();

    renderDay("/day/2026-09-25");
    expect(await screen.findByText("Nothing logged this day.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add manually" })).not.toBeInTheDocument();
  });

  it("Editing an entry the coach back-dated saves it, then looks at the viewed day again", async () => {
    const backDated = named("back", "Scrambled eggs", { message_id: "m1", date: "2026-10-02" });
    const reply = message({ id: "m2", role: "assistant", status: null, reply_to: "m1", text: "Logged for yesterday.", cards: [{ type: "entry", id: "back" }] });
    const calls: string[] = [];
    let saved = backDated;
    mockFetch((url, init) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (method === "PATCH") {
        const { foods } = JSON.parse(String(init?.body)) as { foods: { name: string; kcal: number }[] };
        saved = { ...backDated, edited: true, foods: foods.map((f, i) => foodItem({ id: `f-back-${i}`, name: f.name, kcal: f.kcal })) };
        // The PATCH answers with the day the entry is on (yesterday), not the day on screen.
        return jsonResponse({ entry: saved, day: dayView({ date: "2026-10-02", entries: [saved] }) });
      }
      return jsonResponse(dayView({ linked_entries: [saved], messages: [question, reply] }));
    });
    renderDay();
    expect(await screen.findByText("Logged to Yesterday")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Scrambled eggs/ }));
    const kcal = screen.getByLabelText("kcal");
    await userEvent.clear(kcal);
    await userEvent.type(kcal, "350");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("350 kcal · edited")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toEqual(["GET /api/days/today", "PATCH /api/entries/back", "GET /api/days/today"]);
  });

  it("Deleting an entry the coach back-dated removes it, then looks at the viewed day again", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const backDated = named("back", "Scrambled eggs", { message_id: "m1", date: "2026-10-02" });
    const reply = message({ id: "m2", role: "assistant", status: null, reply_to: "m1", text: "Logged for yesterday.", cards: [{ type: "entry", id: "back" }] });
    const calls: string[] = [];
    let removed = false;
    mockFetch((url, init) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (method === "DELETE") {
        removed = true;
        // The DELETE answers with the day the entry was on (yesterday), not the day on screen.
        return jsonResponse({ day: dayView({ date: "2026-10-02" }) });
      }
      return jsonResponse(dayView({ linked_entries: removed ? [] : [backDated], messages: [question, reply] }));
    });
    renderDay();
    expect(await screen.findByText("Logged to Yesterday")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Scrambled eggs/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Entry removed")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toEqual(["GET /api/days/today", "DELETE /api/entries/back", "GET /api/days/today"]);
  });

  it("does not offer + Add manually on a day after today", async () => {
    mockFetch((url) => jsonResponse(dayView({ date: url.split("/").pop() ?? "" })));
    renderDay("/day/2026-10-04");
    expect(await screen.findByText("Nothing logged this day.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add manually" })).not.toBeInTheDocument();
  });

  it("closes an open editor when Back leaves its day, instead of carrying it over to the other day", async () => {
    function HistoryBack() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate(-1)}>
          history back
        </button>
      );
    }
    mockFetch((url) => jsonResponse(dayView({ date: url.split("/").pop() ?? "" })));
    renderWithProviders(<><TodayPage /><HistoryBack /></>, { route: "/day/2026-09-26", path: "/day/:date" });
    await userEvent.click(await screen.findByRole("button", { name: "Next day" }));
    await userEvent.click(await screen.findByRole("button", { name: "+ Add manually" }));
    expect(screen.getByRole("dialog", { name: "Add manually" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "history back" }));
    expect(await screen.findByText("Sat 26 Sept")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("takes Retry away while the first retry is still running, so it can't be tapped again", async () => {
    const failed = message({ id: "m9", text: "porridge", status: "failed", error_code: "timeout" });
    const done = message({ id: "m9", text: "porridge", status: "done" });
    const reply = message({ id: "r9", role: "assistant", status: null, reply_to: "m9", text: "Logged porridge." });
    let finish: (response: Response) => void = () => {};
    const fetchMock = mockFetch((_url, init) =>
      init?.method === "POST" ? new Promise<Response>((resolve) => (finish = resolve)) : jsonResponse(dayView({ messages: [failed] })),
    );
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    // The message is pending again, with the coach's row where Retry was: there is nothing left to tap a second time.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    finish(jsonResponse({ user: done, reply, day: dayView({ messages: [done, reply] }) }));
    expect(await screen.findByText("Logged porridge.")).toBeInTheDocument();
  });

  it("keeps Retry disabled, and queues it once, while the browser reports it is offline", async () => {
    const failed = message({ id: "m9", text: "porridge", status: "failed", error_code: "timeout" });
    const done = message({ id: "m9", text: "porridge", status: "done" });
    const reply = message({ id: "r9", role: "assistant", status: null, reply_to: "m9", text: "Logged porridge." });
    let retried = false;
    const fetchMock = mockFetch((_url, init) => {
      if (init?.method !== "POST") return jsonResponse(dayView({ messages: retried ? [done, reply] : [failed] }));
      retried = true;
      return jsonResponse({ user: done, reply, day: dayView({ messages: [done, reply] }) });
    });
    const retries = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    renderDay();
    await screen.findByRole("button", { name: "Retry" });
    onlineManager.setOnline(false);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    // TanStack holds the retry back until the network returns, so the message is still failed: the disabled Retry is what marks it as queued.
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retries()).toHaveLength(0);
    onlineManager.setOnline(true);
    expect(await screen.findByText("Logged porridge.")).toBeInTheDocument();
    expect(retries()).toHaveLength(1);
  });

  it("a second Retry that finds the message already restarted shows no alert and looks at the day again", async () => {
    const failed = message({ id: "m9", text: "porridge", status: "failed", error_code: "timeout" });
    const done = message({ id: "m9", text: "porridge", status: "done" });
    const reply = message({ id: "r9", role: "assistant", status: null, reply_to: "m9", text: "Logged porridge." });
    const calls: string[] = [];
    let online = true;
    let restarted = false;
    mockFetch((url, init) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (method === "POST") {
        if (!restarted) {
          // The first tap: the retry ran on the server, but the connection dropped before the reply came back.
          restarted = true;
          online = false;
          throw new TypeError("Failed to fetch");
        }
        online = true; // back in range, and the screen still offers Retry: the server says it is no longer failed
        return jsonResponse({ error: "not_failed" }, 409);
      }
      if (!online) throw new TypeError("Failed to fetch");
      return jsonResponse(dayView({ messages: restarted ? [done, reply] : [failed] }));
    });
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Logged porridge.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls).toEqual([
      "GET /api/days/today", "POST /api/messages/m9/retry", "GET /api/days/today", "POST /api/messages/m9/retry", "GET /api/days/today",
    ]);
  });

  it("still shows the day when an older server leaves linked_entries out", async () => {
    const view = dayView({ entries: [eggs], messages: [question, { ...answer, cards: [{ type: "entry", id: "a" }] }] });
    mockFetch(() => jsonResponse({ ...view, linked_entries: undefined }));
    renderDay();
    expect(await screen.findByText("Scrambled eggs")).toBeInTheDocument();
  });
});

describe("TodayPage: the name and the greeting", () => {
  const stored = {
    sex: "male", birth_date: "1990-05-04", height_cm: 178, weight_kg: 80, activity_level: "light", goal: "maintain",
    goal_rate_kg_week: 0, body_goal_priority: "high", protein_g_per_kg: 1.8, fat_pct: 30, fibre_g: 30, add_back_pct: 50,
    override_kcal: null, override_protein_g: null, override_carbs_g: null, override_fat_g: null, override_fibre_g: null,
    timezone: "Europe/London", units_mass: "kg", units_length: "cm", context_days: 5, goal_notes: "on", language: "en",
    name: null, name_prompt: "show",
  } as const;
  const calculated = { kcal: 2300, protein_g: 144, carbs_g: 260, fat_g: 70, fibre_g: 30 };

  it("asks once for the name, and the hello uses it straight away", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((url, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return jsonResponse({ profile: body, calculated });
      }
      return jsonResponse(dayView());
    });
    const { client } = renderDay();
    client.setQueryData(["profile"], { profile: stored, calculated });
    await userEvent.type(await screen.findByPlaceholderText("Your name"), "Bin");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("Hey, what should Zabaione call you?")).toBeNull());
    expect(puts[0]).toMatchObject({ name: "Bin", name_prompt: "done", height_cm: 178 });
    expect(screen.getByText(/Bin/)).toBeInTheDocument();
  });

  it("Not now settles it without a name", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return jsonResponse({ profile: body, calculated });
      }
      return jsonResponse(dayView());
    });
    const { client } = renderDay();
    client.setQueryData(["profile"], { profile: stored, calculated });
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByText("Hey, what should Zabaione call you?")).toBeNull());
    expect(puts[0]).toMatchObject({ name: null, name_prompt: "done" });
  });

  it("asks once for a companion after the name, and the day bar shows the one picked", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return jsonResponse({ profile: body, calculated });
      }
      return jsonResponse(dayView());
    });
    const { client } = renderDay();
    client.setQueryData(["profile"], { profile: { ...stored, name: "Bin", name_prompt: "done", companion: "zabaione", companion_prompt: "show" }, calculated });
    expect(await screen.findByRole("heading", { name: "Pick a companion" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zabaione, Okay. How your week is going" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Meringa/ }));
    await userEvent.click(screen.getByRole("button", { name: "Choose Meringa" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Pick a companion" })).toBeNull());
    expect(puts[0]).toMatchObject({ companion: "meringa", companion_prompt: "done", name: "Bin" });
    expect(screen.getByRole("button", { name: "Meringa, Okay. How your week is going" })).toBeInTheDocument();
  });

  it("asks for the name before the companion, and Not now keeps Zabaione", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return jsonResponse({ profile: body, calculated });
      }
      return jsonResponse(dayView());
    });
    const { client } = renderDay();
    client.setQueryData(["profile"], { profile: { ...stored, companion: "zabaione", companion_prompt: "show" }, calculated });
    expect(await screen.findByText("Hey, what should Zabaione call you?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pick a companion" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(await screen.findByRole("heading", { name: "Pick a companion" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Pick a companion" })).toBeNull());
    expect(puts[1]).toMatchObject({ companion: "zabaione", companion_prompt: "done" });
  });

  it("keeps the corner empty for an older server that sends no mood", async () => {
    mockFetch(() => jsonResponse({ ...dayView(), companion: undefined }));
    renderDay();
    expect(await screen.findByRole("button", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /How your week is going/ })).toBeNull();
  });

  it("starts the chat under a divider whose All | Log switch shows everything or only what was logged", async () => {
    mockFetch(() => jsonResponse(dayView({ entries: [named("a", "Scrambled eggs", { message_id: "m1" })], messages: [question] })));
    renderDay();
    expect(await screen.findByText("Chat")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Show" });
    expect(within(group).getByRole("radio", { name: "All" })).toBeChecked();
    await userEvent.click(within(group).getByRole("radio", { name: "Log" }));
    expect(within(group).getByRole("radio", { name: "Log" })).toBeChecked();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("opens today at its latest entry, and goes back down when something new arrives", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(document, "scrollingElement", { configurable: true, value: { scrollTo, scrollHeight: 2400 } });
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      run(0);
      return 0;
    });
    let view = dayView({ entries: [named("a", "Scrambled eggs", { message_id: "m1" })], messages: [question] });
    mockFetch(() => jsonResponse(view));
    const { client } = renderDay();
    expect(await screen.findByText("Scrambled eggs")).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 2400, behavior: "instant" }));
    view = { ...view, entries: [...view.entries, named("b", "Toast", { message_id: "m1" })] };
    client.setQueryData(["day", "today"], view);
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ top: 2400, behavior: "smooth" }));
    Reflect.deleteProperty(document, "scrollingElement");
  });

  it("opens another day at the top, on its summary, and today too while it is empty", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(document, "scrollingElement", { configurable: true, value: { scrollTo, scrollHeight: 2400 } });
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      run(0);
      return 0;
    });
    const past = dayView({ date: "2026-10-02", entries: [named("a", "Scrambled eggs", { message_id: "m1" })], messages: [question] });
    mockFetch((url) => jsonResponse(url.endsWith("/today") ? dayView() : past));
    const { unmount } = renderDay("/day/2026-10-02");
    expect(await screen.findByText("Scrambled eggs")).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" }));
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 2400, behavior: "instant" });
    unmount();
    scrollTo.mockClear();
    renderDay();
    expect(await screen.findByText("Chat")).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" }));
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 2400, behavior: "instant" });
    Reflect.deleteProperty(document, "scrollingElement");
  });

  it("doesn't ask on another day, and greets only on today, never in Log only", async () => {
    mockFetch((url) => jsonResponse(url.endsWith("/today") ? dayView() : dayView({ date: "2026-10-02" })));
    const { client } = renderDay("/day/2026-10-02");
    client.setQueryData(["profile"], { profile: { ...stored, name: "Bin" }, calculated });
    expect(await screen.findByText("Yesterday")).toBeInTheDocument();
    expect(screen.queryByText("Hey, what should Zabaione call you?")).toBeNull();
    expect(screen.queryByText(/Bin/)).toBeNull();
  });

  it("puts Zabaione's hello at the top of today's chat, with the name, and Log only hides it", async () => {
    mockFetch(() => jsonResponse(dayView({ entries: [named("a", "Scrambled eggs", { message_id: "m1" })], messages: [question] })));
    const { client } = renderDay();
    client.setQueryData(["profile"], { profile: { ...stored, name: "Bin", name_prompt: "done" }, calculated });
    const hello = await screen.findByText(/Bin/);
    const feed = hello.closest("ol");
    expect(feed?.firstElementChild).toContainElement(hello);
    await userEvent.click(screen.getByRole("radio", { name: "Log" }));
    expect(screen.queryByText(/Bin/)).toBeNull();
  });
});
