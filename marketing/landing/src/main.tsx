import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createStage, type Framing, type Stage } from "@app/companions/stage.ts";
import { moodInput, canDraw3d } from "@app/companions/mood.ts";
import { SPECIES } from "@app/companions/species.ts";
import type { CompanionId, CompanionMood } from "@app/shared.ts";
import { BlurText, ClickSpark, CountUp, DotGrid, Magnet, RotatingText, ScrollReveal, SpotlightCard, TextType, reduceMotion, useInView } from "./fx.tsx";

const CREW: { id: CompanionId; name: string; animal: string }[] = [
  { id: "zabaione", name: "Zabaione", animal: "Shiba Inu" },
  { id: "tiramisu", name: "Tiramisù", animal: "Bear cub" },
  { id: "panna-cotta", name: "Panna Cotta", animal: "Elephant" },
  { id: "cannolo", name: "Cannolo", animal: "Capybara" },
  { id: "bombolone", name: "Bombolone", animal: "Pig" },
  { id: "sfogliatella", name: "Sfogliatella", animal: "Tiger" },
  { id: "meringa", name: "Meringa", animal: "Sheep" },
  { id: "cantuccio", name: "Cantuccio", animal: "Horse" },
];

const MOODS: { id: CompanionMood; label: string; note: string }[] = [
  { id: "thriving", label: "Thriving", note: "A good week: fed well, moving, sleeping." },
  { id: "okay", label: "Okay", note: "An ordinary day. Nothing to fix." },
  { id: "sluggish", label: "Sluggish", note: "Skipped meals. They droop a little." },
  { id: "overfed", label: "Stuffed", note: "Sunday lunch at nonna's." },
  { id: "inactive", label: "Asleep", note: "Nothing logged for a while." },
];

let can3d: boolean | null = null;

