import { useId } from "react";
import { CompanionBadge, useCompanionStills } from "../companions/CompanionView.tsx";
import { useT } from "../i18n/index.tsx";
import { COMPANIONS, COMPANION_NAMES } from "../shared.ts";
import type { CompanionId } from "../shared.ts";

/**
 * The eight companions as a choice of tiles, each a still of it with its name (2026-10-08 companions design §2).
 * `locked` while the last change is under 3 months old: only the current one stays choosable.
 */
export function CompanionPicker({
  legend, value, onChange, locked = false,
}: { legend: string; value: string; onChange: (companion: CompanionId) => void; locked?: boolean }) {
  const t = useT();
  const name = useId();
  const stills = useCompanionStills();
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="grid grid-cols-4 gap-2">
        {COMPANIONS.map((companion) => {
          const chosen = companion === value;
          const disabled = locked && !chosen;
          return (
            <label
              key={companion}
              className={`${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"} flex flex-col items-center gap-1 rounded-2xl px-1 pb-2 pt-1 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${chosen ? "pressed outline-2 outline-accent" : "raised-sm"}`}
            >
              <input type="radio" name={name} value={companion} checked={chosen} disabled={disabled} onChange={() => onChange(companion)} className="sr-only" />
              {stills?.[companion] ? (
                <img src={stills[companion]} alt="" className="h-14 w-14" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center">
                  <CompanionBadge companion={companion} className="h-10 w-10 text-lg" />
                </span>
              )}
              <span className={`text-[11px] leading-tight ${chosen ? "font-semibold text-ink" : "text-muted"}`}>{COMPANION_NAMES[companion]}</span>
              <span className="sr-only">{t.companion.animals[companion]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
