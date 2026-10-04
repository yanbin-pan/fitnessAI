import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayView, entry, exerciseItem } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { EntryEditor } from "./EntryEditor.tsx";

/** An entry with one exercise whose kcal the server derived from its MET. */
const outdoorRun = () => entry({
  foods: [],
  exercises: [{
    id: "x1", position: 0, name: "Outdoor run", category: "cardio", activity: "other", duration_min: 30, sets: null, reps: null, weight_kg: null,
    distance_km: 5, avg_hr: null, met: 9.8, kcal: 287.4, kcal_measured: false, assumption: "easy pace",
    muscles: [{ muscle: "quads", role: "primary" }],
  }],
});

describe("EntryEditor", () => {
  it("saves edited numbers with a PATCH that keeps the fields it does not show", async () => {
    const sample = entry();
    const fetchMock = mockFetch(() => jsonResponse({ entry: sample, day: dayView({ entries: [sample] }) }));
    const onClose = vi.fn();
    renderWithProviders(<EntryEditor date="2026-10-03" entry={sample} onClose={onClose} />);

    const kcal = screen.getByLabelText("kcal");
    await userEvent.clear(kcal);
    await userEvent.type(kcal, "350");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/entries/e1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body)).foods[0]).toMatchObject({
      name: "Porridge", kcal: 350, saturated_fat_g: 1.5, groups: [{ group: "wholegrains", portions: 1 }],
    });
  });

  it("deletes after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockFetch(() => jsonResponse({ day: dayView() }));
    const onClose = vi.fn();
    renderWithProviders(<EntryEditor date="2026-10-03" entry={entry()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("adds a manual entry with a POST", async () => {
    const created = entry({ id: "new" });
    const fetchMock = mockFetch(() => jsonResponse({ entry: created, day: dayView({ entries: [created] }) }, 201));
    renderWithProviders(<EntryEditor date="2026-10-02" entry={null} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Food"), "Apple");
    await userEvent.type(screen.getByLabelText("kcal"), "52");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/entries");
    expect(JSON.parse(String(init?.body))).toMatchObject({ date: "2026-10-02", time: null, foods: [{ name: "Apple", kcal: 52 }], exercises: [] });
  });

  it("lets you pick an exercise's activity, and sends it", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ entry: entry(), day: dayView() }, 201));
    renderWithProviders(<EntryEditor date="2026-10-03" entry={null} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    await userEvent.type(screen.getByLabelText("Exercise"), "Kite session");
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Kitesurfing" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.exercises[0]).toMatchObject({ name: "Kite session", activity: "kitesurfing" });
  });

  it("shows the activity an exercise already has, and sends a change to it with the PATCH", async () => {
    const sample = entry({ foods: [], exercises: [exerciseItem()] }); // a tennis session
    const fetchMock = mockFetch(() => jsonResponse({ entry: sample, day: dayView({ entries: [sample] }) }));
    renderWithProviders(<EntryEditor date="2026-10-03" entry={sample} onClose={() => {}} />);
    expect(screen.getByRole("radio", { name: "Tennis" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Gym" }));
    expect(screen.getByRole("radio", { name: "Gym" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Tennis" })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/entries/e1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body)).exercises[0]).toMatchObject({ name: "Tennis", activity: "gym" });
  });

  it("offers the owner's four sports, and the exercise's own activity when it is another", () => {
    const ride = entry({ foods: [], exercises: [exerciseItem({ name: "Bike ride", category: "cardio", activity: "cycling" })] });
    mockFetch(() => jsonResponse({ entry: ride, day: dayView() }));
    renderWithProviders(<EntryEditor date="2026-10-03" entry={ride} onClose={() => {}} />);
    const group = screen.getByRole("group", { name: "Activity for exercise 1" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Tennis", "Gym", "Wakeboarding", "Kitesurfing", "Cycling"]);
    expect(within(group).getByRole("radio", { name: "Cycling" })).toBeChecked();
  });

  it("keeps each exercise's activity to itself", async () => {
    mockFetch(() => jsonResponse({ entry: entry(), day: dayView() }, 201));
    renderWithProviders(<EntryEditor date="2026-10-03" entry={null} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    // Each picker is named for its exercise, so a screen reader can tell them apart.
    const first = screen.getByRole("group", { name: "Activity for exercise 1" });
    const second = screen.getByRole("group", { name: "Activity for exercise 2" });
    expect(within(first).getAllByRole("radio")).toHaveLength(5);
    await userEvent.click(within(second).getByRole("radio", { name: "Gym" }));
    expect(within(first).getByRole("radio", { name: "Other" })).toBeChecked();
    expect(within(second).getByRole("radio", { name: "Gym" })).toBeChecked();
    // Other is offered only while it is the exercise's own activity, and the second one is a gym session now.
    expect(within(second).queryByRole("radio", { name: "Other" })).toBeNull();
  });

  it("is one stop for the keyboard, and the arrow keys move between the activities", async () => {
    mockFetch(() => jsonResponse({ entry: entry(), day: dayView() }, 201));
    renderWithProviders(<EntryEditor date="2026-10-03" entry={null} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    await userEvent.click(screen.getByLabelText("Type"));
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Other" })).toHaveFocus(); // the chosen one stands for the group
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Kitesurfing" })).toBeChecked();
    await userEvent.tab();
    expect(screen.getByLabelText("Minutes")).toHaveFocus(); // the rest of the group is skipped
  });

  it("explains a date too far back instead of blaming the numbers", async () => {
    mockFetch(() => jsonResponse({ error: "too_old" }, 400));
    renderWithProviders(<EntryEditor date="2026-09-20" entry={null} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Food"), "Apple");
    await userEvent.type(screen.getByLabelText("kcal"), "52");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Entries can only be added up to 7 days back.");
  });

  it("keeps the id when a Save is pressed again after a lost reply, so the server stores the entry once", async () => {
    let calls = 0;
    const fetchMock = mockFetch(() => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch"); // the reply was lost; the server may have stored it
      const created = entry({ id: "new" });
      return jsonResponse({ entry: created, day: dayView({ entries: [created] }) }, 201);
    });
    const onClose = vi.fn();
    renderWithProviders(<EntryEditor date="2026-10-02" entry={null} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Food"), "Apple");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const ids = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it("uses a new id once the entry was changed after the failed Save", async () => {
    let calls = 0;
    const fetchMock = mockFetch(() => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      const created = entry({ id: "new" });
      return jsonResponse({ entry: created, day: dayView({ entries: [created] }) }, 201);
    });
    const onClose = vi.fn();
    renderWithProviders(<EntryEditor date="2026-10-02" entry={null} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Food"), "Apple");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Food"), "s");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const ids = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).id);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it("keeps an exercise's hidden fields, and sends null (not 0) for a cleared optional number", async () => {
    const sample = outdoorRun();
    const fetchMock = mockFetch(() => jsonResponse({ entry: sample, day: dayView({ entries: [sample] }) }));
    const onClose = vi.fn();
    renderWithProviders(<EntryEditor date="2026-10-03" entry={sample} onClose={onClose} />);
    await userEvent.clear(screen.getByLabelText("Minutes"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).exercises).toEqual([{
      name: "Outdoor run", category: "cardio", activity: "other", duration_min: null, sets: null, reps: null, weight_kg: null, distance_km: 5,
      // The minutes changed and the kcal came from the MET, so the server works it out again.
      avg_hr: null, met: 9.8, kcal: null, assumption: "easy pace", muscles: [{ muscle: "quads", role: "primary" }],
    }]);
  });

  it("sends a kcal typed after the minutes changed, instead of working it out again", async () => {
    const sample = outdoorRun();
    const fetchMock = mockFetch(() => jsonResponse({ entry: sample, day: dayView({ entries: [sample] }) }));
    const onClose = vi.fn();
    renderWithProviders(<EntryEditor date="2026-10-03" entry={sample} onClose={onClose} />);
    const minutes = screen.getByLabelText("Minutes");
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "60");
    expect(screen.getByLabelText("kcal burned")).toHaveValue(null); // the 30-minute figure is gone
    await userEvent.type(screen.getByLabelText("kcal burned"), "450");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).exercises[0]).toMatchObject({ duration_min: 60, met: 9.8, kcal: 450 });
  });

  it("does not delete when the confirmation is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = mockFetch(() => jsonResponse({ day: dayView() }));
    const onClose = vi.fn();
    renderWithProviders(<EntryEditor date="2026-10-03" entry={entry()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith("Delete this entry?");
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  describe("says why a save or delete failed", () => {
    async function failWith(handler: () => Response, action: "save" | "delete") {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      mockFetch(handler);
      renderWithProviders(<EntryEditor date="2026-10-02" entry={action === "delete" ? entry() : null} onClose={vi.fn()} />);
      if (action === "save") {
        await userEvent.type(screen.getByLabelText("Food"), "Apple");
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      } else {
        await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      }
      return screen.findByRole("alert");
    }
    const offline = () => {
      throw new TypeError("Failed to fetch");
    };

    it("offline", async () => expect(await failWith(offline, "save")).toHaveTextContent("You're offline, so that didn't go through."));
    it("signed out", async () => expect(await failWith(() => new Response(null, { status: 401 }), "save")).toHaveTextContent("You're signed out"));
    it("a refusal of the numbers keeps the advice about them", async () =>
      expect(await failWith(() => jsonResponse({ error: "invalid_request" }, 400), "save")).toHaveTextContent("Check every item has a name"));
    it("a failed delete says delete, not save", async () =>
      expect(await failWith(() => jsonResponse({ error: "internal" }, 500), "delete")).toHaveTextContent("Couldn't delete this entry"));

    it("shows the reason for the latest failure, not for an earlier one", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      mockFetch((_url, init) => (init?.method === "DELETE" ? jsonResponse({ error: "internal" }, 500) : offline()));
      renderWithProviders(<EntryEditor date="2026-10-03" entry={entry()} onClose={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete this entry");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("You're offline"));
    });

    it("clears an earlier save error while a delete is on its way", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      let finishDelete: (response: Response) => void = () => {};
      mockFetch((_url, init) => (init?.method === "DELETE" ? new Promise<Response>((resolve) => (finishDelete = resolve)) : offline()));
      const onClose = vi.fn();
      renderWithProviders(<EntryEditor date="2026-10-03" entry={entry()} onClose={onClose} />);
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("You're offline");
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      finishDelete(jsonResponse({ day: dayView() }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
  });
});
