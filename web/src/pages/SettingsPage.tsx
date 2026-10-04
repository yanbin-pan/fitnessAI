import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ApiError, api } from "../api.ts";
import { Segmented, fieldClass, primaryButton, quietButton } from "../components/ui.tsx";
import { kcal10 } from "../format.ts";
import { ACTIVITY_LEVEL_KEYS, BODY_GOALS, SEXES } from "../shared.ts";
import type { ActivityLevel, MacroTargets, Profile, ProfileInput, ProfileView } from "../shared.ts";

const FIELDS = [
  "sex", "birth_date", "height_cm", "weight_kg", "activity_level", "goal", "goal_rate_kg_week",
  "protein_g_per_kg", "fat_pct", "fibre_g", "add_back_pct", "override_kcal", "override_protein_g",
  "override_carbs_g", "override_fat_g", "override_fibre_g", "timezone",
] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

/** What each everyday activity level is called on screen; the stored values stay the keys. */
const ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary",
  light: "Light",
  moderate: "Moderate",
  very: "Very active",
};

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

function saveError(error: unknown): string {
  if (error instanceof ApiError && error.kind === "offline") return "You're offline, so that didn't save.";
  if (error instanceof ApiError && error.kind === "signed_out") return "You're signed out. Sign in again, then save.";
  if (error instanceof ApiError && error.code === "invalid_request") return "Couldn't save. Check that every value is filled in and in range.";
  return "Couldn't save. Try again.";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="raised rounded-3xl p-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
        {children}
      </fieldset>
    </section>
  );
}

function TextField({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      {label}
      <input {...input} className={fieldClass} />
    </label>
  );
}

function SelectField({
  label, options, ...select
}: { label: string; options: readonly { value: string; label: string }[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block text-sm">
      {label}
      <select {...select} className={fieldClass}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (!save.isPending) save.reset();
      setForm({ ...form, [field]: event.target.value });
    },
  });
  const choose = (field: Field) => (value: string) => {
    if (!save.isPending) save.reset();
    setForm({ ...form, [field]: value });
  };
  const hint = (key: keyof MacroTargets, unit: string) =>
    calculated ? `${key === "kcal" ? kcal10(calculated.kcal) : Math.round(calculated[key])} ${unit} calculated` : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  if (profile.isPending) return <main className="p-6 text-muted">Loading…</main>;
  // No stored profile is `null` (404 no_profile). `undefined` after the load settled means it failed: do not show the blank form,
  // because saving it would write the defaults over the stored profile.
  if (profile.data === undefined) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p role="alert" className="text-sm text-danger">
          Couldn't load your settings.
        </p>
        <button type="button" onClick={() => void profile.refetch()} className={`${quietButton} mt-3 text-sm text-accent-ink`}>
          Try again
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-28 pt-[calc(env(safe-area-inset-top)_+_1rem)]">
      <h1 className="text-xl font-semibold">Settings</h1>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-6">
        <Section title="About you">
          <Segmented legend="Sex" value={form.sex} onChange={choose("sex")} options={SEXES.map((value) => ({ value, label: value === "male" ? "Male" : "Female" }))} />
          <TextField label="Birth date" type="date" required {...bind("birth_date")} />
          <TextField label="Height (cm)" type="number" step="0.1" required {...bind("height_cm")} />
          <TextField label="Weight (kg)" type="number" step="0.1" required {...bind("weight_kg")} />
          <SelectField
            label="Everyday activity, excluding workouts"
            options={ACTIVITY_LEVEL_KEYS.map((value) => ({ value, label: ACTIVITY_LEVEL_LABELS[value] }))}
            {...bind("activity_level")}
          />
        </Section>
        <Section title="Body goal">
          <Segmented
            legend="Goal"
            value={form.goal}
            onChange={choose("goal")}
            options={BODY_GOALS.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
          />
          {form.goal !== "maintain" && <TextField label="Rate (kg per week)" type="number" step="0.05" required {...bind("goal_rate_kg_week")} />}
        </Section>
        <Section title="Targets">
          <TextField label="Protein (g per kg)" type="number" step="0.1" required {...bind("protein_g_per_kg")} />
          <TextField label="Fat (% of calories)" type="number" required {...bind("fat_pct")} />
          <TextField label="Fibre (g)" type="number" required {...bind("fibre_g")} />
          <TextField label="Exercise calories added back (%)" type="number" required {...bind("add_back_pct")} />
          <p className="text-xs text-muted">An override replaces the calculated value. Leave it blank to use the calculation.</p>
          <TextField label="Calories override" type="number" placeholder={hint("kcal", "kcal")} {...bind("override_kcal")} />
          <TextField label="Protein override (g)" type="number" placeholder={hint("protein_g", "g")} {...bind("override_protein_g")} />
          <TextField label="Carbs override (g)" type="number" placeholder={hint("carbs_g", "g")} {...bind("override_carbs_g")} />
          <TextField label="Fat override (g)" type="number" placeholder={hint("fat_g", "g")} {...bind("override_fat_g")} />
          <TextField label="Fibre override (g)" type="number" placeholder={hint("fibre_g", "g")} {...bind("override_fibre_g")} />
        </Section>
        <Section title="Time">
          <TextField label="Timezone" required {...bind("timezone")} />
        </Section>
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {saveError(save.error)}
          </p>
        )}
        {save.isSuccess && (
          <p role="status" className="text-sm text-accent-ink">
            Saved.
          </p>
        )}
        <button type="submit" disabled={save.isPending} className={primaryButton}>
          Save
        </button>
      </form>
    </main>
  );
}
