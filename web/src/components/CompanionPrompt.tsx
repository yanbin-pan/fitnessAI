import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../api.ts";
import { useT } from "../i18n/index.tsx";
import { COMPANION_NAMES, DEFAULT_COMPANION } from "../shared.ts";
import type { CompanionId, Profile, ProfileInput, ProfileView } from "../shared.ts";
import { CompanionPicker } from "./CompanionPicker.tsx";
import { primaryButton, quietButton } from "./ui.tsx";

/**
 * Asks someone who set up their profile before companions existed to pick one, once (2026-10-08 companions design §7).
 * Choosing or "Not now" both settle it for good, "Not now" keeping Zabaione; Settings can still change it.
 */
export function CompanionPrompt({ profile }: { profile: Profile }) {
  const t = useT();
  const client = useQueryClient();
  const titleId = useId();
  const [picked, setPicked] = useState<CompanionId>(profile.companion ?? DEFAULT_COMPANION);
  const settle = useMutation({
    mutationFn: (companion: CompanionId) =>
      api<ProfileView>("/api/profile", { method: "PUT", json: { ...profile, companion, companion_prompt: "done" } satisfies ProfileInput }),
    onSuccess: (view) => {
      client.setQueryData(["profile"], view);
      // The chat's words and the coach pick the name up from the profile.
      void client.invalidateQueries({ queryKey: ["day"] });
    },
  });

  return (
    <section aria-labelledby={titleId} className="raised mb-3 rounded-3xl p-4">
      <div className="flex flex-col gap-2.5">
        <h2 id={titleId} className="text-base font-semibold">
          {t.companionPrompt.title}
        </h2>
        <p className="text-sm text-muted">{t.companionPrompt.body}</p>
        <CompanionPicker legend={t.companionPrompt.title} value={picked} onChange={setPicked} />
        {settle.isError && (
          <p role="alert" className="text-sm text-danger">
            {t.companionPrompt.failed}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={settle.isPending}
            onClick={() => settle.mutate(profile.companion ?? DEFAULT_COMPANION)}
            className={`${quietButton} min-h-11 text-sm text-muted`}
          >
            {t.companionPrompt.notNow}
          </button>
          <button type="button" disabled={settle.isPending} onClick={() => settle.mutate(picked)} className={primaryButton}>
            {t.companionPrompt.choose(COMPANION_NAMES[picked])}
          </button>
        </div>
      </div>
    </section>
  );
}
