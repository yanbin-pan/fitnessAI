import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import type { HealthParseView, HealthView, LabReadView, LabResultView } from "../shared.ts";
import { HealthDataSettings, HealthPage } from "./HealthPage.tsx";

const empty: HealthView = { consented_at: "2026-10-12T08:00:00.000Z", conditions: [], medications: [], reports: [], trends: [] };

const result = (overrides: Partial<LabResultView>): LabResultView => ({
  id: "x", marker: "ldl", name: "LDL cholesterol", printed_name: "", value: 3.4, text_value: "", unit: "mmol/L", ref_low: null, ref_high: 3, flag: "high", ...overrides,
});

const full: HealthView = {
  ...empty,
  conditions: [
    { id: "c1", kind: "high_cholesterol", label: null, added_at: "2026-10-12T08:00:00.000Z" },
    { id: "c2", kind: "other", label: "Gout", added_at: "2026-10-12T08:00:00.000Z" },
  ],
  medications: [{ id: "m1", name: "Atorvastatin", dose: "20 mg", started_on: "2026-03-01", stopped_on: null }],
  reports: [
    {
      id: "r2", taken_on: "2026-09-20", lab_name: "Synlab",
      results: [result({}), result({ id: "h", marker: "hdl", name: "HDL cholesterol", value: 1.4, ref_low: 1, ref_high: null, flag: "normal" }), result({ id: "g", marker: "other", name: "Blood group", value: null, text_value: "A Rh+", unit: "", ref_high: null, flag: "unknown" })],
    },
  ],
  trends: [
    { key: "ldl", marker: "ldl", name: "LDL cholesterol", unit: "mmol/L", ref_low: null, ref_high: 3, points: [{ taken_on: "2026-03-01", value: 4.1, flag: "high" }, { taken_on: "2026-09-20", value: 3.4, flag: "high" }] },
    { key: "hdl", marker: "hdl", name: "HDL cholesterol", unit: "mmol/L", ref_low: 1, ref_high: null, points: [{ taken_on: "2026-09-20", value: 1.4, flag: "normal" }] },
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
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Agree and continue" }));
    await waitFor(() => expect(calls).toContain("POST /api/records/consent"));
  });

  it("shows conditions and medications as chips, and only the results that need attention", async () => {
    mockFetch(() => jsonResponse(full));
    renderWithProviders(<HealthPage />);
    const about = await screen.findByRole("region", { name: "About you" });
    expect(within(about).getByText("High cholesterol")).toBeInTheDocument();
    expect(within(about).getByText("Gout")).toBeInTheDocument();
    expect(within(about).getByRole("button", { name: "Edit Atorvastatin" })).toBeInTheDocument();
    const blood = screen.getByRole("region", { name: "Blood · 20 Sept 2026" });
    expect(within(blood).getByText("LDL cholesterol")).toBeInTheDocument();
    expect(within(blood).queryByText("HDL cholesterol")).toBeNull();
    await userEvent.click(within(blood).getByRole("button", { name: /2 more in range/ }));
    expect(within(blood).getByText("HDL cholesterol")).toBeInTheDocument();
    expect(within(blood).getByText("A Rh+")).toBeInTheDocument();
  });

  it("adds a common option with one tap", async () => {
    const posts: unknown[] = [];
    mockFetch((_url, init) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return jsonResponse({ id: "n", kind: "vegan", label: null, added_at: "" }, 201);
      }
      return jsonResponse(full);
    });
    renderWithProviders(<HealthPage />);
    const options = await screen.findByRole("list", { name: "Common options" });
    // Already added ones are not offered again.
    expect(within(options).queryByRole("button", { name: "High cholesterol" })).toBeNull();
    await userEvent.click(within(options).getByRole("button", { name: "Vegan" }));
    await waitFor(() => expect(posts).toEqual([{ kind: "vegan" }]));
  });

  it("turns a sentence into items to confirm, updating a medication already listed", async () => {
    const parsed: HealthParseView = {
      conditions: [{ kind: "vegetarian", label: null }],
      medications: [{ name: "atorvastatin", dose: "", started_on: null, stopped_on: "2026-10-10" }],
      report: null,
    };
    const writes: { method: string; url: string; body: unknown }[] = [];
    mockFetch((url, init) => {
      if (url === "/api/records/parse") return jsonResponse(parsed);
      if (init?.method && init.method !== "GET") {
        writes.push({ method: init.method, url, body: JSON.parse(String(init.body)) });
        return jsonResponse({}, 200);
      }
      return jsonResponse(full);
    });
    renderWithProviders(<HealthPage />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Add a condition, medication or test…" }), "I'm vegetarian and stopped atorvastatin{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Add atorvastatin" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss Vegetarian" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add atorvastatin" })).toBeNull());
    expect(writes).toEqual([
      { method: "PUT", url: "/api/records/medications/m1", body: { name: "Atorvastatin", dose: "20 mg", started_on: "2026-03-01", stopped_on: "2026-10-10" } },
    ]);
  });

  it("checks typed-in or read results before saving them, words included", async () => {
    const read: LabReadView = {
      taken_on: "2026-10-08", lab_name: "Synlab Milano", language: "Italian",
      results: [
        { marker: "vitamin_d", name: "Vitamin D", printed_name: "Vitamina D", value: 47, text_value: "", unit: "nmol/L", ref_low: 50, ref_high: 125 },
        { marker: "other", name: "Urine glucose", printed_name: "Glucosio urine", value: null, text_value: "Negative", unit: "", ref_low: null, ref_high: null },
      ],
    };
    const posts: unknown[] = [];
    mockFetch((url, init) => {
      if (url === "/api/records/parse") return jsonResponse({ conditions: [], medications: [], report: read } satisfies HealthParseView);
      if (url === "/api/records/labs") {
        posts.push(JSON.parse(String(init?.body)));
        return jsonResponse(full, 201);
      }
      return jsonResponse(empty);
    });
    renderWithProviders(<HealthPage />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Add a condition, medication or test…" }), "vitamin d 47{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Read 2 results" });
    expect(within(dialog).getByText("Italian report.", { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByText("Outside the range")).toBeInTheDocument();
    expect(within(dialog).getByText("Other findings · 1")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Vitamin D/ }));
    const value = within(dialog).getByRole("textbox", { name: "Value" });
    await userEvent.clear(value);
    await userEvent.type(value, "52,5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save 2" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts).toEqual([{
      taken_on: "2026-10-08", lab_name: "Synlab Milano",
      results: [
        { marker: "vitamin_d", name: "Vitamin D", printed_name: "Vitamina D", value: 52.5, text_value: "", unit: "nmol/L", ref_low: 50, ref_high: 125 },
        { marker: "other", name: "Urine glucose", printed_name: "Glucosio urine", value: null, text_value: "Negative", unit: "", ref_low: null, ref_high: null },
      ],
    }]);
  });

  it("says when a sentence held nothing to add", async () => {
    mockFetch((url) => jsonResponse(url === "/api/records/parse" ? { conditions: [], medications: [], report: null } : empty));
    renderWithProviders(<HealthPage />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Add a condition, medication or test…" }), "hello{Enter}");
    expect(await screen.findByText("I didn't find a condition, medication or test in that. Try naming it.")).toBeInTheDocument();
  });
});

describe("HealthDataSettings", () => {
  it("deletes everything after asking", async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse(full);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<HealthDataSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete my health data" }));
    await waitFor(() => expect(calls).toContain("DELETE /api/records"));
  });
});
