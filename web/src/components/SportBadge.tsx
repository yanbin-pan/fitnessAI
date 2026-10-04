import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import type { Activity } from "../shared.ts";

/** Each activity's name, a short form for tight rows, its pictogram and its badge colour (spec §5.1). */
export const SPORTS: Record<Activity, { label: string; short: string; icon: IconName; color: string }> = {
  tennis: { label: "Tennis", short: "Tennis", icon: "sports_tennis", color: "#8DB82F" },
  gym: { label: "Gym", short: "Gym", icon: "fitness_center", color: "#E8735A" },
  wakeboarding: { label: "Wakeboarding", short: "Wake", icon: "surfing", color: "#3B82F6" },
  kitesurfing: { label: "Kitesurfing", short: "Kite", icon: "kitesurfing", color: "#14A39A" },
  other: { label: "Other", short: "Other", icon: "directions_run", color: "#64748B" },
};

/** The activity's pictogram on its colour, raised from the surface. Named after the sport unless `labelled` is false. */
export function SportBadge({ activity, size = 36, labelled = true }: { activity: Activity; size?: number; labelled?: boolean }) {
  const sport = SPORTS[activity];
  return (
    <span
      className="raised-sm inline-flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ backgroundColor: sport.color, width: size, height: size }}
    >
      <Icon name={sport.icon} size={Math.round(size * 0.58)} label={labelled ? sport.label : undefined} />
    </span>
  );
}
