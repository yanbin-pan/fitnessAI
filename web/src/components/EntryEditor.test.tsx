import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayView, entry } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { EntryEditor } from "./EntryEditor.tsx";

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

  it("explains a date too far back instead of blaming the numbers", async () => {
    mockFetch(() => jsonResponse({ error: "too_old" }, 400));
    renderWithProviders(<EntryEditor date="2026-09-20" entry={null} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Food"), "Apple");
    await userEvent.type(screen.getByLabelText("kcal"), "52");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Entries can only be added up to 7 days back.");
  });
});
