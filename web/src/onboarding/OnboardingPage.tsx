import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { CompanionBadge, useCompanionStills } from "../companions/CompanionView.tsx";
import { CompanionPicker } from "../components/CompanionPicker.tsx";
import { fieldClass, primaryButton, quietButton } from "../components/ui.tsx";
import { thousands } from "../format.ts";
import { LANGUAGE_NAMES, useI18n, useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { useHealth, useProfile } from "../queries.ts";
import { DEFAULT_COMPANION, HEARD_FROM, LANGUAGES, MAX_NAME_LENGTH } from "../shared.ts";
import type { About, CoachTone, CompanionId, Focus, HealthView, HeardFrom, Language, ProfileInput, ProfileView } from "../shared.ts";
import { deviceTimeZone } from "../timezones.ts";
import {
  AnswerLabel, Chip, DietChips, FactChips, FactList, FocusTiles, HabitAnswers, OneOf, SkinAnswers, ToneChoice, TrainingAnswers, healthOptions, useConsent, useProfileSave,
} from "./answers.tsx";
import type { Habits, SkinValue, TrainingValue } from "./answers.tsx";
import { BodyFields, GoalFields, bodyFormFrom, bodyPatch, validateBody } from "./body.tsx";
import type { BodyErrors } from "./body.tsx";
import { effectiveTargets, watchList } from "./plan.ts";

// Onboarding (2026-10-20 onboarding and settings design): one question per screen. Only the body screen is needed, as
// the targets are worked out from it; the profile is created there, and every screen after it saves on Continue.

type Step = "welcome" | "focus" | "body" | "training" | "health" | "food" | "skin" | "coach" | "plan";

/** Today's date on this phone, for when the goal weight would be reached. */
function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function OnboardingPage() {
  const t = useT();
  const profile = useProfile();
  if (profile.isPending) return <main className="p-6 text-muted">{t.common.loading}</main>;
  if (profile.data === undefined) return <main role="alert" className="p-6 text-sm text-danger">{t.settings.loadFailed}</main>;
  return <Flow view={profile.data} />;
}

function Frame({
  index, total, onBack, onSkip, title, body, children, footer,
}: { index: number; total: number; onBack?: () => void; onSkip?: () => void; title?: string; body?: string; children: ReactNode; footer: ReactNode }) {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pt-[calc(env(safe-area-inset-top)_+_1rem)] pb-[calc(env(safe-area-inset-bottom)_+_1.5rem)]">
      {index > 0 && (
        <div className="flex items-center gap-3">
          <button type="button" aria-label={t.onboarding.back} onClick={onBack} className="tap raised-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
            <Icon name="chevron_left" size={22} />
          </button>
          <div role="progressbar" aria-label={t.onboarding.progress(index, total - 1)} aria-valuemin={0} aria-valuemax={total - 1} aria-valuenow={index} className="pressed h-2 flex-1 overflow-hidden rounded-full">
            <div className="h-2 rounded-full bg-accent" style={{ width: `${(index / (total - 1)) * 100}%` }} />
          </div>
          {onSkip ? (
            <button type="button" onClick={onSkip} className="min-h-11 px-1 text-sm text-muted">{t.onboarding.skip}</button>
          ) : (
            <span className="w-9" />
          )}
        </div>
      )}
      {title && <h1 className="mt-7 text-2xl font-bold tracking-tight">{title}</h1>}
      {body && <p className="mt-2 text-[15px] leading-snug text-muted">{body}</p>}
      <div className="mt-6 flex flex-col gap-6">{children}</div>
      <div className="flex-1" />
      <div className="sticky bottom-0 mt-8 bg-base pt-3 pb-1">{footer}</div>
    </main>
  );
}

