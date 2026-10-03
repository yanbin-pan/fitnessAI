import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type { DayView } from "./shared.ts";

export const dayKey = (date: string) => ["day", date] as const;

export function useDay(date: string) {
  return useQuery({ queryKey: dayKey(date), queryFn: () => api<DayView>(`/api/days/${date}`) });
}

/** Puts a fresh DayView from a mutation into the cache, under its date and under "today" when it is today. */
export function storeDay(client: QueryClient, view: DayView): void {
  client.setQueryData(dayKey(view.date), view);
  if (view.date === view.today) client.setQueryData(dayKey("today"), view);
}
