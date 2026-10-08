import * as THREE from "three";
import type { CompanionId } from "../shared.ts";
import { buildAnimal, clamp, facet, lerp, smooth } from "./animal.ts";
import type { Animal } from "./animal.ts";
import type { MoodInput } from "./mood.ts";
import { SPECIES } from "./species.ts";

// One companion on its own canvas (2026-10-08 companions design §5): the plinth, the mood FX and the loop of the
// reference prototype, for a single animal. Loaded only when a companion is shown, so three.js stays out of the main
// bundle.

// The prototype was drawn with three r128, before colour management and physically based light units: keep its colours
// exactly as written, and scale the lights by π, which is what r128's legacy light units did inside the shader.
THREE.ColorManagement.enabled = false;
const LEGACY_LIGHT = Math.PI;

/** How the camera frames the companion: `mini` fills the day bar's round button, `full` leaves room for the FX. */
export type Framing = "mini" | "full";

const FRAMES: Record<Framing, { hw: number; hh: number; lookY: number; rise: number }> = {
  mini: { hw: 0.95, hh: 1.1, lookY: 1.05, rise: 0.22 },
  full: { hw: 1.6, hh: 1.7, lookY: 0.95, rise: 0.34 },
};

export interface StageOptions {
  companion: CompanionId;
  mood: MoodInput;
  framing: Framing;
  /** Drag to turn, tap to pet. */
  interactive: boolean;
  /** Draws the plinth under it. */
  plinth: boolean;
  /** Frames a second at most; the small button draws at 30. */
  fps?: number;
  /** Told each time a tap pets the companion. */
  onPet?: () => void;
}

export interface Stage {
  setMood(mood: MoodInput): void;
  setCompanion(companion: CompanionId): void;
  /** Holds the last frame and stops drawing, as when the bubble covers the button. */
  setPaused(paused: boolean): void;
  pet(): void;
  dispose(): void;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function glyphTex(draw: (g: CanvasRenderingContext2D) => void, w = 64, h = 64): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  return new THREE.CanvasTexture(c);
}