function Flow({ view }: { view: ProfileView | null }) {
  const t = useT();
  const { language, choose } = useI18n();
  const navigate = useNavigate();
  const save = useProfileSave();
  const health = useHealth();
  const stills = useCompanionStills();
  const stored = view?.profile ?? null;

  const [name, setName] = useState(stored?.name ?? "");
  const [focus, setFocus] = useState<Focus[]>(stored?.about.focus ?? []);
  const [body, setBody] = useState(() => bodyFormFrom(stored, []));
  const [bodyErrors, setBodyErrors] = useState<BodyErrors>({});
  const [training, setTraining] = useState<TrainingValue>({
    activity_level: stored?.activity_level ?? "light", sports: stored?.about.sports ?? [], sessions_week: stored?.about.sessions_week ?? null, experience: stored?.about.experience ?? null,
  });
  const [habits, setHabits] = useState<Habits>({ meals: stored?.about.meals ?? null, cooking: stored?.about.cooking ?? null, alcohol: stored?.about.alcohol ?? null, coffee: stored?.about.coffee ?? null });
  const [skin, setSkin] = useState<SkinValue>({ skin_goals: stored?.about.skin_goals ?? [], skin_triggers: stored?.about.skin_triggers ?? [], skin_type: stored?.about.skin_type ?? null });
  const [companion, setCompanion] = useState<CompanionId>(stored?.companion ?? DEFAULT_COMPANION);
  const [tone, setTone] = useState<CoachTone>(stored?.coach_tone ?? "balanced");
  const [heardFrom, setHeardFrom] = useState<HeardFrom | null>(stored?.about.heard_from ?? null);

  const steps: Step[] = ["welcome", "focus", "body", "training", "health", "food", ...(focus.includes("skin") ? (["skin"] as const) : []), "coach", "plan"];
  const [step, setStep] = useState<Step>("welcome");
  const index = steps.indexOf(step);
  const go = (offset: number) => {
    save.reset();
    setStep(steps[Math.min(steps.length - 1, Math.max(0, index + offset))]);
    window.scrollTo?.(0, 0);
  };
  const about = (): About => ({ ...(stored?.about as About), focus });

  /** Saves on a profile that exists; before the body screen there is none, and the answers wait for it. */
  async function persist(patch: Partial<ProfileInput>): Promise<boolean> {
    if (!stored) return true;
    try {
      await save.mutateAsync(patch);
      return true;
    } catch {
      return false;
    }
  }
  const next = (patch?: Partial<ProfileInput>) => async () => {
    if (!patch || (await persist(patch))) go(1);
  };

  async function submitBody() {
    const found = validateBody(body, t);
    setBodyErrors(found);
    if (Object.keys(found).length > 0) return;
    const patch = bodyPatch(body, about());
    // A new profile: what the earlier screens asked for comes with it, and Today need not ask for a name or companion.
    const created: Partial<ProfileInput> = stored ? {} : {
      name: name.trim() || null, name_prompt: "done", companion_prompt: "done", onboarding: "show", activity_level: training.activity_level,
      timezone: deviceTimeZone() ?? "Europe/London", language,
    };
    try {
      await save.mutateAsync({ ...created, ...patch });
      go(1);
    } catch {
      // The message shows under the button.
    }
  }

  /** Before there is a profile, the weight goal's direction follows what was picked: losing fat, building muscle. */
  function leaveFocus() {
    if (stored) return void next({ about: about() })();
    const { goal, goal_rate_kg_week } = bodyFormFrom(null, focus);
    setBody((form) => ({ ...form, goal, goal_rate_kg_week }));
    go(1);
  }

  async function pickLanguage(next: Language) {
    choose(next);
    if (stored) await persist({ language: next });
  }

  async function finish(to: string) {
    if (await persist({ onboarding: "done" })) navigate(to);
  }

  const failed = save.isError && <p role="alert" className="mb-2 text-sm text-danger">{t.onboarding.saveFailed}</p>;
  const button = (label: string, onClick: () => void) => (
    <>
      {failed}
      <button type="button" disabled={save.isPending} onClick={onClick} className={`${primaryButton} w-full`}>{label}</button>
    </>
  );
  const frame = { index, total: steps.length, onBack: () => go(-1), onSkip: () => go(1) };

  switch (step) {
    case "welcome":
      return (
        <Frame {...frame} footer={<>{button(t.onboarding.welcome.start, next(stored ? { name: name.trim() || null, name_prompt: "done" } : undefined))}<p className="mt-3.5 text-center text-sm text-muted">{t.onboarding.welcome.time}</p></>}>
          <div className="mt-8 flex justify-center">
            <span className="pressed flex h-36 w-36 items-center justify-center rounded-full">
              {stills?.[companion] ? <img src={stills[companion]} alt="" className="h-28 w-28" /> : <CompanionBadge companion={companion} className="h-20 w-20 text-3xl" />}
            </span>
          </div>
          <div className="text-center">
            <h1 className="text-[28px] font-bold tracking-tight">{t.onboarding.welcome.title}</h1>
            <p className="mt-3 px-2 leading-normal text-muted">{t.onboarding.welcome.body}</p>
          </div>
          <label className="block text-sm font-medium">
            {t.onboarding.welcome.name}
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="given-name" maxLength={MAX_NAME_LENGTH} className={fieldClass} />
          </label>
          <div role="group" aria-label={t.onboarding.welcome.language} className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm text-muted">{t.onboarding.welcome.language}</span>
            {LANGUAGES.map((value) => (
              <Chip key={value} on={value === language} onClick={() => void pickLanguage(value)}>{LANGUAGE_NAMES[value]}</Chip>
            ))}
          </div>
        </Frame>
      );
    case "focus":
      return (
        <Frame {...frame} title={t.onboarding.focus.title} body={t.onboarding.focus.body} footer={button(t.onboarding.focus.next(focus.length), leaveFocus)}>
          <FocusTiles value={focus} onChange={setFocus} />
        </Frame>
      );
    case "body":
      return (
        <Frame {...frame} onSkip={undefined} title={t.onboarding.body.title} body={t.onboarding.body.body} footer={button(t.onboarding.next, () => void submitBody())}>
          <BodyFields form={body} errors={bodyErrors} onChange={setBody} />
          <section className="raised rounded-3xl p-4">
            <AnswerLabel>{t.onboarding.body.goal}</AnswerLabel>
            <GoalFields form={body} errors={bodyErrors} today={localToday()} onChange={setBody} />
          </section>
        </Frame>
      );
    case "training":
      return (
        <Frame {...frame} title={t.onboarding.training.title} body={t.onboarding.training.body}
          footer={button(t.onboarding.next, next({ activity_level: training.activity_level, about: { ...about(), sports: training.sports, sessions_week: training.sessions_week, experience: training.experience } }))}>
          <TrainingAnswers value={training} onChange={setTraining} />
        </Frame>
      );
    case "health":
      return (
        <Frame {...frame} title={t.onboarding.health.title} footer={<HealthFooter health={health.data} button={button} onNext={() => go(1)} />}>
          <HealthStep health={health.data} female={body.sex === "female"} />
        </Frame>
      );
    case "food":
      return (
        <Frame {...frame} title={t.onboarding.food.title} body={t.onboarding.food.body} footer={button(t.onboarding.next, next({ about: { ...about(), ...habits } }))}>
          {health.data?.consented_at && (
            <>
              <DietChips view={health.data} />
              <FactList label={t.onboarding.food.avoid} placeholder={t.onboarding.food.addFood} view={health.data} kind="food" />
            </>
          )}
          <HabitAnswers value={habits} onChange={setHabits} />
        </Frame>
      );
    case "skin":
      return (
        <Frame {...frame} footer={button(t.onboarding.next, next({ about: { ...about(), ...skin } }))}>
          <p className="pressed mt-4 self-start rounded-lg px-2.5 py-1 text-xs font-semibold text-accent-ink">{t.onboarding.skin.because}</p>
          <SkinAnswers value={skin} onChange={setSkin} />
        </Frame>
      );
    case "coach": {
      const locked = (view?.companion_locked_until ?? null) !== null;
      return (
        <Frame {...frame} title={t.onboarding.coach.title} body={t.onboarding.coach.body}
          footer={button(t.onboarding.coach.seePlan, next({ ...(locked ? {} : { companion }), coach_tone: tone, companion_prompt: "done", about: { ...about(), heard_from: heardFrom } }))}>
          <CompanionPicker legend={t.onboarding.coach.title} value={companion} onChange={setCompanion} locked={locked} />
          <div>
            <AnswerLabel>{t.onboarding.coach.tone}</AnswerLabel>
            <ToneChoice value={tone} onChange={setTone} />
          </div>
          <OneOf label={t.onboarding.coach.heardFrom} options={HEARD_FROM} names={t.onboarding.coach.heardFromNames} value={heardFrom} onChange={setHeardFrom} />
        </Frame>
      );
    }
    case "plan":
      return <PlanStep view={view} health={health.data} onFinish={(to) => void finish(to)} button={button} />;
  }
}

