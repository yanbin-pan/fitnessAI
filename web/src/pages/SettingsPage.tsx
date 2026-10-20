import { useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router";
import { CompanionBadge, useCompanionStills } from "../companions/CompanionView.tsx";
import { CompanionPicker } from "../components/CompanionPicker.tsx";
import { fieldClass, quietButton } from "../components/ui.tsx";
import { HealthDataSettings } from "../health/CoachView.tsx";
import { WithHealth } from "../health/common.tsx";
import { dayAndMonth, thousands } from "../format.ts";
import { LANGUAGE_NAMES, isLanguage, useI18n, useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import {
  AnswerLabel, Chips, DietChips, FactList, HabitAnswers, SkinAnswers, Stepper, ToneChoice, TrainingAnswers, useProfileSave,
} from "../onboarding/answers.tsx";
import { BodyFields, GoalFields, bodyFormFrom, bodyPatch, parseNumber, validateBody } from "../onboarding/body.tsx";
import type { BodyErrors, BodyForm } from "../onboarding/body.tsx";
import { effectiveTargets } from "../onboarding/plan.ts";
import { useHealth, useProfile } from "../queries.ts";
import { COMPANION_NAMES, FOCUSES, LANGUAGES, MAX_NAME_LENGTH, PROFILE_RANGES, isTimeZone } from "../shared.ts";
import type { About, MacroTargets, ProfileInput, ProfileView } from "../shared.ts";
import { THEMES, useTheme } from "../theme.ts";
import { timeZoneGroups } from "../timezones.ts";

// Settings (2026-10-20 onboarding and settings design): a profile card and short groups of rows, each row opening its own
// page. Every page saves a change as it is made, so there is no Save button; a typed number saves when its field is left.

export function SettingsPage() {
  const t = useT();
  const profile = useProfile();
  if (profile.isPending) return <main className="p-6 text-muted">{t.common.loading}</main>;
  // `undefined` after the load settled means it failed: nothing is shown that could save defaults over the profile.
  if (profile.data === undefined) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p role="alert" className="text-sm text-danger">{t.settings.loadFailed}</p>
        <button type="button" onClick={() => void profile.refetch()} className={`${quietButton} mt-3 text-sm text-accent-ink`}>{t.common.tryAgain}</button>
      </main>
    );
  }
  if (profile.data === null) return <Navigate to="/welcome" replace />;
  const view = profile.data;
  return (
    <Routes>
      <Route index element={<Home view={view} />} />
      <Route path="goals" element={<GoalsPage view={view} />} />
      <Route path="targets" element={<TargetsPage view={view} />} />
      <Route path="training" element={<TrainingPage view={view} />} />
      <Route path="food" element={<FoodPage view={view} />} />
      <Route path="skin" element={<SkinPage view={view} />} />
      <Route path="coach" element={<CoachPage view={view} />} />
      <Route path="region" element={<RegionPage />} />
      <Route path="data" element={<DataPage />} />
      <Route path="*" element={<Navigate to="/settings" replace />} />
    </Routes>
  );
}

const main = "mx-auto max-w-xl px-4 pb-28 pt-[calc(env(safe-area-inset-top)_+_1rem)]";

function goalSummary(view: ProfileView, t: Messages): string {
  const { profile } = view;
  const rate = profile.goal_rate_kg_week.toLocaleString(t.locale);
  const goal = profile.goal === "lose" ? t.prefs.losing(rate) : profile.goal === "gain" ? t.prefs.gaining(rate) : t.prefs.keeping;
  const target = profile.about.target_weight_kg;
  return profile.goal !== "maintain" && target !== null ? `${goal} · ${t.prefs.towards(String(profile.weight_kg), String(target))}` : goal;
}

/** Each area keeps one hue on its icon (2026-10-20), so the list scans by colour as well as by word. */
type Tint = "green" | "teal" | "blue" | "violet" | "rose" | "amber" | "custard" | "slate";

function Row({ to, icon, tint, label, value }: { to: string; icon: IconName; tint: Tint; label: string; value?: string }) {
  return (
    <Link to={to} className="flex min-h-12 items-center gap-3 text-[15px]">
      <span className={`well-tint tint-${tint} flex h-7 w-7 shrink-0 items-center justify-center rounded-lg`}><Icon name={icon} size={16} /></span>
      <span className="shrink-0">{label}</span>
      <span className="ml-auto min-w-0 truncate text-sm text-muted">{value}</span>
      <span className="shrink-0 text-muted"><Icon name="chevron_right" size={18} /></span>
    </Link>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 ml-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</h2>
      <div className="raised divide-y divide-[var(--nm-lo)]/40 rounded-3xl px-3.5">{children}</div>
    </section>
  );
}

