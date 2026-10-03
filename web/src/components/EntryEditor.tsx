import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api.ts";
import { storeDay } from "../queries.ts";
import { EXERCISE_CATEGORIES, MAX_BACKDATE_DAYS } from "../shared.ts";
import type {
  DeleteResult, Entry, EntryResult, ExerciseCategory, ExerciseItem, ExerciseItemInput, FoodItem, FoodItemInput,
} from "../shared.ts";

export function toFoodInput(f: FoodItem): FoodItemInput {
  return {
    name: f.name, quantity: f.quantity, grams: f.grams, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g,
    fat_g: f.fat_g, fibre_g: f.fibre_g, saturated_fat_g: f.saturated_fat_g, sugars_g: f.sugars_g, salt_g: f.salt_g,
    fluid_ml: f.fluid_ml, alcohol_units: f.alcohol_units, assumption: f.assumption, groups: f.groups,
  };
}

export function toExerciseInput(x: ExerciseItem): ExerciseItemInput {
  return {
    name: x.name, category: x.category, duration_min: x.duration_min, sets: x.sets, reps: x.reps,
    weight_kg: x.weight_kg, distance_km: x.distance_km, avg_hr: x.avg_hr, met: x.met, kcal: x.kcal,
    assumption: x.assumption, muscles: x.muscles,
  };
}

export const blankFood = (): FoodItemInput => ({
  name: "", quantity: "", grams: null, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0,
  saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0, assumption: "", groups: [],
});

export const blankExercise = (): ExerciseItemInput => ({
  name: "", category: "cardio", duration_min: null, sets: null, reps: null, weight_kg: null,
  distance_km: null, avg_hr: null, met: null, kcal: 0, assumption: "", muscles: [],
});

const inputClass = "mt-0.5 rounded-lg border border-slate-300 px-2 py-1.5 text-base dark:border-slate-700 dark:bg-slate-950";
const rowClass = "mt-3 rounded-xl border border-slate-200 p-2 dark:border-slate-700";

function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="flex min-w-0 flex-col text-xs">
      {label}
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        className={inputClass}
      />
    </label>
  );
}

function FoodRow({ food, onChange, onRemove }: { food: FoodItemInput; onChange: (food: FoodItemInput) => void; onRemove: () => void }) {
  const set = (patch: Partial<FoodItemInput>) => onChange({ ...food, ...patch });
  return (
    <div className={rowClass}>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col text-xs">
          Food
          <input value={food.name} onChange={(event) => set({ name: event.target.value })} className={inputClass} />
        </label>
        <label className="flex w-28 flex-col text-xs">
          Amount
          <input value={food.quantity} onChange={(event) => set({ quantity: event.target.value })} className={inputClass} />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-2">
        <NumberField label="kcal" value={food.kcal} onChange={(v) => set({ kcal: v ?? 0 })} />
        <NumberField label="Protein" value={food.protein_g} onChange={(v) => set({ protein_g: v ?? 0 })} />
        <NumberField label="Carbs" value={food.carbs_g} onChange={(v) => set({ carbs_g: v ?? 0 })} />
        <NumberField label="Fat" value={food.fat_g} onChange={(v) => set({ fat_g: v ?? 0 })} />
        <NumberField label="Fibre" value={food.fibre_g} onChange={(v) => set({ fibre_g: v ?? 0 })} />
      </div>
      <button type="button" onClick={onRemove} className="mt-1 text-xs text-slate-500">
        Remove
      </button>
    </div>
  );
}

function ExerciseRow({ item, onChange, onRemove }: { item: ExerciseItemInput; onChange: (item: ExerciseItemInput) => void; onRemove: () => void }) {
  const set = (patch: Partial<ExerciseItemInput>) => onChange({ ...item, ...patch });
  return (
    <div className={rowClass}>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col text-xs">
          Exercise
          <input value={item.name} onChange={(event) => set({ name: event.target.value })} className={inputClass} />
        </label>
        <label className="flex w-28 flex-col text-xs">
          Type
          <select value={item.category} onChange={(event) => set({ category: event.target.value as ExerciseCategory })} className={inputClass}>
            {EXERCISE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField label="Minutes" value={item.duration_min} onChange={(v) => set({ duration_min: v })} />
        <NumberField label="kcal burned" value={item.kcal} onChange={(v) => set({ kcal: v })} />
      </div>
      <button type="button" onClick={onRemove} className="mt-1 text-xs text-slate-500">
        Remove
      </button>
    </div>
  );
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((item, i) => (i === index ? value : item));
}

export function EntryEditor({ date, entry, onClose }: { date: string; entry: Entry | null; onClose: () => void }) {
  const client = useQueryClient();
  const [foods, setFoods] = useState<FoodItemInput[]>(() => (entry ? entry.foods.map(toFoodInput) : [blankFood()]));
  const [exercises, setExercises] = useState<ExerciseItemInput[]>(() => (entry ? entry.exercises.map(toExerciseInput) : []));

  const save = useMutation({
    mutationFn: () => {
      const items = { foods: foods.filter((f) => f.name.trim()), exercises: exercises.filter((x) => x.name.trim()) };
      return entry
        ? api<EntryResult>(`/api/entries/${entry.id}`, { method: "PATCH", json: items })
        : api<EntryResult>("/api/entries", { json: { id: crypto.randomUUID(), date, time: null, ...items } });
    },
    onSuccess: (result) => {
      storeDay(client, result.day);
      // result.day is the entry's own day. For an entry the coach back-dated that is not the day on
      // screen, so fetch the viewed day again.
      void client.invalidateQueries({ queryKey: ["day"] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<DeleteResult>(`/api/entries/${id}`, { method: "DELETE" }),
    onSuccess: (result) => {
      storeDay(client, result.day);
      void client.invalidateQueries({ queryKey: ["day"] });
      onClose();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={entry ? "Edit entry" : "Add manually"} className="fixed inset-0 z-40 flex items-end bg-black/40 sm:items-center">
      <form
        onSubmit={submit}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:mx-auto sm:max-w-xl sm:rounded-2xl dark:bg-slate-900"
      >
        <h2 className="text-lg font-semibold">{entry ? "Edit entry" : "Add manually"}</h2>
        {foods.map((food, i) => (
          <FoodRow key={`f${i}`} food={food} onChange={(next) => setFoods(replaceAt(foods, i, next))} onRemove={() => setFoods(foods.filter((_, j) => j !== i))} />
        ))}
        {exercises.map((item, i) => (
          <ExerciseRow
            key={`x${i}`}
            item={item}
            onChange={(next) => setExercises(replaceAt(exercises, i, next))}
            onRemove={() => setExercises(exercises.filter((_, j) => j !== i))}
          />
        ))}
        <div className="mt-3 flex gap-4 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <button type="button" onClick={() => setFoods([...foods, blankFood()])}>
            + Food
          </button>
          <button type="button" onClick={() => setExercises([...exercises, blankExercise()])}>
            + Exercise
          </button>
        </div>
        {(save.isError || remove.isError) && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {save.error instanceof ApiError && save.error.code === "too_old"
              ? `Entries can only be added up to ${MAX_BACKDATE_DAYS} days back.`
              : "Couldn't save. Check every item has a name and the numbers are not negative."}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          {entry ? (
            <button
              type="button"
              className="text-red-600"
              onClick={() => {
                if (window.confirm("Delete this entry?")) remove.mutate(entry.id);
              }}
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2">
              Cancel
            </button>
            <button type="submit" disabled={save.isPending} className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-40">
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
