import { timeOf } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { Entry } from "../shared.ts";
import { SportBadge } from "./SportBadge.tsx";

/** One logged entry: what, when, its calories and macros, where it came from, and every assumption made. */
export function EntryCard({ entry, onEdit }: { entry: Entry; onEdit?: (entry: Entry) => void }) {
  const t = useT();
  const eaten = entry.foods.reduce((sum, f) => sum + f.kcal, 0);
  const burned = entry.exercises.reduce((sum, x) => sum + x.kcal, 0);
  const names = [...entry.foods.map((f) => f.name), ...entry.exercises.map((x) => x.name)].join(", ");
  const grams = (key: "protein_g" | "carbs_g" | "fat_g") => Math.round(entry.foods.reduce((sum, f) => sum + f[key], 0));
  const facts = [
    eaten > 0 ? `${Math.round(eaten)} ${t.units.kcal}` : null,
    burned > 0 ? t.entry.burned(Math.round(burned)) : null,
    entry.edited ? t.entry.edited : null,
  ].filter(Boolean);
  const notes = [...entry.foods, ...entry.exercises].filter((item) => item.assumption);
  // An entry of exercise only shows its sport; anything with food shows a meal.
  const sport = entry.foods.length === 0 ? entry.exercises[0]?.activity : undefined;
  const body = (
    <span className="flex gap-3">
      {sport ? (
        <SportBadge activity={sport} />
      ) : (
        <span className="pressed flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fat">
          <Icon name="restaurant" size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{names}</span>
          <span className="shrink-0 text-xs text-muted">{timeOf(entry.logged_at, t)}</span>
        </span>
        <span className="block text-sm text-muted">{facts.join(" · ")}</span>
        {eaten > 0 && (
          <span className="block text-xs text-muted">
            {t.macros.proteinShort} {grams("protein_g")} · {t.macros.carbsShort} {grams("carbs_g")} · {t.macros.fatShort} {grams("fat_g")}
          </span>
        )}
        {entry.source === "regular" && (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            <Icon name="repeat" size={14} />
            {t.entry.fromRegular}
          </span>
        )}
        {entry.source === "photo" && (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            <Icon name="photo_camera" size={14} />
            {t.entry.fromPhoto}
          </span>
        )}
        {notes.map((item) => (
          <span key={item.id} className="block text-xs italic text-muted">
            {item.name}: {item.assumption}
          </span>
        ))}
      </span>
    </span>
  );
  return onEdit ? (
    <button type="button" className="tap raised block w-full rounded-2xl p-3 text-left" onClick={() => onEdit(entry)}>
      {body}
    </button>
  ) : (
    <div className="raised block w-full rounded-2xl p-3 text-left">{body}</div>
  );
}
