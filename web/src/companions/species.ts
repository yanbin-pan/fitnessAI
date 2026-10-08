import type { CompanionId } from "../shared.ts";

// Each companion's build (2026-10-08 companions design §2), ported unchanged from the reference prototype
// (companions-prototype R7). One shared seated body plan; only the head, ears, muzzle, tail, palette and props differ.

export interface BodyPlan {
  tR: [number, number];
  haunchSc: [number, number, number];
  bibZ: number;
  legR: number;
}

export interface Species {
  fur: string;
  furDark: string;
  light: string;
  dark: string;
  ears: "round" | "big" | "tall" | "small" | "floppy" | "side";
  muzzle: "round" | "trunk" | "short" | "capy" | "snout" | "horse";
  tail: "stub" | "tuft" | "curl" | "none" | "curly" | "ringed" | "woolly" | "long";
  scale?: number;
  pawLight?: boolean;
  eyeX?: number;
  eyeY?: number;
  headScale?: [number, number, number];
  earScale?: number;
  earColor?: string;
  yuzu?: boolean;
  stripes?: string;
  wool?: string;
  legs?: string;
  mane?: string;
  blaze?: string;
  build?: Partial<BodyPlan>;
  /** Offsets the idle head sway, so no two companions move in step (the prototype's x position). */
  phase: number;
}

export const SPECIES: Record<CompanionId, Species> = {
  tiramisu: { phase: -4.2, fur: "#A96B42", furDark: "#945A35", light: "#D9B48C", dark: "#4E3020", ears: "round", muzzle: "round", tail: "stub" },
  "panna-cotta": {
    phase: -1.4, scale: 1.1, fur: "#A3A8BA", furDark: "#8E93A6", light: "#C9CDD9", dark: "#6E7386", ears: "big", muzzle: "trunk", tail: "tuft",
    pawLight: true, eyeY: 0.12, eyeX: 0.2, headScale: [1, 0.98, 0.95], build: { legR: 0.15 },
  },
  zabaione: {
    phase: 1.4, fur: "#D9884A", furDark: "#C27538", light: "#F3E3CA", dark: "#3A2E2A", ears: "tall", muzzle: "short", tail: "curl",
    pawLight: true, eyeX: 0.16, eyeY: 0.06, headScale: [1.04, 0.92, 0.95],
  },
  cannolo: {
    phase: 4.2, scale: 1.04, fur: "#B08360", furDark: "#9A6F4F", light: "#C9A280", dark: "#4A3326", ears: "small", muzzle: "capy", tail: "none",
    eyeY: 0.15, eyeX: 0.21, headScale: [0.95, 0.9, 1.1], yuzu: true, build: { tR: [0.38, 0.65], haunchSc: [1.15, 0.85, 1.25], bibZ: 0.26 },
  },
  bombolone: {
    phase: -4.9, fur: "#E9A3A0", furDark: "#D98B89", light: "#F5C9C2", dark: "#9E5957", ears: "floppy", muzzle: "snout", tail: "curly",
    headScale: [1.08, 0.95, 0.95],
  },
  sfogliatella: {
    phase: -1.63, fur: "#E8873A", furDark: "#D4752C", light: "#F6E7D0", dark: "#2E2523", stripes: "#3A2A24", ears: "round", muzzle: "round",
    tail: "ringed", pawLight: true,
  },
  meringa: {
    phase: 1.63, fur: "#EADFCF", furDark: "#DCCFBC", light: "#F2EADF", dark: "#4F4744", wool: "#F7F4EE", legs: "#5E5652", ears: "side",
    earColor: "#DCCFBC", muzzle: "round", tail: "woolly", headScale: [0.95, 1.0, 0.95],
  },
  cantuccio: {
    phase: 4.9, fur: "#9A5B36", furDark: "#86492A", light: "#B5774E", dark: "#2E1F17", mane: "#3E2A1E", ears: "tall", earScale: 0.75,
    muzzle: "horse", tail: "long", headScale: [0.9, 1.05, 1.05], eyeX: 0.19, eyeY: 0.1,
  },
};
