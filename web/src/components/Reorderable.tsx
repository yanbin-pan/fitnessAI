import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

// A vertical list the person rearranges by its grips, in the manner of iOS: the held card lifts (a touch larger, a
// deeper shadow) and follows the finger, the others glide aside to open its slot, and on release it settles into the
// gap. The page scrolls on its own near the top and bottom edges. Arrow keys on a grip move its card by one.

const GAP = 16; // the cards' mt-4
const SLIDE = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)";
const EDGE = 90; // px from the top or bottom of the window where the page starts scrolling
const BOTTOM_BAR = 80; // the tab bar covers the window's last ~80px

interface Drag {
  id: string;
  from: number;
  over: number;
  /** Pointer y and page scroll when the card was picked up. */
  startY: number;
  startScroll: number;
  y: number;
  /** Where the card is drawn, from where it was laid out. */
  dy: number;
  /** Every card's box when the drag began, in the order shown then. */
  rects: { top: number; bottom: number; height: number }[];
  dropping: boolean;
}

export interface Grip {
  /** Spread onto the grip button. */
  props: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    style: { touchAction: "none"; cursor: string };
  };
  held: boolean;
}

function scroller(): Element | null {
  return typeof document === "undefined" ? null : document.scrollingElement;
}

function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Haptics are a nicety.
  }
}

/** Where the held card would land: how many of the others sit above its middle. */
function slotFor(drag: Drag): number {
  const box = drag.rects[drag.from];
  const middle = box.top + box.height / 2 + drag.dy;
  return drag.rects.filter((r, i) => i !== drag.from && r.top + r.height / 2 < middle).length;
}

/** How far the card at `index` steps aside while the held one hovers over `over`. */
function shiftFor(drag: Drag, index: number): number {
  const step = drag.rects[drag.from].height + GAP;
  if (drag.from < drag.over && index > drag.from && index <= drag.over) return -step;
  if (drag.over < drag.from && index >= drag.over && index < drag.from) return step;
  return 0;
}

export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function Reorderable({ ids, onReorder, children }: { ids: readonly string[]; onReorder: (ids: string[]) => void; children: (id: string, grip: Grip) => ReactNode }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  // For one frame after a drop the cards jump to their new places with no transition, so nothing slides twice.
  const [settling, setSettling] = useState(false);
  const live = useRef<Drag | null>(null);
  const boxes = useRef(new Map<string, HTMLDivElement>());
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (next: Drag | null) => {
    live.current = next;
    setDrag(next);
  };

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** Follow the pointer (and any scrolling since the pickup), and buzz when the gap moves. */
  const follow = (y: number) => {
    const current = live.current;
    if (!current || current.dropping) return;
    const scrolled = (scroller()?.scrollTop ?? 0) - current.startScroll;
    const next = { ...current, y, dy: y - current.startY + scrolled };
    next.over = slotFor(next);
    if (next.over !== current.over) buzz();
    update(next);
  };

  /** Near an edge, scroll the page a little each frame while the card is held. */
  const autoscroll = () => {
    const current = live.current;
    const page = scroller();
    if (!current || current.dropping || !page) return;
    const height = window.innerHeight;
    const top = current.y - EDGE;
    const bottom = current.y - (height - BOTTOM_BAR - EDGE);
    const speed = top < 0 ? Math.max(-14, top / 6) : bottom > 0 ? Math.min(14, bottom / 6) : 0;
    if (speed !== 0) {
      const before = page.scrollTop;
      page.scrollTop = before + speed;
      if (page.scrollTop !== before) follow(current.y);
    }
    frame.current = requestAnimationFrame(autoscroll);
  };

  const pickUp = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (live.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rects = ids.map((each) => {
      const box = boxes.current.get(each)?.getBoundingClientRect();
      return { top: box?.top ?? 0, bottom: box?.bottom ?? 0, height: box?.height ?? 0 };
    });
    const from = ids.indexOf(id);
    buzz();
    update({ id, from, over: from, startY: event.clientY, startScroll: scroller()?.scrollTop ?? 0, y: event.clientY, dy: 0, rects, dropping: false });
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(autoscroll);
  };

  const drop = () => {
    const current = live.current;
    if (!current || current.dropping) return;
    cancelAnimationFrame(frame.current);
    const { from, over, rects } = current;
    // Glide into the gap first, then reorder underneath without a visible jump. Both offsets are from the layout at
    // pickup, so scrolling in between changes neither.
    const target = over > from ? rects[over].bottom - rects[from].bottom : over < from ? rects[over].top - rects[from].top : 0;
    update({ ...current, dy: target, dropping: true });
    timer.current = setTimeout(() => {
      setSettling(true);
      if (over !== from) onReorder(moved(ids, from, over));
      update(null);
      requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
    }, 240);
  };

  const step = (id: string, by: number) => {
    const from = ids.indexOf(id);
    const to = Math.max(0, Math.min(ids.length - 1, from + by));
    if (to !== from) onReorder(moved(ids, from, to));
  };

  return (
    <>
      {ids.map((id, index) => {
        const held = drag?.id === id;
        const shift = drag && !held ? shiftFor(drag, index) : 0;
        const grip: Grip = {
          held,
          props: {
            onPointerDown: (event) => pickUp(id, event),
            onPointerMove: (event) => {
              if (live.current?.id === id) follow(event.clientY);
            },
            onPointerUp: () => drop(),
            onPointerCancel: () => drop(),
            onKeyDown: (event) => {
              if (event.key === "ArrowUp") step(id, -1);
              else if (event.key === "ArrowDown") step(id, 1);
              else return;
              event.preventDefault();
            },
            style: { touchAction: "none", cursor: held ? "grabbing" : "grab" },
          },
        };
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) boxes.current.set(id, el);
              else boxes.current.delete(id);
            }}
            className="relative mt-4"
            data-held={held || undefined}
            style={{
              transform: held ? `translate3d(0, ${drag.dy}px, 0)` : shift ? `translate3d(0, ${shift}px, 0)` : undefined,
              transition: settling || (held && !drag.dropping) ? "none" : SLIDE,
              zIndex: held ? 20 : undefined,
              willChange: drag ? "transform" : undefined,
            }}
          >
            <div
              className="rounded-3xl"
              style={{
                transform: held && !drag.dropping ? "scale(1.03)" : undefined,
                boxShadow: held && !drag.dropping ? "0 18px 40px -8px rgb(0 0 0 / 0.28)" : undefined,
                transition: "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 200ms ease",
              }}
            >
              {children(id, grip)}
            </div>
          </div>
        );
      })}
    </>
  );
}
