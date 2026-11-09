import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createStage, companionStills, type Framing, type Stage } from "@app/companions/stage.ts";
import { moodInput, canDraw3d } from "@app/companions/mood.ts";
import { SPECIES } from "@app/companions/species.ts";
import type { CompanionId, CompanionMood } from "@app/shared.ts";
import { BlurText, ClickSpark, CountUp, DotGrid, RotatingText, TextType, reduceMotion, useInView } from "./fx.tsx";

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
const nameOf = (id: CompanionId) => CREW.find((c) => c.id === id)!;

const MOODS: { id: CompanionMood; label: string; note: string }[] = [
  { id: "thriving", label: "Thriving", note: "A good week: fed well, moving, sleeping." },
  { id: "okay", label: "Okay", note: "An ordinary day. Nothing to fix." },
  { id: "sluggish", label: "Sluggish", note: "Skipped meals. They droop a little." },
  { id: "overfed", label: "Stuffed", note: "Sunday lunch at nonna's." },
  { id: "inactive", label: "Asleep", note: "Nothing logged for a while." },
];

let can3d: boolean | null = null;
const draw3d = () => (can3d ??= canDraw3d());

/** A plain disc in the companion's colours, where neither 3D nor a still can be drawn. */
function Badge({ id }: { id: CompanionId }) {
  const sp = SPECIES[id];
  return <span className="badge" style={{ background: sp.fur, color: sp.dark }}>{nameOf(id).name[0]}</span>;
}

/** Stills of the whole crew, drawn once with a single renderer that is then let go. */
let stillsCache: Record<string, string> | null = null;
function useStills(): Record<string, string> | null {
  const [s, setS] = useState(stillsCache);
  useEffect(() => {
    if (stillsCache) { setS(stillsCache); return; }
    if (!draw3d()) return;
    try { stillsCache = companionStills(CREW.map((c) => c.id), 200); setS(stillsCache); } catch { /* badges stay */ }
  }, []);
  return s;
}

function Still({ id, stills, className = "" }: { id: CompanionId; stills: Record<string, string> | null; className?: string }) {
  return stills?.[id] ? <img className={`still ${className}`} src={stills[id]} alt="" /> : <Badge id={id} />;
}

