import { useEffect, useRef, useState } from "react";
import { createStage, companionStills, type Framing, type Stage } from "@app/companions/stage.ts";
import { moodInput, canDraw3d } from "@app/companions/mood.ts";
import { SPECIES } from "@app/companions/species.ts";
import type { CompanionId, CompanionMood } from "@app/shared.ts";
import { ClickSpark, reduceMotion } from "./fx.tsx";

export const CREW: { id: CompanionId; name: string; animal: string }[] = [
  { id: "zabaione", name: "Zabaione", animal: "Shiba Inu" },
  { id: "tiramisu", name: "Tiramisù", animal: "Bear cub" },
  { id: "panna-cotta", name: "Panna Cotta", animal: "Elephant" },
  { id: "cannolo", name: "Cannolo", animal: "Capybara" },
  { id: "bombolone", name: "Bombolone", animal: "Pig" },
  { id: "sfogliatella", name: "Sfogliatella", animal: "Tiger" },
  { id: "meringa", name: "Meringa", animal: "Sheep" },
  { id: "cantuccio", name: "Cantuccio", animal: "Horse" },
];
export const nameOf = (id: CompanionId) => CREW.find((c) => c.id === id)!;

export const MOODS: { id: CompanionMood; label: string; note: string }[] = [
  { id: "thriving", label: "Thriving", note: "A good week: fed well, moving, sleeping." },
  { id: "okay", label: "Okay", note: "An ordinary day. Nothing to fix." },
  { id: "sluggish", label: "Sluggish", note: "Skipped meals. They droop a little." },
  { id: "overfed", label: "Stuffed", note: "Sunday lunch at nonna's." },
  { id: "inactive", label: "Asleep", note: "Nothing logged for a while." },
];

let can3d: boolean | null = null;
const draw3d = () => (can3d ??= canDraw3d());

/** A plain disc in the companion's colours, where neither 3D nor a still can be drawn. */
export function Badge({ id }: { id: CompanionId }) {
  const sp = SPECIES[id];
  return <span className="badge" style={{ background: sp.fur, color: sp.dark }}>{nameOf(id).name[0]}</span>;
}

/** Stills of the whole crew, drawn once with a single renderer that is then let go. */
let stillsCache: Record<string, string> | null = null;
export function useStills(): Record<string, string> | null {
  const [s, setS] = useState(stillsCache);
  useEffect(() => {
    if (stillsCache) { setS(stillsCache); return; }
    if (!draw3d()) return;
    try { stillsCache = companionStills(CREW.map((c) => c.id), 200); setS(stillsCache); } catch { /* badges stay */ }
  }, []);
  return s;
}

export function Still({ id, stills, className = "" }: { id: CompanionId; stills: Record<string, string> | null; className?: string }) {
  return stills?.[id] ? <img className={`still ${className}`} src={stills[id]} alt="" /> : <Badge id={id} />;
}

/** One live low-poly companion from the app. Paused while off screen. */
export function Companion({ id, mood, framing = "full", interactive = false, plinth = false, className = "", petTick = 0 }: {
  id: CompanionId; mood: CompanionMood; framing?: Framing; interactive?: boolean; plinth?: boolean; className?: string; petTick?: number;
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
  useEffect(() => { if (petTick) stage.current?.pet(); }, [petTick]);
  return <div ref={host} className={`companion ${className}`} aria-hidden="true">{!ok && <Badge id={id} />}</div>;
}

/* ---------- Waitlist form: honest about being a preview ---------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function WaitlistForm({ id, cta = "Join the waitlist" }: { id: string; cta?: string }) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [email, setEmail] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) { setState("error"); return; }
    setState("pending");
    window.setTimeout(() => setState("done"), reduceMotion() ? 0 : 700);
  };
  if (state === "done") {
    return (
      <div className="form-done raised-sm" role="status">
        <b>Thanks, that's how it will work.</b>
        <span>This page is a preview, so your email wasn't stored yet.</span>
      </div>
    );
  }
  return (
    <form className="wl" onSubmit={submit} noValidate>
      <label htmlFor={id} className="sr-only">Email address</label>
      <input
        id={id} className="field" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
        value={email} aria-invalid={state === "error"} aria-describedby={`${id}-msg`}
        onChange={(e) => { setEmail(e.target.value); if (state === "error") setState("idle"); }}
      />
      <ClickSpark><button className="btn primary" type="submit" disabled={state === "pending"}>{state === "pending" ? <><span className="spin" aria-hidden="true" />Joining…</> : cta}</button></ClickSpark>
      <p id={`${id}-msg`} className={`form-msg ${state === "error" ? "err" : ""}`} aria-live="polite">
        {state === "error" ? "That email doesn't look right. Check for a typo." : "Preview page: sign-ups aren't connected yet."}
      </p>
    </form>
  );
}

