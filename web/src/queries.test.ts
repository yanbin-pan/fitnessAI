import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { dayKey, storeDay } from "./queries.ts";
import { dayView, message } from "./test/fixtures.ts";
import type { DayView } from "./shared.ts";

describe("storeDay", () => {
  it("stores today's view under its date and under 'today'", () => {
    const client = new QueryClient();
    const view = dayView();
    storeDay(client, view);
    expect(client.getQueryData(dayKey("2026-10-03"))).toEqual(view);
    expect(client.getQueryData(dayKey("today"))).toEqual(view);
  });

  it("leaves 'today' alone for another day's view", () => {
    const client = new QueryClient();
    const todays = dayView();
    client.setQueryData(dayKey("today"), todays);
    storeDay(client, dayView({ date: "2026-10-02" }));
    expect(client.getQueryData(dayKey("today"))).toEqual(todays);
    expect(client.getQueryData(dayKey("2026-10-02"))).toBeDefined();
  });

  it("keeps 'today' in step when a reply lands after midnight, for the day it was sent on", () => {
    const client = new QueryClient();
    client.setQueryData(dayKey("today"), dayView());
    storeDay(client, dayView({ today: "2026-10-04", messages: [message()] }));
    expect(client.getQueryData<DayView>(dayKey("today"))?.messages).toHaveLength(1);
  });
});
