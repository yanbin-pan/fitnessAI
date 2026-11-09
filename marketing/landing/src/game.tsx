import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CompanionId, CompanionMood } from "@app/shared.ts";
import { SPECIES } from "@app/companions/species.ts";
import { CREW, nameOf, Companion, Still, useStills, WaitlistForm } from "./parts.tsx";
import { CountUp, reduceMotion } from "./fx.tsx";
import { METRICS, fmt, nextRound, type Food, type Metric, type Round } from "./foods.ts";

const LIVES = 3;
const PLATES = 12;
const BEST_KEY = "zabaione-guess-best";

const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
const saveBest = (n: number) => { try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* fine */ } };

interface Totals { kcal: number; protein: number; carbs: number; fat: number; fibre: number; sat: number; free: number; salt: number }
const ZERO: Totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sat: 0, free: 0, salt: 0 };
const eat = (t: Totals, f: Food): Totals => ({
  kcal: t.kcal + f.kcal, protein: t.protein + f.protein, carbs: t.carbs + f.carbs, fat: t.fat + f.fat,
  fibre: t.fibre + f.fibre, sat: t.sat + f.sat, free: t.free + (f.free ?? 0), salt: t.salt + f.salt,
});
const clamp = (x: number) => Math.max(0, Math.min(100, x));

/** The pet's three gauges, from everything it has eaten today. A playful model, not a medical one. */
function health(t: Totals) {
  return {
    heart: clamp(75 - t.salt * 5 - t.sat * 0.8 + t.fibre * 0.8),
    gut: clamp(40 + t.fibre * 2 - t.free * 0.6),
    energy: clamp(45 + t.protein * 0.35 - t.free * 0.8),
  };
}
const word = (v: number) => (v >= 70 ? "Glowing" : v >= 45 ? "Doing fine" : "Needs some care");

const TARGETS = { protein: 90, carbs: 260, fat: 70, fibre: 30 };

/* ---------- Pieces ---------- */

