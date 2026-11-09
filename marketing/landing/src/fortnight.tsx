import { useCallback, useEffect, useRef, useState } from "react";
import type { MoodInput } from "@app/companions/mood.ts";

// "Two weeks with Zabaione": a balance game. Fourteen days pass in about a minute, with the sun crossing the sky
// each day. Three meters drain over time: Fuel (calories), Looksmaxxing (exercise) and Vibes (fun). You choose
// when to eat, train or have a drink, each with a cooldown and side effects, and try to keep all three in the
// green "maxxed" band without going over. Daily events change the rules a little. Win: enough time in the band
// on all three.

export const DAYS = 14;
const WAKE = 7, SLEEP = 23, AWAKE_H = SLEEP - WAKE;   // the visible day, 07:00 to 23:00
const HOUR_MS = 270;                                    // one game hour
const NIGHT_MS = 500;                                   // a short night between days
export const DAY_MS = AWAKE_H * HOUR_MS + NIGHT_MS;
const LEAD_MS = 1600;
export const ZONE: [number, number] = [65, 90];
const WIN_SHARE = 0.55;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type Meter = "fuel" | "looks" | "vibes";
export type Action = "food" | "move" | "drink";
export const METERS: { id: Meter; label: string; states: [string, string, string, string] }[] = [
  { id: "fuel", label: "Fuel", states: ["Running on empty", "Peckish", "Fuelled", "Food coma"] },
  { id: "looks", label: "Looksmaxxing", states: ["Mid", "Warming up", "Mogging", "Cooked"] },
  { id: "vibes", label: "Vibes", states: ["NPC mode", "Lowkey", "Main character", "Unhinged"] },
];
export const ACTIONS: { id: Action; label: string; icon: string; key: string; cool: number }[] = [
  { id: "food", label: "Eat", icon: "🍝", key: "A", cool: 2 },
  { id: "move", label: "Train", icon: "🏋️", key: "S", cool: 4 },
  { id: "drink", label: "Drink", icon: "🍷", key: "D", cool: 1 },
];
const MEALS: [number, number, string][] = [[7, 9.5, "🍳"], [12, 14, "🥪"], [19, 21, "🍝"]];
const FOODS = ["🍳", "🥑", "🥗", "🍝", "🍗", "🐟", "🍚", "🥦", "🍎", "🥪"];
const DRINK_FROM = 18;

interface Mods { foodFuel: number; exLooks: number; exVibes: number; drinkVibes: number; vibesDecay: number; fuelDecay: number }
const BASE: Mods = { foodFuel: 1, exLooks: 1, exVibes: 1, drinkVibes: 1, vibesDecay: 1, fuelDecay: 1 };
export interface DayEvent { icon: string; text: string; mods: Partial<Mods> }
const EVENTS: DayEvent[] = [
  { icon: "🎂", text: "Birthday party tonight: drinks bring extra vibes", mods: { drinkVibes: 1.6 } },
  { icon: "🍕", text: "Pizza day at work: meals hit harder", mods: { foodFuel: 1.4 } },
  { icon: "🦵", text: "Leg day soreness: training counts for less", mods: { exLooks: 0.55 } },
  { icon: "☀️", text: "Sunny day: training is a vibe", mods: { exVibes: 2.4 } },
  { icon: "💻", text: "Deadline day: vibes drain twice as fast", mods: { vibesDecay: 2 } },
  { icon: "🌧️", text: "Rainy and cosy: you burn less, but feel flat", mods: { fuelDecay: 0.75, vibesDecay: 1.4 } },
  { icon: "🎉", text: "Friends in town: every drink counts double for vibes", mods: { drinkVibes: 2 } },
];

function planEvents(): (DayEvent | null)[] {
  return Array.from({ length: DAYS }, (_, d) => {
    if (d === 0 || Math.random() > 0.55) return d % 7 === 5 ? { icon: "🥂", text: "Saturday night: drinks bring a little extra", mods: { drinkVibes: 1.3 } } : null;
    return EVENTS[Math.floor(Math.random() * EVENTS.length)];
  });
}

