import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.ts";
import { CompanionBadge, CompanionView, useCompanionStills } from "../companions/CompanionView.tsx";
import { petColours } from "../companions/species.ts";
import { unitsText } from "./Drinks.tsx";
import { kcal10, thousands } from "../format.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { COMPANION_NAMES, COMPANION_THRIVE_DAYS } from "../shared.ts";
import type { CompanionId, CompanionInteractionInput, CompanionStatus } from "../shared.ts";
import { tapHaptic } from "../haptics.ts";
import { THEME_EVENT } from "../theme.ts";

/**
 * Tells the server about a pet or an open of the bubble, for the owner's dashboard (2026-10-08 companions design §8).
 * Best effort: offline or refused, it is simply not counted, and nothing is shown.
 */
export function reportInteraction(kind: CompanionInteractionInput["kind"]): void {
  void api<void>("/api/companion/interactions", { method: "POST", json: { kind } satisfies CompanionInteractionInput }).catch(() => {});
}

// The bubble opens under the day bar, as the calendar does, and leaves the bar usable.
const BELOW_BAR = "top-[calc(env(safe-area-inset-top)_+_4.25rem)]";

function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/** The theme on screen, including the system's while the choice is auto. */
function useShownTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribeTheme, () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
}

/** A window in the companion's own pastel (2026-10-20), with the plinth to match: the stage reads --nm-plinth from it. */
function usePetWash(companion: CompanionId): CSSProperties {
  const colours = petColours(companion, useShownTheme());
  return {
    background: `radial-gradient(120% 90% at 50% 15%, ${colours.top}, ${colours.bottom})`,
    ["--nm-plinth" as string]: colours.plinth,
  };
}

/** Why the companion looks as it does, in a sentence. */
function whyText(status: CompanionStatus, t: Messages): string {
  if (status.mood === "okay" && status.avg_kcal === null) return t.companion.why.fresh;
  return t.companion.why[status.mood];
}

/** The companion large, with its mood and the week behind it (2026-10-08 companions design §7). */
function CompanionBubble({ companion, status, onClose, origin }: { companion: CompanionId; status: CompanionStatus; onClose: () => void; origin?: HTMLElement | null }) {
  const t = useT();
  const name = COMPANION_NAMES[companion];
  const wash = usePetWash(companion);
  const card = useRef<HTMLDivElement>(null);
  // Opened from a message, it grows out of that message's avatar rather than the top-left corner.
  const [growFrom, setGrowFrom] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!origin || !card.current) return;
    const from = origin.getBoundingClientRect();
    const box = card.current.getBoundingClientRect();
    setGrowFrom(`${from.left + from.width / 2 - box.left}px ${from.top + from.height / 2 - box.top}px`);
  }, [origin]);
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
  // An older server sends no alcohol; asleep, the layer is hidden, so the bubble doesn't mention it either.
  const tipsy = status.over_alcohol === true && status.mood !== "inactive";
  return createPortal(
    <>
      <div data-testid="companion-scrim" aria-hidden="true" onClick={onClose} className={`fixed inset-x-0 bottom-0 ${BELOW_BAR} z-40 bg-black/30`} />
      <div role="dialog" aria-label={name} className={`fixed inset-x-0 ${BELOW_BAR} z-50 mx-auto max-w-xl px-4`}>
        <div ref={card} className="companion-pop raised max-w-sm rounded-3xl p-3" style={growFrom ? { transformOrigin: growFrom } : undefined}>
          <div className="pressed relative h-64 overflow-hidden rounded-2xl" style={wash}>
            <CompanionView
              companion={companion} mood={status.mood} overAlcohol={status.over_alcohol === true} framing="full" interactive plinth className="h-full w-full" badgeClassName="m-auto h-24 w-24 text-4xl"
              onPet={() => reportInteraction("pet")}
            />
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
            {tipsy && <p className="mt-1 text-sm text-danger">{t.companion.alcohol(unitsText(status.alcohol_units, t))}</p>}
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
        aria-label={t.companion.open(
          COMPANION_NAMES[companion],
          status.over_alcohol === true && status.mood !== "inactive" ? `${t.companion.moods[status.mood]}, ${t.companion.alcoholShort}` : t.companion.moods[status.mood],
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`tap flex h-11 w-11 items-center justify-center overflow-hidden rounded-full ${open ? "pressed" : "raised-sm"}`}
        onClick={() => {
          if (!open) reportInteraction("open");
          setOpen(!open);
        }}
      >
        {/* Held still while the bubble shows the same companion large. */}
        <CompanionView companion={companion} mood={status.mood} overAlcohol={status.over_alcohol === true} framing="mini" fps={30} paused={open} className="h-11 w-11" badgeClassName="h-9 w-9 text-base" />
      </button>
      {open && <CompanionBubble companion={companion} status={status} onClose={close} />}
    </>
  );
}

const HINT_SEEN_KEY = "fitnessai.companion-hint-seen";
const hintListeners = new Set<() => void>();

function readHintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

let hintSeen: boolean | null = null;