/** One live low-poly companion from the app. Paused while off screen. */
function Companion({ id, mood, framing = "full", interactive = false, plinth = false, className = "" }: {
  id: CompanionId; mood: CompanionMood; framing?: Framing; interactive?: boolean; plinth?: boolean; className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [ok] = useState(draw3d);
  const first = useRef(id);
  useEffect(() => {
    if (!ok || !host.current) return;
    const el = host.current;
    const s = createStage(el, { companion: first.current, mood: moodInput(mood), framing, interactive, plinth });
    stage.current = s;
    const io = new IntersectionObserver(([e]) => s.setPaused(!e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => { io.disconnect(); s.dispose(); stage.current = null; };
  }, [ok, framing, interactive, plinth]);
  useEffect(() => { stage.current?.setCompanion(id); }, [id]);
  useEffect(() => { stage.current?.setMood(moodInput(mood)); }, [mood]);
  return <div ref={host} className={`companion ${className}`} aria-hidden="true">{!ok && <Badge id={id} />}</div>;
}

/* ---------- The app, talking ---------- */

const USER_LINE = "Carbonara with my parents, then an hour of tennis 🎾";
const COACH_LINE = "Lovely evening. I've logged the carbonara (about 720 kcal) and 60 min of tennis. You're 34 g short on protein, so a Greek yoghurt later rounds the day off nicely.";

function PhoneDemo() {
  const [ref, seen] = useInView<HTMLDivElement>(0.35);
  // The finished conversation is the default; the replay only runs once the phone is seen.
  // 0 empty, 1 user sent, 2 typing dots, 3 coach typing, 4 logged
  const [step, setStep] = useState(4);
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const play = () => {
    clear();
    setStep(0);
    timers.current = [
      window.setTimeout(() => setStep(1), 450),
      window.setTimeout(() => setStep(2), 1350),
      window.setTimeout(() => setStep(3), 2600),
    ];
  };
  useEffect(() => {
    if (!seen || reduceMotion()) return;
    play();
    return clear;
  }, [seen]);
  const onTyped = () => {
    setStep(4);
    if (!reduceMotion()) timers.current.push(window.setTimeout(play, 8000));
  };
  const logged = step >= 4;
  const kcal = logged ? 1640 : 920;
  const bars = [
    { k: "Protein", v: logged ? 76 : 48, of: 110, c: "var(--protein)" },
    { k: "Carbs", v: logged ? 212 : 120, of: 240, c: "var(--carbs)" },
    { k: "Fat", v: logged ? 61 : 34, of: 70, c: "var(--fat)" },
    { k: "Fibre", v: logged ? 19 : 14, of: 30, c: "var(--fibre)" },
  ];
  return (
    <div ref={ref} className="phone raised" role="img" aria-label="The Zabaione app: you describe dinner and a tennis match in one sentence, the coach logs both and suggests a Greek yoghurt for protein.">
      <div className="phone-notch" />
      <div className="sum raised-sm">
        <div className="ring">
          <svg viewBox="0 0 80 80" aria-hidden="true">
            <defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient></defs>
            <circle cx="40" cy="40" r="32" className="ring-track" />
            <circle cx="40" cy="40" r="32" className="ring-fill" stroke="url(#rg)" strokeDasharray={`${(kcal / 2200) * 201} 201`} />
          </svg>
          <div className="ring-num"><b>{seen ? <CountUp key={kcal} to={2200 - kcal} start ms={900} /> : (2200 - kcal).toLocaleString("en-GB")}</b><small>kcal left</small></div>
        </div>
        <div className="bars">
          {bars.map((b) => (
            <div className="bar" key={b.k}>
              <span>{b.k}</span>
              <div className="tube inset-sm"><i style={{ width: `${(b.v / b.of) * 100}%`, background: b.c }} /></div>
              <em>{b.v} g</em>
            </div>
          ))}
        </div>
      </div>
      <div className="chat">
        <div className={`msg me ${step >= 1 ? "" : "wait"}`}>{USER_LINE}</div>
        <div className={`row ${step >= 2 ? "" : "wait"}`}>
          <Companion id="zabaione" mood={logged ? "thriving" : "okay"} framing="face" className="avatar" />
          {step === 2 ? (
            <div className="msg coach dots" aria-hidden="true"><i /><i /><i /></div>
          ) : step === 3 ? (
            <div className="msg coach"><TextType text={COACH_LINE} run speed={15} onDone={onTyped} /></div>
          ) : (
            <div className="msg coach">{COACH_LINE}</div>
          )}
        </div>
        <div className={`logged ${logged ? "" : "wait"}`}>
          <div><i style={{ background: "var(--carbs)" }} /><b>Carbonara</b><span>1 plate · 720 kcal</span></div>
          <div><i style={{ background: "var(--orange)" }} /><b>Tennis</b><span>60 min · about 480 kcal</span></div>
        </div>
      </div>
      <div className="composer inset-sm"><span>Tell Zabaione anything…</span><i className="cam" /></div>
    </div>
  );
}

/* ---------- Waitlist form: posts to /api/waitlist (Cloudflare Pages Function) ---------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Only the real site has the sign-up endpoint. Anywhere else (an Artifact
// preview, a file on disk) the form says it's a preview and stores nothing.
const LIVE = /(^|\.)zabaione\.(app|co\.uk)$|\.pages\.dev$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
const HEARD: [string, string][] = [["tiktok", "TikTok"], ["instagram", "Instagram"], ["friend", "A friend"], ["search", "Search"], ["other", "Other"]];

function attribution() {
  const q = new URLSearchParams(location.search);
  return {
    utm_source: q.get("utm_source") || undefined, utm_medium: q.get("utm_medium") || undefined,
    utm_campaign: q.get("utm_campaign") || undefined, ref: document.referrer || undefined, lang: navigator.language,
  };
}

async function send(body: Record<string, unknown>) {
  const r = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
}

function Heard({ email }: { email: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (picked) return <span className="heard-thanks">Thanks, that helps a lot.</span>;
  return (
    <div className="heard" role="group" aria-label="How did you hear about Zabaione? (optional)">
      <span>How did you hear about us?</span>
      <div className="chips">
        {HEARD.map(([v, label]) => (
          <button key={v} type="button" className="chip raised-sm" onClick={() => { setPicked(v); send({ email, heard: v }).catch(() => {}); }}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function WaitlistForm({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error" | "failed">("idle");
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim();
    if (!EMAIL.test(clean)) { setState("error"); return; }
    setState("pending");
    if (!LIVE) { window.setTimeout(() => setState("done"), reduceMotion() ? 0 : 700); return; }
    try {
      await send({ email: clean, form: id === "email-top" ? "top" : "bottom", hp, t: Math.round(performance.now()), ...attribution() });
      setState("done");
    } catch (err) {
      setState(String((err as Error).message) === "invalid_email" ? "error" : "failed");
    }
  };
  if (state === "done") {
    return (
      <div className="form-done raised-sm" role="status">
        {LIVE ? <>
          <b>You're on the list.</b>
          <span>We'll email {email.trim()} when your companion is ready.</span>
          <Heard email={email.trim()} />
        </> : <>
          <b>Thanks, that's how it will work.</b>
          <span>This page is a preview, so your email wasn't stored.</span>
        </>}
      </div>
    );
  }
  const msg = state === "error" ? "That email doesn't look right. Check for a typo."
    : state === "failed" ? "We couldn't save that just now. Try again in a moment."
    : LIVE ? <>Only launch news, never shared. <a href="/privacy">Privacy</a></>
    : "Preview page: sign-ups aren't connected here.";
  return (
    <form className="wl" onSubmit={submit} noValidate>
      <label htmlFor={id} className="sr-only">Email address</label>
      <input
        id={id} className="field" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" maxLength={254}
        value={email} aria-invalid={state === "error"} aria-describedby={`${id}-msg`}
        onChange={(e) => { setEmail(e.target.value); if (state === "error" || state === "failed") setState("idle"); }}
      />
      {/* Honeypot: hidden from people and screen readers, bots tend to fill it. */}
      <input className="hp" type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} />
      <ClickSpark><button className="btn primary" type="submit" disabled={state === "pending"}>{state === "pending" ? <><span className="spin" aria-hidden="true" />Joining…</> : "Join the waitlist"}</button></ClickSpark>
      <p id={`${id}-msg`} className={`form-msg ${state === "error" || state === "failed" ? "err" : ""}`} aria-live="polite">{msg}</p>
    </form>
  );
}

