import type { InputHTMLAttributes } from "react";
import { Segmented, fieldClass } from "../components/ui.tsx";
import { dayAndMonth } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { BODY_GOALS, PROFILE_RANGES, SEXES, addDays, isIsoDate } from "../shared.ts";
import type { BodyGoal, Focus, Profile, ProfileInput, Sex } from "../shared.ts";

// The body numbers and the weight goal, which the daily targets are worked out from: the one onboarding screen that
// can't be skipped, and Settings' Goals and body page.

/** A typed number, taking a decimal comma as well as a point (an Italian or Lithuanian keyboard types "68,5"). */
export function parseNumber(value: string): number {
  const text = value.trim().replace(",", ".");
  return text === "" ? Number.NaN : Number(text);
}

export interface BodyForm {
  sex: Sex;
  birth_date: string;
  height_cm: string;
  weight_kg: string;
  goal: BodyGoal;
  goal_rate_kg_week: number;
  target_weight_kg: string;
}
type BodyField = "birth_date" | "height_cm" | "weight_kg" | "target_weight_kg";
export type BodyErrors = Partial<Record<BodyField, string>>;

const text = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

/** The form for a stored profile, or a new one whose direction follows what the person wants to work on. */
export function bodyFormFrom(profile: Profile | null, focus: readonly Focus[]): BodyForm {
  if (profile) {
    return {
      sex: profile.sex, birth_date: profile.birth_date, height_cm: text(profile.height_cm), weight_kg: text(profile.weight_kg),
      goal: profile.goal, goal_rate_kg_week: profile.goal === "maintain" ? 0.5 : profile.goal_rate_kg_week, target_weight_kg: text(profile.about.target_weight_kg),
    };
  }
  const goal: BodyGoal = focus.includes("lose_fat") ? "lose" : focus.includes("build_muscle") ? "gain" : "maintain";
  return { sex: "male", birth_date: "", height_cm: "", weight_kg: "", goal, goal_rate_kg_week: goal === "gain" ? 0.25 : 0.5, target_weight_kg: "" };
}

function inRange(value: string, [min, max]: readonly [number, number], t: Messages, optional = false): string | undefined {
  if (value.trim() === "") return optional ? undefined : t.settings.required;
  const n = parseNumber(value);
  if (Number.isNaN(n)) return t.settings.notNumber;
  if (n < min || n > max) return t.settings.between(min, max);
  return undefined;
}

export function validateBody(form: BodyForm, t: Messages): BodyErrors {
  const errors: BodyErrors = {
    birth_date: form.birth_date.trim() === "" ? t.settings.required : isIsoDate(form.birth_date) ? undefined : t.settings.badDate,
    height_cm: inRange(form.height_cm, PROFILE_RANGES.height_cm, t),
    weight_kg: inRange(form.weight_kg, PROFILE_RANGES.weight_kg, t),
    target_weight_kg: form.goal === "maintain" ? undefined : inRange(form.target_weight_kg, PROFILE_RANGES.weight_kg, t, true),
  };
  return Object.fromEntries(Object.entries(errors).filter(([, error]) => error)) as BodyErrors;
}

/** What the form changes on the profile. Only call it once the form is valid. */
export function bodyPatch(form: BodyForm, about: Profile["about"] | undefined): Partial<ProfileInput> {
  const target = parseNumber(form.target_weight_kg);
  return {
    sex: form.sex,
    birth_date: form.birth_date,
    height_cm: parseNumber(form.height_cm),
    weight_kg: parseNumber(form.weight_kg),
    goal: form.goal,
    goal_rate_kg_week: form.goal === "maintain" ? 0 : form.goal_rate_kg_week,
    about: { ...about, target_weight_kg: form.goal === "maintain" || Number.isNaN(target) ? null : target },
  };
}

/** The day the goal weight is reached at this pace, or null when there is no goal weight or it points the other way. */
export function arrival(form: BodyForm, today: string): string | null {
  const weight = parseNumber(form.weight_kg);
  const target = parseNumber(form.target_weight_kg);
  if (form.goal === "maintain" || Number.isNaN(weight) || Number.isNaN(target) || form.goal_rate_kg_week <= 0) return null;
  const gap = form.goal === "lose" ? weight - target : target - weight;
  if (gap <= 0) return null;
  return addDays(today, Math.ceil((gap / form.goal_rate_kg_week) * 7));
}