function HealthStep({ health, female }: { health: HealthView | undefined; female: boolean }) {
  const t = useT();
  if (!health) return <p className="text-sm text-muted">{t.common.loading}</p>;
  const privacy = (
    <div className="pressed flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-sm leading-snug text-muted">
      <span className="mt-0.5 text-accent-ink"><Icon name="lock" size={18} /></span>
      {t.onboarding.health.privacy}
    </div>
  );
  if (!health.consented_at) {
    return (
      <>
        {privacy}
        <p className="text-sm leading-snug">{t.health.consentBody}</p>
      </>
    );
  }
  const options = healthOptions(t, female);
  return (
    <>
      {privacy}
      <FactChips label={t.onboarding.health.conditions} view={health} options={options.conditions} />
      <FactChips label={t.onboarding.health.allergies} view={health} options={options.allergies} />
      <FactChips label={t.onboarding.health.injuries} view={health} options={options.injuries} />
      <FactList label={t.onboarding.health.medication} placeholder={t.onboarding.health.addMedication} view={health} kind="medication" />
    </>
  );
}

/** Before consent the step's button gives it; after, it moves on. */
function HealthFooter({ health, button, onNext }: { health: HealthView | undefined; button: (label: string, onClick: () => void) => ReactNode; onNext: () => void }) {
  const t = useT();
  const agree = useConsent();
  if (health && !health.consented_at) {
    return (
      <>
        {agree.isError && <p role="alert" className="mb-2 text-sm text-danger">{t.health.saveFailed}</p>}
        <button type="button" disabled={agree.isPending} onClick={() => agree.mutate()} className={`${primaryButton} w-full`}>{t.health.consentAction}</button>
      </>
    );
  }
  return button(t.onboarding.next, onNext);
}

