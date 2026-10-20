import { useId } from "react";
import { Link } from "react-router";
import { primaryButton, quietButton } from "../components/ui.tsx";
import { useT } from "../i18n/index.tsx";
import { useProfileSave } from "./answers.tsx";

/**
 * Offers onboarding's questions to someone who set up their profile before they existed, or left them halfway, once
 * (2026-10-20 onboarding and settings design). Finishing them or "Not now" settles it; Settings has every answer.
 */
export function AboutPrompt() {
  const t = useT();
  const titleId = useId();
  const settle = useProfileSave();
  return (
    <section aria-labelledby={titleId} className="raised mb-3 rounded-3xl p-4">
      <h2 id={titleId} className="text-base font-semibold">{t.onboarding.prompt.title}</h2>
      <p className="mt-2 text-sm text-muted">{t.onboarding.prompt.body}</p>
      {settle.isError && <p role="alert" className="mt-2 text-sm text-danger">{t.onboarding.prompt.failed}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" disabled={settle.isPending} onClick={() => settle.mutate({ onboarding: "done" })} className={`${quietButton} min-h-11 text-sm text-muted`}>
          {t.onboarding.prompt.notNow}
        </button>
        <Link to="/welcome" className={primaryButton}>{t.onboarding.prompt.start}</Link>
      </div>
    </section>
  );
}
