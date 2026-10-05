import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayView, entry, exerciseItem, foodItem } from "../test/fixtures.ts";
import { ActivitiesCard, activityGroups } from "./ActivitiesCard.tsx";

const tennis = entry({ id: "e1", logged_at: "2026-10-03T19:10:00.000Z", foods: [], exercises: [exerciseItem({ id: "x1", name: "Tennis singles", kcal: 787.5, duration_min: 90, met: 7.3, assumption: "Singles, general recreational play" })] });
const gym = entry({
  id: "e2", logged_at: "2026-10-03T19:20:00.000Z", foods: [],
  exercises: [
    exerciseItem({ id: "x2", name: "Bench press", category: "strength", activity: "gym", kcal: 100, duration_min: 20, met: 5, sets: 4, reps: 8, weight_kg: 60 }),
    exerciseItem({ id: "x3", name: "Rows", category: "strength", activity: "gym", kcal: 120, duration_min: 20, met: 5, sets: 4, reps: 10, weight_kg: 50 }),
  ],
});
const kite = entry({ id: "e3", logged_at: "2026-10-03T19:30:00.000Z", foods: [], exercises: [exerciseItem({ id: "x4", name: "Kitesurfing", activity: "kitesurfing", kcal: 900, duration_min: 120, met: 9, distance_km: 25 })] });
const breakfast = entry({ id: "e0", foods: [foodItem()] });

describe("activityGroups", () => {
  it("makes one badge per activity per entry, in time order", () => {
    const groups = activityGroups(dayView({ entries: [breakfast, tennis, gym, kite] }));
    expect(groups.map((g) => [g.activity, Math.round(g.kcal), g.items.length])).toEqual([["tennis", 788, 1], ["gym", 220, 2], ["kitesurfing", 900, 1]]);
  });
});

describe("ActivitiesCard", () => {
  it("isn't there on a day without exercise", () => {
    const { container } = render(<ActivitiesCard view={dayView({ entries: [breakfast] })} onEdit={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each activity's badge with its kcal, and the day's total burned", () => {
    render(<ActivitiesCard view={dayView({ entries: [tennis, gym, kite] })} onEdit={() => {}} />);
    const card = screen.getByRole("region", { name: "Activity" });
    expect(within(card).getByText("1,908 kcal")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Tennis singles, 788 kcal" })).toHaveTextContent("788");
    expect(within(card).getByRole("button", { name: "Bench press, Rows, 220 kcal" })).toBeInTheDocument();
  });

  it("opens one activity's details at a time, and closes them again", async () => {
    render(<ActivitiesCard view={dayView({ entries: [tennis, gym, kite] })} onEdit={() => {}} />);
    const tennisBadge = screen.getByRole("button", { name: "Tennis singles, 788 kcal" });
    await userEvent.click(tennisBadge);
    expect(tennisBadge).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Tennis details" });
    expect(within(panel).getByText("90 min · 788 kcal · MET 7.3")).toBeInTheDocument();
    expect(within(panel).getByText("Singles, general recreational play")).toBeInTheDocument();
    expect(within(panel).getByText("19:10")).toBeInTheDocument(); // the test setup pins the clock to UTC

    await userEvent.click(screen.getByRole("button", { name: "Bench press, Rows, 220 kcal" }));
    expect(tennisBadge).toHaveAttribute("aria-expanded", "false");
    const gymPanel = screen.getByRole("region", { name: "Gym details" });
    expect(within(gymPanel).getByText("20 min · 100 kcal · MET 5 · 4 × 8 × 60 kg")).toBeInTheDocument();
    expect(within(gymPanel).getByText("20 min · 120 kcal · MET 5 · 4 × 10 × 50 kg")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Bench press, Rows, 220 kcal" }));
    expect(screen.queryByRole("region", { name: "Gym details" })).toBeNull();
  });

  it("shows a distance when there is one, and Edit opens the entry", async () => {
    const onEdit = vi.fn();
    render(<ActivitiesCard view={dayView({ entries: [kite] })} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: "Kitesurfing, 900 kcal" }));
    expect(screen.getByText("120 min · 900 kcal · MET 9 · 25 km")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(kite);
  });
});
