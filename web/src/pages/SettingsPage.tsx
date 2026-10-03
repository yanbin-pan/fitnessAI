import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ApiError, api } from "../api.ts";
import { kcal10 } from "../format.ts";
import { ACTIVITY_LEVEL_KEYS, BODY_GOALS, SEXES } from "../shared.ts";
import type { MacroTargets, Profile, ProfileInput, ProfileView } from "../shared.ts";

const FIELDS = [
  "sex", "birth_date", "height_cm", "weight_kg", "activity_level", "goal", "goal_rate_kg_week",
  "protein_g_per_kg", "fat_pct", "fibre_g", "add_back_pct", "override_kcal", "override_protein_g",
  "override_carbs_g", "override_fat_g", "override_fibre_g", "timezone",
] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

const EMPTY: Form = {
  sex: "male", birth_date: "", height_cm: "", weight_kg: "", activity_level: "light", goal: "maintain",
  goal_rate_kg_week: "0.5", protein_g_per_kg: "1.8", fat_pct: "30", fibre_g: "30", add_back_pct: "50",
  override_kcal: "", override_protein_g: "", override_carbs_g: "", override_fat_g: "", override_fibre_g: "",
  timezone: "Europe/London",
};

function formFrom(profile: Profile): Form {
  const form = { ...EMPTY };
  for (const field of FIELDS) {
    const value = profile[field];
    form[field] = value === null ? "" : String(value);
  }
  return form;
}

function payloadFrom(form: Form, previous: Profile | null): ProfileInput {
  const number = (field: Field) => Number(form[field]);
  const optional = (field: Field) => (form[field].trim() === "" ? null : Number(form[field]));
  return {
    ...previous, // keeps the settings this screen does not show yet
    sex: form.sex as Profile["sex"],
    birth_date: form.birth_date,
    height_cm: number("height_cm"),
    weight_kg: number("weight_kg"),
    activity_level: form.activity_level as Profile["activity_level"],
    goal: form.goal as Profile["goal"],
    goal_rate_kg_week: form.goal === "maintain" ? 0 : number("goal_rate_kg_week"),
    protein_g_per_kg: number("protein_g_per_kg"),
    fat_pct: number("fat_pct"),
    fibre_g: number("fibre_g"),
    add_back_pct: number("add_back_pct"),
    override_kcal: optional("override_kcal"),
    override_protein_g: optional("override_protein_g"),
    override_carbs_g: optional("override_carbs_g"),
    override_fat_g: optional("override_fat_g"),
    override_fibre_g: optional("override_fibre_g"),
    timezone: form.timezone.trim(),
  };
}

async function loadProfile(): Promise<ProfileView | null> {
  try {
    return await api<ProfileView>("/api/profile");
  } catch (error) {
    if (error instanceof ApiError && error.code === "no_profile") return null;
    throw error;
  }
}

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</legend>
      {children}
    </fieldset>
  );
}

function TextField({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      {label}
      <input {...input} className={inputClass} />
    </label>
  );
}

function SelectField({ label, options, ...select }: { label: string; options: readonly string[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block text-sm">
      {label}
      <select {...select} className={inputClass}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SettingsPage() {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: loadProfile });
  const [form, setForm] = useState<Form>(EMPTY);
  const [calculated, setCalculated] = useState<MacroTargets | null>(null);

  useEffect(() => {
    if (profile.data) {
      setForm(formFrom(profile.data.profile));
      setCalculated(profile.data.calculated);
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => api<ProfileView>("/api/profile", { method: "PUT", json: payloadFrom(form, profile.data?.profile ?? null) }),
    onSuccess: (view) => {
      client.setQueryData(["profile"], view);
      setCalculated(view.calculated);
      void client.invalidateQueries({ queryKey: ["day"] });
    },
  });

  const bind = (field: Field) => ({
    value: form[field],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [field]: event.target.value }),
  });
  const hint = (key: keyof MacroTargets, unit: string) =>
    calculated ? `${key === "kcal" ? kcal10(calculated.kcal) : Math.round(calculated[key])} ${unit} calculated` : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  if (profile.isPending) return <main className="p-6 text-slate-500">Loading…</main>;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-[calc(env(safe-area-inset-top)_+_1rem)]">
      <h1 className="text-xl font-semibold">Settings</h1>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-6">
        <Section title="About you">
          <SelectField label="Sex" options={SEXES} {...bind("sex")} />
          <TextField label="Birth date" type="date" required {...bind("birth_date")} />
          <TextField label="Height (cm)" type="number" step="0.1" required {...bind("height_cm")} />
          <TextField label="Weight (kg)" type="number" step="0.1" required {...bind("weight_kg")} />
          <SelectField label="Everyday activity, excluding workouts" options={ACTIVITY_LEVEL_KEYS} {...bind("activity_level")} />
        </Section>
        <Section title="Body goal">
          <SelectField label="Goal" options={BODY_GOALS} {...bind("goal")} />
          {form.goal !== "maintain" && <TextField label="Rate (kg per week)" type="number" step="0.05" {...bind("goal_rate_kg_week")} />}
        </Section>
        <Section title="Targets">
          <TextField label="Protein (g per kg)" type="number" step="0.1" {...bind("protein_g_per_kg")} />
          <TextField label="Fat (% of calories)" type="number" {...bind("fat_pct")} />
          <TextField label="Fibre (g)" type="number" {...bind("fibre_g")} />
          <TextField label="Exercise calories added back (%)" type="number" {...bind("add_back_pct")} />
          <p className="text-xs text-slate-500">An override replaces the calculated value. Leave it blank to use the calculation.</p>
          <TextField label="Calories override" type="number" placeholder={hint("kcal", "kcal")} {...bind("override_kcal")} />
          <TextField label="Protein override (g)" type="number" placeholder={hint("protein_g", "g")} {...bind("override_protein_g")} />
          <TextField label="Carbs override (g)" type="number" placeholder={hint("carbs_g", "g")} {...bind("override_carbs_g")} />
          <TextField label="Fat override (g)" type="number" placeholder={hint("fat_g", "g")} {...bind("override_fat_g")} />
          <TextField label="Fibre override (g)" type="number" placeholder={hint("fibre_g", "g")} {...bind("override_fibre_g")} />
        </Section>
        <Section title="Time">
          <TextField label="Timezone" {...bind("timezone")} />
        </Section>
        {save.isError && (
          <p role="alert" className="text-sm text-red-600">
            Couldn't save. Check that every value is filled in and in range.
          </p>
        )}
        {save.isSuccess && (
          <p role="status" className="text-sm text-emerald-700">
            Saved.
          </p>
        )}
        <button type="submit" disabled={save.isPending} className="rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-40">
          Save
        </button>
      </form>
    </main>
  );
}
