import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "../icons/paths.ts";
import { ACTIVITIES } from "../shared.ts";
import { FEATURED, SPORTS, SportBadge } from "./SportBadge.tsx";

const channel = (hex: string, i: number) => {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("SportBadge", () => {
  it("is named after its sport, unless its caller names it", () => {
    const { rerender } = render(<SportBadge activity="wakeboarding" />);
    expect(screen.getByRole("img", { name: "Wakeboarding" })).toBeInTheDocument();
    // The activity picker puts the sport's name on the button around the badge, so the badge itself stays quiet.
    rerender(<SportBadge activity="wakeboarding" labelled={false} />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws the pictogram in its soft colour for each theme on a matte disc, with no coloured fill", () => {
    const { container } = render(<SportBadge activity="cycling" />);
    const disc = container.firstElementChild as HTMLElement;
    expect(disc).toHaveClass("raised-sm", "text-(color:--sport-light)", "dark:text-(color:--sport-dark)");
    expect(disc.style.getPropertyValue("--sport-light")).toBe("#9A7832");
    expect(disc.style.getPropertyValue("--sport-dark")).toBe("#E0C489");
    expect(disc.style.backgroundColor).toBe("");
  });

  it("has a name, a short name, its own pictogram and both colours for every activity", () => {
    for (const activity of ACTIVITIES) {
      const sport = SPORTS[activity];
      expect(sport.label, activity).not.toBe("");
      expect(sport.short, activity).not.toBe("");
      expect(ICON_PATHS[sport.icon], activity).toBeDefined();
      expect(sport.light, activity).toMatch(/^#[0-9A-F]{6}$/);
      expect(sport.dark, activity).toMatch(/^#[0-9A-F]{6}$/);
    }
    const icons = ACTIVITIES.map((activity) => SPORTS[activity].icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("keeps every pictogram at 3:1 or more against the base colour in both themes", () => {
    for (const activity of ACTIVITIES) {
      expect(contrast(SPORTS[activity].light, "#E4E9F0"), activity).toBeGreaterThanOrEqual(3);
      expect(contrast(SPORTS[activity].dark, "#262A31"), activity).toBeGreaterThanOrEqual(3);
    }
  });

  it("features the owner's four sports", () => {
    expect(FEATURED).toEqual(["tennis", "gym", "wakeboarding", "kitesurfing"]);
  });
});