/** Where the clock is: day index, hour of the day (07–23), or night. */
export function clockAt(now: number) {
  const t = Math.max(0, now);
  const day = Math.min(DAYS - 1, Math.floor(t / DAY_MS));
  const into = t - day * DAY_MS;
  const night = into >= AWAKE_H * HOUR_MS;
  const hour = night ? SLEEP : WAKE + into / HOUR_MS;
  return { day, hour, night, nightShare: night ? (into - AWAKE_H * HOUR_MS) / NIGHT_MS : 0 };
}
export function clockLabel(now: number) {
  if (now < 0) return "Get ready";
  const { day, hour, night } = clockAt(now);
  const wd = WEEKDAYS[day % 7];
  if (night) return `${wd} · night`;
  const h = Math.floor(hour), m = Math.floor((hour - h) * 4) * 15;
  return `Week ${day < 7 ? 1 : 2} · ${wd} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const stateIdx = (v: number) => (v < 40 ? 0 : v < ZONE[0] ? 1 : v <= ZONE[1] ? 2 : 3);
export const stateOf = (m: Meter, v: number) => METERS.find((x) => x.id === m)!.states[stateIdx(v)];

interface S {
  fuel: number; looks: number; vibes: number; booze: number;
  ready: Record<Action, number>;        // game time (ms) when each action is ready again
  inZone: Record<Meter, number>; total: number;
  hangover: boolean; boosts: number;
}
const fresh = (): S => ({ fuel: 70, looks: 62, vibes: 66, booze: 0, ready: { food: 0, move: 0, drink: 0 }, inZone: { fuel: 0, looks: 0, vibes: 0 }, total: 0, hangover: false, boosts: 0 });

export type Verdict = { label: string; note: string; input: MoodInput; tipsy: number };
function judge(s: S): Verdict {
  const tipsy = s.booze >= 3.4 ? 3 : s.booze >= 2.3 ? 2 : 0;
  const zones = [s.fuel, s.looks, s.vibes].filter((v) => v >= ZONE[0] && v <= ZONE[1]).length;
  const overfed = s.fuel > ZONE[1];
  const score = s.fuel < 40 ? 20 : Math.min(100, 40 + zones * 19);
  const input: MoodInput = { score, inactive: false, overfed, overAlcohol: tipsy >= 2 };
  if (tipsy) return { label: "Tipsy", note: "Wobbly. Maybe water next.", input, tipsy };
  if (overfed) return { label: "Stuffed", note: "Food coma. Train or wait it out.", input, tipsy };
  if (s.fuel < 40) return { label: "Sluggish", note: "Running on empty. Time to eat.", input, tipsy };
  if (s.looks > ZONE[1]) return { label: "Cooked", note: "Overtrained. Rest a bit.", input, tipsy };
  if (zones === 3) return { label: "Thriving", note: "Everything maxxed. Keep it there.", input, tipsy };
  return { label: "Okay", note: zones === 2 ? "Nearly there. One meter to fix." : "Get all three into the green.", input, tipsy };
}

export interface Pop { id: number; text: string; tone: "good" | "meh" | "fun" | "warn" | "boost"; icon?: string }

export function useFortnight() {
  const [phase, setPhase] = useState<"idle" | "play" | "done">("idle");
  const [now, setNow] = useState(-LEAD_MS);
  const [pops, setPops] = useState<Pop[]>([]);
  const st = useRef(fresh());
  const events = useRef<(DayEvent | null)[]>(Array(DAYS).fill(null));
  const clock = useRef({ start: 0, paused: 0, hiddenAt: 0, last: 0, day: -1 });
  const popId = useRef(0);

  const pop = useCallback((text: string, tone: Pop["tone"], icon?: string) => {
    const id = ++popId.current;
    setPops((p) => [...p.slice(-3), { id, text, tone, icon }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1100);
  }, []);

  const start = useCallback(() => {
    st.current = fresh();
    events.current = planEvents();
    clock.current = { start: performance.now() + LEAD_MS, paused: 0, hiddenAt: 0, last: -LEAD_MS, day: -1 };
    setNow(-LEAD_MS); setPops([]); setPhase("play");
  }, []);

  const mods = (day: number): Mods => ({ ...BASE, ...(events.current[day]?.mods ?? {}) });

  useEffect(() => {
    if (phase !== "play") return;
    let raf = 0;
    const tick = () => {
      const c = clock.current, s = st.current;
      const t = performance.now() - c.start - c.paused;
      const dt = Math.max(0, Math.min(100, t - Math.max(0, c.last)));
      c.last = t;
      if (t > 0) {
        const { day, night } = clockAt(t);
        if (day !== c.day) {                      // morning
          if (c.day >= 0) {
            s.hangover = s.booze >= 2.3;
            if (s.hangover) { s.vibes -= 10; s.fuel -= 6; pop("Hangover", "warn", "🥴"); }
            s.booze = 0;
          }
          c.day = day;
          const ev = events.current[day];
          if (day === 0) pop("Morning! Breakfast time", "good", "🌅");
          else if (ev) pop(ev.text, "fun", ev.icon);
        }
        const h = dt / HOUR_MS, m = mods(day);
        if (night) { s.fuel -= 1.5 * h; }
        else {
          s.fuel -= 4.3 * h * m.fuelDecay;
          s.looks -= 1.35 * h;
          s.vibes -= 1.45 * h * m.vibesDecay + (s.looks > ZONE[1] ? 2.5 * h : 0);
          s.booze = Math.max(0, s.booze - 0.22 * h);
          s.total += h;
          if (s.fuel >= ZONE[0] && s.fuel <= ZONE[1]) s.inZone.fuel += h;
          if (s.looks >= ZONE[0] && s.looks <= ZONE[1]) s.inZone.looks += h;
          if (s.vibes >= ZONE[0] && s.vibes <= ZONE[1]) s.inZone.vibes += h;
        }
        s.fuel = Math.max(0, s.fuel); s.looks = Math.max(0, s.looks); s.vibes = Math.max(0, s.vibes);
      }
      setNow(t);
      if (t >= DAYS * DAY_MS) { setPhase("done"); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const vis = () => {
      const c = clock.current;
      if (document.hidden) c.hiddenAt = performance.now();
      else if (c.hiddenAt) { c.paused += performance.now() - c.hiddenAt; c.hiddenAt = 0; }
    };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", vis); };
  }, [phase, pop]);

  const act = useCallback((a: Action) => {
    if (phase !== "play") return;
    const t = performance.now() - clock.current.start - clock.current.paused;
    const s = st.current;
    if (t < 0 || t < s.ready[a]) return;
    const { day, hour, night } = clockAt(t);
    if (night) { pop("Sleeping…", "meh", "💤"); return; }
    const m = mods(day);
    const spec = ACTIONS.find((x) => x.id === a)!;
    s.ready[a] = t + spec.cool * HOUR_MS;
    const add = (k: Meter, v: number) => { s[k] = Math.min(110, s[k] + v); };
    if (a === "food") {
      const meal = MEALS.find(([a0, a1]) => hour >= a0 && hour <= a1);
      const food = FOODS[Math.floor(Math.random() * FOODS.length)];
      if (meal) { add("fuel", 24 * m.foodFuel); pop("Proper meal", "good", food); }
      else if (hour >= 22) { add("fuel", 20 * m.foodFuel); add("vibes", 3); s.looks -= 3; pop("Midnight snack", "meh", "🌮"); }
      else { add("fuel", 17 * m.foodFuel); pop("Snack", "meh", "🍪"); }
    } else if (a === "move") {
      if (s.fuel < 25) { add("looks", 8); s.fuel = Math.max(0, s.fuel - 8); pop("Too hungry to lift", "warn", "😵"); return; }
      add("looks", 26 * m.exLooks); add("vibes", 7 * m.exVibes); s.fuel = Math.max(0, s.fuel - 14);
      if (hour >= 21.5) { s.vibes -= 6; pop("Late session, wired", "meh", "😳"); }
      s.boosts++;
      pop(s.looks > ZONE[1] ? "Cooked 🥵" : "+GAINS", "boost", "💪");
    } else {
      const early = hour < DRINK_FROM;
      s.booze += early ? 2 : 1;
      add("vibes", (early ? 8 : 16) * m.drinkVibes); add("fuel", 7); s.looks -= s.booze >= 2.3 ? 4 : 1;
      pop(early ? "Day drinking?!" : s.booze >= 3.4 ? "Wheee!" : s.booze >= 2.3 ? "Tipsy…" : "Cheers!", early || s.booze >= 2.3 ? "warn" : "fun", early ? "🙃" : "🥂");
    }
  }, [phase, pop]);

  useEffect(() => {
    if (phase !== "play") return;
    const map: Record<string, Action> = { a: "food", s: "move", d: "drink", j: "food", k: "move", l: "drink", "1": "food", "2": "move", "3": "drink" };
    const on = (e: KeyboardEvent) => {
      const a = map[e.key.toLowerCase()];
      if (!a || e.repeat || e.metaKey || e.ctrlKey) return;
      e.preventDefault(); act(a);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [phase, act]);

  const s = st.current;
  const verdict = judge(s);
  const shares = { fuel: s.total ? s.inZone.fuel / s.total : 0, looks: s.total ? s.inZone.looks / s.total : 0, vibes: s.total ? s.inZone.vibes / s.total : 0 };
  const won = phase === "done" && shares.fuel >= WIN_SHARE && shares.looks >= WIN_SHARE && shares.vibes >= WIN_SHARE;
  const clk = clockAt(now);
  return {
    phase, now, pops, s, verdict, shares, won, start, act, clk,
    event: now >= 0 ? events.current[clk.day] : null,
    cooldown: (a: Action) => {
      const spec = ACTIONS.find((x) => x.id === a)!;
      const left = s.ready[a] - now;
      return left > 0 ? left / (spec.cool * HOUR_MS) : 0;
    },
  };
}
export type Fortnight = ReturnType<typeof useFortnight>;
export { WIN_SHARE, MEALS, DRINK_FROM, WAKE, AWAKE_H };

/** The day as a sky: the sun (or moon) crosses an arc, meal windows sit on the timeline below. */
export function Sky({ g }: { g: Fortnight }) {
  const { hour, night, nightShare } = g.clk;
  const p = (hour - WAKE) / AWAKE_H;                       // 0 morning … 1 night
  const x = 6 + p * 88, y = 78 - Math.sin(p * Math.PI) * 58;
  const dusk = Math.max(0, (p - 0.62) / 0.38);
  const dawn = Math.max(0, 1 - p / 0.15);
  return (
    <div className={`sky ${night ? "night" : ""}`} style={{ ["--dusk" as string]: night ? 1 : dusk, ["--dawn" as string]: night ? 0 : dawn }} aria-hidden="true">
      <div className="sky-glow" />
      {night ? <span className="moon" style={{ left: `${30 + nightShare * 40}%` }}>🌙</span> : <span className="sun" style={{ left: `${x}%`, top: `${y}%` }}>{dusk > 0.55 ? "🌆" : "☀️"}</span>}
      {night && <span className="zzz">💤</span>}
      {g.event && !night && <div className="sky-event"><span>{g.event.icon}</span>{g.event.text}</div>}
      <div className="sky-pops">
        {g.pops.map((q) => <span key={q.id} className={`sky-pop ${q.tone}`}>{q.icon && <i>{q.icon}</i>}{q.text}</span>)}
      </div>
      <div className="timeline">
        {MEALS.map(([a, b, ic]) => <span key={a} className="tl-meal" style={{ left: `${((a - WAKE) / AWAKE_H) * 100}%`, width: `${((b - a) / AWAKE_H) * 100}%` }}>{ic}</span>)}
        <span className="tl-drink" style={{ left: `${((DRINK_FROM - WAKE) / AWAKE_H) * 100}%` }}>🍷</span>
        <span className="tl-now" style={{ left: `${Math.min(100, p * 100)}%` }} />
      </div>
    </div>
  );
}

export function MeterBar({ id, label, value }: { id: Meter; label: string; value: number }) {
  const st = stateIdx(value);
  return (
    <div className={`gm gm-${id} st-${st}`}>
      <div className="gm-row"><span>{label}</span><b>{stateOf(id, value)}</b></div>
      <div className="gm-bar inset-sm" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, value))}>
        <em style={{ left: `${ZONE[0]}%`, width: `${ZONE[1] - ZONE[0]}%` }} />
        <i style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export function Buttons({ g }: { g: Fortnight }) {
  return (
    <div className="pads">
      {ACTIONS.map((a) => {
        const cd = g.cooldown(a.id);
        return (
          <button key={a.id} className={`pad p-${a.id} ${cd > 0 ? "cool" : ""}`} onPointerDown={(e) => { e.preventDefault(); g.act(a.id); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); g.act(a.id); } }}
            aria-label={`${a.label} (key ${a.key})`} disabled={g.phase !== "play"}>
            <span className="cd" style={{ height: `${cd * 100}%` }} aria-hidden="true" />
            <span aria-hidden="true" className="ic">{a.icon}</span><b>{a.label}</b><kbd>{a.key}</kbd>
          </button>
        );
      })}
    </div>
  );
}
