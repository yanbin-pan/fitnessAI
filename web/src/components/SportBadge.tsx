import type { CSSProperties } from "react";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import type { SportName } from "../i18n/en.ts";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import type { Activity } from "../shared.ts";

export interface Sport {
  icon: IconName;
  /** The pictogram's colour on the light base and on the dark base (spec §5.1); both reach 3:1 or more. */
  light: string;
  dark: string;
}

/** Every activity's pictogram and soft colours (spec §5.1); its names are in each language's words (`sports`). */
export const SPORTS: Record<Activity, Sport> = {
  tennis: { icon: "sports_tennis", light: "#6E8B3D", dark: "#B5CF8A" },
  gym: { icon: "fitness_center", light: "#B5654A", dark: "#E7A58E" },
  wakeboarding: { icon: "surfing", light: "#4F7BB0", dark: "#9DBBE0" },
  kitesurfing: { icon: "kitesurfing", light: "#3E8C86", dark: "#8FCFC9" },
  padel: { icon: "padel", light: "#5F8A4A", dark: "#A9CF95" },
  badminton: { icon: "badminton", light: "#4A8A6A", dark: "#96CDB0" },
  running: { icon: "directions_run", light: "#A86C38", dark: "#E5B88A" },
  walking: { icon: "directions_walk", light: "#A0704A", dark: "#D8B394" },
  hiking: { icon: "hiking", light: "#7E6A4F", dark: "#C8B497" },
  photography: { icon: "photo_camera", light: "#7A6F66", dark: "#C2B8AF" },
  cycling: { icon: "directions_bike", light: "#9A7832", dark: "#E0C489" },
  skateboarding: { icon: "skateboarding", light: "#8F7F45", dark: "#D2C48E" },
  swimming: { icon: "pool", light: "#4A84A8", dark: "#97C3DD" },
  surfing: { icon: "waves", light: "#3A8599", dark: "#8CCAD9" },
  rowing: { icon: "rowing", light: "#5670A8", dark: "#A3B5DE" },
  kayaking: { icon: "kayaking", light: "#3E7F8F", dark: "#8EC2CE" },
  sailing: { icon: "sailing", light: "#4C6A9A", dark: "#9FB3D6" },
  diving: { icon: "scuba_diving", light: "#45608A", dark: "#98ABCC" },
  boxing: { icon: "sports_mma", light: "#B4554F", dark: "#E59C97" },
  martial_arts: { icon: "sports_martial_arts", light: "#9A5A55", dark: "#D8A39E" },
  yoga: { icon: "self_improvement", light: "#8A6FB0", dark: "#C5B3E0" },
  climbing: { icon: "mountain_flag", light: "#857A6E", dark: "#C7BDB2" },
  football: { icon: "sports_soccer", light: "#5F68A8", dark: "#AAB0DE" },
  basketball: { icon: "sports_basketball", light: "#7B67A8", dark: "#BBADDD" },
  volleyball: { icon: "sports_volleyball", light: "#6E62A0", dark: "#B3AAD8" },
  rugby: { icon: "sports_rugby", light: "#665E96", dark: "#ADA6D2" },
  cricket: { icon: "sports_cricket", light: "#5E5A8C", dark: "#A8A4CC" },
  hockey: { icon: "sports_hockey", light: "#565E92", dark: "#A3A9D0" },
  skiing: { icon: "downhill_skiing", light: "#5A86A3", dark: "#A6C4D8" },
  snowboarding: { icon: "snowboarding", light: "#557C99", dark: "#A2BCD0" },
  skating: { icon: "ice_skating", light: "#4E728F", dark: "#9DB6CB" },
  golf: { icon: "sports_golf", light: "#4F7F55", dark: "#9CC6A1" },
  other: { icon: "interests", light: "#6F7785", dark: "#B7BECA" },
};

/** An activity's sport, or Other's for a key this copy of the app doesn't know yet (a newer server can add activities). */
export function sportOf(activity: string): Sport {
  return (SPORTS as Record<string, Sport | undefined>)[activity] ?? SPORTS.other;
}

/** An activity's names in the chosen language, or Other's for a key this copy of the app doesn't know yet. */
export function sportName(activity: string, t: Messages): SportName {
  return (t.sports as Record<string, SportName | undefined>)[activity] ?? t.sports.other;
}

/** A family of the More grid; its name is in each language's words (`families`). */
export type FamilyKey = keyof Messages["families"];

/** Every activity in its family, each once, in the order the editor's More grid shows them (spec §11.1). */
export const FAMILIES: readonly { key: FamilyKey; activities: readonly Activity[] }[] = [
  { key: "racket", activities: ["tennis", "padel", "badminton"] },
  { key: "foot", activities: ["running", "walking", "hiking", "photography", "cycling", "skateboarding"] },
  { key: "water", activities: ["swimming", "surfing", "wakeboarding", "kitesurfing", "rowing", "kayaking", "sailing", "diving"] },
  { key: "gym", activities: ["gym", "boxing", "martial_arts", "yoga", "climbing"] },
  { key: "team", activities: ["football", "basketball", "volleyball", "rugby", "cricket", "hockey"] },
  { key: "snow", activities: ["skiing", "snowboarding", "skating"] },
  { key: "else", activities: ["golf", "other"] },
];

/**
 * The More grid for someone: their featured four as "Your sports", then every other activity in its family, so each
 * appears once (one radio per activity). A family with nothing left to show is left out: one the four have emptied, and
 * "Your sports" itself when there are none (an older server sends no featured row).
 */
export function familiesFor(featured: readonly Activity[]): { key: FamilyKey; activities: readonly Activity[] }[] {
  const rest = FAMILIES.map((family) => ({ key: family.key, activities: family.activities.filter((activity) => !featured.includes(activity)) }));
  return [{ key: "yours" as const, activities: featured }, ...rest].filter((family) => family.activities.length > 0);
}

/**
 * The activity's pictogram in its soft colour on a matte disc, raised from the surface (spec §11.4).
 * Named after the sport unless `labelled` is false. Pressed in when it is the chosen one.
 */
export function SportBadge({
  activity, size = 36, labelled = true, pressed = false,
}: { activity: Activity; size?: number; labelled?: boolean; pressed?: boolean }) {
  const t = useT();
  const sport = sportOf(activity);
  // Both themes' colours ride along as variables; the dark: variant picks the dark one.
  const style = { "--sport-light": sport.light, "--sport-dark": sport.dark, width: size, height: size } as CSSProperties;
  return (
    <span
      className={`${pressed ? "pressed" : "raised-sm"} inline-flex shrink-0 items-center justify-center rounded-full text-(color:--sport-light) dark:text-(color:--sport-dark)`}
      style={style}
    >
      <Icon name={sport.icon} size={Math.round(size * 0.58)} label={labelled ? sportName(activity, t).label : undefined} />
    </span>
  );
}
