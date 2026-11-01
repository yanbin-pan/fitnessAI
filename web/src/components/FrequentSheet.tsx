import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { FREQUENT_SLOTS } from "../shared.ts";
import type { Activity, ExerciseItemInput, FoodItemInput, FrequentItem, FrequentSlot, FrequentView, Regular, RegularKind } from "../shared.ts";
import { ItemsEditor, blankExercise, blankFood } from "./EntryEditor.tsx";
import { sportOf } from "./SportBadge.tsx";
import { Segmented, fieldClass, quietButton } from "./ui.tsx";

// The Frequent sheet (2026-11-01 frequent items), opened from ⋯ on the quick card: what is pinned, by meals and
// activities, the regulars that could be pinned, and an editor that saves as you go, like Settings.

export function useFrequent(enabled = true) {
  return useQuery({ queryKey: ["frequent"], queryFn: () => api<FrequentView>("/api/frequent"), enabled });
}

/** "Porridge, Coffee +2" style names, for an item saved without one. */
function nameFrom(items: { name: string }[]): string {
  const names = [...new Set(items.map((item) => item.name.trim()).filter(Boolean))];
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
}

function KindIcon({ kind, activity, dashed = false }: { kind: RegularKind; activity: Activity | undefined; dashed?: boolean }) {
  const icon = kind === "meal" ? "restaurant" : sportOf(activity ?? "other").icon;
  if (dashed) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-dashed border-muted/50 text-muted">
        <Icon name={icon} size={18} />
      </span>
    );
  }
  return (
    <span className={`well-tint ${kind === "meal" ? "tint-amber" : "tint-orange"} flex h-9 w-9 shrink-0 items-center justify-center rounded-xl`}>
      <Icon name={icon} size={18} />
    </span>
  );
}

interface Draft {
  id: string;
  name: string;
  foods: FoodItemInput[];
  exercises: ExerciseItemInput[];
  slot: FrequentSlot;
  source_key: string | null;
  times_logged: number;
  isNew: boolean;
}

const draftOf = (item: FrequentItem): Draft => ({
  id: item.id, name: item.name, foods: item.foods, exercises: item.exercises, slot: item.slot, source_key: item.source_key, times_logged: item.times_logged, isNew: false,
});

/** What would be saved, or null while there is nothing to save yet (no item with a name). */
function payloadOf(draft: Draft) {
  const foods = draft.foods.filter((f) => f.name.trim());
  const exercises = draft.exercises.filter((x) => x.name.trim());
  if (foods.length + exercises.length === 0) return null;
  return { name: draft.name.trim() || nameFrom([...foods, ...exercises]), foods, exercises, slot: draft.slot, source_key: draft.source_key };
}