function Meters({ t }: { t: Totals }) {
  const h = health(t);
  const macros = [
    { k: "Protein", v: t.protein, of: TARGETS.protein, c: "var(--protein)" },
    { k: "Carbs", v: t.carbs, of: TARGETS.carbs, c: "var(--carbs)" },
    { k: "Fat", v: t.fat, of: TARGETS.fat, c: "var(--fat)" },
    { k: "Fibre", v: t.fibre, of: TARGETS.fibre, c: "var(--fibre)" },
  ];
  const gauges = [
    { k: "Heart", v: h.heart, c: "var(--heart)", icon: "♥" },
    { k: "Gut", v: h.gut, c: "var(--fibre)", icon: "●" },
    { k: "Energy", v: h.energy, c: "var(--carbs)", icon: "⚡" },
  ];
  return (
    <div className="meters raised-sm">
      <div className="meter-col">
        <p className="meter-h">Today's plate</p>
        {macros.map((m) => (
          <div className="bar" key={m.k}>
            <span>{m.k}</span>
            <div className="tube inset-sm"><i style={{ width: `${Math.min(100, (m.v / m.of) * 100)}%`, background: m.c }} /></div>
            <em>{Math.round(m.v)} g</em>
          </div>
        ))}
      </div>
      <div className="meter-col">
        <p className="meter-h">Future you</p>
        {gauges.map((g) => (
          <div className="bar gauge" key={g.k}>
            <span><b aria-hidden="true" style={{ color: g.c }}>{g.icon}</b> {g.k}</span>
            <div className="tube inset-sm"><i style={{ width: `${g.v}%`, background: g.c }} /></div>
            <em className="sr-only">{word(g.v)}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function FoodCard({ f, side, metric, picked, answer, onPick }: {
  f: Food; side: "a" | "b"; metric: Metric; picked: "a" | "b" | null; answer: "a" | "b"; onPick: (s: "a" | "b") => void;
}) {
  const revealed = picked !== null;
  const right = side === answer;
  const state = !revealed ? "" : right ? "right" : picked === side ? "wrong" : "other";
  const v = f[metric] ?? 0;
  return (
    <button className={`food ${state}`} onClick={() => !revealed && onPick(side)} aria-disabled={revealed}
      aria-label={revealed ? `${f.name}, ${fmt(v, metric)}${right ? ", the right answer" : ""}` : `${f.name}, ${f.portion}`}>
      <span className="food-emoji" aria-hidden="true">{f.emoji}</span>
      <span className="food-name">{f.name}</span>
      <span className="food-portion">{f.portion}</span>
      <span className="food-val" aria-hidden={!revealed}>{revealed ? fmt(v, metric) : "?"}</span>
      {revealed && right && <span className="tag">✓</span>}
    </button>
  );
}

function Hud({ pet, mood, petTick, streak, lives, plate, level }: { pet: CompanionId; mood: CompanionMood; petTick: number; streak: number; lives: number; plate: number; level: number }) {
  return (
    <div className="hud">
      <div className="hud-pet inset" style={{ ["--fur" as string]: SPECIES[pet].fur }}>
        <div className="grow" style={{ transform: `scale(${1 + Math.min(level, 4) * 0.07})` }}>
          <Companion id={pet} mood={mood} framing="face" petTick={petTick} />
        </div>
      </div>
      <div className="hud-stats">
        <div className="hud-row"><b>{nameOf(pet).name}</b><span className="lvl">Level {level + 1}</span></div>
        <div className="hud-row small">
          <span aria-label={`Streak ${streak}`}>🔥 {streak}</span>
          <span aria-label={`${lives} lives left`} className="lives">{Array.from({ length: LIVES }, (_, i) => <i key={i} className={i < lives ? "on" : ""} />)}</span>
          <span>Plate {Math.min(plate, PLATES)}/{PLATES}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Screens ---------- */

function Hello({ pet, setPet, onPlay, best }: { pet: CompanionId; setPet: (c: CompanionId) => void; onPlay: () => void; best: number }) {
  const stills = useStills();
  const [pats, setPats] = useState(0);
  return (
    <section className="screen hello" aria-labelledby="hello-h">
      <div className="hello-stage raised" style={{ ["--fur" as string]: SPECIES[pet].fur }}>
        <div className="bubble raised-sm" aria-live="polite">
          {pats > 2 ? "Okay, okay, I like you. Shall we play?" : `Ciao! I'm ${nameOf(pet).name}. Bet you can't tell what's really in your food.`}
        </div>
        <div className="hello-well inset" onPointerUp={() => setPats((n) => n + 1)}>
          <Companion id={pet} mood="thriving" interactive plinth framing="full" />
        </div>
      </div>
      <div className="hello-copy">
        <h1 id="hello-h" className="display">Guess &amp; Grow</h1>
        <p className="sub">Two foods, one question. Pick right and your companion grows. Everything you pick, they eat, so watch their heart, gut and energy.</p>
        <div className="picker" role="group" aria-label="Choose your companion">
          {CREW.map((k) => (
            <button key={k.id} className={`peek ${pet === k.id ? "on" : ""}`} aria-pressed={pet === k.id} onClick={() => setPet(k.id)} style={{ ["--fur" as string]: SPECIES[k.id].fur }}>
              <Still id={k.id} stills={stills} />
              <span className="sr-only">{k.name}, {k.animal}</span>
            </button>
          ))}
        </div>
        <button className="btn primary big" onClick={onPlay}>Play with {nameOf(pet).name}</button>
        <p className="hint">About a minute. No sign-up.{best ? ` Your best streak: ${best}.` : ""}</p>
      </div>
    </section>
  );
}

function Play({ pet, onEnd }: { pet: CompanionId; onEnd: (r: Result) => void }) {
  const recent = useRef(new Set<string>());
  const [round, setRound] = useState<Round>(() => nextRound(recent.current));
  const [picked, setPicked] = useState<"a" | "b" | null>(null);
  const [plate, setPlate] = useState(1);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [right, setRight] = useState(0);
  const [lives, setLives] = useState(LIVES);
  const [totals, setTotals] = useState<Totals>(ZERO);
  const [petTick, setPetTick] = useState(0);
  const [missed, setMissed] = useState<Metric[]>([]);
  const nextBtn = useRef<HTMLButtonElement>(null);

  const correct = picked !== null && picked === round.answer;
  const over = picked !== null && (lives === 0 || plate >= PLATES);
  const level = Math.floor(right / 3);
  const h = health(totals);
  const mood: CompanionMood = picked && !correct ? "sluggish" : totals.kcal > 2300 ? "overfed" : h.heart < 35 ? "sluggish" : streak >= 3 ? "thriving" : "okay";

  const pick = (s: "a" | "b") => {
    const ok = s === round.answer;
    setPicked(s);
    setTotals((t) => eat(t, s === "a" ? round.a : round.b));
    if (ok) { setStreak((n) => { const v = n + 1; setBest((b) => Math.max(b, v)); return v; }); setRight((n) => n + 1); setPetTick((n) => n + 1); }
    else { setStreak(0); setLives((n) => n - 1); setMissed((m) => [...m, round.metric]); }
    window.setTimeout(() => nextBtn.current?.focus({ preventScroll: true }), 50);
  };
  const next = () => {
    if (over) { onEnd({ best, right, plates: plate, totals, missed }); return; }
    setRound(nextRound(recent.current));
    setPicked(null);
    setPlate((n) => n + 1);
  };
  const m = METRICS[round.metric];

  return (
    <section className="screen play" aria-labelledby="q">
      <Hud pet={pet} mood={mood} petTick={petTick} streak={streak} lives={lives} plate={plate} level={level} />
      <h2 id="q" className="question">Which has <em>{m.ask}</em>?</h2>
      <div className="foods" key={plate}>
        <FoodCard f={round.a} side="a" metric={round.metric} picked={picked} answer={round.answer} onPick={pick} />
        <span className="vs" aria-hidden="true">or</span>
        <FoodCard f={round.b} side="b" metric={round.metric} picked={picked} answer={round.answer} onPick={pick} />
      </div>
      <div className={`verdict ${picked ? (correct ? "ok" : "no") : "idle"}`} aria-live="polite">
        {picked ? (
          <>
            <p className="verdict-h">{correct ? (streak >= 3 ? `Yes! ${streak} in a row.` : "Yes, well spotted.") : "Not this time."} <span>{nameOf(pet).name} ate the {(picked === "a" ? round.a : round.b).name.toLowerCase()}.</span></p>
            <p className="fact">{m.fact}</p>
            <button ref={nextBtn} className="btn primary" onClick={next}>{over ? `See ${nameOf(pet).name}'s check-up` : "Next plate"}</button>
          </>
        ) : (
          <p className="verdict-h muted">Tap the one you think. {nameOf(pet).name} eats whichever you pick.</p>
        )}
      </div>
      <Meters t={totals} />
    </section>
  );
}

interface Result { best: number; right: number; plates: number; totals: Totals; missed: Metric[] }

function End({ pet, r, allBest, onAgain }: { pet: CompanionId; r: Result; allBest: number; onAgain: () => void }) {
  const h = health(r.totals);
  const avg = (h.heart + h.gut + h.energy) / 3;
  const mood: CompanionMood = avg >= 62 ? "thriving" : avg >= 42 ? "okay" : "sluggish";
  const tip = useMemo(() => {
    const m = r.missed.length ? r.missed[r.missed.length - 1] : (["fibre", "salt", "sat"] as Metric[])[r.right % 3];
    return METRICS[m].fact;
  }, [r]);
  const name = nameOf(pet).name;
  const share = `I got a ${r.best} streak in Zabaione's Guess & Grow, and ${name}'s heart is ${word(h.heart).toLowerCase()} 🍝 zabaione.app`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(share); setCopied(true); } catch { setCopied(false); }
  };
  const rows = [
    { k: "Heart", v: h.heart, c: "var(--heart)" },
    { k: "Gut", v: h.gut, c: "var(--fibre)" },
    { k: "Energy", v: h.energy, c: "var(--carbs)" },
  ];
  return (
    <section className="screen end" aria-labelledby="end-h">
      <div className="report raised">
        <div className="report-top">
          <div className="report-pet inset" style={{ ["--fur" as string]: SPECIES[pet].fur }}>
            <Companion id={pet} mood={mood} framing="face" />
          </div>
          <div>
            <p className="report-kicker">Check-up</p>
            <h2 id="end-h" className="h2">{name}'s day</h2>
            <p className="report-score"><b><CountUp to={r.best} start ms={700} /></b> best streak · {r.right} of {r.plates} right{allBest > r.best ? ` · your record is ${allBest}` : r.best && r.best >= allBest ? " · a new record" : ""}</p>
          </div>
        </div>
        <ul className="report-rows">
          {rows.map((x) => (
            <li key={x.k}>
              <span>{x.k}</span>
              <div className="tube inset-sm"><i style={{ width: `${x.v}%`, background: x.c }} /></div>
              <b>{word(x.v)}</b>
            </li>
          ))}
        </ul>
        <p className="report-tip"><span>Worth remembering</span>{tip}</p>
        <div className="report-actions">
          <button className="btn" onClick={copy}>{copied ? "Copied" : "Copy my score"}</button>
          <button className="btn" onClick={onAgain}>Play again</button>
        </div>
        <p className="sr-only" aria-live="polite">{copied ? "Score copied to the clipboard" : ""}</p>
      </div>
      <div className="save raised">
        <h2 className="h2 small">Save a seat for {name}.</h2>
        <p className="sub">In the app, {name} does this for your real meals: you say what you ate, and the coach remembers your whole week, even your blood tests.</p>
        <WaitlistForm id="email-end" cta="Save my seat" />
      </div>
    </section>
  );
}

/* ---------- App ---------- */

function App() {
  const [screen, setScreen] = useState<"hello" | "play" | "end">("hello");
  const [pet, setPet] = useState<CompanionId>("zabaione");
  const [result, setResult] = useState<Result | null>(null);
  const [best, setBest] = useState(readBest);
  const [run, setRun] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }); }, [screen, run]);
  const end = (r: Result) => {
    if (r.best > best) { setBest(r.best); saveBest(r.best); }
    setResult(r); setScreen("end");
  };
  return (
    <>
      <nav className="nav scrolled" aria-label="Main">
        <div className="nav-in">
          <a href="#" className="word" onClick={(e) => { e.preventDefault(); setScreen("hello"); }}>zabaione</a>
          <a href="#about" className="nav-link">What is Zabaione?</a>
        </div>
      </nav>
      <main ref={top} className="wrap game">
        {screen === "hello" && <Hello pet={pet} setPet={setPet} best={best} onPlay={() => { setRun((n) => n + 1); setScreen("play"); }} />}
        {screen === "play" && <Play key={run} pet={pet} onEnd={end} />}
        {screen === "end" && result && <End pet={pet} r={result} allBest={best} onAgain={() => { setRun((n) => n + 1); setScreen("play"); }} />}
      </main>
      <section id="about" className="about wrap">
        <blockquote className="why">
          <p>“My parents got their blood test back and had no idea what to change at dinner. I wanted a coach that would just listen, and remember.”</p>
          <footer>Davide, founder of Zabaione</footer>
        </blockquote>
        <p className="fine">Food values are typical portions, rounded, from UK CoFID and USDA tables. The heart, gut and energy meters are a playful model to show direction, not a health assessment.</p>
      </section>
      <footer className="foot wrap">
        <span>© 2026 Zabaione</span>
        <span>hello@zabaione.app · @zabaioneapp</span>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
