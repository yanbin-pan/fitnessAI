import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANGUAGES } from "../shared.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { LANGUAGE_NAMES, LanguageProvider, MESSAGES, en, initialLanguage, useT } from "./index.tsx";

/** Every string in a dictionary, with its path; a function is called with sample arguments. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") return [[path, String((value as (...args: unknown[]) => unknown)(3, 4, "x", "y"))]];
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => strings(item, path ? `${path}.${key}` : key));
  return [[path, ""]];
}

afterEach(() => {
  localStorage.clear();
});

describe("the dictionaries", () => {
  it("has every language the profile accepts, each named in itself", () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...LANGUAGES].sort());
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...LANGUAGES].sort());
  });

  it("fills every string in every language, with the same keys as English", () => {
    const english = strings(en).map(([path]) => path);
    for (const language of LANGUAGES) {
      const words = strings(MESSAGES[language]);
      expect(words.map(([path]) => path), language).toEqual(english);
      for (const [path, text] of words) expect(text.trim(), `${language} ${path}`).not.toBe("");
    }
  });

  it("translates the words, not only the keys", () => {
    for (const language of LANGUAGES.filter((l) => l !== "en")) {
      expect(MESSAGES[language].settings.title, language).not.toBe(en.settings.title);
      expect(MESSAGES[language].feed.emptyToday, language).not.toBe(en.feed.emptyToday);
    }
  });

  it("has a locale Intl can format with, one per language", () => {
    for (const language of LANGUAGES) {
      expect(Intl.DateTimeFormat.supportedLocalesOf([MESSAGES[language].locale]), language).toHaveLength(1);
      expect(MESSAGES[language].locale.startsWith(language), language).toBe(true);
    }
  });
});

describe("initialLanguage", () => {
  it("prefers the language last shown on this phone", () => {
    localStorage.setItem("language", "lt");
    expect(initialLanguage()).toBe("lt");
  });

  it("otherwise takes the phone's first language the app speaks, else English", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR", "de-AT", "fr"]);
    expect(initialLanguage()).toBe("de");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR", "ja"]);
    expect(initialLanguage()).toBe("en");
  });

  it("ignores a stored value it doesn't know", () => {
    localStorage.setItem("language", "klingon");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    expect(initialLanguage()).toBe("zh");
  });
});

function Title() {
  return <h1>{useT().settings.title}</h1>;
}

describe("LanguageProvider", () => {
  it("follows the profile's language, marks the page with it and remembers it for the next start", async () => {
    mockFetch(() => jsonResponse({ profile: { language: "es" }, calculated: {} }));
    renderWithProviders(
      <LanguageProvider>
        <Title />
      </LanguageProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Ajustes" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es-ES");
    expect(localStorage.getItem("language")).toBe("es");
  });

  it("uses this phone's language until there is a profile", async () => {
    localStorage.setItem("language", "fr");
    const fetch = mockFetch(() => jsonResponse({ error: "no_profile" }, 404));
    renderWithProviders(
      <LanguageProvider>
        <Title />
      </LanguageProvider>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Réglages" })).toBeInTheDocument();
  });

  it("keeps working with a server from before languages", async () => {
    localStorage.setItem("language", "it");
    mockFetch(() => jsonResponse({ profile: { sex: "male" }, calculated: {} }));
    const { client } = renderWithProviders(
      <LanguageProvider>
        <Title />
      </LanguageProvider>,
    );
    await waitFor(() => expect(client.getQueryState(["profile"])?.status).toBe("success"));
    expect(screen.getByRole("heading", { name: "Impostazioni" })).toBeInTheDocument();
  });
});