function Editor({ start, featured, onBack }: { start: Draft; featured: readonly Activity[]; onBack: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const [draft, setDraft] = useState(start);
  const [created, setCreated] = useState(!start.isNew);
  const save = useMutation({
    mutationFn: (payload: NonNullable<ReturnType<typeof payloadOf>>) => api<FrequentItem>(`/api/frequent/${draft.id}`, { method: "PUT", json: payload }),
    onSuccess: () => {
      setCreated(true);
      void client.invalidateQueries({ queryKey: ["frequent"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/api/frequent/${draft.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["frequent"] });
      onBack();
    },
  });
  // Saves a moment after the last change, as Settings does.
  const first = useRef(true);
  const payload = payloadOf(draft);
  const key = JSON.stringify(payload);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!payload) return;
    const timer = setTimeout(() => save.mutate(payload), 600);
    return () => clearTimeout(timer);
  }, [key]);

  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));
  const kcal = draft.foods.length > 0 ? draft.foods.reduce((s, f) => s + f.kcal, 0) : draft.exercises.reduce((s, x) => s + (x.kcal ?? 0), 0);
  const grams = (k: "protein_g" | "carbs_g" | "fat_g" | "fibre_g") => Math.round(draft.foods.reduce((s, f) => s + f[k], 0));
  const status = save.isPending ? t.frequent.saving : save.isError ? t.frequent.saveFailed : save.isSuccess ? t.frequent.saved : "";

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={onBack} className="tap flex items-center gap-0.5 rounded-full py-1 pr-2 text-sm text-muted">
          <Icon name="chevron_left" size={20} />
          {t.frequent.back}
        </button>
        <span role="status" className={`flex items-center gap-1 text-xs ${save.isError ? "text-danger" : "text-muted"}`}>
          {save.isSuccess && !save.isPending && <Icon name="check" size={14} />}
          {status}
        </span>
      </div>
      <label className="block text-sm">
        {t.frequent.name}
        <input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} placeholder={t.frequent.namePlaceholder} className={fieldClass} />
      </label>
      <ItemsEditor foods={draft.foods} exercises={draft.exercises} featured={featured} onFoods={(foods) => set({ foods })} onExercises={(exercises) => set({ exercises })} />
      <p className="mt-3 flex flex-wrap justify-between gap-2 border-t border-[color-mix(in_srgb,var(--nm-lo)_50%,transparent)] pt-3 text-sm text-muted">
        <span>
          {Math.round(kcal)} {t.units.kcal}
        </span>
        {draft.foods.length > 0 && (
          <span className="flex gap-2.5 text-xs">
            {([["protein_g", t.macros.proteinShort, "bg-protein"], ["carbs_g", t.macros.carbsShort, "bg-carbs"], ["fat_g", t.macros.fatShort, "bg-fat"], ["fibre_g", t.macros.fibreShort, "bg-fibre"]] as const).map(([k, short, dot]) => (
              <span key={k} className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                {short} {grams(k)}
              </span>
            ))}
          </span>
        )}
      </p>
      <div className="mt-4">
        <Segmented
          legend={t.frequent.slotLabel}
          options={FREQUENT_SLOTS.map((slot) => ({ value: slot, label: t.frequent.slots[slot] }))}
          value={draft.slot}
          onChange={(slot) => set({ slot })}
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        {created ? (
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => window.confirm(t.frequent.confirmRemove) && remove.mutate()}
            className={`${quietButton} flex items-center gap-1 text-sm text-danger`}
          >
            <Icon name="delete" size={17} />
            {t.frequent.remove}
          </button>
        ) : (
          <span />
        )}
        {draft.times_logged > 0 && <span className="text-xs text-muted">{t.frequent.timesLogged(draft.times_logged)}</span>}
      </div>
    </>
  );
}

