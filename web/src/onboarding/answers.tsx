import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api } from "../api.ts";
import { fieldClass } from "../components/ui.tsx";
import { useI18n, useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import {
  ACTIVITY_LEVEL_KEYS, ALCOHOL_HABITS, COACH_TONES, COFFEE_HABITS, COOKING, EXPERIENCES, FOCUSES, MAX_SESSIONS_WEEK, MEAL_PATTERNS, SKIN_GOALS, SKIN_TRIGGERS,
  SKIN_TYPES, SPORTS,
} from "../shared.ts";
import type { About, ActivityLevel, CoachTone, FactInput, FactKind, FactView, Focus, HealthCondition, HealthView, Profile, ProfileInput, ProfileView } from "../shared.ts";

// The answers onboarding asks for (2026-10-20 onboarding and settings design), as pieces Settings reuses: each takes
// the value and reports a change, and the caller decides when it is saved.

/** Saves a change to the stored profile, keeping everything else as it is. */
export function useProfileSave() {
  const client = useQueryClient();
  const { language } = useI18n();
  return useMutation({
    mutationFn: (patch: Partial<ProfileInput>) => {
      const stored = client.getQueryData<ProfileView | null>(["profile"])?.profile;
      return api<ProfileView>("/api/profile", { method: "PUT", json: { ...stored, language, ...patch } as ProfileInput });
    },
    onSuccess: (view) => {
      client.setQueryData(["profile"], view);
      // Today's targets and greeting follow the profile.
      void client.invalidateQueries({ queryKey: ["day"] });
    },
  });
}

/** Agrees to keep health data, as the Health tab's consent card does. */
export function useConsent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<HealthView>("/api/records/consent", { method: "POST" }),
    onSuccess: (view) => client.setQueryData(["health"], view),
  });
}

/** A small heading in capitals over a group of answers. */
export function AnswerLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted">{children}</p>;
}

const chip = "tap min-h-9 rounded-full px-3.5 py-1.5 text-sm";
const chipOn = "bg-accent text-on-accent shadow-[3px_3px_6px_var(--nm-lo),-3px_-3px_6px_var(--nm-hi)]";

/** One chip that is on or off. */
export function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick} className={`${chip} ${on ? chipOn : "raised-sm text-ink"} disabled:opacity-50`}>
      {children}
    </button>
  );
}

