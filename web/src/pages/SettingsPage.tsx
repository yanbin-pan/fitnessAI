import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ApiError, api } from "../api.ts";
import { CompanionPicker } from "../components/CompanionPicker.tsx";
import { Segmented, fieldClass, primaryButton, quietButton } from "../components/ui.tsx";
import { dayAndMonth, kcal10 } from "../format.ts";
import { LANGUAGE_NAMES, MESSAGES, isLanguage, useI18n, withCompanion } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { useProfile } from "../queries.ts";
import { deviceTimeZone, timeZoneGroups } from "../timezones.ts";
import {
  ACTIVITY_LEVEL_KEYS, BODY_GOALS, COMPANIONS, DEFAULT_COMPANION, LANGUAGES, MAX_NAME_LENGTH, PROFILE_RANGES, SEXES, isIsoDate, isTimeZone,
} from "../shared.ts";
import type { Language, MacroTargets, Profile, ProfileInput, ProfileView } from "../shared.ts";

const FIELDS = [
  "companion", "name", "sex", "birth_date", "height_cm", "weight_kg", "activity_level", "goal", "goal_rate_kg_week",
  "protein_g_per_kg", "fat_pct", "fibre_g", "add_back_pct", "override_kcal", "override_protein_g",
  "override_carbs_g", "override_fat_g", "override_fibre_g", "timezone",
] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

const EMPTY: Form = {
  companion: DEFAULT_COMPANION, name: "", sex: "male", birth_date: "", height_cm: "", weight_kg: "", activity_level: "light", goal: "maintain",
  goal_rate_kg_week: "0.5", protein_g_per_kg: "1.8", fat_pct: "30", fibre_g: "30", add_back_pct: "50",
  override_kcal: "", override_protein_g: "", override_carbs_g: "", override_fat_g: "", override_fibre_g: "",
  timezone: "Europe/London",
};

function formFrom(profile: Profile): Form {
  const form = { ...EMPTY };
  for (const field of FIELDS) {
    const value = profile[field];
    // An older server sends no name: null and missing both mean a blank field.
    form[field] = value === null || value === undefined ? "" : String(value);
  }
  return form;
}

/** A new profile starts in the phone's own timezone. */
function blankForm(): Form {
  return { ...EMPTY, timezone: deviceTimeZone() ?? EMPTY.timezone };
}

/** A typed number, taking a decimal comma as well as a point (an Italian or Lithuanian keyboard types "68,5"). */
function parseNumber(value: string): number {
  const text = value.trim().replace(",", ".");
  return text === "" ? Number.NaN : Number(text);
}

const OVERRIDES = ["override_kcal", "override_protein_g", "override_carbs_g", "override_fat_g", "override_fibre_g"] as const;
type Errors = Partial<Record<Field, string>>;

/**
 * What is wrong with the form, field by field, checked here rather than by the browser: iOS can refuse to submit a
 * form without saying why, which looks like Save doing nothing. The ranges are the server's own (PROFILE_RANGES).
 */
function validate(form: Form, t: Messages): Errors {
  const errors: Errors = {};
  if (form.name.trim().length > MAX_NAME_LENGTH) errors.name = t.settings.tooLong(MAX_NAME_LENGTH);
  if (form.birth_date.trim() === "") errors.birth_date = t.settings.required;
  else if (!isIsoDate(form.birth_date)) errors.birth_date = t.settings.badDate;
  for (const [field, [min, max]] of Object.entries(PROFILE_RANGES) as [keyof typeof PROFILE_RANGES, readonly [number, number]][]) {
    // The rate is only asked for, and only sent, when losing or gaining.
    if (field === "goal_rate_kg_week" && form.goal === "maintain") continue;
    const value = parseNumber(form[field]);
    if (form[field].trim() === "") errors[field] = t.settings.required;
    else if (Number.isNaN(value)) errors[field] = t.settings.notNumber;
    else if (value < min || value > max) errors[field] = t.settings.between(min, max);
  }
  for (const field of OVERRIDES) {
    if (form[field].trim() === "") continue;
    const value = parseNumber(form[field]);
    if (Number.isNaN(value)) errors[field] = t.settings.notNumber;
    else if (value < 0) errors[field] = t.settings.notNegative;
  }
  if (!isTimeZone(form.timezone.trim())) errors.timezone = t.settings.badTimezone;
  return errors;
}