function Home({ view }: { view: ProfileView }) {
  const t = useT();
  const { language } = useI18n();
  const [theme, chooseTheme] = useTheme();
  const stills = useCompanionStills();
  const health = useHealth().data;
  const { profile } = view;
  const about = profile.about;
  const facts = health?.facts.filter((fact) => fact.status === "active") ?? [];
  const diets = facts.filter((fact) => fact.kind === "diet").map((fact) => (fact.code ? t.health.conditionNames[fact.code] : fact.label));
  const healthCount = facts.filter((fact) => fact.kind !== "diet" && fact.kind !== "food").length;
  const training = about.sessions_week !== null ? t.prefs.sessions(about.sessions_week) : about.sports.map((s) => t.onboarding.training.sportNames[s]).join(", ");
  const showSkin = about.focus.includes("skin") || about.skin_goals.length > 0;
  return (
    <main className={`${main} flex flex-col gap-5`}>
      <h1 className="ml-1 text-[28px] font-bold tracking-tight">{t.settings.title}</h1>
      <Link to="goals" className="raised flex items-center gap-3.5 rounded-3xl px-4 py-3.5">
        <span className="pressed flex h-14 w-14 shrink-0 items-center justify-center rounded-full">
          {stills?.[profile.companion] ? <img src={stills[profile.companion]} alt="" className="h-12 w-12" /> : <CompanionBadge companion={profile.companion} className="h-9 w-9" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-semibold">{profile.name ?? t.prefs.rows.goals}</span>
          <span className="mt-0.5 block truncate text-sm text-muted">{goalSummary(view, t)}</span>
        </span>
        <span className="text-muted"><Icon name="chevron_right" size={18} /></span>
      </Link>
      <Group label={t.prefs.groups.plan}>
        <Row to="goals" icon="mountain_flag" tint="green" label={t.prefs.rows.goals} value={about.focus.map((f) => t.onboarding.focus.names[f]).join(", ")} />
        <Row to="targets" icon="monitoring" tint="teal" label={t.prefs.rows.targets} value={t.prefs.kcal(thousands(effectiveTargets(profile, view.calculated).kcal, t))} />
      </Group>
      <Group label={t.prefs.groups.you}>
        <Row to="/health" icon="ecg_heart" tint="rose" label={t.prefs.rows.health} value={healthCount > 0 ? t.prefs.items(healthCount) : undefined} />
        <Row to="food" icon="restaurant" tint="amber" label={t.prefs.rows.food} value={health?.consented_at ? (diets.join(", ") || t.onboarding.food.everything) : undefined} />
        <Row to="training" icon="fitness_center" tint="blue" label={t.prefs.rows.training} value={training} />
        {showSkin && <Row to="skin" icon="lightbulb" tint="violet" label={t.prefs.rows.skin} value={about.skin_goals.map((g) => t.onboarding.skin.goalNames[g]).join(", ")} />}
      </Group>
      <Group label={t.prefs.groups.app}>
        <Row to="coach" icon="chat" tint="custard" label={t.prefs.rows.coach} value={`${COMPANION_NAMES[profile.companion]}, ${t.onboarding.coach.tones[profile.coach_tone]}`} />
        <Row to="region" icon="translate" tint="violet" label={t.prefs.rows.region} value={LANGUAGE_NAMES[language]} />
        <div className="flex min-h-12 items-center gap-3 text-[15px]">
          <span className="well-tint tint-amber flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"><Icon name="sunny" size={16} /></span>
          <span id="appearance">{t.prefs.rows.appearance}</span>
          <div role="radiogroup" aria-labelledby="appearance" className="pressed ml-auto flex gap-0.5 rounded-xl p-1">
            {THEMES.map((value) => (
              <button key={value} type="button" role="radio" aria-checked={theme === value} onClick={() => chooseTheme(value)}
                className={`min-h-8 rounded-lg px-2.5 text-xs ${theme === value ? "raised-sm font-semibold text-ink" : "text-muted"}`}>
                {t.settings.themes[value]}
              </button>
            ))}
          </div>
        </div>
        <Row to="data" icon="lock" tint="slate" label={t.prefs.rows.data} />
      </Group>
    </main>
  );
}

/** A page under Settings: the way back, a title, and whether the last change saved. */
function Page({ title, save, children }: { title: string; save?: { isPending: boolean; isSuccess: boolean; isError: boolean }; children: ReactNode }) {
  const t = useT();
  return (
    <main className={`${main} flex flex-col gap-5`}>
      <div className="flex min-h-11 items-center justify-between">
        <Link to="/settings" className="-ml-1 flex min-h-11 items-center gap-0.5 text-[15px] font-medium text-accent-ink">
          <Icon name="chevron_left" size={20} />
          {t.prefs.back}
        </Link>
        <span role="status" className={`text-sm ${save?.isError ? "text-danger" : "text-accent-ink"}`}>
          {save?.isPending ? t.prefs.saving : save?.isError ? t.settings.failed : save?.isSuccess ? t.prefs.saved : ""}
        </span>
      </div>
      <h1 className="-mt-3 ml-1 text-[26px] font-bold tracking-tight">{title}</h1>
      {children}
    </main>
  );
}

function Card({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section>
      {label && <h2 className="mb-2 ml-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</h2>}
      <div className="raised rounded-3xl p-4">{children}</div>
    </section>
  );
}

/** Today on the person's own calendar, from the profile's timezone. */
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function GoalsPage({ view }: { view: ProfileView }) {
  const t = useT();
  const save = useProfileSave();
  const { profile } = view;
  const [form, setForm] = useState<BodyForm>(() => bodyFormFrom(profile, []));
  const [errors, setErrors] = useState<BodyErrors>({});
  // A field left with a value that can't be saved is marked, and nothing is sent until it is fixed.
  const commit = (next: BodyForm) => {
    const found = validateBody(next, t);
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate(bodyPatch(next, profile.about));
  };
  return (
    <Page title={t.prefs.rows.goals} save={save}>
      <Chips label={t.prefs.working} options={FOCUSES} names={t.onboarding.focus.names} value={profile.about.focus}
        onChange={(focus) => save.mutate({ about: { ...profile.about, focus } })} />
      <Card label={t.prefs.weightGoal}>
        <GoalFields form={form} errors={errors} today={todayIn(profile.timezone)} onChange={setForm} onCommit={commit} />
      </Card>
      <Card label={t.prefs.body}>
        <BodyFields form={form} errors={errors} onChange={setForm} onCommit={commit} />
      </Card>
    </Page>
  );
}

const MACROS = [
  { key: "kcal", field: "override_kcal", unit: "kcal" },
  { key: "protein_g", field: "override_protein_g", unit: "g", name: "protein", color: "bg-protein" },
  { key: "carbs_g", field: "override_carbs_g", unit: "g", name: "carbs", color: "bg-carbs" },
  { key: "fat_g", field: "override_fat_g", unit: "g", name: "fat", color: "bg-fat" },
] as const;

/** One target: the calculation, marked Auto, or the person's own number, which Reset takes back to Auto. */
function TargetRow({ label, calculated, own, unit, color, onSave }: { label: string; calculated: number; own: number | null; unit: string; color?: string; onSave: (value: number | null) => void }) {
  const t = useT();
  const [text, setText] = useState(own === null ? "" : String(own));
  const [error, setError] = useState(false);
  function commit() {
    if (text.trim() === "") return own !== null && onSave(null);
    const value = parseNumber(text);
    setError(Number.isNaN(value) || value < 0);
    if (!Number.isNaN(value) && value >= 0 && value !== own) onSave(value);
  }
  return (
    <div className="flex min-h-13 items-center gap-3 text-[15px]">
      {color && <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />}
      <label htmlFor={`target-${label}`} className="flex-1">{label}</label>
      <input
        id={`target-${label}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        inputMode="decimal"
        placeholder={`${thousands(calculated, t)}`}
        aria-invalid={error || undefined}
        aria-describedby={`target-${label}-unit`}
        className={`${fieldClass} mt-0 w-24 py-1.5 text-right font-semibold placeholder:font-semibold placeholder:text-ink`}
      />
      <span id={`target-${label}-unit`} className="w-9 text-sm text-muted">{unit}</span>
      {own === null ? (
        <span className="pressed w-14 rounded-md py-0.5 text-center text-[11px] font-semibold text-muted">{t.prefs.auto}</span>
      ) : (
        <button type="button" onClick={() => { setText(""); onSave(null); }} className="w-14 text-xs font-medium text-accent-ink">{t.prefs.reset}</button>
      )}
    </div>
  );
}

function TargetsPage({ view }: { view: ProfileView }) {
  const t = useT();
  const save = useProfileSave();
  const { profile, calculated } = view;
  const value = (key: keyof MacroTargets) => calculated[key];
  const addBack = profile.add_back_pct;
  const addBackOptions = [[0, t.prefs.addBackOptions.none], [50, t.prefs.addBackOptions.half], [100, t.prefs.addBackOptions.all]] as const;
  return (
    <Page title={t.prefs.rows.targets} save={save}>
      <Card>
        <p className="text-sm leading-snug text-muted">{t.prefs.targetsNote}</p>
        <div className="mt-2 divide-y divide-[var(--nm-lo)]/40">
          {MACROS.map((macro) => (
            <TargetRow
              key={macro.key}
              label={"name" in macro ? t.macros[macro.name] : t.units.kcal}
              calculated={value(macro.key)}
              own={profile[macro.field]}
              unit={macro.unit === "kcal" ? t.units.kcal : t.units.g}
              color={"color" in macro ? macro.color : undefined}
              onSave={(own) => save.mutate({ [macro.field]: own } as Partial<ProfileInput>)}
            />
          ))}
        </div>
      </Card>
      <Card label={t.prefs.how}>
        <div className="flex flex-col divide-y divide-[var(--nm-lo)]/40">
          <div className="flex min-h-13 items-center justify-between gap-3 text-[15px]">
            {t.prefs.proteinPerKg}
            <Stepper label={t.prefs.proteinPerKg} value={profile.protein_g_per_kg} min={PROFILE_RANGES.protein_g_per_kg[0]} max={PROFILE_RANGES.protein_g_per_kg[1]} step={0.1}
              format={(n) => n.toLocaleString(t.locale)} onChange={(protein_g_per_kg) => save.mutate({ protein_g_per_kg })} />
          </div>
          <div className="flex min-h-13 items-center justify-between gap-3 text-[15px]">
            {t.prefs.fatShare}
            <Stepper label={t.prefs.fatShare} value={profile.fat_pct} min={PROFILE_RANGES.fat_pct[0]} max={PROFILE_RANGES.fat_pct[1]} format={(n) => `${n}%`} onChange={(fat_pct) => save.mutate({ fat_pct })} />
          </div>
          <div className="flex min-h-13 items-center justify-between gap-3 text-[15px]">
            {t.prefs.fibreGoal}
            <Stepper label={t.prefs.fibreGoal} value={profile.fibre_g} min={PROFILE_RANGES.fibre_g[0]} max={PROFILE_RANGES.fibre_g[1]} step={5} format={(n) => `${n} ${t.units.g}`}
              onChange={(fibre_g) => save.mutate({ fibre_g })} />
          </div>
          <div className="py-3">
            <span id="add-back" className="text-[15px]">{t.prefs.addBack}</span>
            <div role="radiogroup" aria-labelledby="add-back" className="pressed mt-2.5 flex gap-1 rounded-xl p-1">
              {addBackOptions.map(([pct, label]) => (
                <button key={pct} type="button" role="radio" aria-checked={addBack === pct} onClick={() => save.mutate({ add_back_pct: pct })}
                  className={`min-h-9 flex-1 rounded-lg text-sm ${addBack === pct ? "raised-sm font-semibold text-ink" : "text-muted"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </Page>
  );
}

function TrainingPage({ view }: { view: ProfileView }) {
  const t = useT();
  const save = useProfileSave();
  const { profile } = view;
  const value = { activity_level: profile.activity_level, sports: profile.about.sports, sessions_week: profile.about.sessions_week, experience: profile.about.experience };
  return (
    <Page title={t.prefs.rows.training} save={save}>
      <TrainingAnswers
        value={value}
        onChange={({ activity_level, ...rest }) => save.mutate({ activity_level, about: { ...profile.about, ...rest } })}
      />
    </Page>
  );
}

function FoodPage({ view }: { view: ProfileView }) {
  const t = useT();
  const save = useProfileSave();
  const about = view.profile.about;
  return (
    <Page title={t.prefs.rows.food} save={save}>
      <WithHealth>
        {(health) => (
          <div className="flex flex-col gap-6">
            <DietChips view={health} />
            <FactList label={t.onboarding.food.avoid} placeholder={t.onboarding.food.addFood} view={health} kind="food" />
          </div>
        )}
      </WithHealth>
      <HabitAnswers value={about} onChange={(habits) => save.mutate({ about: { ...about, ...habits } })} />
    </Page>
  );
}

function SkinPage({ view }: { view: ProfileView }) {
  const t = useT();
  const save = useProfileSave();
  const about: About = view.profile.about;
  return (
    <Page title={t.prefs.rows.skin} save={save}>
      <SkinAnswers value={about} onChange={(skin) => save.mutate({ about: { ...about, ...skin } })} />
    </Page>
  );
}

function CoachPage({ view }: { view: ProfileView }) {
  const t = useT();
  const save = useProfileSave();
  const { profile } = view;
  const lockedUntil = view.companion_locked_until ?? null;
  const [name, setName] = useState(profile.name ?? "");
  return (
    <Page title={t.prefs.rows.coach} save={save}>
      <label className="block text-sm font-medium">
        {t.onboarding.welcome.name}
        <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="given-name" maxLength={MAX_NAME_LENGTH} className={fieldClass}
          onBlur={() => (name.trim() || null) !== profile.name && save.mutate({ name: name.trim() || null, name_prompt: "done" })} />
      </label>
      <Card label={t.settings.companion}>
        <CompanionPicker legend={t.settings.companion} value={profile.companion} locked={lockedUntil !== null}
          onChange={(companion) => save.mutate({ companion, companion_prompt: "done" })} />
        <p className={`mt-3 text-xs ${lockedUntil ? "text-ink" : "text-muted"}`}>
          {lockedUntil ? t.settings.companionLocked(dayAndMonth(lockedUntil, t)) : t.settings.companionOnce}
        </p>
      </Card>
      <div>
        <AnswerLabel>{t.onboarding.coach.tone}</AnswerLabel>
        <ToneChoice value={profile.coach_tone} onChange={(coach_tone) => save.mutate({ coach_tone })} />
      </div>
    </Page>
  );
}

function RegionPage() {
  const t = useT();
  const { language, choose } = useI18n();
  const save = useProfileSave();
  const profile = useProfile().data?.profile;
  const timezone = profile?.timezone ?? "";
  const groups = timeZoneGroups(timezone);
  return (
    <Page title={t.prefs.rows.region} save={save}>
      <Card>
        <div className="flex flex-col gap-4">
          <label className="block text-sm">
            {t.settings.languageField}
            <select value={language} className={fieldClass} onChange={(event) => {
              if (!isLanguage(event.target.value)) return;
              choose(event.target.value);
              save.mutate({ language: event.target.value });
            }}>
              {LANGUAGES.map((value) => <option key={value} value={value}>{LANGUAGE_NAMES[value]}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            {t.settings.timezone}
            {groups ? (
              <select value={timezone} className={fieldClass} onChange={(event) => save.mutate({ timezone: event.target.value })}>
                {!isTimeZone(timezone) && <option value={timezone}>{timezone}</option>}
                {groups.map((group) => (
                  <optgroup key={group.region} label={group.region}>
                    {group.zones.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
                  </optgroup>
                ))}
              </select>
            ) : (
              <input defaultValue={timezone} className={fieldClass} onBlur={(event) => isTimeZone(event.target.value.trim()) && save.mutate({ timezone: event.target.value.trim() })} />
            )}
          </label>
        </div>
      </Card>
    </Page>
  );
}

function DataPage() {
  const t = useT();
  const health = useHealth().data;
  return (
    <Page title={t.prefs.rows.data}>
      <Card>
        <p className="text-sm leading-snug text-muted">{t.prefs.dataBody}</p>
        {health?.consented_at ? (
          <a href="/api/records/export" download className="mt-3 flex min-h-11 items-center gap-2 text-[15px] font-medium text-accent-ink">
            <Icon name="download" size={18} />
            {t.prefs.download}
          </a>
        ) : (
          <p className="mt-3 text-sm">{t.prefs.noHealthData}</p>
        )}
      </Card>
      <HealthDataSettings />
    </Page>
  );
}
