import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api.ts";
import { storeDay } from "../queries.ts";
import { EXERCISE_CATEGORIES, MAX_BACKDATE_DAYS } from "../shared.ts";
import type {
  Activity, DeleteResult, Entry, EntryResult, ExerciseCategory, ExerciseItem, ExerciseItemInput, FoodItem, FoodItemInput,
} from "../shared.ts";
import { SportBadge, familiesFor, sportOf } from "./SportBadge.tsx";
import { primaryButton, quietButton } from "./ui.tsx";

export function toFoodInput(f: FoodItem): FoodItemInput {
  return {
    name: f.name, quantity: f.quantity, grams: f.grams, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g,
    fat_g: f.fat_g, fibre_g: f.fibre_g, saturated_fat_g: f.saturated_fat_g, sugars_g: f.sugars_g, salt_g: f.salt_g,
    fluid_ml: f.fluid_ml, alcohol_units: f.alcohol_units, assumption: f.assumption, groups: f.groups,
  };
}

export function toExerciseInput(x: ExerciseItem): ExerciseItemInput {
  return {
    name: x.name, category: x.category, activity: x.activity, duration_min: x.duration_min, sets: x.sets, reps: x.reps,
    weight_kg: x.weight_kg, distance_km: x.distance_km, avg_hr: x.avg_hr, met: x.met, kcal: x.kcal,
    assumption: x.assumption, muscles: x.muscles,
  };
}

export const blankFood = (): FoodItemInput => ({
  name: "", quantity: "", grams: null, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0,
  saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0, assumption: "", groups: [],
});

export const blankExercise = (): ExerciseItemInput => ({
  name: "", category: "cardio", activity: "other", duration_min: null, sets: null, reps: null, weight_kg: null,
  distance_km: null, avg_hr: null, met: null, kcal: 0, assumption: "", muscles: [],
});

const inputClass = "pressed mt-0.5 rounded-xl px-2 py-1.5 text-base text-ink";
const rowClass = "pressed mt-3 rounded-2xl p-3";

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
      <button type="button" onClick={onRemove} className="mt-2 text-xs font-medium text-muted">
        Remove
      </button>
    </div>
  );
}

/**
 * An exercise's activity (spec §11.1): the person's featured four and the exercise's own as a row of badges, and More,
 * which swaps the row for every activity by family. Either way it is one radio group: one keyboard stop.
 */
