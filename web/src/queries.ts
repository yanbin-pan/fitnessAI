import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError, api } from "./api.ts";
import { isLive } from "./coach/live.ts";
import type { DaySummaries, DayView, InsightsView, ProfileView, RegularsView } from "./shared.ts";

export const dayKey = (date: string) => ["day", date] as const;

export function useDay(date: string) {
  return useQuery({
    queryKey: dayKey(date),
    queryFn: () => api<DayView>(`/api/days/${date}`),
    // A message may still be with the coach (for instance after the app was suspended mid-send): look again.
    // One whose stream is open needs no polling; when a stream drops, the day is fetched again and the poll takes over.
    refetchInterval: (query) => (query.state.data?.messages.some((m) => m.status === "pending" && !isLive(m.id)) ? 3000 : false),
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

/** The stored profile, or null before one has been saved (404 no_profile). */
export async function loadProfile(): Promise<ProfileView | null> {
  try {
    return await api<ProfileView>("/api/profile");
  } catch (error) {
    if (error instanceof ApiError && error.code === "no_profile") return null;
    throw error;
  }
}

/** The profile, shared by the settings screen and the app's language. */
export function useProfile() {
  return useQuery({ queryKey: ["profile"], queryFn: loadProfile });
}

/**
 * The profile as the app already holds it, without asking the server again: the language provider keeps it loaded
 * for every screen, so Today reads the same copy and follows its updates.
 */
export function useLoadedProfile() {
  return useQuery({ queryKey: ["profile"], queryFn: loadProfile, enabled: false });
}

/** Everything found to recur in the log, for the Regulars tab (2026-10-06 design §2.3). */
export function useRegulars() {
  return useQuery({ queryKey: ["regulars"], queryFn: () => api<RegularsView>("/api/regulars") });
}

/** The weekly analysis (2026-10-06 design §3.4). While it is being written, ask again every 10 seconds. */
export function useInsights() {
  return useQuery({
    queryKey: ["insights"],
    queryFn: () => api<InsightsView>("/api/insights"),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 10_000 : false),
  });
}
