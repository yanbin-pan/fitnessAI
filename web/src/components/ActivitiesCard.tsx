import { useId, useState } from "react";
import { timeOf } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import type { Activity, DayView, Entry, ExerciseItem } from "../shared.ts";
import { AlcoholPill, AlcoholWeekPanel, DrinkBadge, DrinkPanel, drinkGroups, drinkName, unitsText } from "./Drinks.tsx";
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
 * The day's activity and drinks at a glance, under the nutrients (spec §11.1, 2026-10-08 alcohol design): the badges
 * float on the page, without a card of their own: one per sport, one per kind of drink had on the day, and the week's
 * alcohol units as a pill while the 7 days ending on the day hold any. Each opens its panel under the row. Only there
 * when there is something to show. The day's total burned is in the summary's exercise line.
 */
export function ActivitiesCard({ view, onEdit }: { view: DayView; onEdit: (entry: Entry) => void }) {
  const t = useT();
  const groups = activityGroups(view);
  const drinks = drinkGroups(view);
  // An older server sends no alcohol.
  const week = view.alcohol ?? null;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const panelId = useId();
  if (groups.length === 0 && drinks.length === 0 && !week) return null;
  const open = groups.find((g) => g.key === openKey) ?? null;
  const openDrink = drinks.find((d) => `drink:${d.drink ?? "other"}` === openKey) ?? null;
  const weekOpen = openKey === "week" && week !== null;
  const toggle = (key: string) => setOpenKey(openKey === key ? null : key);
  return (
    <section aria-label={t.activity.title} className="mt-4">
      <ul className="flex flex-wrap items-start justify-center gap-x-3 gap-y-2">
        {groups.map((group) => {
          const isOpen = group.key === open?.key;
          return (
            <li key={group.key}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                aria-label={`${group.items.map((item) => item.name).join(", ")}, ${Math.round(group.kcal)} ${t.units.kcal}`}
                onClick={() => toggle(group.key)}
                className="flex w-16 flex-col items-center gap-1.5 rounded-2xl py-1"
              >
                <SportBadge activity={group.activity} size={44} labelled={false} pressed={isOpen} />
                <span className="text-[0.8125rem] tabular-nums text-muted">{Math.round(group.kcal)}</span>
              </button>
            </li>
          );
        })}
        {groups.length > 0 && (drinks.length > 0 || week) && <li aria-hidden="true" className="mt-2 h-10 w-px bg-(--nm-lo)" />}
        {drinks.map((group) => {
          const key = `drink:${group.drink ?? "other"}`;
          const isOpen = openKey === key;
          return (
            <li key={key}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                aria-label={t.alcohol.badge(drinkName(group.drink, t), group.items.length, unitsText(group.units, t))}
                onClick={() => toggle(key)}
                className="flex w-16 flex-col items-center gap-1.5 rounded-2xl py-1"
              >
                <DrinkBadge drink={group.drink} count={group.items.length} pressed={isOpen} />
                <span className="text-[0.8125rem] tabular-nums text-muted">{t.alcohol.units(unitsText(group.units, t))}</span>
              </button>
            </li>
          );
        })}
        {week && (
          <li className="py-1">
            <AlcoholPill week={week} pressed={weekOpen} onClick={() => toggle("week")} controls={weekOpen ? panelId : undefined} />
          </li>
        )}
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
      {openDrink && <DrinkPanel group={openDrink} id={panelId} onEdit={onEdit} />}
      {weekOpen && <AlcoholWeekPanel week={week} id={panelId} />}
    </section>
  );
}
