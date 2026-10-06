import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { regular } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { RegularsPage } from "./RegularsPage.tsx";

const view = (regulars = [regular()], data_days = 9) => ({ data_days, required_days: 5, window_days: 28, regulars });

describe("RegularsPage", () => {
  it("says how many days are logged until there are enough", async () => {
    mockFetch(() => jsonResponse(view([], 3)));
    renderWithProviders(<RegularsPage />);
    expect(await screen.findByText("Regulars appear once you've logged 5 days.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "3 / 5 days");
  });

  it("lists meals and activities with when and how often, and offers no way to add one", async () => {
    const tennis = regular({
      key: "fedcba9876543210", kind: "activity", name: "Tennis singles", foods: [], typical_time: "18:15", days_seen: 3, edited: true, kcal: 480,
      exercises: [{ name: "Tennis singles", category: "sport", activity: "tennis", duration_min: 60, sets: null, reps: null, weight_kg: null, distance_km: null, avg_hr: null, met: 7, kcal: 480, assumption: "", muscles: [] }],
    });
    mockFetch(() => jsonResponse(view([regular(), tennis])));
    renderWithProviders(<RegularsPage />);
    const meals = await screen.findByRole("region", { name: "Meals" });
    expect(within(meals).getByText("Porridge")).toBeInTheDocument();
    expect(within(meals).getByText("Usually around 08:00 · 5 of the last 28 days")).toBeInTheDocument();
    const activities = screen.getByRole("region", { name: "Activities" });
    expect(within(activities).getByText("Usually around 18:15 · 3 of the last 28 days · edited")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add|\+/i })).toBeNull();
  });

  it("edits a regular's name and items", async () => {
    const puts: unknown[] = [];
    mockFetch((_url, init) => {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return jsonResponse(regular({ name: "Morning oats" }));
      }
      return jsonResponse(view());
    });
    renderWithProviders(<RegularsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Porridge/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit regular" });
    const name = within(dialog).getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Morning oats");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts[0]).toMatchObject({ name: "Morning oats", foods: [{ name: "Porridge", kcal: 300 }], exercises: [] });
  });

  it("removes a regular after asking", async () => {
    const methods: string[] = [];
    mockFetch((url, init) => {
      methods.push(`${init?.method ?? "GET"} ${url}`);
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse(view());
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<RegularsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Porridge/ }));
    await userEvent.click(screen.getByRole("button", { name: "Remove regular" }));
    await waitFor(() => expect(methods).toContain("DELETE /api/regulars/0123456789abcdef"));
    expect(window.confirm).toHaveBeenCalledWith("Remove this regular? It won't be suggested again.");
  });
});
