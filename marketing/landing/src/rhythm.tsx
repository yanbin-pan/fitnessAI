import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { MoodInput } from "@app/companions/mood.ts";

// "Two weeks with Zabaione": a three-lane rhythm game. Fourteen days scroll down towards a line in about a minute.
// Food notes are meals, Move notes are workouts, and gold bands on Friday and Saturday evenings are the social slots
// where a drink or two fills the Fun meter. The companion's mood follows a rolling 7-day window, like the real app:
// missed meals droop it (Sluggish), snacking between notes stuffs it, and drinks outside the slots make it tipsy.
// Win: Thriving on day 14 with Fun at least half full.

export const DAY_MS = 4000;
export const DAYS = 14;
const LEAD_MS = 2200;              // notes appear before day 1 starts
const LOOK_MS = 1900;              // how far ahead the highway shows
const HIT_MS = 230;                // tap window either side of a note
const TIPSY_HIT_MS = 150;          // a tipsy companion is harder to steer
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FUN_PER_DRINK = 11, FUN_PER_MOVE = 3, FUN_WIN = 50;

export type Lane = "food" | "move" | "drink";
export const LANES: { id: Lane; label: string; icon: string; key: string }[] = [
  { id: "food", label: "Food", icon: "🍝", key: "A" },
  { id: "move", label: "Move", icon: "🏃", key: "S" },
  { id: "drink", label: "Drinks", icon: "🍷", key: "D" },
];

interface Note { lane: "food" | "move"; t: number; day: number; state: "open" | "hit" | "miss" }
interface Slot { t0: number; t1: number; day: number; drinks: number }

function schedule() {
  const notes: Note[] = [];
  const slots: Slot[] = [];
  for (let d = 0; d < DAYS; d++) {
    const at = (f: number) => d * DAY_MS + f * DAY_MS;
    for (const f of [0.12, 0.42, 0.72]) notes.push({ lane: "food", t: at(f), day: d, state: "open" });
    const wd = d % 7;
    if (wd === 0 || wd === 2 || wd === 4 || wd === 6) notes.push({ lane: "move", t: at(wd === 6 ? 0.28 : 0.57), day: d, state: "open" });
    if (wd === 4 || wd === 5) slots.push({ t0: at(0.8), t1: at(0.97), day: d, drinks: 0 });
  }
  return { notes, slots };
}

interface Stats { food: number[]; meal: number[]; move: number[]; tipsy: number; fun: number; combo: number; best: number }
const freshStats = (): Stats => ({ food: Array(DAYS).fill(0), meal: Array(DAYS).fill(0), move: Array(DAYS).fill(0), tipsy: 0, fun: 0, combo: 0, best: 0 });

export type Verdict = { label: string; input: MoodInput; tipsy: boolean };

/** The companion's mood from the last 7 game days, counting only notes that have already reached the line. */
function judge(notes: Note[], s: Stats, now: number): Verdict {
  const day = Math.max(0, Math.min(DAYS - 1, Math.floor(now / DAY_MS)));
  const from = Math.max(0, day - 6);
  let eaten = 0, onTime = 0, meals = 0, moved = 0, moves = 0;
  for (let d = from; d <= day; d++) { eaten += s.food[d]; onTime += s.meal[d]; moved += s.move[d]; }
  for (const n of notes) {
    if (n.day < from || n.day > day || n.t > now + HIT_MS) continue;
    if (n.lane === "food") meals++; else moves++;
  }
  const tipsy = s.tipsy >= 2;
  if (meals < 2) return { label: tipsy ? "Tipsy" : "Okay", input: { score: 55, inactive: false, overfed: false, overAlcohol: tipsy }, tipsy };
  const ratio = eaten / meals;
  const moveShare = moves ? moved / moves : 0.6;
  const overfed = ratio > 1.3;
  let score = 10 + 50 * Math.max(0, 1 - Math.abs(ratio - 1) * 2.5) + 40 * moveShare;
  if (ratio < 0.7) score = Math.min(score, 25);
  if (onTime / meals < 0.6) score = Math.min(score, 60);   // grazing all day is not a routine
  score = Math.round(Math.max(0, Math.min(100, score)));
  const label = tipsy ? "Tipsy" : overfed ? "Stuffed" : score >= 70 ? "Thriving" : score < 35 ? "Sluggish" : "Okay";
  return { label, input: { score, inactive: false, overfed, overAlcohol: tipsy }, tipsy };
}

