import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import type { HealthView } from "../shared.ts";
import { HealthPage } from "./HealthPage.tsx";

const empty: HealthView = { consented_at: "2026-10-12T08:00:00.000Z", conditions: [], medications: [], reports: [], trends: [] };

const full: HealthView = {
  ...empty,
  conditions: [
    { id: "c1", kind: "high_cholesterol", label: null, added_at: "2026-10-12T08:00:00.000Z" },
    { id: "c2", kind: "other", label: "Gout", added_at: "2026-10-12T08:00:00.000Z" },
  ],
  medications: [
    { id: "m1", name: "Atorvastatin", dose: "20 mg", started_on: "2026-03-01", stopped_on: null },
    { id: "m2", name: "Ibuprofen", dose: "", started_on: null, stopped_on: "2026-05-02" },
  ],
  reports: [
    {
      id: "r2", taken_on: "2026-09-20", lab_name: "Synlab",
      results: [{ id: "x", marker: "ldl", name: "LDL cholesterol", value: 3.4, unit: "mmol/L", ref_low: null, ref_high: 3, flag: "high" }],
    },
    {
      id: "r1", taken_on: "2026-03-01", lab_name: "",
      results: [{ id: "y", marker: "ldl", name: "LDL cholesterol", value: 4.1, unit: "mmol/L", ref_low: null, ref_high: 3, flag: "high" }],
    },
  ],
  trends: [
    {
      key: "ldl", marker: "ldl", name: "LDL cholesterol", unit: "mmol/L", ref_low: null, ref_high: 3,
      points: [{ taken_on: "2026-03-01", value: 4.1, flag: "high" }, { taken_on: "2026-09-20", value: 3.4, flag: "high" }],
    },
  ],
};

describe("HealthPage", () => {
  it("asks for consent before anything can be added", async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return jsonResponse(init?.method === "POST" ? empty : { ...empty, consented_at: null });
    });
    renderWithProviders(<HealthPage />);
    expect(await screen.findByText("Before you add anything")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Medications" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Agree and continue" }));
    await waitFor(() => expect(calls).toContain("POST /api/records/consent"));
  });

  it("shows conditions, medications and blood results compactly", async () => {
    mockFetch(() => jsonResponse(full));
    renderWithProviders(<HealthPage />);
    const conditions = await screen.findByRole("region", { name: "Conditions and diets" });
    expect(within(conditions).getByText("High cholesterol")).toBeInTheDocument();
    expect(within(conditions).getByText("Gout")).toBeInTheDocument();
    const meds = screen.getByRole("region", { name: "Medications" });
    expect(within(meds).getByText("Atorvastatin")).toBeInTheDocument();
    expect(within(meds).getByText("since 1 Mar 2026")).toBeInTheDocument();
    expect(within(meds).getByText("stopped 2 May 2026")).toBeInTheDocument();
    const blood = screen.getByRole("region", { name: "Blood results" });
    expect(within(blood).getByText("LDL cholesterol")).toBeInTheDocument();
    expect(within(blood).getByText(/High · < 3/)).toBeInTheDocument();
    expect(within(blood).getByText("20 Sept 2026 · Synlab")).toBeInTheDocument();
  });

  it("adds a condition from the picker, and one in the person's own words", async () => {
    const posts: unknown[] = [];
    mockFetch((url, init) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return jsonResponse({ id: "n", kind: "vegan", label: null, added_at: "" }, 201);
      }
      return jsonResponse(full);
    });
    renderWithProviders(<HealthPage />);
    const conditions = await screen.findByRole("region", { name: "Conditions and diets" });
    await userEvent.click(within(conditions).getByRole("button", { name: "Add" }));
    // Already added ones are not offered again.
    expect(within(conditions).queryByRole("button", { name: "High cholesterol" })).toBeNull();
    await userEvent.click(within(conditions).getByRole("button", { name: "Vegan" }));
    await userEvent.click(within(conditions).getByRole("button", { name: "Something else" }));
    await userEvent.type(within(conditions).getByRole("textbox", { name: "Something else" }), "Kidney stones{Enter}");
    await waitFor(() => expect(posts).toEqual([{ kind: "vegan" }, { kind: "other", label: "Kidney stones" }]));
  });

  it("adds a medication", async () => {
    const posts: unknown[] = [];
    mockFetch((url, init) => {
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return jsonResponse({ id: "m3", name: "Metformin", dose: "500 mg", started_on: null, stopped_on: null }, 201);
      }
      return jsonResponse(empty);
    });
    renderWithProviders(<HealthPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Add medication" }));
    const dialog = screen.getByRole("dialog", { name: "Add medication" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Metformin");
    await userEvent.type(within(dialog).getByLabelText("Dose"), "500 mg");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts).toEqual([{ url: "/api/records/medications", body: { name: "Metformin", dose: "500 mg", started_on: null, stopped_on: null } }]);
  });

  it("types in a blood test, reading decimal commas", async () => {
    const posts: unknown[] = [];
    mockFetch((url, init) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return jsonResponse(full, 201);
      }
      return jsonResponse(empty);
    });
    renderWithProviders(<HealthPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Type it in" }));
    const dialog = screen.getByRole("dialog", { name: "Check what I read" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Blood taken on"), "2026-10-01");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Test" }), "Ferritin");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Value" }), "18,5");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Unit" }), "µg/L");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Low" }), "30");
    await userEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts).toEqual([{
      taken_on: "2026-10-01", lab_name: "",
      results: [{ marker: "other", name: "Ferritin", value: 18.5, unit: "µg/L", ref_low: 30, ref_high: null }],
    }]);
  });

  it("deletes everything after asking", async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse(full);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<HealthPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete my health data" }));
    await waitFor(() => expect(calls).toContain("DELETE /api/records"));
  });
});
