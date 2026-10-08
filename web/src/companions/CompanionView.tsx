import { useEffect, useRef, useState } from "react";
import type { CompanionId, CompanionMood } from "../shared.ts";
import { COMPANIONS, COMPANION_NAMES } from "../shared.ts";
import { canDraw3d, moodInput } from "./mood.ts";
import { SPECIES } from "./species.ts";
import type { Framing, Stage } from "./stage.ts";

let drawable: boolean | null = null;
/** Asked once: making a WebGL context to find out is not free. */
function drawable3d(): boolean {
  drawable ??= canDraw3d();
  return drawable;
}

/** A plain disc in the companion's colours with its initial, where the 3D view can't be drawn. */
export function CompanionBadge({ companion, className = "" }: { companion: CompanionId; className?: string }) {
  const species = SPECIES[companion];
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-full font-semibold ${className}`}
      style={{ backgroundColor: species.fur, color: species.light }}
    >
      {COMPANION_NAMES[companion].charAt(0)}
    </span>
  );
}

interface CompanionViewProps {
  companion: CompanionId;
  mood: CompanionMood;
  /** Over the weekly alcohol guide: woozy on top of the mood. */
  overAlcohol?: boolean;
  framing: Framing;
  /** Drag to turn, tap to pet. */
  interactive?: boolean;
  plinth?: boolean;
  fps?: number;
  /** Holds the last frame. */
  paused?: boolean;
  className?: string;
  /** The badge's size, where the 3D view can't be drawn. */
  badgeClassName?: string;
  /** Told each time a tap pets the companion. */
  onPet?: () => void;
}

/**
 * The 3D companion (2026-10-08 companions design §5). three.js loads with the first one shown; until then, and on a phone
 * without WebGL, the badge stands in. Decorative: whatever it shows, the text beside it says.
 */
export function CompanionView({
  companion, mood, overAlcohol = false, framing, interactive = false, plinth = false, fps, paused = false, className = "", badgeClassName = "", onPet,
}: CompanionViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(() => !drawable3d());
  // The latest values, for the stage that loads after them.
  const latest = useRef({ companion, mood, overAlcohol, paused, onPet });
  latest.current = { companion, mood, overAlcohol, paused, onPet };

  useEffect(() => {
    if (failed || !host.current) return;
    const element = host.current;
    let disposed = false;
    import("./stage.ts")
      .then(({ createStage }) => {
        if (disposed) return;
        const now = latest.current;
        stage.current = createStage(element, {
          companion: now.companion, mood: moodInput(now.mood, now.overAlcohol), framing, interactive, plinth, fps,
          // The latest callback, whenever the tap comes.
          onPet: () => latest.current.onPet?.(),
        });
        stage.current.setPaused(now.paused);
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      stage.current?.dispose();
      stage.current = null;
      setReady(false);
    };
  }, [failed, framing, interactive, plinth, fps]);

  useEffect(() => stage.current?.setMood(moodInput(mood, overAlcohol)), [mood, overAlcohol, ready]);
  useEffect(() => stage.current?.setCompanion(companion), [companion, ready]);
  useEffect(() => stage.current?.setPaused(paused), [paused, ready]);

  return (
    <div ref={host} aria-hidden="true" className={`flex ${className}`}>
      {(failed || !ready) && <CompanionBadge companion={companion} className={`${badgeClassName} ${failed ? "" : "opacity-0"}`} />}
    </div>
  );
}

let stills: Promise<Record<string, string>> | null = null;

/**
 * Stills of every companion for the picker's tiles, drawn once per app start. Null until they are ready, and for good
 * where they can't be drawn: the tiles then show the badges.
 */
export function useCompanionStills(): Record<string, string> | null {
  const [images, setImages] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!drawable3d()) return;
    let live = true;
    stills ??= import("./stage.ts").then(({ companionStills }) => companionStills(COMPANIONS, 192));
    stills.then((result) => live && setImages(result)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return images;
}
