import { useId, useState } from "react";
import { timeOf } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import type { Activity, DayView, Entry, ExerciseItem } from "../shared.ts";
import { SportBadge, sportName } from "./SportBadge.tsx";
import { quietButton } from "./ui.tsx";

export interface ActivityGroup {
  key: string;
  entry: Entry;
  activity: Activity;
  items: ExerciseItem[];
  kcal: number;
}

/** One badge per activity per entry, in time order: a gym session's several exercises are one badge (spec §11.1). */
export function activityGroups(view: DayView): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const entry of view.entries) {
    for (const item of entry.exercises) {
      const key = `${entry.id}:${item.activity}`;
      const group = groups.find((g) => g.key === key);
      if (group) {
        group.items.push(item);
        group.kcal += item.kcal;
      } else {
        groups.push({ key, entry, activity: item.activity, items: [item], kcal: item.kcal });
      }
    }
  }
  return groups;
}

/** "90 min · 788 kcal · MET 7.3", with sets × reps × weight or the distance when known. */
function facts(item: ExerciseItem, t: Messages): string {
  return [
    item.duration_min !== null ? t.activity.minutes(Math.round(item.duration_min)) : null,
    `${Math.round(item.kcal)} ${t.units.kcal}`,
    item.met !== null ? `MET ${item.met}` : null,
    item.sets !== null && item.reps !== null ? `${item.sets} × ${item.reps}${item.weight_kg !== null ? ` × ${item.weight_kg} kg` : ""}` : null,
    item.distance_km !== null ? `${item.distance_km} km` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The day's activity at a glance, under the nutrients (spec §11.1): its badges float on the page, without a card of
 * their own, so a day with one workout shows one badge rather than an empty card. Only there when something was done.
 * The day's total burned is in the summary's exercise line.
 */
export function ActivitiesCard({ view, onEdit }: { view: DayView; onEdit: (entry: Entry) => void }) {
  const t = useT();
  const groups = activityGroups(view);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const panelId = useId();
  if (groups.length === 0) return null;
  const open = groups.find((g) => g.key === openKey) ?? null;
  return (
    <section aria-label={t.activity.title} className="mt-4">
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-2">
        {groups.map((group) => {
          const isOpen = group.key === open?.key;
          return (
            <li key={group.key}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                aria-label={`${group.items.map((item) => item.name).join(", ")}, ${Math.round(group.kcal)} ${t.units.kcal}`}
                onClick={() => setOpenKey(isOpen ? null : group.key)}
                className="flex w-16 flex-col items-center gap-1.5 rounded-2xl py-1"
              >
                <SportBadge activity={group.activity} size={44} labelled={false} pressed={isOpen} />
                <span className="text-[0.8125rem] tabular-nums text-muted">{Math.round(group.kcal)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <div id={panelId} role="region" aria-label={t.activity.details(sportName(open.activity, t).label)} className="pressed mt-3 rounded-2xl p-3">
          <p className="text-right text-xs text-muted">{timeOf(open.entry.logged_at, t)}</p>
          {open.items.map((item) => (
            <div key={item.id} className="mt-1">
              <p className="font-medium">{item.name}</p>
              <p className="text-sm">{facts(item, t)}</p>
              {item.assumption && <p className="text-xs italic text-muted">{item.assumption}</p>}
            </div>
          ))}
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => onEdit(open.entry)} className={`${quietButton} min-h-11 text-sm text-accent-ink`}>
              {t.common.edit}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
