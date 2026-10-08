import type { CompanionMood } from "../shared.ts";

/** What the 3D companion is driven by (2026-10-08 companions design §6): a nutrition score and two flags. */
export interface MoodInput {
  /** 0–100: under 35 Sluggish, 35–69 Okay, 70 and up Thriving. */
  score: number;
  /** Asleep; wins over everything else. */
  inactive: boolean;
  /** Stuffed; wins over the score. */
  overfed: boolean;
  /** Over the weekly alcohol guide: a woozy layer on top of any awake mood, hidden while asleep. */
  overAlcohol: boolean;
}

/** Each mood as the prototype's presets show it, with the alcohol layer on top when the week is over the guide. */
export function moodInput(mood: CompanionMood, overAlcohol = false): MoodInput {
  const base = { score: 55, inactive: false, overfed: false, overAlcohol };
  switch (mood) {
    case "inactive":
      return { ...base, inactive: true };
    case "sluggish":
      return { ...base, score: 20 };
    case "thriving":
      return { ...base, score: 95 };
    case "overfed":
      return { ...base, overfed: true };
    default:
      return base;
  }
}

/** Whether this phone can draw the companions. Without WebGL (an old phone, a test) the app shows a plain badge. */
export function canDraw3d(): boolean {
  if (typeof window === "undefined" || typeof WebGLRenderingContext === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