/** Once the companion has been peeked at or opened, the hint under the newest reply has done its job. */
function markHintSeen(): void {
  if (hintSeen === true) return;
  hintSeen = true;
  try {
    localStorage.setItem(HINT_SEEN_KEY, "1");
  } catch {
    // Without storage the hint just shows again on the next visit.
  }
  for (const listener of hintListeners) listener();
}

/** Whether to show "Hold … to peek, tap to open" under the newest reply: until the first peek or open. */
export function useHoldHint(): boolean {
  const seen = useSyncExternalStore(
    (onChange) => {
      hintListeners.add(onChange);
      return () => hintListeners.delete(onChange);
    },
    () => (hintSeen ??= readHintSeen()),
  );
  return !seen;
}

/** How long a press is held before the peek shows: about iOS's Haptic Touch. */
const PEEK_AFTER_MS = 350;

/** A glance at the companion, held open while the avatar is: small, moving, its mood and the streak. Let go to close. */
function CompanionPeek({ companion, status, anchor }: { companion: CompanionId; status: CompanionStatus; anchor: HTMLElement }) {
  const t = useT();
  const wash = usePetWash(companion);
  const at = anchor.getBoundingClientRect();
  const showStreak = status.mood === "okay" && status.okay_streak > 0;
  return createPortal(
    // A preview of what a tap opens, which says it all to a screen reader: this is for the eyes only.
    <div aria-hidden="true" data-testid="companion-peek" className="pointer-events-none fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[6px]" />
      <div
        className="companion-pop raised absolute w-56 rounded-3xl p-2"
        style={{ left: Math.max(8, at.left - 6), bottom: window.innerHeight - at.top + 10, transformOrigin: "1.5rem bottom" }}
      >
        <div className="pressed relative h-44 overflow-hidden rounded-2xl" style={wash}>
          <CompanionView companion={companion} mood={status.mood} overAlcohol={status.over_alcohol === true} framing="full" plinth className="h-full w-full" badgeClassName="m-auto h-20 w-20 text-3xl" />
        </div>
        <div className="flex items-baseline justify-between gap-2 px-1.5 pt-2">
          <span className="text-[15px] font-semibold">{COMPANION_NAMES[companion]}</span>
          <span className="text-sm font-semibold text-accent-ink">{t.companion.moods[status.mood]}</span>
        </div>
        {showStreak && (
          <div className="px-1.5 pb-1">
            <p className="text-xs text-muted">{t.companion.streak(status.okay_streak, COMPANION_THRIVE_DAYS)}</p>
            <div className="pressed mt-1 h-1.5 overflow-hidden rounded-full">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(status.okay_streak / COMPANION_THRIVE_DAYS) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The companion beside its own replies (2026-10-20): small, on a pastel of its colour. The newest one moves; older ones
 * hold a still, since every moving one is a WebGL canvas of its own. Hold it to peek, tap it to open the full window,
 * which grows out of it.
 */
export function CompanionAvatar({ companion, status, live }: { companion: CompanionId; status: CompanionStatus; live: boolean }) {
  const t = useT();
  const wash = usePetWash(companion);
  const stills = useCompanionStills();
  const [open, setOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  // A press that peeked ends there: the click that follows its release doesn't open the window too.
  const peeked = useRef(false);
  const stopTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopTimer, []);
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || open) return;
    peeked.current = false;
    stopTimer();
    timer.current = window.setTimeout(() => {
      peeked.current = true;
      setPeeking(true);
      tapHaptic();
      markHintSeen();
    }, PEEK_AFTER_MS);
  };
  const endPress = () => {
    stopTimer();
    setPeeking(false);
  };
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const mood = status.over_alcohol === true && status.mood !== "inactive" ? `${t.companion.moods[status.mood]}, ${t.companion.alcoholShort}` : t.companion.moods[status.mood];
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t.companion.open(COMPANION_NAMES[companion], mood)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`relative flex h-8 w-8 shrink-0 touch-manipulation select-none items-center justify-center rounded-full [-webkit-touch-callout:none] overflow-hidden ${open || peeking ? "pressed" : "raised-sm"}`}
        style={wash}
        onPointerDown={onPointerDown}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={endPress}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {
          if (peeked.current) {
            peeked.current = false;
            return;
          }
          reportInteraction("open");
          markHintSeen();
          setOpen(true);
        }}
      >
        <span className="flex h-8 w-8 items-center justify-center">
          {live ? (
            <CompanionView
              companion={companion} mood={status.mood} overAlcohol={status.over_alcohol === true} framing="face" fps={30} fidget paused={open || peeking}
              className="h-8 w-8" badgeClassName="h-7 w-7 text-xs"
            />
          ) : stills?.[companion] ? (
            <img src={stills[companion]} alt="" className="h-8 w-8 object-contain" />
          ) : (
            <CompanionBadge companion={companion} className="h-7 w-7 text-xs" />
          )}
        </span>
      </button>
      {peeking && button.current && <CompanionPeek companion={companion} status={status} anchor={button.current} />}
      {open && <CompanionBubble companion={companion} status={status} onClose={close} origin={button.current} />}
    </>
  );
}
