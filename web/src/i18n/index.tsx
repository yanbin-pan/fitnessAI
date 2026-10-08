import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useProfile } from "../queries.ts";
import { COMPANIONS, COMPANION_NAMES, DEFAULT_COMPANION, LANGUAGES } from "../shared.ts";
import type { CompanionId, Language } from "../shared.ts";
import { de } from "./de.ts";
import { en } from "./en.ts";
import type { Messages } from "./en.ts";
import { es } from "./es.ts";
import { fr } from "./fr.ts";
import { it } from "./it.ts";
import { lt } from "./lt.ts";
import { zh } from "./zh.ts";

export type { Messages } from "./en.ts";
export { en };

export const MESSAGES: Record<Language, Messages> = { en, it, zh, lt, fr, de, es };

/** Each language by its own name, as the picker lists them: someone who can't read the current one still finds theirs. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  it: "Italiano",
  zh: "中文（简体）",
  lt: "Lietuvių",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
};

const STORAGE_KEY = "language";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** The language before the profile has loaded, or before there is one: the last one shown on this phone, else the phone's own, else English. */
export function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage can be blocked (a private window); the phone's language still works.
  }
  const tags = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const base = (tag ?? "").toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return "en";
}

function remember(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Only the next cold start's first paint depends on it.
  }
}

const COACH = COMPANION_NAMES[DEFAULT_COMPANION];

/** Every "Zabaione" in `value` as `name`, through nested groups and inside what a message function returns. */
function rename<T>(value: T, name: string): T {
  if (typeof value === "string") return value.replaceAll(COACH, name) as T;
  if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    // Only the message's own words: what it is given (another companion's name, say) stays as given.
    return ((...args: unknown[]) => {
      const held = args.map((arg, i) => (typeof arg === "string" ? `\uE000${i}\uE000` : arg));
      const out = rename(fn(...held), name);
      return typeof out === "string" ? out.replace(/\uE000(\d+)\uE000/g, (_all, i: string) => String(args[Number(i)])) : out;
    }) as T;
  }
  if (Array.isArray(value)) return value.map((inner) => rename(inner, name)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, rename(inner, name)])) as T;
  }
  return value;
}

/**
 * The messages with the person's companion as the coach (2026-10-08 companions design §7). The messages say
 * "Zabaione" wherever they mean the coach; the companion picked takes that name everywhere.
 */
export function withCompanion(messages: Messages, companion: CompanionId): Messages {
  return companion === DEFAULT_COMPANION ? messages : rename(messages, COMPANION_NAMES[companion]);
}

function isCompanion(value: unknown): value is CompanionId {
  return typeof value === "string" && (COMPANIONS as readonly string[]).includes(value);
}

interface I18n {
  language: Language;
  t: Messages;
  /** Shows the app in another language at once. Saving it to the profile is the settings screen's job. */
  choose: (language: Language) => void;
}

// Without a provider (most tests render a single screen) everything is English.
const I18nContext = createContext<I18n>({ language: "en", t: en, choose: () => {} });

/** Picks the app's language: the profile's once it has loaded, so every phone follows the choice; before that, this phone's own. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const profile = useProfile();
  const [chosen, setChosen] = useState<Language>(initialLanguage);
  // An older server sends no language.
  const saved = profile.data?.profile.language;
  const language = isLanguage(saved) ? saved : chosen;
  // An older server sends no companion: Zabaione then.
  const stored = profile.data?.profile.companion;
  const companion = isCompanion(stored) ? stored : DEFAULT_COMPANION;
  const t = useMemo(() => withCompanion(MESSAGES[language], companion), [language, companion]);
  useEffect(() => {
    document.documentElement.lang = t.locale;
    remember(language);
  }, [language, t]);
  return <I18nContext.Provider value={{ language, t, choose: setChosen }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

/** The words of the app in the chosen language. */
export function useT(): Messages {
  return useContext(I18nContext).t;
}