function PlanStep({ view, health, onFinish, button }: { view: ProfileView | null; health: HealthView | undefined; onFinish: (to: string) => void; button: (label: string, onClick: () => void) => ReactNode }) {
  const t = useT();
  if (!view) return null;
  const targets = effectiveTargets(view.profile, view.calculated);
  const watch = watchList(view.profile, health?.facts ?? []);
  const macros = [
    { key: "protein", value: targets.protein_g, color: "bg-protein" },
    { key: "carbs", value: targets.carbs_g, color: "bg-carbs" },
    { key: "fat", value: targets.fat_g, color: "bg-fat" },
    { key: "fibre", value: targets.fibre_g, color: "bg-fibre" },
  ] as const;
  return (
    <Frame index={0} total={1} footer={<>{button(t.onboarding.plan.start, () => onFinish("/day/today"))}<p className="mt-3 text-center text-sm text-muted">{t.onboarding.plan.later}</p></>}>
      <div className="mt-6">
        <p className="text-sm font-semibold text-accent-ink">{t.onboarding.plan.ready}</p>
        <h1 className="mt-1.5 text-[26px] font-bold tracking-tight">{t.onboarding.plan.title(view.profile.name)}</h1>
      </div>
      <section className="raised rounded-3xl p-4">
        <p>
          <span className="text-[34px] font-bold tracking-tight">{thousands(targets.kcal, t)}</span>
          <span className="text-[15px] text-muted"> {t.onboarding.plan.perDay}</span>
        </p>
        <div className="mt-4 grid grid-cols-4 gap-3">
          {macros.map((macro) => (
            <div key={macro.key} className="flex flex-col gap-1.5">
              <span className={`h-1.5 rounded-full ${macro.color}`} />
              <span className="text-[17px] font-semibold">{Math.round(macro.value)} {t.units.g}</span>
              <span className="text-xs text-muted">{t.macros[macro.key]}</span>
            </div>
          ))}
        </div>
      </section>
      {watch.length > 0 && (
        <section>
          <AnswerLabel>{t.onboarding.plan.watching}</AnswerLabel>
          <ul className="raised divide-y divide-[var(--nm-lo)]/40 rounded-3xl px-4">
            {watch.map((key) => {
              const [title, note] = t.onboarding.plan.watch[key];
              return (
                <li key={key} className="py-3">
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-sm text-muted">{note}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {health?.consented_at && health.documents.length === 0 && (
        <Link to="/health" onClick={(event) => { event.preventDefault(); onFinish("/health"); }} className={`${quietButton} flex items-center gap-3 rounded-3xl py-3.5 text-left`}>
          <span className="pressed flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent-ink"><Icon name="add_a_photo" size={22} /></span>
          <span>
            <span className="block text-[15px] font-semibold">{t.onboarding.plan.bloodTest}</span>
            <span className="block text-sm font-normal text-muted">{t.onboarding.plan.bloodTestNote}</span>
          </span>
        </Link>
      )}
    </Frame>
  );
}
