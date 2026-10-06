import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api.ts";
import { useT } from "../i18n/index.tsx";
import { MAX_NAME_LENGTH } from "../shared.ts";
import type { Profile, ProfileInput, ProfileView } from "../shared.ts";
import { fieldClass, primaryButton, quietButton } from "./ui.tsx";

/**
 * Asks someone who set up their profile before names existed what Zabaione should call them, once (the name and
 * greeting design, 2). Saving a name or "Not now" both settle it for good; the name can still be set in Settings.
 */
export function NamePrompt({ profile }: { profile: Profile }) {
  const t = useT();
  const client = useQueryClient();
  const inputId = useId();
  const [name, setName] = useState("");
  const settle = useMutation({
    mutationFn: (given: string | null) =>
      api<ProfileView>("/api/profile", { method: "PUT", json: { ...profile, name: given, name_prompt: "done" } satisfies ProfileInput }),
    onSuccess: (view) => {
      client.setQueryData(["profile"], view);
      // Today's greeting and the coach pick the name up from the profile.
      void client.invalidateQueries({ queryKey: ["day"] });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const given = name.trim();
    if (given) settle.mutate(given);
  }

  return (
    <section aria-labelledby={`${inputId}-title`} className="raised mb-3 rounded-3xl p-4">
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <h2 id={`${inputId}-title`} className="text-base font-semibold">
          {t.namePrompt.title}
        </h2>
        <p className="text-sm text-muted">{t.namePrompt.body}</p>
        <label htmlFor={inputId} className="sr-only">
          {t.namePrompt.label}
        </label>
        <input
          id={inputId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t.namePrompt.label}
          autoComplete="given-name"
          maxLength={MAX_NAME_LENGTH}
          className={fieldClass}
        />
        {settle.isError && (
          <p role="alert" className="text-sm text-danger">
            {t.namePrompt.failed}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={settle.isPending} onClick={() => settle.mutate(null)} className={`${quietButton} min-h-11 text-sm text-muted`}>
            {t.namePrompt.notNow}
          </button>
          <button type="submit" disabled={settle.isPending || name.trim() === ""} className={primaryButton}>
            {t.namePrompt.save}
          </button>
        </div>
      </form>
    </section>
  );
}
