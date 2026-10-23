import { describe, expect, it } from "vitest";
import type { SeenTip } from "../shared.ts";
import { TIP_IDS } from "../shared.ts";
import { dayView } from "../test/fixtures.ts";
import { dueTip } from "./tips.ts";

const seen = (id: SeenTip["id"], date = "2026-10-03"): SeenTip => ({ id, date, seen_at: `${date}T08:00:00.000Z`, vars: {} });

describe("dueTip", () => {
  it("offers the first tip whose moment has come, one before 2pm and a second after", () => {
    const view = dayView();
    expect(dueTip(view, [], 9)).toEqual({ id: "shared-plate", vars: {} });
    expect(dueTip(view, [seen("shared-plate")], 9)).toBeNull();
    // Nothing left to close (the fixture day is empty but it's before 3pm), so the gap tip waits.
    expect(dueTip(view, [seen("shared-plate")], 14)).toEqual({ id: "menu-photo", vars: {} });
    expect(dueTip(view, [seen("shared-plate"), seen("menu-photo")], 20)).toBeNull();
  });

  it("offers the gap tip in the afternoon with today's numbers, only with a real gap", () => {
    const view = dayView({ totals: { ...dayView().totals, kcal: 1500, protein_g: 109 } });
    expect(dueTip(view, [seen("shared-plate", "2026-10-01")], 16)).toEqual({ id: "close-day", vars: { kcal: 810, protein_g: 41 } });
    const full = dayView({ totals: { ...dayView().totals, kcal: 2200, protein_g: 140 } });
    expect(dueTip(full, [seen("shared-plate", "2026-10-01")], 16)?.id).toBe("menu-photo");
  });

  it("names up to three low vitamins and minerals, never vitamin D", () => {
    const levels = { vitamin_d_ug: "low", iron_mg: "low", zinc_mg: "low", calcium_mg: "low", folate_ug: "low", salt: "low" } as const;
    const earlier = (["shared-plate", "close-day", "menu-photo"] as const).map((id) => seen(id, "2026-10-01"));
    expect(dueTip(dayView({ nutrients: { days: 7, levels } }), earlier, 9)).toEqual({ id: "vitamin-gaps", vars: { nutrients: ["folate_ug", "calcium_mg", "iron_mg"] } });
    expect(dueTip(dayView({ nutrients: { days: 7, levels: { vitamin_d_ug: "low" } } }), earlier, 9)?.id).toBe("plan-ahead");
  });

  it("stops for good once every tip has been seen, and never on another day than today", () => {
    expect(dueTip(dayView(), TIP_IDS.map((id) => seen(id, "2026-09-01")), 20)).toBeNull();
    expect(dueTip(dayView({ date: "2026-10-02" }), [], 9)).toBeNull();
  });
});