/** The fields a 400 from the server names, should it refuse something the form let through. */
function serverErrors(error: unknown, t: Messages): Errors {
  const errors: Errors = {};
  if (!(error instanceof ApiError) || error.code !== "invalid_request") return errors;
  for (const issue of error.issues ?? []) {
    const field = FIELDS.find((f) => f === issue.path);
    if (field) errors[field] = t.settings.checkValue;
  }
  return errors;
}

function payloadFrom(form: Form, previous: Profile | null, language: Language): ProfileInput {
  const number = (field: Field) => parseNumber(form[field]);
  const optional = (field: Field) => (form[field].trim() === "" ? null : parseNumber(form[field]));
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
    name: form.name.trim() || null,
    // A new profile was just asked for its name here, and a name given here settles it: Today need not ask.
    // Otherwise the prompt stays as it was.
    name_prompt: form.name.trim() || !previous ? "done" : (previous.name_prompt ?? "done"),
    // An older server sends no companion, which leaves the field blank: Zabaione then.
    companion: COMPANIONS.find((id) => id === form.companion) ?? DEFAULT_COMPANION,
    // Picking here settles Today's question, as does setting up: a new profile was just shown the choice.
    companion_prompt: !previous || form.companion !== previous.companion ? "done" : (previous.companion_prompt ?? "done"),
  };
}