interface Pop { id: number; lane: Lane; text: string; tone: "good" | "meh" | "fun" | "warn" }

export function useRhythm() {
  const [phase, setPhase] = useState<"idle" | "play" | "done">("idle");
  const [now, setNow] = useState(-LEAD_MS);
  const [pops, setPops] = useState<Pop[]>([]);
  const game = useRef(schedule());
  const stats = useRef(freshStats());
  const clock = useRef({ start: 0, paused: 0, hiddenAt: 0 });
  const lastDay = useRef(-1);
  const popId = useRef(0);

  const pop = useCallback((lane: Lane, text: string, tone: Pop["tone"]) => {
    const id = ++popId.current;
    setPops((p) => [...p.slice(-5), { id, lane, text, tone }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 700);
  }, []);

  const start = useCallback(() => {
    game.current = schedule();
    stats.current = freshStats();
    lastDay.current = -1;
    clock.current = { start: performance.now() + LEAD_MS, paused: 0, hiddenAt: 0 };
    setNow(-LEAD_MS);
    setPops([]);
    setPhase("play");
  }, []);

  // The clock: time never stops while the tab is visible.
  useEffect(() => {
    if (phase !== "play") return;
    let raf = 0;
    const tick = () => {
      const t = performance.now() - clock.current.start - clock.current.paused;
      const s = stats.current;
      for (const n of game.current.notes) {
        if (n.state === "open" && t > n.t + HIT_MS) {
          n.state = "miss";
          if (s.combo > 0) s.combo = 0;
        }
      }
      const day = Math.floor(t / DAY_MS);
      if (day > lastDay.current) { if (lastDay.current >= 0 && s.tipsy > 0) s.tipsy--; lastDay.current = day; }
      setNow(t);
      if (t >= DAYS * DAY_MS) { setPhase("done"); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const vis = () => {
      if (document.hidden) clock.current.hiddenAt = performance.now();
      else if (clock.current.hiddenAt) { clock.current.paused += performance.now() - clock.current.hiddenAt; clock.current.hiddenAt = 0; }
    };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", vis); };
  }, [phase]);

  const tap = useCallback((lane: Lane) => {
    if (phase !== "play") return;
    const t = performance.now() - clock.current.start - clock.current.paused;
    if (t < 0) return;
    const s = stats.current;
    const day = Math.min(DAYS - 1, Math.floor(t / DAY_MS));
    const win = s.tipsy >= 2 ? TIPSY_HIT_MS : HIT_MS;
    if (lane === "drink") {
      const slot = game.current.slots.find((x) => t >= x.t0 - 120 && t <= x.t1 + 120);
      if (slot && slot.drinks < 2) { slot.drinks++; s.fun = Math.min(100, s.fun + FUN_PER_DRINK); pop(lane, "Cheers!", "fun"); }
      else if (slot) { slot.drinks++; s.tipsy++; pop(lane, "One too many", "warn"); }
      else { s.tipsy++; pop(lane, s.tipsy >= 2 ? "Tipsy…" : "Not the time", "warn"); }
      return;
    }
    let best: Note | null = null;
    for (const n of game.current.notes) {
      if (n.lane !== lane || n.state !== "open") continue;
      if (Math.abs(n.t - t) <= win && (!best || Math.abs(n.t - t) < Math.abs(best.t - t))) best = n;
    }
    if (best) {
      best.state = "hit";
      s.combo++; s.best = Math.max(s.best, s.combo);
      if (lane === "food") { s.food[best.day]++; s.meal[best.day]++; pop(lane, Math.abs(best.t - t) < 90 ? "Perfect" : "Nice", "good"); }
      else { s.move[best.day]++; s.fun = Math.min(100, s.fun + FUN_PER_MOVE); pop(lane, "Strong!", "good"); }
    } else if (lane === "food") {
      s.food[day] += 1.5; s.combo = 0; pop(lane, "Snack", "meh");
    } else {
      pop(lane, "Warm-up", "meh");
    }
  }, [phase, pop]);

  // Keys: A S D, J K L, or the arrow keys.
  useEffect(() => {
    if (phase !== "play") return;
    const map: Record<string, Lane> = { a: "food", s: "move", d: "drink", j: "food", k: "move", l: "drink", arrowleft: "food", arrowdown: "move", arrowright: "drink" };
    const on = (e: KeyboardEvent) => {
      const lane = map[e.key.toLowerCase()];
      if (!lane || e.repeat || e.metaKey || e.ctrlKey) return;
      e.preventDefault(); tap(lane);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [phase, tap]);

  const verdict = judge(game.current.notes, stats.current, phase === "idle" ? -1 : Math.min(now, DAYS * DAY_MS - 1));
  const s = stats.current;
  const won = phase === "done" && verdict.label === "Thriving" && s.fun >= FUN_WIN;
  return { phase, now, pops, notes: game.current.notes, slots: game.current.slots, stats: s, verdict, won, start, tap };
}

export type Rhythm = ReturnType<typeof useRhythm>;

export function dayLabel(now: number) {
  if (now < 0) return "Get ready";
  const d = Math.min(DAYS - 1, Math.floor(now / DAY_MS));
  return `Week ${d < 7 ? 1 : 2} · ${WEEKDAYS[d % 7]}`;
}

/** The highway: lanes, falling notes, gold social bands and the hit line. */
export function Highway({ g, sway }: { g: Rhythm; sway: boolean }) {
  const lo = g.now - 400, hi = g.now + LOOK_MS;
  const y = (t: number) => `${(1 - (t - g.now) / LOOK_MS) * 84}%`;   // hit line sits at 84%
  return (
    <div className={`hw inset ${sway ? "sway" : ""}`} aria-hidden="true">
      {LANES.map((l, i) => (
        <div key={l.id} className={`hw-lane l-${l.id}`} style={{ left: `${(i * 100) / 3}%` }}>
          {l.id === "drink" && g.slots.filter((s) => s.t1 > lo && s.t0 < hi).map((s) => (
            <span key={s.t0} className="hw-slot" style={{ top: y(s.t1), height: `${((s.t1 - s.t0) / LOOK_MS) * 84}%` }}><i>Social</i></span>
          ))}
          {g.notes.filter((n) => n.lane === l.id && n.t > lo && n.t < hi && n.state !== "hit").map((n) => (
            <span key={n.t} className={`hw-note ${n.state}`} style={{ top: y(n.t) }}>{l.icon}</span>
          ))}
          {g.pops.filter((p) => p.lane === l.id).map((p) => <span key={p.id} className={`hw-pop ${p.tone}`}>{p.text}</span>)}
        </div>
      ))}
      <div className="hw-line" />
    </div>
  );
}

export function Pads({ g }: { g: Rhythm }) {
  return (
    <div className="pads">
      {LANES.map((l) => (
        <button key={l.id} className={`pad l-${l.id}`} onPointerDown={(e) => { e.preventDefault(); g.tap(l.id); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); g.tap(l.id); } }}
          aria-label={`${l.label} (key ${l.key})`} disabled={g.phase !== "play"}>
          <span aria-hidden="true">{l.icon}</span><b>{l.label}</b><kbd>{l.key}</kbd>
        </button>
      ))}
    </div>
  );
}

export function Meter({ label, value, children }: { label: string; value: number; children?: ReactNode }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="meter-bar inset-sm" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
        <i style={{ width: `${value}%` }} /><em style={{ left: `${FUN_WIN}%` }} />
      </div>
      {children}
    </div>
  );
}

export { FUN_WIN };
