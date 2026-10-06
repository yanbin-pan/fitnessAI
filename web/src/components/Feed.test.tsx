import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayLabel } from "../format.ts";
import { en } from "../i18n/index.tsx";
import type { ChatMessage } from "../shared.ts";
import { dayView, entry, exerciseItem, foodItem, message } from "../test/fixtures.ts";
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
    expect(screen.getByText(/Zabaione took too long/)).toBeInTheDocument();
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

  it("labels a linked entry by its distance from today, not from the day on screen", () => {
    // Viewing 1 Oct while it is 3 Oct, a reply says "yesterday": 30 Sep, which is not "Yesterday" to the reader.
    const backDated = entry({ id: "back", date: "2026-09-30", message_id: "m1", source: "coach", foods: [foodItem({ id: "f-back", name: "Scrambled eggs" })] });
    const reply = message({ id: "m2", date: "2026-10-01", role: "assistant", status: null, reply_to: "m1", cards: [{ type: "entry", id: "back" }] });
    const view = dayView({ date: "2026-10-01", today: "2026-10-03", linked_entries: [backDated], messages: [message({ id: "m1", date: "2026-10-01" }), reply] });
    render(<Feed view={view} logOnly={false} onRetry={vi.fn()} />);
    expect(screen.getByText(`Logged to ${dayLabel("2026-09-30", "2026-10-03", en)}`)).toBeInTheDocument();
    expect(screen.queryByText("Logged to Yesterday")).not.toBeInTheDocument();
  });

  it("disables Retry for the message that is being retried, and for no other", () => {
    const failed = (id: string, createdAt: string) => message({ id, status: "failed", error_code: "timeout", created_at: createdAt });
    const view = dayView({ messages: [failed("m8", "2026-10-03T07:08:00.000Z"), failed("m9", "2026-10-03T07:09:00.000Z")] });
    render(<Feed view={view} logOnly={false} onRetry={vi.fn()} retrying="m9" />);
    const [first, second] = screen.getAllByRole("button", { name: "Retry" });
    expect(first).toBeEnabled();
    expect(second).toBeDisabled();
  });

  it("shows a message's photos, and a placeholder for one that can't load", () => {
    const [a, b] = ["a".repeat(32), "b".repeat(32)];
    render(<Feed view={dayView({ messages: [message({ text: "lunch", photo_ids: [a, b] })] })} logOnly={false} onRetry={() => {}} />);
    const first = screen.getByRole("img", { name: "Photo 1" });
    expect(first).toHaveAttribute("src", `/api/photos/${a}`);
    expect(screen.getByRole("img", { name: "Photo 2" })).toHaveAttribute("src", `/api/photos/${b}`);
    fireEvent.error(first);
    expect(screen.getByText("Photo unavailable")).toBeInTheDocument();
  });

  it("shows an exercise's sport as its icon", () => {
    const kite = entry({ foods: [], exercises: [exerciseItem({ name: "Kite session", activity: "kitesurfing" })] });
    render(<Feed view={dayView({ entries: [kite] })} logOnly={false} onRetry={() => {}} />);
    expect(screen.getByRole("img", { name: "Kitesurfing" })).toBeInTheDocument();
  });

  it("says when an entry came from a photo, and shows a meal's macros", () => {
    render(<Feed view={dayView({ entries: [entry({ source: "photo" })] })} logOnly={false} onRetry={() => {}} />);
    expect(screen.getByText("from photo")).toBeInTheDocument();
    expect(screen.getByText("P 10 · C 50 · F 6")).toBeInTheDocument();
  });

  it("explains that a day before the chat window has no conversation", () => {
    const past = dayView({ date: "2026-09-29", today: "2026-10-03", entries: [entry({ date: "2026-09-29" })] });
    const { rerender } = render(<Feed view={past} logOnly={false} onRetry={() => {}} />);
    expect(screen.getByText("Chats are kept for today and the 3 days before.")).toBeInTheDocument();
    rerender(<Feed view={dayView({ entries: [entry()] })} logOnly={false} onRetry={() => {}} />);
    expect(screen.queryByText("Chats are kept for today and the 3 days before.")).toBeNull();
    // A day inside the window keeps its chat, even one with no messages yet.
    rerender(<Feed view={dayView({ date: "2026-09-30", today: "2026-10-03", entries: [entry({ date: "2026-09-30" })] })} logOnly={false} onRetry={() => {}} />);
    expect(screen.queryByText("Chats are kept for today and the 3 days before.")).toBeNull();
  });

  it("keeps quiet about the chat window while the day still has its conversation, and in Log only", () => {
    const earlier = { date: "2026-10-01", today: "2026-10-03" };
    const logged = entry({ date: "2026-10-01" });
    const { rerender } = render(<Feed view={dayView({ ...earlier, entries: [logged], messages: [message({ date: "2026-10-01" })] })} logOnly={false} onRetry={() => {}} />);
    expect(screen.queryByText("Chats are kept for today and the 3 days before.")).toBeNull();
    rerender(<Feed view={dayView({ ...earlier, entries: [logged] })} logOnly={true} onRetry={() => {}} />);
    expect(screen.queryByText("Chats are kept for today and the 3 days before.")).toBeNull();
  });

  it("invites a message or a photo when today is empty", () => {
    render(<Feed view={dayView()} logOnly={false} onRetry={() => {}} />);
    expect(screen.getByText("Nothing logged yet. Tell Zabaione what you ate or did, or send a photo.")).toBeInTheDocument();
    expect(screen.queryByText("Chats are kept for today and the 3 days before.")).toBeNull();
  });

  it("explains an empty day before the window too, and invites a chat on an empty one inside it", () => {
    const { rerender } = render(<Feed view={dayView({ date: "2026-09-29", today: "2026-10-03" })} logOnly={false} onRetry={() => {}} />);
    expect(screen.getByText("Nothing logged this day.")).toBeInTheDocument();
    expect(screen.getByText("Chats are kept for today and the 3 days before.")).toBeInTheDocument();
    rerender(<Feed view={dayView({ date: "2026-10-01", today: "2026-10-03" })} logOnly={false} onRetry={() => {}} />);
    expect(screen.getByText(/Tell Zabaione what you ate/)).toBeInTheDocument();
  });

  it("gives food a meal's icon and macros, and an exercise only its sport", () => {
    const meal = entry({ id: "meal", exercises: [exerciseItem({ id: "x-gym", name: "Row machine", activity: "gym" })] });
    const tennis = entry({ id: "tennis", foods: [], exercises: [exerciseItem()] });
    render(<Feed view={dayView({ entries: [meal, tennis] })} logOnly={false} onRetry={() => {}} />);
    // One sport badge, for the exercise-only entry; the entry with food and a workout shows a meal, not Gym.
    expect(screen.getAllByRole("img").map((icon) => icon.getAttribute("aria-label"))).toEqual(["Tennis"]);
    // One macros line, for the entry with food.
    expect(screen.getAllByText(/^P \d+ · C \d+ · F \d+$/)).toHaveLength(1);
  });

  it("adds up a meal's foods before rounding its macros to whole grams", () => {
    const half = { protein_g: 10.4, carbs_g: 20.4, fat_g: 5.4 };
    const meal = entry({ foods: [foodItem({ id: "f1", ...half }), foodItem({ id: "f2", ...half })] });
    render(<Feed view={dayView({ entries: [meal] })} logOnly={false} onRetry={() => {}} />);
    // 20.8, 40.8 and 10.8 round to 21, 41 and 11; rounding each food first would give 20, 40 and 10.
    expect(screen.getByText("P 21 · C 41 · F 11")).toBeInTheDocument();
  });

  it("still shows a message when an older server leaves photo_ids out", () => {
    const older = { ...message({ text: "porridge" }), photo_ids: undefined } as unknown as ChatMessage;
    render(<Feed view={dayView({ messages: [older] })} logOnly={false} onRetry={() => {}} />);
    expect(screen.getByText("porridge")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
