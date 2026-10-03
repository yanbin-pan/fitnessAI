import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { ApiError, api } from "../api.ts";
import { Composer } from "../components/Composer.tsx";
import { DayNav } from "../components/DayNav.tsx";
import { Feed } from "../components/Feed.tsx";
import { SetupPrompt } from "../components/SetupPrompt.tsx";
import { Summary } from "../components/Summary.tsx";
import { storeDay, useDay } from "../queries.ts";
import type { DeleteResult, MessageResult } from "../shared.ts";

export function TodayPage() {
  const { date = "today" } = useParams();
  const day = useDay(date);
  const client = useQueryClient();
  const [logOnly, setLogOnly] = useState(false);
  const retry = useMutation({
    mutationFn: (id: string) => api<MessageResult>(`/api/messages/${id}/retry`, { method: "POST" }),
    onSuccess: (result) => storeDay(client, result.day),
  });
  const undo = useMutation({
    mutationFn: async (ids: string[]) => {
      let last: DeleteResult | null = null;
      for (const id of ids) last = await api<DeleteResult>(`/api/entries/${id}`, { method: "DELETE" });
      return last;
    },
    onSuccess: (last) => {
      if (last) storeDay(client, last.day);
    },
  });

  if (day.error instanceof ApiError && day.error.code === "no_profile") return <SetupPrompt />;
  if (!day.data) {
    return <main className="mx-auto max-w-xl p-6 text-slate-500">{day.isError ? "Couldn't load this day." : "Loading…"}</main>;
  }
  const view = day.data;
  return (
    <main className="mx-auto max-w-xl pb-48">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <DayNav date={view.date} today={view.today} />
        <Summary view={view} />
        <label className="flex items-center gap-2 pb-2 text-xs text-slate-500">
          <input type="checkbox" checked={logOnly} onChange={(event) => setLogOnly(event.target.checked)} />
          Log only
        </label>
      </header>
      <Feed view={view} logOnly={logOnly} onRetry={(id) => retry.mutate(id)} onUndo={(ids) => undo.mutate(ids)} />
      {view.date === view.today && <Composer />}
    </main>
  );
}
