import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type { DaySummaries, DayView } from "./shared.ts";

export const dayKey = (date: string) => ["day", date] as const;

export function useDay(date: string) {
  return useQuery({
    queryKey: dayKey(date),
    queryFn: () => api<DayView>(`/api/days/${date}`),
    // A message may still be with the coach (for instance after the app was suspended mid-send): look again.
    refetchInterval: (query) => (query.state.data?.messages.some((m) => m.status === "pending") ? 3000 : false),
  });
}

/** Puts a fresh DayView from a mutation into the cache, under its date and under "today" when it is today. */
export function storeDay(client: QueryClient, view: DayView): void {
  client.setQueryData(dayKey(view.date), view);
  // "today" is an alias. Keep it in step whenever it holds this date, even if the clock has moved
  // on since (a reply that lands just after midnight belongs to the day it was sent on).
  const alias = client.getQueryData<DayView>(dayKey("today"));
  if (view.date === view.today || alias?.date === view.date) client.setQueryData(dayKey("today"), view);
}

/** The calendar's six weeks (spec §12); fetched again whenever the calendar opens. */
export function useDaySummaries(from: string, to: string) {
  return useQuery({
    queryKey: ["days", from, to],
    queryFn: () => api<DaySummaries>(`/api/days?from=${from}&to=${to}`),
  });
}