/** One low-poly companion from the app, drawn live. Paused while off screen so nine canvases stay cheap. */
function Companion({ id, mood, framing = "full", interactive = false, plinth = false, className = "" }: {
  id: CompanionId; mood: CompanionMood; framing?: Framing; interactive?: boolean; plinth?: boolean; className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [ok] = useState(() => (can3d ??= canDraw3d()));
  useEffect(() => {
    if (!ok || !host.current) return;
    const el = host.current;
    const s = createStage(el, { companion: id, mood: moodInput(mood), framing, interactive, plinth });
    stage.current = s;
    const io = new IntersectionObserver(([e]) => s.setPaused(!e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => { io.disconnect(); s.dispose(); stage.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, id, framing, interactive, plinth]);
  useEffect(() => { stage.current?.setMood(moodInput(mood)); }, [mood]);
  const sp = SPECIES[id];
  return (
    <div ref={host} className={`companion ${className}`} aria-hidden="true">
      {!ok && <span className="badge" style={{ background: sp.fur, color: sp.light }}>{CREW.find((c) => c.id === id)?.name[0]}</span>}
    </div>
  );
}

/* ---------- Hero: the app itself, talking ---------- */

const USER_LINE = "Carbonara with my parents, then an hour of tennis 🎾";
const COACH_LINE = "Lovely evening. I've logged the carbonara (about 720 kcal) and 60 min of tennis. You're 34 g short on protein, so a Greek yoghurt later rounds the day off nicely.";

function PhoneDemo() {
  const [ref, seen] = useInView<HTMLDivElement>(0.25);
  // 0 idle, 1 user sent, 2 typing dots, 3 coach typing, 4 card logged
  const [step, setStep] = useState(0);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    if (!seen) return;
    if (reduceMotion()) { setStep(4); return; }
    const run = () => {
      timers.current.forEach(clearTimeout);
      setStep(0);
      timers.current = [
        window.setTimeout(() => setStep(1), 500),
        window.setTimeout(() => setStep(2), 1500),
        window.setTimeout(() => setStep(3), 2900),
      ];
    };
    run();
    return () => timers.current.forEach(clearTimeout);
  }, [seen]);
  const onTyped = () => {
    setStep(4);
    if (!reduceMotion()) timers.current.push(window.setTimeout(() => setStep(0), 7000), window.setTimeout(() => {
      setStep(1);
      timers.current.push(window.setTimeout(() => setStep(2), 1000), window.setTimeout(() => setStep(3), 2400));
    }, 7600));
  };
  const logged = step >= 4;
  const kcal = logged ? 1640 : 920;
  const bars = [
    { k: "Protein", v: logged ? 76 : 48, of: 110, c: "var(--protein)" },
    { k: "Carbs", v: logged ? 212 : 120, of: 240, c: "var(--carbs)" },
    { k: "Fat", v: logged ? 61 : 34, of: 70, c: "var(--fat)" },
    { k: "Fibre", v: logged ? 19 : 14, of: 30, c: "var(--fibre)" },
  ];
  const ringPct = kcal / 2200;
  return (
    <div ref={ref} className="phone raised" role="img" aria-label="The Zabaione app: you describe dinner and a tennis match in one sentence, the coach logs both and suggests a Greek yoghurt for protein.">
      <div className="phone-notch" />
      <div className="sum raised-sm">
        <div className="ring">
          <svg viewBox="0 0 80 80" aria-hidden="true">
            <defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient></defs>
            <circle cx="40" cy="40" r="32" className="ring-track" />
            <circle cx="40" cy="40" r="32" className="ring-fill" stroke="url(#rg)" strokeDasharray={`${ringPct * 201} 201`} />
          </svg>
          <div className="ring-num"><b><CountUp key={kcal} to={2200 - kcal} start={seen} ms={900} /></b><small>kcal left</small></div>
        </div>
        <div className="bars">
          {bars.map((b) => (
            <div className="bar" key={b.k}>
              <span>{b.k}</span>
              <div className="tube inset"><i style={{ width: `${(b.v / b.of) * 100}%`, background: b.c }} /></div>
              <em>{b.v}g</em>
            </div>
          ))}
        </div>
      </div>
      <div className="chat">
        <div className={`msg me ${step >= 1 ? "show" : ""}`}>{USER_LINE}</div>
        <div className={`row ${step >= 2 ? "show" : ""}`}>
          <Companion id="zabaione" mood={logged ? "thriving" : "okay"} framing="face" className="avatar" />
          {step === 2 ? (
            <div className="msg coach dots"><i /><i /><i /></div>
          ) : (
            <div className="msg coach"><TextType text={COACH_LINE} run={step >= 3} speed={16} onDone={onTyped} /></div>
          )}
        </div>
        <div className={`logged raised-sm ${logged ? "show" : ""}`}>
          <div><b>Carbonara</b><span>1 plate · 720 kcal</span></div>
          <div><b>Tennis</b><span>60 min · ≈ 480 kcal</span></div>
        </div>
      </div>
      <div className="composer inset"><span>Tell Zabaione anything…</span><i className="cam" /></div>
    </div>
  );
}

function WaitlistForm({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "done">("idle");
  const [email, setEmail] = useState("");
  return state === "done" ? (
    <p className="form-done raised-sm" role="status">You’re on the list. We’ll write once, when your invite is ready.</p>
  ) : (
    <form className="wl" onSubmit={(e) => { e.preventDefault(); if (email.includes("@")) setState("done"); }}>
      <label htmlFor={id} className="sr-only">Email</label>
      <input id={id} className="inset" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <ClickSpark><button className="btn primary" type="submit">Join the waitlist</button></ClickSpark>
    </form>
  );
}

function Hero() {
  return (
    <header className="hero" id="top">
      <DotGrid />
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="eyebrow pill inset-sm"><span className="live" /> AI food &amp; fitness coach · invite-only beta</p>
          <BlurText text="The coach that remembers." className="display" />
          <p className="lede">
            Tell it about your day in one sentence. It remembers{" "}
            <RotatingText items={["what you ate on Tuesday", "your knee after squats", "your cholesterol results", "that you hate fish"]} />
          </p>
          <WaitlistForm id="email-top" />
          <p className="small">Free early access for the first testers. One email when it’s ready.</p>
        </div>
        <div className="hero-demo"><PhoneDemo /></div>
      </div>
    </header>
  );
}

/* ---------- Crew ---------- */

function Crew() {
  const [mood, setMood] = useState<CompanionMood>("thriving");
  const [pick, setPick] = useState<CompanionId>("zabaione");
  const note = MOODS.find((m) => m.id === mood)!.note;
  return (
    <section className="crew" id="crew" aria-labelledby="crew-h">
      <div className="wrap">
        <p className="eyebrow">Meet the crew</p>
        <h2 id="crew-h" className="h2">Pick who keeps you company.</h2>
        <p className="sub">Eight low-poly companions, each named after an Italian dessert. Their mood follows your week, so you can see how you’re doing without reading a single number. Drag one to turn it, tap to give it a pat.</p>
        <div className="moods" role="radiogroup" aria-label="Show the crew's mood">
          {MOODS.map((m) => (
            <button key={m.id} role="radio" aria-checked={mood === m.id} className={`chip ${mood === m.id ? "on" : ""}`} onClick={() => setMood(m.id)}>{m.label}</button>
          ))}
          <span className="mood-note" aria-live="polite">{note}</span>
        </div>
        <ul className="crew-grid">
          {CREW.map((c) => (
            <li key={c.id}>
              <Magnet strength={8}>
                <div className={`tile raised ${pick === c.id ? "picked" : ""}`} style={{ ["--fur" as string]: SPECIES[c.id].fur }}>
                  <div className="well inset"><Companion id={c.id} mood={mood} interactive plinth framing="full" /></div>
                  <div className="tile-foot">
                    <div><b>{c.name}</b><span>{c.animal}</span></div>
                    <button className={`pick ${pick === c.id ? "on" : ""}`} aria-pressed={pick === c.id} onClick={() => setPick(c.id)} aria-label={`Pick ${c.name}`}>
                      {pick === c.id ? "✓" : "+"}
                    </button>
                  </div>
                </div>
              </Magnet>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- What it does ---------- */

function Week() {
  const [ref, seen] = useInView<HTMLDivElement>(0.4);
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const tint = ["good", "good", "near", "good", "off", "good", "good"];
  return (
    <div ref={ref} className="week" aria-hidden="true">
      {days.map((d, i) => (
        <span key={i} className={`day ${seen ? tint[i] : ""}`} style={{ transitionDelay: `${i * 90}ms` }}><b>{d}</b></span>
      ))}
    </div>
  );
}

function Features() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  return (
    <section className="features" aria-labelledby="f-h">
      <div className="wrap">
        <p className="eyebrow">Why it’s different</p>
        <h2 id="f-h" className="h2">Not every day starts fresh.</h2>
        <div ref={ref} className={`f-grid ${seen ? "in" : ""}`}>
          <SpotlightCard className="f-card">
            <span className="ico inset-sm" style={{ ["--t" as string]: "var(--accent)" }}>
              <svg viewBox="0 0 24 24"><path d="M4 5h16v10H9l-5 4z" /></svg>
            </span>
            <h3>Talk, don’t log</h3>
            <p>Say it like you’d tell a friend, or snap the plate. It works out the food, the portions and the effort, in your language.</p>
            <div className="say inset-sm">“two eggs and toast, then 5k”</div>
          </SpotlightCard>
          <SpotlightCard className="f-card">
            <span className="ico inset-sm" style={{ ["--t" as string]: "var(--carbs)" }}>
              <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
            </span>
            <h3>Remembers your week</h3>
            <p>Yesterday’s late dinner and Thursday’s legs session are still in the conversation, so the advice fits the week you’re actually having.</p>
            <Week />
          </SpotlightCard>
          <SpotlightCard className="f-card">
            <span className="ico inset-sm" style={{ ["--t" as string]: "var(--fat)" }}>
              <svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /></svg>
            </span>
            <h3>Reads your results</h3>
            <p>Add a blood test and it explains how your plate relates to the numbers, in plain words. Coaching, never a diagnosis.</p>
            <div className="lab inset-sm"><span>LDL</span><b>3.4</b><em>→ swap butter for olive oil twice a week</em></div>
          </SpotlightCard>
        </div>
      </div>
    </section>
  );
}

/* ---------- Story + CTA ---------- */

function Story() {
  return (
    <section className="story" aria-label="Why I built it">
      <div className="wrap narrow">
        <p className="eyebrow">Why I built it</p>
        <ScrollReveal className="quote" text="My parents got their blood results back and had no idea what to change at dinner. Every app wanted them to weigh rice. I wanted something that would just listen, and remember." />
        <p className="sig">Bin, founder</p>
      </div>
    </section>
  );
}

function Cta() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  return (
    <section className="cta" id="waitlist" aria-labelledby="cta-h">
      <div ref={ref} className="wrap">
        <div className="cta-card raised">
          <div className="cta-crew" aria-hidden="true">
            {(["bombolone", "zabaione", "meringa"] as CompanionId[]).map((id) => (
              <div className="mini inset" key={id}>{seen && <Companion id={id} mood="thriving" framing="mini" />}</div>
            ))}
          </div>
          <h2 id="cta-h" className="h2">Save a seat at the table.</h2>
          <p className="sub">We’re letting in a small group of early testers first. Leave your email and we’ll tell you when your companion is ready.</p>
          <WaitlistForm id="email-bottom" />
          <p className="small">Preview only: this form doesn’t send anywhere yet.</p>
        </div>
      </div>
    </section>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    on(); addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  return (
    <nav className={`nav ${scrolled ? "scrolled" : ""}`} aria-label="Main">
      <div className="nav-in raised-sm">
        <a href="#top" className="word">zabaione</a>
        <div className="nav-links">
          <a href="#crew">The crew</a>
          <a href="#waitlist" className="btn small-btn">Join the waitlist</a>
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Crew />
        <Features />
        <Story />
        <Cta />
      </main>
      <footer className="foot wrap">
        <span>© 2026 Zabaione</span>
        <span>hello@zabaione.app · @zabaioneapp on TikTok and Instagram</span>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
