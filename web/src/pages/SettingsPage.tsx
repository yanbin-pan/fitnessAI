import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ApiError, api } from "../api.ts";
import { Segmented, fieldClass, primaryButton, quietButton } from "../components/ui.tsx";
import { kcal10 } from "../format.ts";
import { LANGUAGE_NAMES, isLanguage, useI18n } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { useProfile } from "../queries.ts";
import { ACTIVITY_LEVEL_KEYS, BODY_GOALS, LANGUAGES, SEXES } from "../shared.ts";
import type { Language, MacroTargets, Profile, ProfileInput, ProfileView } from "../shared.ts";

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

function payloadFrom(form: Form, previous: Profile | null, language: Language): ProfileInput {
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
    language,
  };
}

function saveError(error: unknown, t: Messages): string {
  if (error instanceof ApiError && error.kind === "offline") return t.settings.offline;
  if (error instanceof ApiError && error.kind === "signed_out") return t.settings.signedOut;
  if (error instanceof ApiError && error.code === "invalid_request") return t.settings.invalid;
  return t.settings.failed;
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
  const { language, t, choose } = useI18n();
  const profile = useProfile();
  const [form, setForm] = useState<Form>(EMPTY);
  const [calculated, setCalculated] = useState<MacroTargets | null>(null);
  // The stored values the form last took. Changing the language saves the profile on its own, and that must not
  // throw away what is being typed in the rest of the form: only a change to what the form shows is copied in.
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (profile.data) {
      const stored = formFrom(profile.data.profile);
      const key = JSON.stringify(stored);
      if (key !== shown.current) {
        shown.current = key;
        setForm(stored);
      }
      setCalculated(profile.data.calculated);
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => api<ProfileView>("/api/profile", { method: "PUT", json: payloadFrom(form, profile.data?.profile ?? null, language) }),
    onSuccess: (view) => {
      client.setQueryData(["profile"], view);
      setCalculated(view.calculated);
      void client.invalidateQueries({ queryKey: ["day"] });
    },
  });

  // The app speaks the new language at once. With a profile saved, the choice is saved straight away too (every phone
  // and the coach follow it); before there is one, it goes with the first Save.
  const saveLanguage = useMutation({
    mutationFn: (next: Language) => {
      const stored = profile.data?.profile as Profile;
      return api<ProfileView>("/api/profile", { method: "PUT", json: { ...stored, language: next } satisfies ProfileInput });
    },
    onMutate: (next) => {
      const previous = client.getQueryData<ProfileView | null>(["profile"]);
      if (previous) client.setQueryData<ProfileView>(["profile"], { ...previous, profile: { ...previous.profile, language: next } });
      return { previous };
    },
    onSuccess: (view) => client.setQueryData(["profile"], view),
    // Back to the stored language, which the app then shows again.
    onError: (_error, _next, context) => {
      if (context?.previous) client.setQueryData(["profile"], context.previous);
    },
  });
  const pickLanguage = (value: string) => {
    if (!isLanguage(value)) return;
    choose(value);
    if (profile.data) saveLanguage.mutate(value);
  };

  const bind = (field: Field) => ({
    value: form[field],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (!save.isPending) save.reset();
      setForm({ ...form, [field]: event.target.value });
    },
  });
  const pick = (field: Field) => (value: string) => {
    if (!save.isPending) save.reset();
    setForm({ ...form, [field]: value });
  };
  const hint = (key: keyof MacroTargets, unit: string) =>
    calculated ? t.settings.calculated(key === "kcal" ? kcal10(calculated.kcal) : Math.round(calculated[key]), unit) : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  if (profile.isPending) return <main className="p-6 text-muted">{t.common.loading}</main>;
  // No stored profile is `null` (404 no_profile). `undefined` after the load settled means it failed: do not show the blank form,
  // because saving it would write the defaults over the stored profile.
  if (profile.data === undefined) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p role="alert" className="text-sm text-danger">
          {t.settings.loadFailed}
        </p>
        <button type="button" onClick={() => void profile.refetch()} className={`${quietButton} mt-3 text-sm text-accent-ink`}>
          {t.common.tryAgain}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-28 pt-[calc(env(safe-area-inset-top)_+_1rem)]">
      <h1 className="text-xl font-semibold">{t.settings.title}</h1>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-6">
        <Section title={t.settings.language}>
          <SelectField
            label={t.settings.languageField}
            options={LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }))}
            value={language}
            onChange={(event) => pickLanguage(event.target.value)}
          />
          <p className="text-xs text-muted">{t.settings.languageNote}</p>
          {saveLanguage.isError && (
            <p role="alert" className="text-sm text-danger">
              {t.settings.languageFailed}
            </p>
          )}
        </Section>
        <Section title={t.settings.aboutYou}>
          <Segmented
            legend={t.settings.sex}
            value={form.sex}
            onChange={pick("sex")}
            options={SEXES.map((value) => ({ value, label: t.settings[value] }))}
          />
          <TextField label={t.settings.birthDate} type="date" required {...bind("birth_date")} />
          <TextField label={t.settings.height} type="number" step="0.1" required {...bind("height_cm")} />
          <TextField label={t.settings.weight} type="number" step="0.1" required {...bind("weight_kg")} />
          <SelectField
            label={t.settings.activityLevel}
            options={ACTIVITY_LEVEL_KEYS.map((value) => ({ value, label: t.settings.levels[value] }))}
            {...bind("activity_level")}
          />
        </Section>
        <Section title={t.settings.bodyGoal}>
          <Segmented
            legend={t.settings.goal}
            value={form.goal}
            onChange={pick("goal")}
            options={BODY_GOALS.map((value) => ({ value, label: t.settings.goals[value] }))}
          />
          {form.goal !== "maintain" && <TextField label={t.settings.rate} type="number" step="0.05" required {...bind("goal_rate_kg_week")} />}
        </Section>
        <Section title={t.settings.targets}>
          <TextField label={t.settings.protein} type="number" step="0.1" required {...bind("protein_g_per_kg")} />
          <TextField label={t.settings.fat} type="number" required {...bind("fat_pct")} />
          <TextField label={t.settings.fibre} type="number" required {...bind("fibre_g")} />
          <TextField label={t.settings.addBack} type="number" required {...bind("add_back_pct")} />
          <p className="text-xs text-muted">{t.settings.overrideNote}</p>
          <TextField label={t.settings.overrideKcal} type="number" placeholder={hint("kcal", t.units.kcal)} {...bind("override_kcal")} />
          <TextField label={t.settings.overrideProtein} type="number" placeholder={hint("protein_g", t.units.g)} {...bind("override_protein_g")} />
          <TextField label={t.settings.overrideCarbs} type="number" placeholder={hint("carbs_g", t.units.g)} {...bind("override_carbs_g")} />
          <TextField label={t.settings.overrideFat} type="number" placeholder={hint("fat_g", t.units.g)} {...bind("override_fat_g")} />
          <TextField label={t.settings.overrideFibre} type="number" placeholder={hint("fibre_g", t.units.g)} {...bind("override_fibre_g")} />
        </Section>
        <Section title={t.settings.time}>
          <TextField label={t.settings.timezone} required {...bind("timezone")} />
        </Section>
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {saveError(save.error, t)}
          </p>
        )}
        {save.isSuccess && (
          <p role="status" className="text-sm text-accent-ink">
            {t.settings.saved}
          </p>
        )}
        <button type="submit" disabled={save.isPending} className={primaryButton}>
          {t.common.save}
        </button>
      </form>
    </main>
  );
}
