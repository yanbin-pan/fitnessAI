import { isTimeZone } from "./shared.ts";

export interface ZoneOption {
  value: string;
  label: string;
}

export interface ZoneGroup {
  region: string;
  zones: ZoneOption[];
}

/** The phone's own timezone, when the browser names a valid one. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** "UTC+8", "UTC−3:30" or "UTC" for a zone at `now`. */
function offsetOf(zone: string, now: Date): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
    return name ? name.replace(/^GMT/, "UTC").replace("-", "−") : "";
  } catch {
    return "";
  }
}

/** "Buenos Aires (Argentina)" for "America/Argentina/Buenos_Aires", "London" for "Europe/London". */
function placeOf(zone: string): string {
  const [, ...rest] = zone.split("/");
  const parts = (rest.length > 0 ? rest : [zone]).map((part) => part.replaceAll("_", " "));
  const city = parts.at(-1) ?? zone;
  return parts.length > 1 ? `${city} (${parts.slice(0, -1).join(", ")})` : city;
}

/**
 * Every timezone the browser knows, grouped by region (Africa, America, Asia, …) and labelled with its city and current
 * offset, for a picker. `current` is always offered, even when the browser does not list it. Null when the browser
 * cannot list its timezones (iOS before 15.4), so the form falls back to typing one.
 */
export function timeZoneGroups(current: string, now = new Date()): ZoneGroup[] | null {
  if (typeof Intl.supportedValuesOf !== "function") return null;
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  if (current && isTimeZone(current)) zones.add(current);
  const groups = new Map<string, ZoneOption[]>();
  for (const zone of zones) {
    const region = zone.includes("/") ? zone.split("/")[0] : "Other";
    const offset = offsetOf(zone, now);
    const label = offset ? `${placeOf(zone)} (${offset})` : placeOf(zone);
    groups.set(region, [...(groups.get(region) ?? []), { value: zone, label }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
    .map(([region, options]) => ({ region, zones: options.sort((a, b) => a.label.localeCompare(b.label)) }));
}
