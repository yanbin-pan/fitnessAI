import { useSyncExternalStore } from "react";

// Light, dark, or the phone's own setting (spec §11.4). Chosen per device, like the screen it is for: kept in the
// browser, not the profile. index.html sets the theme before the first paint from the same key; this keeps it current.

export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "theme";
/** The browser's bar colour for each theme: the surface, --nm-base. */
const BAR_COLOURS = { light: "#e4e9f0", dark: "#262a31" } as const;
/** Fired on window whenever the theme in use changes, for what draws its colours outside CSS (the companion's plinth). */
export const THEME_EVENT = "themechange";

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function storedTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

function systemDark(): MediaQueryList | null {
  return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
}

/** What the page shows for `theme`: auto follows the system. */
export function resolvedTheme(theme: Theme): "light" | "dark" {
  if (theme !== "auto") return theme;
  return systemDark()?.matches ? "dark" : "light";
}

function apply(theme: Theme): void {
  const shown = resolvedTheme(theme);
  const root = document.documentElement;
  if (root.dataset.theme === shown) return;
  root.dataset.theme = shown;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = BAR_COLOURS[shown];
  window.dispatchEvent(new Event(THEME_EVENT));
}

let current: Theme = "auto";
const listeners = new Set<() => void>();

/** Applies the stored theme and follows the system while it is auto. Once, at start. */
export function startTheme(): void {
  current = storedTheme();
  apply(current);
  systemDark()?.addEventListener?.("change", () => apply(current));
}

export function chooseTheme(theme: Theme): void {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing: it holds for this visit.
  }
  apply(theme);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen theme (auto, light or dark), and a way to change it. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  return [useSyncExternalStore(subscribe, () => current), chooseTheme];
}