/** A labelled row of chips from one vocabulary: any number of them, or at most one when `single`. */
export function Chips<T extends string>({
  label, options, names, value, onChange, single = false,
}: { label?: string; options: readonly T[]; names: Record<T, string>; value: readonly T[]; onChange: (value: T[]) => void; single?: boolean }) {
  const toggle = (option: T) => {
    if (single) onChange(value.includes(option) ? [] : [option]);
    else onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  };
  return (
    <div role="group" aria-label={label}>
      {label && <AnswerLabel>{label}</AnswerLabel>}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Chip key={option} on={value.includes(option)} onClick={() => toggle(option)}>
            {names[option]}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** At most one answer from a vocabulary, or none. */
export function OneOf<T extends string>({
  label, options, names, value, onChange,
}: { label: string; options: readonly T[]; names: Record<T, string>; value: T | null; onChange: (value: T | null) => void }) {
  return <Chips label={label} options={options} names={names} value={value ? [value] : []} onChange={(list) => onChange(list[0] ?? null)} single />;
}

const FOCUS_ICONS: Record<Focus, IconName> = {
  lose_fat: "monitoring", build_muscle: "fitness_center", stay_in_shape: "directions_walk", skin: "lightbulb",
  bloods: "bloodtype", energy: "sunny", gut: "nutrition", event: "mountain_flag",
};

/** What the person wants to work on, as tiles. */
export function FocusTiles({ value, onChange }: { value: readonly Focus[]; onChange: (value: Focus[]) => void }) {
  const t = useT();
  return (
    <div role="group" aria-label={t.onboarding.focus.title} className="grid grid-cols-2 gap-3.5">
      {FOCUSES.map((focus) => {
        const on = value.includes(focus);
        return (
          <button
            key={focus}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((f) => f !== focus) : [...value, focus])}
            className={`tap raised-sm flex min-h-22 flex-col gap-1.5 rounded-2xl p-3.5 text-left ${on ? "outline-2 outline-accent" : ""}`}
          >
            <span className="text-accent-ink"><Icon name={FOCUS_ICONS[focus]} size={22} /></span>
            <span className="text-[15px] font-semibold">{t.onboarding.focus.names[focus]}</span>
            <span className="text-xs leading-snug text-muted">{t.onboarding.focus.notes[focus]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A count with − and + either side. */
export function Stepper({
  label, value, onChange, min, max, step = 1, format = String,
}: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number; format?: (value: number) => string }) {
  const t = useT();
  const round = (n: number) => Math.round(n * 100) / 100;
  return (
    <span className="flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" aria-label={t.prefs.less(label)} disabled={value <= min} onClick={() => onChange(round(Math.max(min, value - step)))} className="tap raised-sm h-9 w-9 rounded-full text-lg disabled:opacity-40">
        −
      </button>
      <span aria-live="polite" className="min-w-9 text-center text-base font-semibold">{format(value)}</span>
      <button type="button" aria-label={t.prefs.moreOf(label)} disabled={value >= max} onClick={() => onChange(round(Math.min(max, value + step)))} className="tap raised-sm h-9 w-9 rounded-full text-lg disabled:opacity-40">
        +
      </button>
    </span>
  );
}

export interface TrainingValue {
  activity_level: ActivityLevel;
  sports: About["sports"];
  sessions_week: number | null;
  experience: About["experience"];
}

/** Everyday activity, the sports, how often and for how long. */
export function TrainingAnswers({ value, onChange }: { value: TrainingValue; onChange: (value: TrainingValue) => void }) {
  const t = useT().onboarding.training;
  return (
    <div className="flex flex-col gap-6">
      <OneOf label={t.daily} options={ACTIVITY_LEVEL_KEYS} names={t.levels} value={value.activity_level}
        onChange={(level) => level && onChange({ ...value, activity_level: level })} />
      <Chips label={t.sports} options={SPORTS} names={t.sportNames} value={value.sports} onChange={(sports) => onChange({ ...value, sports })} />
      <div className="raised flex items-center justify-between gap-3 rounded-3xl px-4 py-3.5">
        <div>
          <div className="text-[15px] font-semibold">{t.sessions}</div>
          <div className="mt-0.5 text-sm text-muted">{t.sessionsNote}</div>
        </div>
        <Stepper label={t.sessions} value={value.sessions_week ?? 3} min={0} max={MAX_SESSIONS_WEEK} onChange={(sessions_week) => onChange({ ...value, sessions_week })} />
      </div>
      <OneOf label={t.experience} options={EXPERIENCES} names={t.experiences} value={value.experience} onChange={(experience) => onChange({ ...value, experience })} />
    </div>
  );
}

export type Habits = Pick<About, "meals" | "cooking" | "alcohol" | "coffee">;

/** How the day's eating usually goes, and drinks. */
export function HabitAnswers({ value, onChange }: { value: Habits; onChange: (value: Habits) => void }) {
  const t = useT().onboarding.food;
  return (
    <div className="flex flex-col gap-6">
      <OneOf label={t.meals} options={MEAL_PATTERNS} names={t.mealNames} value={value.meals} onChange={(meals) => onChange({ ...value, meals })} />
      <OneOf label={t.cooking} options={COOKING} names={t.cookingNames} value={value.cooking} onChange={(cooking) => onChange({ ...value, cooking })} />
      <OneOf label={t.alcohol} options={ALCOHOL_HABITS} names={t.alcoholNames} value={value.alcohol} onChange={(alcohol) => onChange({ ...value, alcohol })} />
      <OneOf label={t.coffee} options={COFFEE_HABITS} names={t.coffeeNames} value={value.coffee} onChange={(coffee) => onChange({ ...value, coffee })} />
    </div>
  );
}

export type SkinValue = Pick<About, "skin_goals" | "skin_triggers" | "skin_type">;

export function SkinAnswers({ value, onChange }: { value: SkinValue; onChange: (value: SkinValue) => void }) {
  const t = useT().onboarding.skin;
  return (
    <div className="flex flex-col gap-6">
      <Chips label={t.title} options={SKIN_GOALS} names={t.goalNames} value={value.skin_goals} onChange={(skin_goals) => onChange({ ...value, skin_goals })} />
      <Chips label={t.triggers} options={SKIN_TRIGGERS} names={t.triggerNames} value={value.skin_triggers} onChange={(skin_triggers) => onChange({ ...value, skin_triggers })} />
      <OneOf label={t.type} options={SKIN_TYPES} names={t.typeNames} value={value.skin_type} onChange={(skin_type) => onChange({ ...value, skin_type })} />
      <div className="raised rounded-2xl px-4 py-3.5">
        <div className="text-sm font-semibold">{t.watchTitle}</div>
        <p className="mt-1.5 text-sm leading-snug text-muted">{t.watchBody}</p>
      </div>
    </div>
  );
}

/** How the coach talks, each with a line it might say. */
export function ToneChoice({ value, onChange }: { value: CoachTone; onChange: (value: CoachTone) => void }) {
  const t = useT().onboarding.coach;
  return (
    <div role="radiogroup" aria-label={t.tone} className="flex flex-col gap-2.5">
      {COACH_TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          role="radio"
          aria-checked={tone === value}
          onClick={() => onChange(tone)}
          className={`tap raised-sm flex flex-col gap-1 rounded-2xl px-3.5 py-3 text-left ${tone === value ? "outline-2 outline-accent" : ""}`}
        >
          <span className="text-sm font-semibold">{t.tones[tone]}</span>
          <span className="text-sm italic text-muted">{t.samples[tone]}</span>
        </button>
      ))}
    </div>
  );
}

// Health facts as chips: on adds the fact, off removes it, straight away (they live on the Health tab, behind its consent).

/** A chip for one fact: a known code, or a label in the person's language. */
export interface FactOption {
  kind: FactKind;
  code?: HealthCondition;
  label?: string;
}

function optionName(option: FactOption, t: Messages): string {
  return option.code ? t.health.conditionNames[option.code] : (option.label ?? "");
}

function matches(fact: FactView, option: FactOption, t: Messages): boolean {
  if (fact.status !== "active") return false;
  if (option.code) return fact.code === option.code;
  return fact.kind === option.kind && fact.label.trim().toLowerCase() === optionName(option, t).toLowerCase();
}

/** The active facts that answer this option. */
export function factsFor(view: HealthView, option: FactOption, t: Messages): FactView[] {
  return view.facts.filter((fact) => matches(fact, option, t));
}

function useFactWrites() {
  const client = useQueryClient();
  // As on the Health tab: every write refreshes it.
  const refresh = () => client.invalidateQueries({ queryKey: ["health"] });
  const add = useMutation({ mutationFn: (input: FactInput) => api<FactView>("/api/records/facts", { json: input }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: async (facts: readonly FactView[]) => {
      for (const fact of facts) await api<void>(`/api/records/facts/${fact.id}`, { method: "DELETE" });
    },
    onSuccess: refresh,
  });
  return { add, remove, pending: add.isPending || remove.isPending, failed: add.isError || remove.isError };
}

/** Facts picked from a list of options. */
export function FactChips({ label, view, options }: { label: string; view: HealthView; options: readonly FactOption[] }) {
  const t = useT();
  const writes = useFactWrites();
  return (
    <div role="group" aria-label={label}>
      <AnswerLabel>{label}</AnswerLabel>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const found = factsFor(view, option, t);
          const name = optionName(option, t);
          return (
            <Chip
              key={option.code ?? option.label}
              on={found.length > 0}
              disabled={writes.pending}
              onClick={() =>
                found.length ? writes.remove.mutate(found) : writes.add.mutate({ kind: option.kind, code: option.code ?? null, label: name })
              }
            >
              {name}
            </Chip>
          );
        })}
      </div>
      {writes.failed && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
    </div>
  );
}

/** Facts of one kind in the person's own words: each a chip with ×, and a box to add another. */
export function FactList({ label, placeholder, view, kind }: { label: string; placeholder: string; view: HealthView; kind: FactKind }) {
  const t = useT();
  const writes = useFactWrites();
  const [text, setText] = useState("");
  const facts = view.facts.filter((fact) => fact.kind === kind && fact.status === "active");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = text.trim();
    if (!label) return;
    writes.add.mutate({ kind, label }, { onSuccess: () => setText("") });
  }
  return (
    <div role="group" aria-label={label}>
      <AnswerLabel>{label}</AnswerLabel>
      {facts.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {facts.map((fact) => (
            <span key={fact.id} className="raised-sm inline-flex min-h-9 items-center gap-1 rounded-full py-1 pr-1 pl-3.5 text-sm">
              {fact.code ? t.health.conditionNames[fact.code] : fact.label}
              <button type="button" aria-label={t.onboarding.health.remove(fact.label)} disabled={writes.pending} onClick={() => writes.remove.mutate([fact])} className="flex h-7 w-7 items-center justify-center rounded-full text-muted">
                <Icon name="close" size={16} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-2">
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={100} className={`${fieldClass} mt-0`} />
        <button type="submit" disabled={writes.pending || text.trim() === ""} className="tap raised-sm min-h-10 shrink-0 rounded-xl px-3.5 text-sm font-medium text-accent-ink disabled:opacity-50">
          {t.onboarding.health.add}
        </button>
      </form>
      {writes.failed && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
    </div>
  );
}

/** The quick picks on the health step, in the order they show. */
export function healthOptions(t: Messages, female: boolean) {
  const extra = t.onboarding.health.extra;
  const conditions: FactOption[] = [
    ...(["high_cholesterol", "prediabetes", "type2_diabetes", "high_blood_pressure", "ibs", "reflux"] as const).map((code) => ({ kind: "condition" as const, code })),
    ...(female ? [{ kind: "condition" as const, label: extra.pcos }, ...(["menopause", "pregnant", "breastfeeding"] as const).map((code) => ({ kind: "condition" as const, code }))] : []),
    { kind: "condition", label: extra.thyroid },
    { kind: "condition", code: "eating_disorder_history" },
  ];
  const allergies: FactOption[] = [
    { kind: "allergy", code: "nut_allergy" },
    { kind: "allergy", code: "shellfish_allergy" },
    { kind: "intolerance", code: "lactose_intolerance" },
    { kind: "intolerance", code: "coeliac" },
    { kind: "allergy", label: extra.eggs },
  ];
  const injuries: FactOption[] = [extra.knee, extra.back, extra.shoulder].map((label) => ({ kind: "injury", label }));
  return { conditions, allergies, injuries };
}

export const DIETS: readonly HealthCondition[] = ["vegetarian", "vegan", "pescatarian", "halal", "kosher"];

/** The diets as chips, with "Everything" for none of them. */
export function DietChips({ view }: { view: HealthView }) {
  const t = useT();
  const writes = useFactWrites();
  const active = view.facts.filter((fact) => fact.status === "active" && fact.kind === "diet");
  const on = (code: HealthCondition) => active.some((fact) => fact.code === code);
  // Vegetarian, vegan and pescatarian exclude each other; halal and kosher go with any of them.
  const patterns: readonly HealthCondition[] = ["vegetarian", "vegan", "pescatarian"];
  function pick(code: HealthCondition) {
    const existing = active.filter((fact) => fact.code === code);
    if (existing.length) return writes.remove.mutate(existing);
    const clash = patterns.includes(code) ? active.filter((fact) => fact.code && patterns.includes(fact.code)) : [];
    writes.remove.mutate(clash, { onSuccess: () => writes.add.mutate({ kind: "diet", code, label: t.health.conditionNames[code] }) });
  }
  return (
    <div role="group" aria-label={t.onboarding.food.diet}>
      <AnswerLabel>{t.onboarding.food.diet}</AnswerLabel>
      <div className="flex flex-wrap gap-2">
        <Chip on={active.length === 0} disabled={writes.pending} onClick={() => writes.remove.mutate(active)}>
          {t.onboarding.food.everything}
        </Chip>
        {DIETS.map((code) => (
          <Chip key={code} on={on(code)} disabled={writes.pending} onClick={() => pick(code)}>
            {t.health.conditionNames[code]}
          </Chip>
        ))}
      </div>
      {writes.failed && <p role="alert" className="mt-2 text-sm text-danger">{t.health.saveFailed}</p>}
    </div>
  );
}

/** Whether the women-only picks show. */
export function isFemale(profile: Pick<Profile, "sex"> | null | undefined): boolean {
  return profile?.sex === "female";
}
