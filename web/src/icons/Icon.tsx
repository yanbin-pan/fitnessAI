import { ICON_PATHS } from "./paths.ts";
import type { IconName } from "./paths.ts";

/** A Material Symbols icon in the current text colour. Decorative unless it has a label. */
export function Icon({ name, size = 20, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
