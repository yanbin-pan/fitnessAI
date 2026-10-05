import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { dayKey } from "../queries.ts";
import type { DayView, MessageInput } from "../shared.ts";
import { dayView, message } from "../test/fixtures.ts";
import { addPending, markPending, pendingMessage, removePending } from "./pending.ts";

const input: MessageInput = { id: "3f1c0a52-7c1e-4a0e-9d57-0c2f4d1a9b10", sent_at: "2026-10-03T07:09:00.000Z", text: "2 eggs", photo_ids: ["a".repeat(32)] };
const idsToday = (client: QueryClient) => client.getQueryData<DayView>(dayKey("today"))?.messages.map((m) => m.id);

describe("the pending message", () => {
  it("is yours, still travelling, with its photos, and sits where it was sent", () => {
    expect(pendingMessage(input, "2026-10-03")).toEqual(
      message({ id: input.id, text: "2 eggs", photo_ids: input.photo_ids, status: "pending", sent_at: input.sent_at, created_at: input.sent_at }),
    );
  });

  it("goes into today's feed once, however often it is added", () => {
    const client = new QueryClient();
    client.setQueryData(dayKey("today"), dayView({ messages: [message({ id: "old" })] }));
    expect(addPending(client, input)).toBe(true);
    expect(addPending(client, input)).toBe(false); // already there, whoever put it there
    expect(idsToday(client)).toEqual(["old", input.id]);
  });

  it("goes nowhere while today's day isn't loaded, and says so", () => {
    const client = new QueryClient();
    expect(addPending(client, input)).toBe(false);
    expect(idsToday(client)).toBeUndefined();
  });

  it("comes out again by its id, leaving the rest", () => {
    const client = new QueryClient();
    client.setQueryData(dayKey("today"), dayView({ messages: [message({ id: "old" })] }));
    addPending(client, input);
    removePending(client, input.id);
    expect(idsToday(client)).toEqual(["old"]);
  });

  it("is what a Retry makes of a failed message, on the day being viewed and nothing else", () => {
    const client = new QueryClient();
    const failed = (id: string) => message({ id, status: "failed", error_code: "timeout" });
    markPending(client, dayView({ date: "2026-10-02", messages: [failed("m1"), failed("m2")] }), "m1");
    const [first, second] = client.getQueryData<DayView>(dayKey("2026-10-02"))?.messages ?? [];
    expect(first).toMatchObject({ id: "m1", status: "pending", error_code: null });
    expect(second).toMatchObject({ id: "m2", status: "failed", error_code: "timeout" });
  });
});
