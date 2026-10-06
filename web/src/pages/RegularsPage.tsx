import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api.ts";
import { ItemsEditor } from "../components/EntryEditor.tsx";
import { SetupPrompt } from "../components/SetupPrompt.tsx";
import { sportOf } from "../components/SportBadge.tsx";
import { fieldClass, primaryButton, quietButton } from "../components/ui.tsx";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { useRegulars } from "../queries.ts";
import type { ExerciseItemInput, FoodItemInput, Regular, RegularKind } from "../shared.ts";

/** Edits a regular's name and what a tap logs, or removes it (2026-10-06 design §2.3). There is no adding one. */
function RegularEditor({ regular, onClose }: { regular: Regular; onClose: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const [name, setName] = useState(regular.name);
  const [foods, setFoods] = useState<FoodItemInput[]>(regular.foods);
  const [exercises, setExercises] = useState<ExerciseItemInput[]>(regular.exercises);
  const done = () => {
    void client.invalidateQueries({ queryKey: ["regulars"] });
    // Today's suggestions come with the day.
    void client.invalidateQueries({ queryKey: ["day"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () =>
      api<Regular>(`/api/regulars/${regular.key}`, {
        method: "PUT",
        json: { name: name.trim(), foods: foods.filter((f) => f.name.trim()), exercises: exercises.filter((x) => x.name.trim()) },
      }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/api/regulars/${regular.key}`, { method: "DELETE" }),
    onSuccess: done,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    remove.reset();
    save.mutate();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t.regulars.edit} className="fixed inset-0 z-40 flex items-end bg-black/40 sm:items-center">
      <form
        onSubmit={submit}
        className="raised max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:mx-auto sm:max-w-xl sm:rounded-3xl"
      >
        <h2 className="text-lg font-semibold">{t.regulars.edit}</h2>
        <label className="mt-3 block text-sm">
          {t.regulars.name}
          <input value={name} required maxLength={100} onChange={(event) => setName(event.target.value)} className={fieldClass} />
        </label>
        <ItemsEditor foods={foods} exercises={exercises} featured={[]} onFoods={setFoods} onExercises={setExercises} />
        {(save.isError || remove.isError) && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {remove.isError ? t.regulars.removeFailed : t.regulars.saveFailed}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            className="font-medium text-danger"
            disabled={remove.isPending}
            onClick={() => {
              if (!window.confirm(t.regulars.confirmRemove)) return;
              save.reset();
              remove.mutate();
            }}
          >
            {t.regulars.remove}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={quietButton}>
              {t.common.cancel}
            </button>
            <button type="submit" disabled={save.isPending} className={primaryButton}>
              {t.common.save}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function RegularCard({ regular, windowDays, onEdit }: { regular: Regular; windowDays: number; onEdit: () => void }) {
  const t = useT();
  const icon = regular.kind === "meal" ? "restaurant" : sportOf(regular.exercises[0]?.activity ?? "other").icon;
  const items = [...regular.foods, ...regular.exercises].map((item) => item.name).join(", ");
  return (
    <button type="button" onClick={onEdit} className="tap raised block w-full rounded-2xl p-3 text-left">
      <span className="flex gap-3">
        <span className="pressed flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent-ink">
          <Icon name={icon} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{regular.name}</span>
            <span className="shrink-0 text-sm">
              {Math.round(regular.kcal)} {t.units.kcal}
            </span>
          </span>
          {items !== regular.name && <span className="block truncate text-sm text-muted">{items}</span>}
          <span className="block text-xs text-muted">
            {t.regulars.usually(regular.typical_time)} · {t.regulars.seen(regular.days_seen, windowDays)}
            {regular.edited && ` · ${t.regulars.edited}`}
          </span>
        </span>
      </span>
    </button>
  );
}

export function RegularsPage() {
  const t = useT();
  const regulars = useRegulars();
  const [editing, setEditing] = useState<Regular | null>(null);

  if (regulars.error instanceof ApiError && regulars.error.code === "no_profile") return <SetupPrompt />;
  const view = regulars.data;
  const groups: { kind: RegularKind; title: string }[] = [
    { kind: "meal", title: t.regulars.meals },
    { kind: "activity", title: t.regulars.activities },
  ];
  return (
    <main className="mx-auto max-w-xl px-4 pb-28 pt-[calc(env(safe-area-inset-top)_+_1rem)]">
      <h1 className="text-xl font-semibold">{t.regulars.title}</h1>
      {!view ? (
        <p className={`mt-4 text-sm ${regulars.isError ? "text-danger" : "text-muted"}`} role={regulars.isError ? "alert" : undefined}>
          {regulars.isError ? t.regulars.loadFailed : t.common.loading}
        </p>
      ) : view.data_days < view.required_days ? (
        <section className="raised mt-4 rounded-3xl p-4">
          <p className="text-sm">{t.regulars.collecting(view.required_days)}</p>
          <Progress value={view.data_days} max={view.required_days} />
        </section>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">{t.regulars.intro}</p>
          {view.regulars.length === 0 && <p className="mt-6 text-center text-sm text-muted">{t.regulars.none}</p>}
          {groups.map(({ kind, title }) => {
            const list = view.regulars.filter((r) => r.kind === kind);
            if (list.length === 0) return null;
            return (
              <section key={kind} aria-label={title} className="mt-5">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
                <ul className="flex flex-col gap-3">
                  {list.map((regular) => (
                    <li key={regular.key}>
                      <RegularCard regular={regular} windowDays={view.window_days} onEdit={() => setEditing(regular)} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
      {editing && <RegularEditor regular={editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

/** Days logged so far against the days needed: a pressed track filling with the accent, the numbers beside it. */
export function Progress({ value, max }: { value: number; max: number }) {
  const t = useT();
  const share = Math.min(1, value / max);
  return (
    <div className="mt-3 flex items-center gap-3">
      <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-valuetext={t.insights.progress(value, max)} className="pressed h-2.5 flex-1 rounded-full">
        <div className="h-2.5 rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>
      <span className="shrink-0 text-sm tabular-nums text-muted">{t.insights.progress(value, max)}</span>
    </div>
  );
}
