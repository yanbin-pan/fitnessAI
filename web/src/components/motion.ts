import { useCallback, useEffect, useRef, useState } from "react";

/** How long a sheet takes to leave: faster than it came in (2026-11-03 design review). */
export const LEAVE_MS = 180;

/** Whether this browser runs animations at all: jsdom (the tests) has no Web Animations, so a close there is instant. */
function animates(): boolean {
  return typeof document !== "undefined" && typeof document.body?.animate === "function";
}

/**
 * Closes after the leave animation: `leaving` turns on (put it in `data-leaving`), and `onClose` runs once the sheet has
 * gone. Closing twice runs it once.
 */
export function useLeaving(onClose: () => void): [boolean, () => void] {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const leave = useCallback(() => {
    if (!animates()) {
      latest.current();
      return;
    }
    if (timer.current !== null) return;
    setLeaving(true);
    timer.current = setTimeout(() => latest.current(), LEAVE_MS);
  }, []);
  return [leaving, leave];
}

/** Calls `onEscape` when Escape is pressed anywhere, while mounted. */
export function useEscape(onEscape: () => void): void {
  const latest = useRef(onEscape);
  useEffect(() => {
    latest.current = onEscape;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

let locks = 0;
/**
 * Keeps the page behind still while a sheet is open (2026-11-03): a swipe inside the sheet, or past its end, scrolls the
 * sheet and never the chat underneath. Counted, so a sheet opened over another keeps the lock until both are gone.
 */
export function useScrollLock(): void {
  useEffect(() => {
    const root = document.documentElement;
    if (locks++ === 0) {
      root.style.overflow = "hidden";
      root.style.overscrollBehavior = "none";
    }
    return () => {
      if (--locks === 0) {
        root.style.overflow = "";
        root.style.overscrollBehavior = "";
      }
    };
  }, []);
}