function List({ view, onEdit, onAdd }: { view: FrequentView; onEdit: (item: FrequentItem) => void; onAdd: (kind: RegularKind) => void }) {
  const t = useT();
  const client = useQueryClient();
  const [kind, setKind] = useState<RegularKind>(() => (view.items.length > 0 && view.items.every((i) => i.kind === "activity") ? "activity" : "meal"));
  const pin = useMutation({
    mutationFn: (regular: Regular) => api<FrequentItem>(`/api/regulars/${regular.key}/pin`, { json: { id: crypto.randomUUID() } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["frequent"] }),
  });
  const dismiss = useMutation({
    mutationFn: (regular: Regular) => api<void>(`/api/regulars/${regular.key}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["frequent"] }),
  });
  const items = view.items.filter((i) => i.kind === kind);
  const suggestions = view.suggestions.filter((r) => r.kind === kind);
  const count = (k: RegularKind) => view.items.filter((i) => i.kind === k).length;
  return (
    <>
      <div className="pressed mb-3 flex gap-1 rounded-2xl p-1 text-sm" role="tablist">
        {(["meal", "activity"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={`flex-1 rounded-xl py-2 ${kind === k ? "raised-sm font-semibold text-ink" : "text-muted"}`}
          >
            {k === "meal" ? t.frequent.meals : t.frequent.activities} · {count(k)}
          </button>
        ))}
      </div>
      {items.length === 0 && <p className="px-1 py-2 text-sm text-muted">{t.frequent.none}</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id} className="border-b border-[color-mix(in_srgb,var(--nm-lo)_50%,transparent)]">
            <button type="button" onClick={() => onEdit(item)} className="flex w-full items-center gap-3 py-2.5 text-left">
              <KindIcon kind={item.kind} activity={item.exercises[0]?.activity} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{item.name}</span>
                <span className="block truncate text-xs text-muted">{nameFrom([...item.foods, ...item.exercises])}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-muted">
                {item.slot !== "any" && <span className="block">{t.frequent.slots[item.slot]}</span>}
                {Math.round(item.kcal)} {t.units.kcal}
              </span>
              <Icon name="chevron_right" size={18} className="shrink-0 text-muted" />
            </button>
          </li>
        ))}
      </ul>
      {suggestions.length > 0 && (
        <>
          <h3 className="mx-1 mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t.frequent.suggested}</h3>
          <ul>
            {suggestions.map((regular) => (
              <li key={regular.key} className="flex items-center gap-3 border-b border-[color-mix(in_srgb,var(--nm-lo)_50%,transparent)] py-2.5">
                <KindIcon kind={regular.kind} activity={regular.exercises[0]?.activity} dashed />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{regular.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {t.frequent.seen(regular.days_seen)} · {Math.round(regular.kcal)} {t.units.kcal}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pin.isPending}
                  onClick={() => pin.mutate(regular)}
                  className="tap raised-sm flex shrink-0 items-center gap-0.5 rounded-full px-2.5 py-1 text-xs font-semibold text-accent-ink disabled:opacity-50"
                >
                  <Icon name="add" size={14} />
                  {t.frequent.pin}
                </button>
                <button
                  type="button"
                  aria-label={t.frequent.dismiss(regular.name)}
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate(regular)}
                  className="tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted"
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" onClick={() => onAdd(kind)} className={`${quietButton} mt-4 flex items-center gap-1 text-sm text-accent-ink`}>
        <Icon name="add" size={18} />
        {t.frequent.add}
      </button>
      <p className="mx-1 mt-3 text-xs text-muted">{t.frequent.tip}</p>
    </>
  );
}

export function FrequentSheet({ featured, onClose }: { featured: readonly Activity[]; onClose: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const frequent = useFrequent();
  const [editing, setEditing] = useState<Draft | null>(null);
  // What changed here shows behind the quick button once the sheet closes.
  const close = () => {
    void client.invalidateQueries({ queryKey: ["day"] });
    onClose();
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={t.frequent.title} className="fixed inset-0 z-40 flex items-end bg-black/30 sm:items-center" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="raised max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:mx-auto sm:max-w-xl sm:rounded-3xl"
      >
        {editing ? (
          <Editor key={editing.id} start={editing} featured={featured} onBack={() => setEditing(null)} />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t.frequent.title}</h2>
              <button type="button" aria-label={t.frequent.close} onClick={close} className="tap raised-sm flex h-9 w-9 items-center justify-center rounded-full text-muted">
                <Icon name="close" size={18} />
              </button>
            </div>
            {frequent.isError && <p role="alert" className="text-sm text-danger">{t.frequent.loadFailed}</p>}
            {frequent.isPending && <p className="text-sm text-muted">{t.common.loading}</p>}
            {frequent.data && (
              <List
                view={frequent.data}
                onEdit={(item) => setEditing(draftOf(item))}
                onAdd={(kind) =>
                  setEditing({
                    id: crypto.randomUUID(), name: "", foods: kind === "meal" ? [blankFood()] : [], exercises: kind === "activity" ? [blankExercise()] : [],
                    slot: "any", source_key: null, times_logged: 0, isNew: true,
                  })
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