/** The sprite art of the prototype: z's, sparkles, bolts, streaks, the burp bubble, the grumble and the "oof…". */
function makeTextures() {
  const star = (g: CanvasRenderingContext2D, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(32, 4);
    g.quadraticCurveTo(36, 28, 60, 32);
    g.quadraticCurveTo(36, 36, 32, 60);
    g.quadraticCurveTo(28, 36, 4, 32);
    g.quadraticCurveTo(28, 28, 32, 4);
    g.fill();
  };
  return {
    blob: glyphTex((g) => {
      const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, "rgba(20,24,32,0.34)");
      gr.addColorStop(1, "rgba(20,24,32,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }, 128, 128),
    z: glyphTex((g) => {
      g.fillStyle = "#8E96A3";
      g.font = "600 50px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("z", 32, 34);
    }),
    spark: glyphTex((g) => star(g, "#F2C14E")),
    sparkW: glyphTex((g) => star(g, "#FFFFFF")),
    bolt: glyphTex((g) => {
      g.fillStyle = "#F5C33B";
      g.strokeStyle = "#D9822B";
      g.lineWidth = 3;
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(38, 3);
      g.lineTo(14, 36);
      g.lineTo(29, 36);
      g.lineTo(22, 61);
      g.lineTo(50, 24);
      g.lineTo(34, 24);
      g.lineTo(42, 3);
      g.closePath();
      g.fill();
      g.stroke();
    }),
    streak: glyphTex((g) => {
      const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, "rgba(120,214,226,0)");
      gr.addColorStop(0.35, "rgba(120,214,226,0.95)");
      gr.addColorStop(1, "rgba(120,214,226,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(8, 0);
      g.quadraticCurveTo(16, 64, 8, 128);
      g.quadraticCurveTo(0, 64, 8, 0);
      g.fill();
    }, 16, 128),
    oof: glyphTex((g) => {
      g.fillStyle = "#7C8492";
      g.font = "italic 600 38px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("oof…", 64, 34);
    }, 128, 64),
    bubble: glyphTex((g) => {
      g.strokeStyle = "#8E96A3";
      g.lineWidth = 4;
      g.beginPath();
      g.arc(32, 32, 24, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fill();
      g.fillStyle = "#FFFFFF";
      g.beginPath();
      g.arc(24, 24, 5, 0, Math.PI * 2);
      g.fill();
    }),
    grumble: glyphTex((g) => {
      g.strokeStyle = "#8E96A3";
      g.lineWidth = 4;
      g.lineCap = "round";
      for (const y of [18, 32, 46]) {
        g.beginPath();
        g.moveTo(8, y);
        for (let xx = 8; xx <= 56; xx += 4) g.lineTo(xx, y + Math.sin(xx * 0.5) * 3.5);
        g.stroke();
      }
    }),
  };
}

type Textures = ReturnType<typeof makeTextures>;

const sprite = (tex: THREE.Texture) => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));

/** The companion with everything that floats around it, in a holder on the plinth. */
interface Cast {
  holder: THREE.Group;
  animal: Animal;
  blob: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  blobBase: THREE.Vector3;
  zs: THREE.Sprite[];
  grr: THREE.Sprite;
  bub: THREE.Sprite;
  oofS: THREE.Sprite;
  sparks: { s: THREE.Sprite; off: number; px: number; py: number }[];
  bolts: { s: THREE.Sprite; side: number; off: number }[];
  streaks: { s: THREE.Sprite; off: number; px: number }[];
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  nextBlink: number;
  blinkAt: number;
  happyAt: number;
}

const PLINTH_R = 1.15;

function castOf(companion: CompanionId, tex: Textures, plinthMat: THREE.Material, withPlinth: boolean, reduce: boolean): Cast {
  const cfg = SPECIES[companion];
  const radius = cfg.muzzle === "trunk" ? 1.3 : cfg.yuzu ? 1.25 : PLINTH_R;
  const holder = new THREE.Group();
  if (withPlinth) {
    const plinth = new THREE.Mesh(facet(new THREE.CylinderGeometry(radius, radius + 0.06, 0.16, 9), 0.0), plinthMat);
    plinth.position.y = -0.08;
    holder.add(plinth);
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.005;
  blob.scale.set(radius * 1.5, radius * 1.2, 1);
  holder.add(blob);
  const animal = buildAnimal(cfg, reduce);
  holder.add(animal.root);
  const zs = [0, 1].map(() => {
    const s = sprite(tex.z);
    animal.root.add(s);
    return s;
  });
  const grr = sprite(tex.grumble);
  grr.position.set(0.62, 0.62, 0.5);
  animal.root.add(grr);
  const bub = sprite(tex.bubble);
  animal.root.add(bub);
  const oofS = sprite(tex.oof);
  animal.root.add(oofS);
  // energy FX for Thriving: twinkling sparkles, popping bolts, rising speed streaks, landing ring
  const sparks = [0, 1, 2, 3].map((k) => {
    const s = sprite(k % 2 ? tex.sparkW : tex.spark);
    const a = (k / 4) * Math.PI * 2 + Math.random() * 0.6;
    holder.add(s);
    return { s, off: Math.random() * 6, px: Math.cos(a) * 0.85, py: animal.headTop - 0.25 + Math.sin(a) * 0.45 };
  });
  const bolts = [-1, 1].map((side) => {
    const s = sprite(tex.bolt);
    holder.add(s);
    return { s, side, off: Math.random() };
  });
  const streaks = [0, 1, 2, 3].map((k) => {
    const s = sprite(tex.streak);
    holder.add(s);
    return { s, off: k / 4 + Math.random() * 0.1, px: (k % 2 ? 1 : -1) * (0.55 + Math.random() * 0.35) };
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.7, 48),
    new THREE.MeshBasicMaterial({ color: "#F2C14E", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  holder.add(ring);
  return {
    holder, animal, blob, blobBase: blob.scale.clone(), zs, grr, bub, oofS, sparks, bolts, streaks, ring,
    nextBlink: 1 + Math.random() * 2, blinkAt: -1, happyAt: -10,
  };
}

/** Frees everything under `object` but the textures, which the stage shares between companions. */
function disposeTree(object: THREE.Object3D) {
  object.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
}

function plinthColour(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--nm-plinth").trim() || "#dbe1e9";
}

/** Draws `options.companion` into a canvas appended to `host`, sized to it, until disposed. */
export function createStage(host: HTMLElement, options: StageOptions): Stage {
  const reduce = prefersReducedMotion();
  const frame = FRAMES[options.framing];
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8f96a3, 0.8 * LEGACY_LIGHT));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85 * LEGACY_LIGHT);
  sun.position.set(-3, 8, 7);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffffff, 0.3 * LEGACY_LIGHT);
  rim.position.set(6, 3, -4);
  scene.add(rim);

  const tex = makeTextures();
  const plinthMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: plinthColour() });
  const dark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const readPlinth = () => plinthMat.color.set(plinthColour());
  dark?.addEventListener?.("change", readPlinth);

  let cast = castOf(options.companion, tex, plinthMat, options.plinth, reduce);
  scene.add(cast.holder);

  // The mood the companion eases towards, as the prototype: the score at about 3× a second, each flag over ~0.4 s.
  let mood = options.mood;
  let score = mood.score, sleepK = mood.inactive ? 1 : 0, overK = mood.overfed && !mood.inactive ? 1 : 0;

  let width = 1, height = 1;
  const resize = () => {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const f = Math.tan(THREE.MathUtils.degToRad(14));
    const d = Math.max(frame.hw / (f * camera.aspect), frame.hh / f);
    camera.position.set(0, frame.lookY + d * frame.rise - 0.05, d);
    camera.lookAt(0, frame.lookY, 0);
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  observer?.observe(host);
  resize();

  // Drag to turn, tap to pet.
  const start = performance.now();
  const now = () => (performance.now() - start) / 1000;
  let yaw = options.framing === "mini" ? -0.3 : -0.35;
  let dragging = false, lastX = 0, downX = 0, downY = 0;
  const canvas = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = downX = e.clientX;
    downY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.012;
    lastX = e.clientX;
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) >= 6) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObject(cast.animal.root, true).length) {
      cast.happyAt = now();
      options.onPet?.();
    }
  };
  const onCancel = () => {
    dragging = false;
  };
  if (options.interactive) {
    canvas.style.touchAction = "pan-y";
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
  }

  // Reduced motion holds the pose, so a few frames a second are enough to show a change of mood or a pet.
  const minGap = reduce ? 0.25 : options.fps ? 1 / options.fps : 0;
  let last = now(), lastDrawn = -1;
  let raf = 0;
  let paused = false;

  function draw() {
    const clockNow = now();
    if (clockNow - lastDrawn < minGap - 0.002) {
      raf = requestAnimationFrame(draw);
      return;
    }
    lastDrawn = clockNow;
    const dt = Math.min(clockNow - last, 0.05);
    last = clockNow;
    const t = reduce ? 0 : clockNow;
    score = reduce ? mood.score : score + (mood.score - score) * Math.min(1, dt * 3);
    sleepK = reduce ? (mood.inactive ? 1 : 0) : sleepK + ((mood.inactive ? 1 : 0) - sleepK) * Math.min(1, dt * 2.5);
    const vAwake = lerp(0.52, 1, clamp((score - 10) / 45, 0, 1)); // awake pose: droopy (Sluggish) → content (Okay, 55+)
    const v = lerp(vAwake, 0, sleepK); // Inactive folds into the sleeping pose
    overK = reduce ? (mood.overfed ? 1 : 0) : overK + ((mood.overfed ? 1 : 0) - overK) * Math.min(1, dt * 2.5);
    const o = overK * (1 - sleepK);
    const vFinal = lerp(v, 0.7, o); // stuffed: awake but heavy and droopy
    const u = (1 - smooth(score, 22, 50)) * (1 - sleepK) * (1 - overK); // under-eating, awake only
    const x = smooth(score, 70, 92) * (1 - sleepK) * (1 - overK); // extra joy for Thriving
    const c = cast;
    c.animal.applyColour(vFinal, x, Math.max(u, o * 0.3)); // a touch of queasy pallor when stuffed

    const sway = dragging || reduce ? 0 : Math.sin(clockNow * 0.4) * 0.1;
    c.animal.root.rotation.y = yaw + sway;
    if (!reduce && clockNow > c.nextBlink) {
      c.blinkAt = clockNow;
      c.nextBlink = clockNow + 2.2 + Math.random() * 3;
    }
    const blink = clockNow - c.blinkAt < 0.13 && v > 0.25;
    const hRaw = (clockNow - c.happyAt) / 1.1;
    const happy = hRaw >= 0 && hRaw <= 1 ? (reduce ? 0.5 : hRaw) : 0;
    const lift = c.animal.update(t, vFinal, x, { blink, happy: sleepK > 0.5 ? 0 : happy, unwell: u, over: o });
    const a = c.animal;
    c.grr.material.opacity = a.grumble * 0.9;
    c.grr.visible = a.grumble > 0.02;
    c.grr.scale.setScalar(0.22 + a.grumble * 0.08);
    c.bub.visible = a.burp > 0.02;
    c.bub.material.opacity = a.burp * 0.9;
    c.bub.position.set(0.35, a.headTop - 0.45 + (1 - a.burp) * 0.25 + a.burp * 0.15, 0.6);
    c.bub.scale.setScalar(0.12 + a.burp * 0.18);
    c.oofS.visible = a.oof > 0.02;
    c.oofS.material.opacity = a.oof * 0.95;
    c.oofS.position.set(-0.75, a.headTop - 0.1 + a.oof * 0.12, 0.4);
    c.oofS.scale.set(0.5 + a.oof * 0.1, 0.25 + a.oof * 0.05, 1);
    const s = 1 - lift * 0.5;
    c.blob.scale.set(c.blobBase.x * s, c.blobBase.y * s, 1);
    c.blob.material.opacity = 1 - lift * 0.6;
    c.zs.forEach((z, j) => {
      const ph = ((reduce ? 0.4 : clockNow * 0.35) + j * 0.5) % 1;
      z.position.set(a.zAnchor.x + ph * 0.35, a.zAnchor.y + ph * 0.7, a.zAnchor.z);
      const sc = 0.24 + ph * 0.12;
      z.scale.set(sc, sc, 1);
      z.material.opacity = Math.sin(ph * Math.PI) * sleepK;
      z.visible = sleepK > 0.01;
    });
    const fxOn = Math.max(x, happy > 0 ? Math.sin(happy * Math.PI) : 0);
    const on = fxOn > 0.01;
    // twinkling sparkles around the head
    for (const f of c.sparks) {
      const tw = reduce ? 0.7 : Math.abs(Math.sin(clockNow * 3.2 + f.off));
      f.s.position.set(f.px, f.py + lift * 0.6, 0.45);
      const sc = (0.08 + 0.2 * tw) * fxOn;
      f.s.scale.set(sc, sc, 1);
      f.s.material.rotation = reduce ? 0 : clockNow * 1.5 + f.off;
      f.s.material.opacity = (0.4 + 0.6 * tw) * fxOn;
      f.s.visible = on;
    }
    // energy bolts popping beside the shoulders on each jump
    for (const f of c.bolts) {
      const pop = reduce ? 0.6 : Math.max(0, Math.sin(((a.ph + 0.5 + f.off * 0.2) % 1) * Math.PI));
      f.s.position.set(f.side * (0.95 + pop * 0.12), a.headTop - 0.7 + pop * 0.25, 0.3);
      const sc = (0.16 + 0.16 * pop) * fxOn;
      f.s.scale.set(sc, sc, 1);
      f.s.material.rotation = f.side * -0.35;
      f.s.material.opacity = (0.35 + 0.65 * pop) * fxOn;
      f.s.visible = on;
    }
    // speed streaks rushing upward behind the body
    for (const f of c.streaks) {
      const ph = ((reduce ? 0.5 : clockNow * 1.1) + f.off) % 1;
      f.s.position.set(f.px, 0.2 + ph * 2.3, -0.35);
      f.s.scale.set(0.07, 0.55, 1);
      f.s.material.opacity = Math.sin(ph * Math.PI) * fxOn * 0.85;
      f.s.visible = on;
    }
    // landing ring
    if (!reduce && x > 0.05 && a.ph < 0.28) {
      const k = a.ph / 0.28;
      c.ring.visible = true;
      c.ring.scale.setScalar(0.8 + k * 1.3);
      c.ring.material.opacity = (1 - k) * 0.85 * x;
    } else c.ring.visible = false;
    renderer.render(scene, camera);
    if (!paused) raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  return {
    setMood(next) {
      mood = next;
    },
    setCompanion(companion) {
      scene.remove(cast.holder);
      disposeTree(cast.holder);
      cast = castOf(companion, tex, plinthMat, options.plinth, reduce);
      scene.add(cast.holder);
    },
    setPaused(next) {
      if (next === paused) return;
      paused = next;
      cancelAnimationFrame(raf);
      if (!paused) {
        last = now();
        raf = requestAnimationFrame(draw);
      }
    },
    pet() {
      cast.happyAt = now();
    },
    dispose() {
      paused = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      dark?.removeEventListener?.("change", readPlinth);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      disposeTree(scene);
      for (const texture of Object.values(tex)) texture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

/**
 * A still of each companion, content and facing a little to the side, for the picker's tiles: drawn once with one
 * renderer that is then let go, so eight tiles never hold eight WebGL contexts.
 */
export function companionStills(ids: readonly CompanionId[], size: number): Record<string, string> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8f96a3, 0.8 * LEGACY_LIGHT));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85 * LEGACY_LIGHT);
  sun.position.set(-3, 8, 7);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const f = Math.tan(THREE.MathUtils.degToRad(14));
  const { hh, lookY, rise } = FRAMES.mini;
  const d = hh / f;
  camera.position.set(0, lookY + d * rise - 0.05, d);
  camera.lookAt(0, lookY, 0);
  const out: Record<string, string> = {};
  try {
    for (const id of ids) {
      const animal = buildAnimal(SPECIES[id], true);
      animal.root.rotation.y = -0.3;
      animal.applyColour(1, 0, 0);
      animal.update(0, 1, 0, { blink: false, happy: 0, unwell: 0, over: 0 });
      scene.add(animal.root);
      renderer.render(scene, camera);
      out[id] = renderer.domElement.toDataURL("image/png");
      scene.remove(animal.root);
      disposeTree(animal.root);
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
