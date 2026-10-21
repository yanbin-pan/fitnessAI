import { entryNames } from "../copied.ts";
import { timeOf } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { Entry } from "../shared.ts";
import { CopyButton } from "./CopyPaste.tsx";
import { SportBadge } from "./SportBadge.tsx";

/** One logged entry: what, when, its calories and macros, where it came from, and every assumption made. */
export function EntryCard({ entry, onEdit, onUndo }: { entry: Entry; onEdit?: (entry: Entry) => void; onUndo?: () => void }) {
  const t = useT();
  const eaten = entry.foods.reduce((sum, f) => sum + f.kcal, 0);
  const burned = entry.exercises.reduce((sum, x) => sum + x.kcal, 0);
  const names = entryNames(entry);
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
      {/* With Undo, the icon column keeps room below the badge for the undo button in the bottom-left corner. */}
      <span className={`shrink-0 ${onUndo ? "pb-7" : ""}`}>
        {sport ? (
          <SportBadge activity={sport} />
        ) : (
          <span className="well-tint tint-amber flex h-9 w-9 items-center justify-center rounded-full">
            <Icon name="restaurant" size={18} />
          </span>
        )}
      </span>
      {/* Room on the right for the copy button in the corner. */}
      <span className="min-w-0 flex-1 pr-6">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{names}</span>
          <span className="shrink-0 text-xs text-muted">{timeOf(entry.logged_at, t)}</span>
        </span>
        <span className="block text-sm text-muted">{facts.join(" · ")}</span>
        {eaten > 0 && (
          <span className="flex gap-2.5 text-xs text-muted">
            <span className="sr-only">
              {t.macros.proteinShort} {grams("protein_g")} · {t.macros.carbsShort} {grams("carbs_g")} · {t.macros.fatShort} {grams("fat_g")}
            </span>
            {/* The same, with each macro's dot in its colour (2026-10-20); read once, from the line above. */}
            {([["protein_g", t.macros.proteinShort, "bg-protein"], ["carbs_g", t.macros.carbsShort, "bg-carbs"], ["fat_g", t.macros.fatShort, "bg-fat"]] as const).map(([key, short, dot]) => (
              <span key={key} aria-hidden="true" className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                {short} {grams(key)}
              </span>
            ))}
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
  // The copy and undo buttons sit beside the card's own button, not inside it: a button can't hold another.
  return (
    <div className="relative">
      {onEdit ? (
        <button type="button" className="tap raised block w-full rounded-2xl p-3 text-left" onClick={() => onEdit(entry)}>
          {body}
        </button>
      ) : (
        <div className="raised block w-full rounded-2xl p-3 text-left">{body}</div>
      )}
      {onUndo && (
        <button
          type="button"
          aria-label={t.feed.undo}
          onClick={onUndo}
          className="tap absolute bottom-1 left-1 flex h-9 w-9 items-center justify-center rounded-full text-muted"
        >
          <Icon name="undo" size={16} />
        </button>
      )}
      <CopyButton entry={entry} />
    </div>
  );
}