/* ---------- Hero: the why, the promise, the app ---------- */

function Hero() {
  return (
    <header className="hero" id="top">
      <DotGrid />
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="kicker"><span className="live" aria-hidden="true" />Your whole-health companion · invite-only beta</p>
          <BlurText text="The companion that knows you." className="display" />
          <blockquote className="why">
            <p>“Every app knew one slice of me: calories here, runs there, blood tests in a drawer. I wanted one companion that sees the whole picture, and notices what’s missing before the numbers do.”</p>
            <footer>Davide, founder</footer>
          </blockquote>
          <p className="lede">
            Tell it your day in one sentence. It remembers{" "}
            <RotatingText items={["what you ate on Tuesday", "Sunday’s long run", "your iron levels", "your knee after squats", "that you hate fish"]} />.
          </p>
        </div>
        <div className="hero-demo"><PhoneDemo /></div>
        <div className="hero-form"><WaitlistForm id="email-top" /></div>
      </div>
    </header>
  );
}

/* ---------- Crew: one hero, the rest waiting their turn ---------- */

function Crew() {
  const stills = useStills();
  const [mood, setMood] = useState<CompanionMood>("thriving");
  const [pick, setPick] = useState<CompanionId>("zabaione");
  const c = nameOf(pick);
  const note = MOODS.find((m) => m.id === mood)!.note;
  return (
    <section className="crew" id="crew" aria-labelledby="crew-h">
      <div className="wrap crew-grid">
        <div className="crew-copy">
          <h2 id="crew-h" className="h2">Pick who keeps you company.</h2>
          <p className="sub">Eight low-poly companions, each named after an Italian dessert. Their mood follows your week, so you can tell how you're doing before you read a single number.</p>
          <div className="picker" role="group" aria-label="Choose a companion">
            {CREW.map((k) => (
              <button key={k.id} className={`peek ${pick === k.id ? "on" : ""}`} aria-pressed={pick === k.id} onClick={() => setPick(k.id)} style={{ ["--fur" as string]: SPECIES[k.id].fur }}>
                <Still id={k.id} stills={stills} />
                <span className="sr-only">{k.name}, {k.animal}</span>
              </button>
            ))}
          </div>
          <p className="hint">Tap one to meet them. Drag to turn, tap the companion to give it a pat.</p>
        </div>
        <div className="stage-card raised" style={{ ["--fur" as string]: SPECIES[pick].fur }}>
          <div className="stage-well inset">
            <Companion id={pick} mood={mood} interactive plinth framing="full" />
          </div>
          <div className="stage-foot">
            <div aria-live="polite"><b>{c.name}</b><span>{c.animal} · {note}</span></div>
          </div>
          <div className="moods" role="group" aria-label="Try a mood">
            {MOODS.map((m) => (
              <button key={m.id} aria-pressed={mood === m.id} className={`chip ${mood === m.id ? "on" : ""}`} onClick={() => setMood(m.id)}>{m.label}</button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- What it does, shown in the product ---------- */

function Week() {
  const [ref, seen] = useInView<HTMLDivElement>(0.4);
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const tint = ["good", "good", "near", "good", "off", "good", "good"];
  const animate = seen && !reduceMotion();
  return (
    <div ref={ref} className="week" aria-label="A week of days, mostly on target, one a little off, one well off">
      {days.map((d, i) => (
        <span key={i} className={`day ${tint[i]} ${animate ? "pop" : ""}`} style={{ animationDelay: `${i * 80}ms` }}><b>{d}</b></span>
      ))}
    </div>
  );
}

function Features() {
  return (
    <section className="features" aria-labelledby="f-h">
      <div className="wrap">
        <h2 id="f-h" className="h2">You are what you eat and do.</h2>
        <div className="f-rows">
          <div className="f-row">
            <div className="f-text">
              <h3>Talk, don't log</h3>
              <p>Say it like you'd tell a friend, or snap the plate. It works out the food, the portions and the effort, in your language.</p>
            </div>
            <div className="f-art raised-sm"><div className="say">“two eggs and toast, then a 5k run”</div><div className="say-out"><span>Eggs ×2</span><span>Toast</span><span>Run 5 km</span></div></div>
          </div>
          <div className="f-row">
            <div className="f-text">
              <h3>Remembers your week</h3>
              <p>Yesterday's late dinner and Thursday's leg day are still in the conversation, so the advice fits the week you're actually having.</p>
            </div>
            <div className="f-art raised-sm"><Week /></div>
          </div>
          <div className="f-row">
            <div className="f-text">
              <h3>Spots gaps early</h3>
              <p>It keeps an eye on iron, vitamin D, protein and fibre across your weeks, and nudges you before a blood test has to. Add your results and it explains them in plain words. Coaching, never a diagnosis.</p>
            </div>
            <div className="f-art raised-sm"><div className="lab"><span>Iron, last 3 weeks</span><b>62% <small>of target</small></b></div><p className="lab-tip">Lentils or spinach twice this week would close the gap.</p></div>
          </div>
          <div className="f-row">
            <div className="f-text">
              <h3>Trains with you</h3>
              <p>A first marathon, more muscle at the gym, or keeping your strength into your fifties and beyond. It fuels the goal and plans around how your body actually feels.</p>
            </div>
            <div className="f-art raised-sm"><div className="say">“long run tomorrow, what should I eat tonight?”</div><div className="say-out"><span>Salmon + rice</span><span>Extra carbs</span><span>Rest the legs</span></div></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Cta() {
  const stills = useStills();
  return (
    <section className="cta" id="waitlist" aria-labelledby="cta-h">
      <div className="wrap">
        <div className="cta-card raised">
          <div className="cta-crew" aria-hidden="true">
            {(["bombolone", "zabaione", "meringa"] as CompanionId[]).map((id) => (
              <span className="mini inset-sm" key={id}><Still id={id} stills={stills} /></span>
            ))}
          </div>
          <h2 id="cta-h" className="h2">Save a seat at the table.</h2>
          <p className="sub">We're letting in a small group of early testers first. Leave your email and we'll tell you when your companion is ready.</p>
          <WaitlistForm id="email-bottom" />
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
      <div className="nav-in">
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
        <Cta />
      </main>
      <footer className="foot wrap">
        <span>© 2026 Zabaione · <a href="/privacy">Privacy</a></span>
        <span>hello@zabaione.app · @zabaioneapp on TikTok and Instagram</span>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
