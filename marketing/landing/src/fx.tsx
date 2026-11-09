import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";

// Small hand-made versions of the React Bits effects the page uses (reactbits.dev itself couldn't be reached from
// the build machine). Every effect settles to its end state under prefers-reduced-motion.

export const reduceMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useInView<T extends Element>(threshold = 0.2, once = true) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver !== "function") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); if (once) io.disconnect(); }
      else if (!once) setSeen(false);
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, once]);
  return [ref, seen] as const;
}

/** BlurText: words arrive one by one out of a soft blur. Visible by default; the reveal only runs once it is seen. */
export function BlurText({ text, as: Tag = "h1", className = "", delay = 70 }: { text: string; as?: "h1" | "h2" | "p"; className?: string; delay?: number }) {
  const [ref, seen] = useInView<HTMLHeadingElement>(0.3);
  const [phase, setPhase] = useState<"static" | "pre" | "in">("static");
  useEffect(() => {
    if (!seen || reduceMotion()) return;
    setPhase("pre");
    const id = window.setTimeout(() => setPhase("in"), 40);
    return () => clearTimeout(id);
  }, [seen]);
  const words = text.split(" ");
  return (
    <Tag ref={ref as never} className={`blur-text ${phase} ${className}`} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true" style={{ transitionDelay: phase === "in" ? `${i * delay}ms` : "0ms" }}>{w}{i < words.length - 1 ? "\u00a0" : ""}</span>
      ))}
    </Tag>
  );
}

/** RotatingText: phrases swap in place with a short rise. */
export function RotatingText({ items, interval = 2800 }: { items: string[]; interval?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduceMotion()) return;
    const id = setInterval(() => setI((n) => (n + 1) % items.length), interval);
    return () => clearInterval(id);
  }, [items.length, interval]);
  return (
    <span className="rotating" aria-live="polite">
      <span key={i} className="rot-word">{items[i]}</span>
    </span>
  );
}

/** CountUp: eases a number up to its value when it comes into view. */
export function CountUp({ to, start = false, ms = 1400, suffix = "" }: { to: number; start?: boolean; ms?: number; suffix?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!start) { setV(0); return; }
    if (reduceMotion()) { setV(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, start, ms]);
  return <>{v.toLocaleString("en-GB")}{suffix}</>;
}

/** TextType: types a line out, with a caret while it runs. */
export function TextType({ text, run, speed = 18, onDone }: { text: string; run: boolean; speed?: number; onDone?: () => void }) {
  const [n, setN] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!run) { setN(0); return; }
    if (reduceMotion()) { setN(text.length); done.current?.(); return; }
    let k = 0;
    const id = setInterval(() => {
      k += 1;
      setN(k);
      if (k >= text.length) { clearInterval(id); done.current?.(); }
    }, speed);
    return () => clearInterval(id);
  }, [run, text, speed]);
  return <>{text.slice(0, n)}{run && n < text.length && <span className="caret" aria-hidden="true" />}</>;
}

/** SpotlightCard: a raised card with a soft light that follows the pointer. */
export function SpotlightCard({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    ref.current!.style.setProperty("--mx", `${e.clientX - r.left}px`);
    ref.current!.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div ref={ref} className={`spot raised ${className}`} style={style} onPointerMove={move}>
      {children}
    </div>
  );
}

/** Magnet: leans gently towards the pointer while it is near. */
export function Magnet({ children, strength = 10, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState("translate3d(0,0,0)");
  const move = (e: React.PointerEvent) => {
    if (reduceMotion() || e.pointerType !== "mouse") return;
    const r = ref.current!.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
    const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
    setT(`translate3d(${dx * strength}px, ${dy * strength}px, 0)`);
  };
  return (
    <div ref={ref} className={`magnet ${className}`} onPointerMove={move} onPointerLeave={() => setT("translate3d(0,0,0)")}>
      <div style={{ transform: t, transition: "transform 400ms cubic-bezier(.2,.8,.2,1)" }}>{children}</div>
    </div>
  );
}

/** ClickSpark: a little burst of lines from where you clicked. */
export function ClickSpark({ children, color = "#087a54" }: { children: ReactNode; color?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const fire = (e: React.MouseEvent) => {
    if (reduceMotion()) return;
    const r = host.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    for (let i = 0; i < 8; i++) {
      const s = document.createElement("i");
      s.className = "spark";
      s.style.left = `${x}px`;
      s.style.top = `${y}px`;
      s.style.background = color;
      s.style.setProperty("--a", `${i * 45}deg`);
      host.current!.appendChild(s);
      setTimeout(() => s.remove(), 520);
    }
  };
  return <div ref={host} className="spark-host" onClickCapture={fire}>{children}</div>;
}

/** ScrollReveal: each word brightens as the passage scrolls through the middle of the screen. */
export function ScrollReveal({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [p, setP] = useState(reduceMotion() ? 1 : 0);
  useEffect(() => {
    if (reduceMotion()) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        const vh = innerHeight;
        setP(Math.max(0, Math.min(1, (vh * 0.85 - r.top) / (r.height + vh * 0.35))));
      });
    };
    on();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => { removeEventListener("scroll", on); removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);
  const words = text.split(" ");
  return (
    <p ref={ref} className={`scroll-reveal ${className}`} aria-label={text}>
      {words.map((w, i) => {
        const k = Math.max(0, Math.min(1, p * words.length * 1.15 - i));
        return <span key={i} aria-hidden="true" style={{ opacity: 0.18 + 0.82 * k }}>{w} </span>;
      })}
    </p>
  );
}

/** DotGrid: a quiet field of dots that parts around the pointer. */
export function DotGrid({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    let w = 0, h = 0, dpr = 1, raf = 0, mx = -999, my = -999, alive = true, visible = true;
    const gap = 26;
    const css = () => getComputedStyle(cv).getPropertyValue("--dot").trim() || "#c3ccd8";
    let colour = css();
    const size = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      colour = css();
      draw();
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colour;
      for (let y = gap / 2; y < h; y += gap) {
        for (let x = gap / 2; x < w; x += gap) {
          const dx = x - mx, dy = y - my;
          const d = Math.hypot(dx, dy);
          const f = d < 120 ? (1 - d / 120) : 0;
          const ox = d ? (dx / d) * f * 14 : 0, oy = d ? (dy / d) * f * 14 : 0;
          ctx.globalAlpha = 0.55 + f * 0.45;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, 1.4 + f * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    const loop = () => { if (!alive) return; if (visible) draw(); raf = requestAnimationFrame(loop); };
    const move = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      mx = e.clientX - r.left; my = e.clientY - r.top;
    };
    const leave = () => { mx = -999; my = -999; };
    size();
    const ro = new ResizeObserver(size); ro.observe(cv);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(cv);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const theme = () => requestAnimationFrame(size);
    mq.addEventListener?.("change", theme);
    addEventListener("themechange", theme);
    if (!reduceMotion()) {
      addEventListener("pointermove", move, { passive: true });
      document.addEventListener("pointerleave", leave);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      removeEventListener("pointermove", move); document.removeEventListener("pointerleave", leave);
      mq.removeEventListener?.("change", theme); removeEventListener("themechange", theme);
    };
  }, []);
  return <canvas ref={ref} className={`dotgrid ${className}`} aria-hidden="true" />;
}
