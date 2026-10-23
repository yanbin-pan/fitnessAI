import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { clearPetSignal, raisePetSignal } from "../companions/signal.ts";
import { kcal10 } from "../format.ts";
import { MAX_TIP_NUTRIENTS, MICROS, TIP_IDS, tipsAllowedBy } from "../shared.ts";
import type { DayView, Micro, SeenTip, TipId, TipSeenInput, TipVars, TipsView } from "../shared.ts";

// Tips from the companion (2026-10-23 pet tips design). The phone decides when one is due and which: at most one before
// SECOND_TIP_HOUR and two by the end of the day, each once, ever. While one is due the companion glows; a tap puts it in
// the chat, and the server keeps it as seen.

const TIPS_KEY = ["tips"] as const;

export function useTips(enabled = true) {
  return useQuery({ queryKey: TIPS_KEY, queryFn: () => api<TipsView>("/api/tips"), enabled, staleTime: 60_000 });
}

/** A close-the-day tip only with a real gap left in the afternoon: this much energy, and this much protein. */
const CLOSE_FROM_HOUR = 15;
const CLOSE_MIN_KCAL = 300;
const CLOSE_MIN_PROTEIN_G = 20;
/** Food alone rarely fixes vitamin D (it comes mostly from sunlight), so a vitamin tip never leans on it. */
const SUNLIGHT: Micro = "vitamin_d_ug";

/** The numbers a tip needs from the day, or null when its moment hasn't come. Most tips need nothing. */
function moment(id: TipId, view: DayView, hour: number): TipVars | null {
  if (id === "close-day") {
    if (hour < CLOSE_FROM_HOUR) return null;
    const kcal = kcal10(view.targets.adjusted.kcal) - Math.round(view.totals.kcal);
    const protein = Math.round(view.targets.adjusted.protein_g - view.totals.protein_g);
    return kcal >= CLOSE_MIN_KCAL && protein >= CLOSE_MIN_PROTEIN_G ? { kcal, protein_g: protein } : null;
  }
  if (id === "vitamin-gaps") {
    // An older server sends no signals.
    const levels = view.nutrients?.levels ?? {};
    const low = MICROS.filter((micro) => micro !== SUNLIGHT && levels[micro] === "low").slice(0, MAX_TIP_NUTRIENTS);
    return low.length > 0 ? { nutrients: low } : null;
  }
  return {};
}

/** The tip due on `view` (today) at `hour`, with its numbers; null when none is. */
export function dueTip(view: DayView, seen: SeenTip[], hour: number): TipSeenInput | null {
  if (view.date !== view.today) return null;
  if (seen.filter((tip) => tip.date === view.today).length >= tipsAllowedBy(hour)) return null;
  const shown = new Set(seen.map((tip) => tip.id));
  for (const id of TIP_IDS) {
    if (shown.has(id)) continue;
    const vars = moment(id, view, hour);
    if (vars) return { id, vars };
  }
  return null;
}

/** The hour now, kept current: a second tip becomes due in the afternoon without a reload. */
function useHour(): number {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const timer = window.setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return hour;
}

const SIGNAL_KEY = "tip";

/**
 * Raises the companion's glow while a tip is due on `view`, and puts the tip in the chat on a tap. `enabled` is false
 * while there is no companion to glow or onboarding is still asking.
 */
export function useTipSignal(view: DayView | undefined, enabled: boolean, label: string): void {
  const client = useQueryClient();
  const hour = useHour();
  const tips = useTips(enabled);
  const show = useMutation({
    mutationFn: (tip: TipSeenInput) => api<TipsView>("/api/tips", { method: "POST", json: tip }),
    onSuccess: (result) => client.setQueryData(TIPS_KEY, result),
    // tip_limit (another phone got there first) or offline: fetch the list again, which settles what is due.
    onError: () => void client.invalidateQueries({ queryKey: TIPS_KEY }),
  });
  const seen = tips.data?.tips;
  const due = enabled && view && Array.isArray(seen) && !show.isPending ? dueTip(view, seen, hour) : null;
  const dueKey = due ? JSON.stringify(due) : null;
  const { mutate } = show;
  useEffect(() => {
    if (!dueKey) return;
    raisePetSignal({ key: SIGNAL_KEY, priority: 0, label, open: () => mutate(JSON.parse(dueKey) as TipSeenInput) });
    return () => clearPetSignal(SIGNAL_KEY);
  }, [dueKey, label, mutate]);
}