function saveError(error: unknown, t: Messages): string {
  if (error instanceof ApiError && error.kind === "offline") return t.settings.offline;
  if (error instanceof ApiError && error.code === "companion_locked") return t.settings.companionLockedError;
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

/** The message under a field the form or the server refused. */
function FieldError({ id, error }: { id: string; error: string | undefined }) {
  return error ? (
    <span id={id} className="mt-1 block text-xs text-danger">
      {error}
    </span>
  ) : null;
}

function TextField({ label, error, ...input }: { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const errorId = `${input.name ?? label}-error`;
  // The message sits outside the label, so it never becomes part of the field's name.
  return (
    <div>
      <label className="block text-sm">
        {label}
        <input {...input} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className={fieldClass} />
      </label>
      <FieldError id={errorId} error={error} />
    </div>
  );
}

/** A number typed on the phone's decimal keypad. Text, not type="number", so a decimal comma reaches the form intact. */
function NumberField(props: { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <TextField type="text" inputMode="decimal" autoComplete="off" {...props} />;
}

/** The timezone, picked from the list the phone knows (grouped by region), or typed where it can't list them. */
function TimezoneField({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (value: string) => void }) {
  const groups = timeZoneGroups(value);
  if (!groups) return <TextField name="timezone" label={label} value={value} error={error} onChange={(event) => onChange(event.target.value)} />;
  return (
    <div>
      <label className="block text-sm">
        {label}
        <select
          name="timezone"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "timezone-error" : undefined}
          className={fieldClass}
        >
          {!isTimeZone(value) && <option value={value}>{value}</option>}
          {groups.map((group) => (
            <optgroup key={group.region} label={group.region}>
              {group.zones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <FieldError id="timezone-error" error={error} />
    </div>
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
  const [form, setForm] = useState<Form>(blankForm);
  const [errors, setErrors] = useState<Errors>({});
  const formRef = useRef<HTMLFormElement>(null);
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
    onError: (error) => {
      setErrors(serverErrors(error, t));
      // Changed elsewhere meanwhile: fetch the profile again, so the picker shows the lock and its date.
      if (error instanceof ApiError && error.code === "companion_locked") void profile.refetch();
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

  const change = (field: Field, value: string) => {
    if (!save.isPending) save.reset();
    setForm({ ...form, [field]: value });
    // A corrected field stops being marked; the others keep their message until the next Save.
    if (errors[field]) setErrors({ ...errors, [field]: undefined });
  };
  const bind = (field: Field) => ({
    name: field,
    value: form[field],
    error: errors[field],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => change(field, event.target.value),
  });
  const pick = (field: Field) => (value: string) => change(field, value);
  const hint = (key: keyof MacroTargets, unit: string) =>
    calculated ? t.settings.calculated(key === "kcal" ? kcal10(calculated.kcal) : Math.round(calculated[key]), unit) : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(form, t);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      save.reset();
      // Take the person to the first thing to fix, which may be far above the Save button.
      const first = FIELDS.find((field) => found[field]);
      const input = first ? formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`) : null;
      input?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      input?.focus({ preventScroll: true });
      return;
    }
    save.mutate();
  }
  const hasErrors = Object.values(errors).some(Boolean);
  // The companion picked just above is who asks for the name: the words follow the pick before it is saved.
  const picked = COMPANIONS.find((id) => id === form.companion) ?? DEFAULT_COMPANION;
  const named = withCompanion(MESSAGES[language], picked);
  // An older server sends no lock.
  const lockedUntil = profile.data?.companion_locked_until ?? null;

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
      <form ref={formRef} onSubmit={submit} noValidate className="mt-4 flex flex-col gap-6">
        <Section title={t.settings.language}>
          <SelectField
            label={t.settings.languageField}
            options={LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }))}
            value={language}
            onChange={(event) => pickLanguage(event.target.value)}
          />
          <p className="text-xs text-muted">{named.settings.languageNote}</p>
          {saveLanguage.isError && (
            <p role="alert" className="text-sm text-danger">
              {t.settings.languageFailed}
            </p>
          )}
        </Section>
        <Section title={t.settings.companion}>
          <p className="text-xs text-muted">{t.settings.companionHint}</p>
          <CompanionPicker legend={t.settings.companion} value={form.companion} onChange={pick("companion")} locked={lockedUntil !== null} />
          <p className={`text-xs ${lockedUntil ? "text-ink" : "text-muted"}`}>
            {lockedUntil ? t.settings.companionLocked(dayAndMonth(lockedUntil, t)) : t.settings.companionOnce}
          </p>
        </Section>
        <Section title={t.settings.aboutYou}>
          <div>
            <TextField label={named.settings.name} autoComplete="given-name" maxLength={MAX_NAME_LENGTH} {...bind("name")} />
            <p className="mt-1 text-xs text-muted">{named.settings.nameHint}</p>
          </div>
          <Segmented
            legend={t.settings.sex}
            value={form.sex}
            onChange={pick("sex")}
            options={SEXES.map((value) => ({ value, label: t.settings[value] }))}
          />
          <TextField label={t.settings.birthDate} type="date" {...bind("birth_date")} />
          <NumberField label={t.settings.height} {...bind("height_cm")} />
          <NumberField label={t.settings.weight} {...bind("weight_kg")} />
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
          {form.goal !== "maintain" && <NumberField label={t.settings.rate} {...bind("goal_rate_kg_week")} />}
        </Section>
        <Section title={t.settings.targets}>
          <NumberField label={t.settings.protein} {...bind("protein_g_per_kg")} />
          <NumberField label={t.settings.fat} {...bind("fat_pct")} />
          <NumberField label={t.settings.fibre} {...bind("fibre_g")} />
          <NumberField label={t.settings.addBack} {...bind("add_back_pct")} />
          <p className="text-xs text-muted">{t.settings.overrideNote}</p>
          <NumberField label={t.settings.overrideKcal} placeholder={hint("kcal", t.units.kcal)} {...bind("override_kcal")} />
          <NumberField label={t.settings.overrideProtein} placeholder={hint("protein_g", t.units.g)} {...bind("override_protein_g")} />
          <NumberField label={t.settings.overrideCarbs} placeholder={hint("carbs_g", t.units.g)} {...bind("override_carbs_g")} />
          <NumberField label={t.settings.overrideFat} placeholder={hint("fat_g", t.units.g)} {...bind("override_fat_g")} />
          <NumberField label={t.settings.overrideFibre} placeholder={hint("fibre_g", t.units.g)} {...bind("override_fibre_g")} />
        </Section>
        <Section title={t.settings.time}>
          <TimezoneField label={t.settings.timezone} value={form.timezone} error={errors.timezone} onChange={pick("timezone")} />
        </Section>
        {hasErrors && !save.isError && (
          <p role="alert" className="text-sm text-danger">
            {t.settings.checkFields}
          </p>
        )}
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
