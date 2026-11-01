import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import { entryNames } from "../copied.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { slotOf } from "../shared.ts";
import type { Entry, FrequentItem } from "../shared.ts";
import { toExerciseInput, toFoodInput } from "./EntryEditor.tsx";
import { useFrequent } from "./FrequentSheet.tsx";

/** The names an entry or a frequent item is made of, as one comparable key. */
const namesKey = (items: { name: string }[]) => items.map((i) => i.name.trim().toLocaleLowerCase()).sort().join("|");

/**
 * ☆ on an entry card, above its copy button (2026-11-01 frequent items): saves the entry to Frequent as it is, around the
 * part of the day it was had, and shows filled while a frequent item has the same items; a tap then removes that item.
 */
export function FrequentStar({ entry }: { entry: Entry }) {
  const t = useT();
  const client = useQueryClient();
  const frequent = useFrequent();
  const key = namesKey([...entry.foods, ...entry.exercises]);
  const saved = frequent.data?.items?.find((item) => namesKey([...item.foods, ...item.exercises]) === key);
  const done = () => {
    void client.invalidateQueries({ queryKey: ["frequent"] });
    void client.invalidateQueries({ queryKey: ["day"] });
  };
  const toggle = useMutation({
    mutationFn: (existing: FrequentItem | undefined) => {
      if (existing) return api<unknown>(`/api/frequent/${existing.id}`, { method: "DELETE" });
      const at = new Date(entry.logged_at);
      const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
      return api<unknown>(`/api/frequent/${crypto.randomUUID()}`, {
        method: "PUT",
        json: { name: entryNames(entry), foods: entry.foods.map(toFoodInput), exercises: entry.exercises.map(toExerciseInput), slot: slotOf(hhmm), source_key: null },
      });
    },
    onSuccess: done,
  });
  if (!key) return null;
  return (
    <button
      type="button"
      aria-label={`${saved ? t.frequent.starOn : t.frequent.starOff}: ${entryNames(entry)}`}
      aria-pressed={saved !== undefined}
      disabled={toggle.isPending || frequent.isPending}
      onClick={() => toggle.mutate(saved)}
      className={`tap absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-60 ${saved ? "text-[var(--tint-ink)] tint-custard" : "text-muted"}`}
    >
      {saved ? <Icon name="star" size={17} /> : (
        <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
      )}
    </button>
  );
}