function Field({ label, error, name, ...input }: { label: string; error?: string; name: string } & InputHTMLAttributes<HTMLInputElement>) {
  const errorId = `${name}-error`;
  return (
    <div>
      <label className="block text-sm text-muted">
        {label}
        <input name={name} {...input} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className={fieldClass} />
      </label>
      {error && <span id={errorId} className="mt-1 block text-xs text-danger">{error}</span>}
    </div>
  );
}

/** Sex, birth date, height and weight. `onCommit` runs when a field is left, for pages that save as they go. */
export function BodyFields({ form, errors, onChange, onCommit }: { form: BodyForm; errors: BodyErrors; onChange: (form: BodyForm) => void; onCommit?: (form: BodyForm) => void }) {
  const t = useT();
  const set = (field: BodyField) => ({
    value: form[field],
    error: errors[field],
    onChange: (event: { target: { value: string } }) => onChange({ ...form, [field]: event.target.value }),
    onBlur: () => onCommit?.(form),
  });
  return (
    <div className="flex flex-col gap-4">
      <Segmented
        legend={t.settings.sex}
        value={form.sex}
        onChange={(sex) => {
          onChange({ ...form, sex });
          onCommit?.({ ...form, sex });
        }}
        options={SEXES.map((value) => ({ value, label: t.settings[value] }))}
      />
      <Field label={t.settings.birthDate} type="date" name="birth_date" {...set("birth_date")} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.settings.height} name="height_cm" type="text" inputMode="decimal" autoComplete="off" {...set("height_cm")} />
        <Field label={t.settings.weight} name="weight_kg" type="text" inputMode="decimal" autoComplete="off" {...set("weight_kg")} />
      </div>
    </div>
  );
}

const PACE_MIN = 0.1;
const PACE_MAX = 1;

/** Lose, keep or gain, and for a change: the goal weight, the pace and when it would be reached. */
export function GoalFields({ form, errors, today, onChange, onCommit }: { form: BodyForm; errors: BodyErrors; today: string; onChange: (form: BodyForm) => void; onCommit?: (form: BodyForm) => void }) {
  const t = useT();
  const when = arrival(form, today);
  const commit = (next: BodyForm) => {
    onChange(next);
    onCommit?.(next);
  };
  return (
    <div className="flex flex-col gap-4">
      <Segmented legend={t.settings.goal} value={form.goal} onChange={(goal) => commit({ ...form, goal })} options={BODY_GOALS.map((value) => ({ value, label: t.settings.goals[value] }))} />
      {form.goal !== "maintain" && (
        <>
          <Field
            label={t.onboarding.body.goalWeight}
            name="target_weight_kg"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={form.target_weight_kg}
            error={errors.target_weight_kg}
            onChange={(event) => onChange({ ...form, target_weight_kg: event.target.value })}
            onBlur={() => onCommit?.(form)}
          />
          <div>
            <label htmlFor="pace" className="flex justify-between text-sm text-muted">
              {t.onboarding.body.pace}
              <span className="font-semibold text-ink">{t.onboarding.body.paceValue(form.goal_rate_kg_week.toLocaleString(t.locale))}</span>
            </label>
            <input
              id="pace"
              type="range"
              min={PACE_MIN}
              max={PACE_MAX}
              step={0.05}
              value={form.goal_rate_kg_week}
              onChange={(event) => onChange({ ...form, goal_rate_kg_week: Number(event.target.value) })}
              onPointerUp={() => onCommit?.(form)}
              onKeyUp={() => onCommit?.(form)}
              className="mt-3 w-full accent-[var(--nm-accent)]"
            />
            <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-muted">
              <span>{t.onboarding.body.gentle}</span>
              <span>{t.onboarding.body.steady}</span>
              <span>{t.onboarding.body.fast}</span>
            </div>
          </div>
          {when && <p className="text-sm text-muted">{t.onboarding.body.eta(dayAndMonth(when, t))}</p>}
        </>
      )}
    </div>
  );
}
