import type { CSSProperties } from "react";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import type { Activity } from "../shared.ts";

export interface Sport {
  label: string;
  /** For tight rows, such as the editor's picker. */
  short: string;
  icon: IconName;
  /** The pictogram's colour on the light base and on the dark base (spec §5.1); both reach 3:1 or more. */
  light: string;
  dark: string;
}

/** Every activity's name, short name, pictogram and soft colours (spec §5.1). */
export const SPORTS: Record<Activity, Sport> = {
  tennis: { label: "Tennis", short: "Tennis", icon: "sports_tennis", light: "#6E8B3D", dark: "#B5CF8A" },
  gym: { label: "Gym", short: "Gym", icon: "fitness_center", light: "#B5654A", dark: "#E7A58E" },
  wakeboarding: { label: "Wakeboarding", short: "Wake", icon: "surfing", light: "#4F7BB0", dark: "#9DBBE0" },
  kitesurfing: { label: "Kitesurfing", short: "Kite", icon: "kitesurfing", light: "#3E8C86", dark: "#8FCFC9" },
  padel: { label: "Padel", short: "Padel", icon: "padel", light: "#5F8A4A", dark: "#A9CF95" },
  badminton: { label: "Badminton", short: "Badminton", icon: "badminton", light: "#4A8A6A", dark: "#96CDB0" },
  running: { label: "Running", short: "Run", icon: "directions_run", light: "#A86C38", dark: "#E5B88A" },
  walking: { label: "Walking", short: "Walk", icon: "directions_walk", light: "#A0704A", dark: "#D8B394" },
  hiking: { label: "Hiking", short: "Hike", icon: "hiking", light: "#7E6A4F", dark: "#C8B497" },
  photography: { label: "Photography", short: "Photo", icon: "photo_camera", light: "#7A6F66", dark: "#C2B8AF" },
  cycling: { label: "Cycling", short: "Bike", icon: "directions_bike", light: "#9A7832", dark: "#E0C489" },
  skateboarding: { label: "Skateboarding", short: "Skateboard", icon: "skateboarding", light: "#8F7F45", dark: "#D2C48E" },
  swimming: { label: "Swimming", short: "Swim", icon: "pool", light: "#4A84A8", dark: "#97C3DD" },
  surfing: { label: "Surfing", short: "Surf", icon: "waves", light: "#3A8599", dark: "#8CCAD9" },
  rowing: { label: "Rowing", short: "Row", icon: "rowing", light: "#5670A8", dark: "#A3B5DE" },
  kayaking: { label: "Kayak and SUP", short: "Kayak", icon: "kayaking", light: "#3E7F8F", dark: "#8EC2CE" },
  sailing: { label: "Sailing", short: "Sail", icon: "sailing", light: "#4C6A9A", dark: "#9FB3D6" },
  diving: { label: "Diving", short: "Dive", icon: "scuba_diving", light: "#45608A", dark: "#98ABCC" },
  boxing: { label: "Boxing", short: "Boxing", icon: "sports_mma", light: "#B4554F", dark: "#E59C97" },
  martial_arts: { label: "Martial arts", short: "Martial", icon: "sports_martial_arts", light: "#9A5A55", dark: "#D8A39E" },
  yoga: { label: "Yoga and pilates", short: "Yoga", icon: "self_improvement", light: "#8A6FB0", dark: "#C5B3E0" },
  climbing: { label: "Climbing", short: "Climb", icon: "mountain_flag", light: "#857A6E", dark: "#C7BDB2" },
  football: { label: "Football", short: "Football", icon: "sports_soccer", light: "#5F68A8", dark: "#AAB0DE" },
  basketball: { label: "Basketball", short: "Basketball", icon: "sports_basketball", light: "#7B67A8", dark: "#BBADDD" },
  volleyball: { label: "Volleyball", short: "Volleyball", icon: "sports_volleyball", light: "#6E62A0", dark: "#B3AAD8" },
  rugby: { label: "Rugby", short: "Rugby", icon: "sports_rugby", light: "#665E96", dark: "#ADA6D2" },
  cricket: { label: "Cricket", short: "Cricket", icon: "sports_cricket", light: "#5E5A8C", dark: "#A8A4CC" },
  hockey: { label: "Hockey", short: "Hockey", icon: "sports_hockey", light: "#565E92", dark: "#A3A9D0" },
  skiing: { label: "Skiing", short: "Ski", icon: "downhill_skiing", light: "#5A86A3", dark: "#A6C4D8" },
  snowboarding: { label: "Snowboarding", short: "Snowboard", icon: "snowboarding", light: "#557C99", dark: "#A2BCD0" },
  skating: { label: "Skating", short: "Skating", icon: "ice_skating", light: "#4E728F", dark: "#9DB6CB" },
  golf: { label: "Golf", short: "Golf", icon: "sports_golf", light: "#4F7F55", dark: "#9CC6A1" },
  other: { label: "Other", short: "Other", icon: "interests", light: "#6F7785", dark: "#B7BECA" },
};

/** The owner's main sports, offered first wherever an activity is picked (spec §5.1). */
export const FEATURED: readonly Activity[] = ["tennis", "gym", "wakeboarding", "kitesurfing"];

/**
 * The activity's pictogram in its soft colour on a matte disc, raised from the surface (spec §11.4).
 * Named after the sport unless `labelled` is false.
 */
export function SportBadge({ activity, size = 36, labelled = true }: { activity: Activity; size?: number; labelled?: boolean }) {
  const sport = SPORTS[activity];
  // Both themes' colours ride along as variables; the dark: variant picks the dark one.
  const style = { "--sport-light": sport.light, "--sport-dark": sport.dark, width: size, height: size } as CSSProperties;
  return (
    <span
      className="raised-sm inline-flex shrink-0 items-center justify-center rounded-full text-(color:--sport-light) dark:text-(color:--sport-dark)"
      style={style}
    >
      <Icon name={sport.icon} size={Math.round(size * 0.58)} label={labelled ? sport.label : undefined} />
    </span>
  );
}
