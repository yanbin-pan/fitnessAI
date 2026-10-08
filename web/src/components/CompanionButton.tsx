import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CompanionView } from "../companions/CompanionView.tsx";
import { kcal10, thousands } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { COMPANION_NAMES, COMPANION_THRIVE_DAYS } from "../shared.ts";
import type { CompanionId, CompanionStatus } from "../shared.ts";

// The bubble opens under the day bar, as the calendar does, and leaves the bar usable.
const BELOW_BAR = "top-[calc(env(safe-area-inset-top)_+_4.25rem)]";

/** Why the companion looks as it does, in a sentence. */
function whyText(status: CompanionStatus, t: Messages): string {
  if (status.mood === "okay" && status.avg_kcal === null) return t.companion.why.fresh;
  return t.companion.why[status.mood];
}

/** The companion large, with its mood and the week behind it (2026-10-08 companions design §7). */
function CompanionBubble({ companion, status, onClose }: { companion: CompanionId; status: CompanionStatus; onClose: () => void }) {
  const t = useT();
  const name = COMPANION_NAMES[companion];
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const showAverage = status.mood !== "inactive" && status.avg_kcal !== null && status.avg_target_kcal !== null;
  const showStreak = status.mood === "okay" && status.okay_streak > 0;
  return createPortal(
    <>
      <div data-testid="companion-scrim" aria-hidden="true" onClick={onClose} className={`fixed inset-x-0 bottom-0 ${BELOW_BAR} z-40 bg-black/30`} />
      <div role="dialog" aria-label={name} className={`fixed inset-x-0 ${BELOW_BAR} z-50 mx-auto max-w-xl px-4`}>
        <div className="companion-pop raised max-w-sm rounded-3xl p-3">
          <div className="pressed relative h-64 overflow-hidden rounded-2xl">
            <CompanionView companion={companion} mood={status.mood} framing="full" interactive plinth className="h-full w-full" badgeClassName="m-auto h-24 w-24 text-4xl" />
            <span className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted">{t.companion.hint}</span>
            <button
              ref={closeButton}
              type="button"
              aria-label={t.companion.close}
              onClick={onClose}
              className="tap raised-sm absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-muted"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="px-1 pb-1 pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">{name}</h2>
              <span className="text-xs text-muted">{t.companion.animals[companion]}</span>
            </div>
            <p className="mt-1 text-sm font-semibold text-accent-ink">{t.companion.moods[status.mood]}</p>
            <p className="mt-1 text-sm">{whyText(status, t)}</p>
            {showAverage && (
              <p className="mt-2 text-xs text-muted tabular-nums">
                {t.companion.average(thousands(status.avg_kcal ?? 0, t), thousands(kcal10(status.avg_target_kcal ?? 0), t), t.units.kcal)}
              </p>
            )}
            {showStreak && (
              <div className="mt-2">
                <p className="text-xs text-muted">{t.companion.streak(status.okay_streak, COMPANION_THRIVE_DAYS)}</p>
                <div aria-hidden="true" className="pressed mt-1 h-2 overflow-hidden rounded-full">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(status.okay_streak / COMPANION_THRIVE_DAYS) * 100}%` }} />
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-muted">{t.companion.rule}</p>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** The day bar's top-left button: the companion in small, moving, and the bubble it opens. */
export function CompanionButton({ companion, status }: { companion: CompanionId; status: CompanionStatus }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t.companion.open(COMPANION_NAMES[companion], t.companion.moods[status.mood])}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`tap flex h-11 w-11 items-center justify-center overflow-hidden rounded-full ${open ? "pressed" : "raised-sm"}`}
        onClick={() => setOpen((was) => !was)}
      >
        {/* Held still while the bubble shows the same companion large. */}
        <CompanionView companion={companion} mood={status.mood} framing="mini" fps={30} paused={open} className="h-11 w-11" badgeClassName="h-9 w-9 text-base" />
      </button>
      {open && <CompanionBubble companion={companion} status={status} onClose={close} />}
    </>
  );
}