function ActivityPicker({
  exercise, value, featured, onChange,
}: { exercise: number; value: Activity; featured: readonly Activity[]; onChange: (value: Activity) => void }) {
  const name = useId();
  const [all, setAll] = useState(false);
  // Armed when a pointer goes down in the picker, disarmed when a key does, spent by the radio's click.
  const tapped = useRef(false);
  const shown = featured.includes(value) ? featured : [...featured, value];
  // A tap picks and folds the grid away. The arrow keys also "click" a radio: those only move the choice, so
  // someone browsing the grid by keyboard keeps it open. The click cannot tell them apart: a tap reaches the
  // radio through its label, and WebKit sends that forwarded click with detail 0, as it does a key's.
  const folds = () => {
    if (tapped.current) setAll(false);
    tapped.current = false;
  };
  const choice = (activity: Activity) => {
    const chosen = activity === value;
    const sport = sportOf(activity);
    return (
      <label
        key={activity}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-2xl py-1.5 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${chosen ? "font-semibold text-ink" : "text-muted"}`}
      >
        <input
          type="radio"
          name={name}
          value={activity}
          checked={chosen}
          onChange={() => onChange(activity)}
          onClick={folds}
          aria-label={sport.label}
          className="sr-only"
        />
        <SportBadge activity={activity} size={32} labelled={false} pressed={chosen} />
        {sport.short}
      </label>
    );
  };
  return (
    <fieldset
      className="mt-2"
      onPointerDown={() => {
        tapped.current = true;
      }}
      onKeyDown={() => {
        tapped.current = false;
      }}
    >
      {/* Every exercise has a picker: the hidden words tell a screen reader which one this is. */}
      <legend className="text-xs">
        Activity <span className="sr-only">for exercise {exercise}</span>
      </legend>
      {all ? (
        <div className="mt-1 flex flex-col gap-2">
          {familiesFor(featured).map((family) => (
            <div key={family.name}>
              <p className="px-1 text-xs text-muted">{family.name}</p>
              <div className="mt-1 grid grid-cols-5 gap-1">{family.activities.map(choice)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 grid grid-cols-5 gap-1">{shown.map(choice)}</div>
      )}
      <button type="button" aria-expanded={all} onClick={() => setAll((open) => !open)} className={`${quietButton} mt-1 min-h-11 text-xs`}>
        {all ? "Fewer" : "More"}
      </button>
    </fieldset>
  );
}

function ExerciseRow({
  item, number, featured, onChange, onRemove,
}: { item: ExerciseItemInput; number: number; featured: readonly Activity[]; onChange: (item: ExerciseItemInput) => void; onRemove: () => void }) {
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
      <ActivityPicker exercise={number} value={item.activity} featured={featured} onChange={(activity) => set({ activity })} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField label="Minutes" value={item.duration_min} onChange={(v) => set({ duration_min: v, ...(item.met !== null ? { kcal: null } : {}) })} />
        <NumberField label="kcal burned" value={item.kcal} onChange={(v) => set({ kcal: v })} />
      </div>
      <button type="button" onClick={onRemove} className="mt-2 text-xs font-medium text-muted">
        Remove
      </button>
    </div>
  );
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((item, i) => (i === index ? value : item));
}

/** Why a save or delete failed. Only a refusal by the server is about what was typed. */
function failureText(error: unknown, deleting: boolean): string {
  if (error instanceof ApiError) {
    if (error.kind === "offline") return "You're offline, so that didn't go through.";
    if (error.kind === "signed_out") return "You're signed out, so that didn't go through.";
    if (error.code === "too_old") return `Entries can only be added up to ${MAX_BACKDATE_DAYS} days back.`;
    if (error.code === "future_date") return "Entries can't be dated in the future.";
    if (error.code === "invalid_request") return "Couldn't save. Check every item has a name and the numbers are not negative.";
  }
  return deleting ? "Couldn't delete this entry. Try again." : "Couldn't save this entry. Try again.";
}

export function EntryEditor({ date, entry, featured, onClose }: { date: string; entry: Entry | null; featured: readonly Activity[]; onClose: () => void }) {
  const client = useQueryClient();
  const [foods, setFoods] = useState<FoodItemInput[]>(() => (entry ? entry.foods.map(toFoodInput) : [blankFood()]));
  const [exercises, setExercises] = useState<ExerciseItemInput[]>(() => (entry ? entry.exercises.map(toExerciseInput) : []));
  // The last manual add that was sent. Saving again with nothing changed (after a lost reply) is the same
  // request, so it keeps its id and the server stores the entry once (spec §6.3).
  const attempt = useRef<{ key: string; id: string } | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const items = { foods: foods.filter((f) => f.name.trim()), exercises: exercises.filter((x) => x.name.trim()) };
      if (entry) return api<EntryResult>(`/api/entries/${entry.id}`, { method: "PATCH", json: items });
      const key = JSON.stringify({ date, ...items });
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      return api<EntryResult>("/api/entries", { json: { id: attempt.current.id, date, time: null, ...items } });
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
    remove.reset();
    save.mutate();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={entry ? "Edit entry" : "Add manually"} className="fixed inset-0 z-40 flex items-end bg-black/40 sm:items-center">
      <form
        onSubmit={submit}
        className="raised max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:mx-auto sm:max-w-xl sm:rounded-3xl"
      >
        <h2 className="text-lg font-semibold">{entry ? "Edit entry" : "Add manually"}</h2>
        {foods.map((food, i) => (
          <FoodRow key={`f${i}`} food={food} onChange={(next) => setFoods(replaceAt(foods, i, next))} onRemove={() => setFoods(foods.filter((_, j) => j !== i))} />
        ))}
        {exercises.map((item, i) => (
          <ExerciseRow
            key={`x${i}`}
            item={item}
            number={i + 1}
            featured={featured}
            onChange={(next) => setExercises(replaceAt(exercises, i, next))}
            onRemove={() => setExercises(exercises.filter((_, j) => j !== i))}
          />
        ))}
        <div className="mt-3 flex gap-3">
          <button type="button" onClick={() => setFoods([...foods, blankFood()])} className={`${quietButton} text-sm text-accent-ink`}>
            + Food
          </button>
          <button type="button" onClick={() => setExercises([...exercises, blankExercise()])} className={`${quietButton} text-sm text-accent-ink`}>
            + Exercise
          </button>
        </div>
        {(save.isError || remove.isError) && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {failureText(remove.isError ? remove.error : save.error, remove.isError)}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          {entry ? (
            <button
              type="button"
              className="font-medium text-danger"
              onClick={() => {
                if (!window.confirm("Delete this entry?")) return;
                save.reset();
                remove.mutate(entry.id);
              }}
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={quietButton}>
              Cancel
            </button>
            <button type="submit" disabled={save.isPending} className={primaryButton}>
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
