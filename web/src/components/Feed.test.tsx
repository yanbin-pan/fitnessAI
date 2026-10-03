import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayView, entry, foodItem, message } from "../test/fixtures.ts";
import { Feed, buildFeed } from "./Feed.tsx";

describe("buildFeed", () => {
  const coachEntry = entry({ id: "e1", logged_at: "2026-10-03T08:00:00.000Z", source: "coach" });
  const manual = entry({ id: "e2", logged_at: "2026-10-03T09:00:00.000Z" });
  const question = message({ id: "m1", created_at: "2026-10-03T07:59:00.000Z" });
  const reply = message({ id: "m2", role: "assistant", status: null, created_at: "2026-10-03T08:00:05.000Z", cards: [{ type: "entry", id: "e1" }], reply_to: "m1" });
  const view = dayView({ entries: [coachEntry, manual], messages: [question, reply] });

  it("keeps coach-created entries under their reply and lists manual entries on their own", () => {
    expect(buildFeed(view, false).map((i) => (i.kind === "entry" ? i.entry.id : i.message.id))).toEqual(["m1", "m2", "e2"]);
  });

  it("shows only entries, in time order, in log-only mode", () => {
    expect(buildFeed(view, true).map((i) => (i.kind === "entry" ? i.entry.id : i.message.id))).toEqual(["e1", "e2"]);
  });
});

describe("Feed", () => {
  it("explains a failed message and offers Retry", async () => {
    const onRetry = vi.fn();
    const failed = message({ id: "m9", status: "failed", error_code: "timeout" });
    render(<Feed view={dayView({ messages: [failed] })} logOnly={false} onRetry={onRetry} />);
    expect(screen.getByText(/The coach took too long/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith("m9");
  });

  it("offers Undo for what a reply logged, but not for older entries it corrected", async () => {
    const onUndo = vi.fn();
    const logged = entry({ id: "new", message_id: "m1", source: "coach" });
    const corrected = entry({ id: "old", message_id: "m0", source: "coach", edited: true });
    const reply = message({ id: "m2", role: "assistant", status: null, reply_to: "m1", cards: [{ type: "entry", id: "new" }, { type: "entry", id: "old" }] });
    render(<Feed view={dayView({ entries: [logged, corrected], messages: [message({ id: "m1" }), reply] })} logOnly={false} onRetry={vi.fn()} onUndo={onUndo} />);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledWith(["new"]);
  });

  it("shows what a reply logged for an earlier day, says which day, and offers Undo for it", async () => {
    const onUndo = vi.fn();
    // "Yesterday I had two eggs": the entry is dated 2 Oct, so it is not in 3 Oct's own entries.
    const backDated = entry({ id: "back", date: "2026-10-02", message_id: "m1", source: "coach", foods: [foodItem({ id: "f-back", name: "Scrambled eggs" })] });
    const reply = message({ id: "m2", role: "assistant", status: null, reply_to: "m1", cards: [{ type: "entry", id: "back" }] });
    render(<Feed view={dayView({ linked_entries: [backDated], messages: [message({ id: "m1" }), reply] })} logOnly={false} onRetry={vi.fn()} onUndo={onUndo} />);
    expect(screen.getByText("Scrambled eggs")).toBeInTheDocument();
    expect(screen.getByText("Logged to Yesterday")).toBeInTheDocument();
    expect(screen.queryByText("Entry removed")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledWith(["back"]);
  });
});
