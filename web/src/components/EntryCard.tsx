import { timeOf } from "../format.ts";
import type { Entry } from "../shared.ts";

export function EntryCard({ entry, onEdit }: { entry: Entry; onEdit?: (entry: Entry) => void }) {
  const eaten = entry.foods.reduce((sum, f) => sum + f.kcal, 0);
  const burned = entry.exercises.reduce((sum, x) => sum + x.kcal, 0);
  const names = [...entry.foods.map((f) => f.name), ...entry.exercises.map((x) => x.name)].join(", ");
  const facts = [
    eaten > 0 ? `${Math.round(eaten)} kcal` : null,
    burned > 0 ? `${Math.round(burned)} kcal burned` : null,
    entry.edited ? "edited" : null,
  ].filter(Boolean);
  const notes = [...entry.foods, ...entry.exercises].filter((item) => item.assumption);
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{names}</span>
        <span className="shrink-0 text-xs text-slate-500">{timeOf(entry.logged_at)}</span>
      </span>
      <span className="block text-sm text-slate-600 dark:text-slate-300">{facts.join(" · ")}</span>
      {notes.map((item) => (
        <span key={item.id} className="block text-xs italic text-slate-500">
          {item.name}: {item.assumption}
        </span>
      ))}
    </>
  );
  const className = "block w-full rounded-xl border border-slate-200 p-3 text-left dark:border-slate-800";
  return onEdit ? (
    <button type="button" className={className} onClick={() => onEdit(entry)}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
