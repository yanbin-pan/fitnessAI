import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_EVENT, chooseTheme, startTheme, storedTheme } from "./theme.ts";

/** A system setting the test can flip, as matchMedia("(prefers-color-scheme: dark)") reports it. */
function fakeSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return (next: boolean) => {
    dark = next;
    for (const listener of listeners) listener();
  };
}

const shown = () => document.documentElement.dataset.theme;
const barColour = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;

describe("theme", () => {
  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  });
  afterEach(() => {
    document.querySelector('meta[name="theme-color"]')?.remove();
    delete document.documentElement.dataset.theme;
    localStorage.clear();
  });

  it("starts on auto, following the system, and keeps following it", () => {
    const flip = fakeSystem(true);
    startTheme();
    expect(storedTheme()).toBe("auto");
    expect(shown()).toBe("dark");
    expect(barColour()).toBe("#262a31");
    flip(false);
    expect(shown()).toBe("light");
    expect(barColour()).toBe("#e4e9f0");
  });

  it("holds a chosen theme whatever the system does, and remembers it on this device", () => {
    const flip = fakeSystem(false);
    startTheme();
    chooseTheme("dark");
    expect(shown()).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    flip(true);
    flip(false);
    expect(shown()).toBe("dark");
    chooseTheme("light");
    flip(true);
    expect(shown()).toBe("light");
    // Back to auto: the system's setting again, at once.
    chooseTheme("auto");
    expect(shown()).toBe("dark");
  });

  it("reads back the stored choice, and anything unknown as auto", () => {
    localStorage.setItem("theme", "light");
    expect(storedTheme()).toBe("light");
    localStorage.setItem("theme", "sepia");
    expect(storedTheme()).toBe("auto");
  });

  it("tells the companion's stage only when the colours actually change", () => {
    fakeSystem(false);
    startTheme();
    const changed = vi.fn();
    window.addEventListener(THEME_EVENT, changed);
    chooseTheme("light");
    expect(changed).not.toHaveBeenCalled();
    chooseTheme("dark");
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(THEME_EVENT, changed);
  });
});
