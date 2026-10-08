import type { CompanionMood } from "../shared.ts";

/** What the 3D companion is driven by (2026-10-08 companions design §6): a nutrition score and two flags. */
export interface MoodInput {
  /** 0–100: under 35 Sluggish, 35–69 Okay, 70 and up Thriving. */
  score: number;
  /** Asleep; wins over everything else. */
  inactive: boolean;
  /** Stuffed; wins over the score. */
  overfed: boolean;
}

/** Each mood as the prototype's presets show it. */
export function moodInput(mood: CompanionMood): MoodInput {
  switch (mood) {
    case "inactive":
      return { score: 55, inactive: true, overfed: false };
    case "sluggish":
      return { score: 20, inactive: false, overfed: false };
    case "thriving":
      return { score: 95, inactive: false, overfed: false };
    case "overfed":
      return { score: 55, inactive: false, overfed: true };
    default:
      return { score: 55, inactive: false, overfed: false };
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
