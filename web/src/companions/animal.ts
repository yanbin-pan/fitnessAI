import * as THREE from "three";
import type { Species } from "./species.ts";

// The low-poly seated companion (2026-10-08 companions design §2–3), ported from the reference prototype's
// buildAnimal() and update(): the same geometry, numbers and timing. Every animal owns its materials, so two on screen
// (the day bar's and the bubble's) can each be coloured by their own mood.

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const smooth = (x: number, a: number, b: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const hash = (n: number) => {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
};

/** Nudges each vertex by a small offset keyed by its position, so shared vertices stay welded: the hand-folded look. */
export function facet<G extends THREE.BufferGeometry>(geo: G, amt: number): G {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = +p.getX(i).toFixed(3), y = +p.getY(i).toFixed(3), z = +p.getZ(i).toFixed(3);
    const n = x * 127.1 + y * 311.7 + z * 74.7;
    p.setXYZ(i, x + (hash(n) - 0.5) * amt, y + (hash(n + 19.3) - 0.5) * amt, z + (hash(n + 47.1) - 0.5) * amt);
  }
  geo.computeVertexNormals();
  return geo;
}

const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);

interface MatOpts {
  smooth?: boolean;
  double?: boolean;
  opacity?: number;
  /** Never recoloured by mood: eyes, mouth, props. */
  keep?: boolean;
}

/** What one frame of animation is told on top of the pose. */
export interface FrameContext {
  blink: boolean;
  /** 0 → 1 through a tap-to-pet hop; 0 when not petted. */
  happy: number;
  /** Under-eating (Sluggish), awake only. */
  unwell: number;
  /** Overfed. */
  over: number;
}

export interface Animal {
  root: THREE.Group;
  headTop: number;
  zAnchor: THREE.Vector3;
  /** The hop cycle's phase, which the energy FX follow. */
  ph: number;
  grumble: number;
  burp: number;
  oof: number;
  /** v: pose (0 asleep → 1 content). x: joy on top (0 → ecstatic). Returns how high it is off the plinth. */
  update(t: number, v: number, x: number, ctx: FrameContext): number;
  /** Recolours the fur for the mood: drained when low or underfed, slightly richer when thriving. */
  applyColour(v: number, x: number, u: number): void;
}

export function buildAnimal(cfg: Species, reduce: boolean): Animal {
  const mats: THREE.MeshStandardMaterial[] = [];
  const mat = (hex: string, opts: MatOpts = {}) => {
    const m = new THREE.MeshStandardMaterial({
      color: hex, roughness: 0.9, metalness: 0, flatShading: !opts.smooth, side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (opts.opacity !== undefined) {
      m.transparent = true;
      m.opacity = opts.opacity;
    }
    m.userData.base = new THREE.Color(hex);
    m.userData.keep = !!opts.keep;
    mats.push(m);
    return m;
  };
  const P = (geo: THREE.BufferGeometry, m: THREE.Material, j = 0.04) => new THREE.Mesh(facet(geo, j), m);

  const inkMat = mat("#1F1A18", { keep: true });
  const mouthMat = mat("#3A2A26", { keep: true, double: true });
  const tongueMat = mat("#E9787A", { keep: true, double: true });
  const makeEye = () => {
    const g = new THREE.Group();
    const dot = new THREE.Mesh(facet(new THREE.IcosahedronGeometry(0.045, 0), 0.006), inkMat);
    dot.scale.z = 0.6;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.011, 6, 12, Math.PI), inkMat);
    arc.position.y = -0.012;
    arc.visible = false;
    g.add(dot, arc);
    return { g, dot, arc };
  };

  const scale = cfg.scale ?? 1;
  const root = new THREE.Group(), inner = new THREE.Group();
  root.add(inner);
  inner.scale.setScalar(scale);
  const F = mat(cfg.fur), Fd = mat(cfg.furDark || cfg.fur), L = mat(cfg.light), D = mat(cfg.dark);
  // the shared body plan
  const B = {
    tR: [0.32, 0.55] as [number, number], tH: 1.12, tY: 0.74, tZ: 0, tLean: -0.1,
    headY: 1.42, headZ: 0.12, headR: 0.48, legLen: 0.72, legR: 0.1, legX: 0.18, legZ: 0.3,
    haunchR: 0.36, haunchX: 0.34, haunchSc: [1, 0.85, 1.25] as [number, number, number], bibY: 0.72, bibZ: 0.22,
    bibSc: [1, 1, 0.7] as [number, number, number],
    ...cfg.build,
  };
  const legR = B.legR;
  const haunches: THREE.Mesh[] = [];
  const LegA = cfg.legs ? mat(cfg.legs) : F, LegB = cfg.legs ? mat(cfg.legs) : Fd;
  for (const s of [-1, 1]) {
    const h = P(ico(B.haunchR, 0), s < 0 ? F : Fd, 0.05);
    h.position.set(B.haunchX * s, B.haunchR * 0.82, -0.12);
    h.scale.set(...B.haunchSc);
    inner.add(h);
    haunches.push(h);
    h.userData.base = h.scale.clone();
    h.userData.x0 = h.position.x;
    const leg = P(new THREE.CylinderGeometry(legR * 0.9, legR * 1.1, B.legLen, 5), s < 0 ? LegA : LegB, 0.02);
    leg.position.set(B.legX * s, B.legLen / 2, B.legZ);
    inner.add(leg);
    const paw = P(ico(legR * 1.25, 0), cfg.pawLight ? L : D, 0.02);
    paw.position.set(B.legX * s, 0.06, B.legZ + 0.06);
    paw.scale.set(1, 0.7, 1.2);
    inner.add(paw);
  }

  const body = new THREE.Group();
  inner.add(body);
  const torso = P(new THREE.CylinderGeometry(B.tR[0], B.tR[1], B.tH, 7, 2), F, 0.05);
  const torsoShade = P(new THREE.CylinderGeometry(B.tR[0] + 0.01, B.tR[1] + 0.01, B.tH - 0.02, 7, 1, false, Math.PI * 0.5, Math.PI * 0.6), Fd, 0.0);
  for (const o of [torso, torsoShade]) {
    o.position.set(0, B.tY, B.tZ);
    o.rotation.x = B.tLean;
  }
  const bib = P(new THREE.CylinderGeometry(0.17, 0.31, 0.95, 6, 1), L, 0.03);
  bib.position.set(0, B.bibY, B.bibZ);
  bib.scale.set(...B.bibSc);
  bib.rotation.x = B.tLean;
  body.add(torso, torsoShade, bib);
  // Overfed: a rounder, fuller belly that puffs out (kept mild and playful)
  const torsoBase = torso.scale.clone(), bibBase = bib.scale.clone();
  const belly = P(ico(0.4, 1), L, 0.03);
  belly.position.set(0, 0.5, B.bibZ + 0.06);
  belly.scale.set(1, 0.92, 0.75);
  body.add(belly);
  const bellyBase = belly.scale.clone();

  const head = new THREE.Group();
  head.position.set(0, B.headY, B.headZ);
  body.add(head);
  const hs = cfg.headScale ?? [1, 0.92, 0.95];
  const skull = P(ico(B.headR, 1), F, 0.05);
  skull.scale.set(...hs);
  head.add(skull);
  const surfZ = (px: number, py: number) => hs[2] * B.headR * Math.sqrt(Math.max(0.05, 1 - (px / (hs[0] * B.headR)) ** 2 - (py / (hs[1] * B.headR)) ** 2));
  const torsoR = (y: number) => B.tR[1] + (B.tR[0] - B.tR[1]) * clamp((y - (B.tY - B.tH / 2)) / B.tH, 0, 1);

  // --- species extras ---
  if (cfg.wool) {
    // sheep: fluffy wool puffs over the body and a curly tuft on the head
    const W = mat(cfg.wool);
    [0.4, 0.68, 0.96, 1.2].forEach((y, row) => {
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = 0.75 + (k / (n - 1)) * (Math.PI * 2 - 1.5) + (row % 2) * 0.18;
        const r = torsoR(y) + 0.05;
        const w = P(ico(0.19 + (row === 0 ? 0.04 : 0), 1), W, 0.03);
        w.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
        body.add(w);
      }
    });
    for (const [px, py, pz, r] of [[0, 0.36, 0.08, 0.13], [-0.15, 0.33, 0.04, 0.11], [0.15, 0.33, 0.04, 0.11], [-0.08, 0.4, -0.1, 0.12], [0.08, 0.4, -0.1, 0.12]]) {
      const w = P(ico(r, 1), W, 0.02);
      w.position.set(px, py, pz);
      head.add(w);
    }
    for (const h of haunches) {
      const w = P(ico(0.3, 1), W, 0.04);
      w.position.copy(h.position);
      w.position.y += 0.05;
      w.scale.copy(h.scale);
      inner.add(w);
    }
  }
  if (cfg.stripes) {
    // tiger: forehead, cheek, body stripes
    const S = mat(cfg.stripes);
    for (const [px, py, rz] of [[-0.09, 0.3, 0.15], [0, 0.33, 0], [0.09, 0.3, -0.15]]) {
      const st = P(new THREE.BoxGeometry(0.035, 0.15, 0.03), S, 0);
      st.position.set(px, py, surfZ(px, py) - 0.005);
      st.rotation.z = rz;
      head.add(st);
    }
    for (const sd of [-1, 1]) {
      for (const [px, py] of [[0.36, 0.02], [0.37, -0.08]]) {
        const st = P(new THREE.BoxGeometry(0.13, 0.03, 0.03), S, 0);
        st.position.set(px * sd, py, surfZ(px, py) - 0.02);
        st.rotation.z = -0.2 * sd;
        st.rotation.y = 0.6 * sd;
        head.add(st);
      }
    }
    for (const a of [-1.95, -1.45, 1.45, 1.95, 2.6, -2.6]) {
      for (const y of [0.45, 0.8, 1.1]) {
        const r = torsoR(y) + 0.005;
        const st = P(new THREE.BoxGeometry(0.05, 0.2, 0.03), S, 0);
        st.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
        st.rotation.y = a;
        st.rotation.z = 0.35 * Math.sign(a);
        body.add(st);
      }
    }
    for (const sd of [-1, 1]) {
      const ruff = P(ico(0.14, 0), L, 0.02);
      ruff.position.set(0.38 * sd, -0.16, surfZ(0.3, -0.16) - 0.08);
      ruff.scale.set(1, 0.8, 0.7);
      head.add(ruff);
    }
  }
  if (cfg.mane) {
    // horse: mane along the head and neck, plus a forelock
    const M = mat(cfg.mane);
    for (const [px, py, pz, rx] of [[0, 0.43, -0.02, -0.5], [0, 0.38, -0.2, -0.8], [0, 0.24, -0.36, -1.1]]) {
      const c = P(new THREE.ConeGeometry(0.1, 0.26, 4), M, 0.01);
      c.position.set(px, py, pz);
      c.rotation.x = rx;
      head.add(c);
    }
    for (const [py, pz] of [[1.12, -0.3], [0.95, -0.36], [0.78, -0.38]]) {
      const c = P(new THREE.ConeGeometry(0.11, 0.28, 4), M, 0.01);
      c.position.set(0, py, pz);
      c.rotation.x = -1.3;
      body.add(c);
    }
    const fl = P(new THREE.ConeGeometry(0.08, 0.2, 4), M, 0.01);
    fl.position.set(0.02, 0.4, surfZ(0, 0.36) - 0.04);
    fl.rotation.x = 2.3;
    head.add(fl);
  }

  // ears
  const ears: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group();
    head.add(p);
    p.userData.side = s;
    if (cfg.ears === "tall") {
      p.position.set(0.23 * s, 0.29, 0.0);
      const e = P(new THREE.ConeGeometry(0.17, 0.38, 4), s < 0 ? F : Fd, 0.03);
      e.position.y = 0.18;
      e.rotation.y = Math.PI / 4;
      e.scale.z = 0.7;
      const inr = P(new THREE.ConeGeometry(0.09, 0.25, 3), L, 0.0);
      inr.position.set(0, 0.13, 0.05);
      inr.scale.z = 0.5;
      p.add(e, inr);
      p.rotation.z = -0.22 * s;
      p.rotation.x = 0.12;
      p.scale.setScalar(cfg.earScale ?? 1);
    } else if (cfg.ears === "big") {
      p.position.set(0.4 * s, 0.04, -0.06);
      const e = P(ico(0.42, 1), s < 0 ? F : Fd, 0.06);
      e.scale.set(1, 1.15, 0.18);
      e.position.x = 0.2 * s;
      const inr = P(ico(0.3, 1), L, 0.04);
      inr.scale.set(1, 1.1, 0.12);
      inr.position.set(0.2 * s, 0, 0.04);
      p.add(e, inr);
    } else if (cfg.ears === "floppy") {
      // pig: soft triangular ears folding forward
      p.position.set(0.25 * s, 0.3, 0.06);
      const e = P(new THREE.ConeGeometry(0.15, 0.3, 4), s < 0 ? F : Fd, 0.02);
      e.position.y = 0.12;
      e.rotation.y = Math.PI / 4;
      e.scale.z = 0.45;
      const tilt = new THREE.Group();
      tilt.rotation.x = 1.05;
      tilt.add(e);
      p.add(tilt);
    } else if (cfg.ears === "side") {
      // sheep: ears sticking out sideways
      p.position.set(0.36 * s, 0.1, -0.02);
      const e = P(ico(0.12, 1), cfg.earColor ? mat(cfg.earColor) : F, 0.01);
      e.scale.set(1.5, 0.55, 0.6);
      e.position.x = 0.1 * s;
      p.add(e);
    } else if (cfg.ears === "small") {
      p.position.set(0.27 * s, 0.36, -0.14);
      const e = P(ico(0.09, 0), Fd, 0.01);
      e.scale.z = 0.6;
      p.add(e);
    } else {
      p.position.set(0.3 * s, 0.34, -0.02);
      const e = P(ico(0.14, 0), F, 0.01);
      e.scale.z = 0.6;
      const inr = P(ico(0.08, 0), L, 0.0);
      inr.position.z = 0.05;
      inr.scale.z = 0.4;
      p.add(e, inr);
    }
    ears.push(p);
  }

  // muzzle
  let trunk: THREE.Group[] | null = null;
  let mouthY = -0.22, mouthZ = 0.56;
  if (cfg.muzzle === "trunk") {
    trunk = [];
    let parent = new THREE.Group();
    parent.position.set(0, -0.1, 0.4);
    head.add(parent);
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      if (i) seg.position.y = -0.17;
      parent.add(seg);
      const r1 = 0.13 - i * 0.016, r2 = r1 - 0.016;
      const c = P(new THREE.CylinderGeometry(r1, r2, 0.2, 6), F, 0.012);
      c.geometry.translate(0, -0.1, 0);
      seg.add(c);
      trunk.push(seg);
      parent = seg;
    }
    for (const s of [-1, 1]) {
      const tusk = P(new THREE.ConeGeometry(0.04, 0.2, 5), L, 0);
      tusk.position.set(0.15 * s, -0.24, 0.36);
      tusk.rotation.x = 2.2;
      head.add(tusk);
    }
    mouthY = -0.3;
    mouthZ = 0.4;
  } else if (cfg.muzzle === "short") {
    // Shiba: narrow wedge snout, cream urajiro cheeks, eyebrow dots
    const z0 = surfZ(0, -0.1);
    const m = P(new THREE.ConeGeometry(0.15, 0.3, 5), L, 0.015);
    m.rotation.x = Math.PI / 2;
    m.scale.set(1, 0.85, 1);
    m.position.set(0, -0.11, z0 + 0.06);
    head.add(m);
    const bridge = P(new THREE.BoxGeometry(0.12, 0.08, 0.22), F, 0.01);
    bridge.position.set(0, -0.03, z0 + 0.02);
    bridge.rotation.x = 0.25;
    head.add(bridge);
    const nose = P(ico(0.055, 0), D, 0);
    nose.scale.set(1.2, 0.85, 0.9);
    nose.position.set(0, -0.08, z0 + 0.2);
    head.add(nose);
    for (const s of [-1, 1]) {
      const ch = P(ico(0.15, 0), L, 0.015);
      ch.position.set(0.19 * s, -0.14, surfZ(0.19, -0.14) - 0.05);
      ch.scale.set(1, 0.75, 0.7);
      head.add(ch);
    }
    for (const s of [-1, 1]) {
      const b = P(ico(0.03, 0), L, 0);
      b.position.set(0.15 * s, 0.18, surfZ(0.15, 0.18) + 0.005);
      b.scale.z = 0.5;
      head.add(b);
    }
    mouthY = -0.2;
    mouthZ = z0 + 0.12;
  } else if (cfg.muzzle === "snout") {
    // pig: flat round snout disc with nostrils
    const z0 = surfZ(0, -0.1);
    const sn = P(new THREE.CylinderGeometry(0.16, 0.17, 0.16, 8), L, 0.008);
    sn.rotation.x = Math.PI / 2;
    sn.position.set(0, -0.1, z0 + 0.04);
    head.add(sn);
    for (const sd of [-1, 1]) {
      const n = new THREE.Mesh(ico(0.03, 0), D);
      n.scale.set(0.8, 1.2, 0.4);
      n.position.set(0.055 * sd, -0.1, z0 + 0.125);
      head.add(n);
    }
    mouthY = -0.29;
    mouthZ = surfZ(0, -0.29) + 0.03;
  } else if (cfg.muzzle === "horse") {
    // horse: long muzzle angled down, nostrils, white blaze
    const z0 = surfZ(0, -0.12);
    const mz = P(new THREE.BoxGeometry(0.3, 0.3, 0.46, 2, 2, 2), L, 0.03);
    mz.position.set(0, -0.2, z0 + 0.1);
    mz.rotation.x = 0.3;
    head.add(mz);
    for (const sd of [-1, 1]) {
      const n = new THREE.Mesh(ico(0.035, 0), D);
      n.scale.set(1, 0.6, 0.4);
      n.position.set(0.075 * sd, -0.25, z0 + 0.33);
      head.add(n);
    }
    const blaze = P(new THREE.BoxGeometry(0.08, 0.34, 0.03), mat(cfg.blaze ?? "#F3EDE4"), 0.005);
    blaze.position.set(0, 0.08, surfZ(0, 0.08) - 0.005);
    blaze.rotation.x = -0.25;
    head.add(blaze);
    mouthY = -0.36;
    mouthZ = z0 + 0.26;
  } else if (cfg.muzzle === "capy") {
    const m = P(new THREE.BoxGeometry(0.46, 0.4, 0.42, 2, 2, 2), Fd, 0.035);
    m.position.set(0, -0.1, 0.36);
    head.add(m);
    const nose = P(ico(0.085, 0), D, 0);
    nose.scale.set(2.0, 0.55, 0.6);
    nose.position.set(0, 0.02, 0.58);
    head.add(nose);
    mouthY = -0.2;
    mouthZ = 0.59;
  } else {
    const m = P(ico(0.21, 1), L, 0.02);
    m.scale.set(1, 0.75, 0.85);
    m.position.set(0, -0.15, 0.36);
    head.add(m);
    const nose = P(ico(0.075, 0), D, 0);
    nose.scale.set(1.3, 0.8, 0.8);
    nose.position.set(0, -0.08, 0.55);
    head.add(nose);
  }

  // eyes, mouths, blush
  const ex = cfg.eyeX ?? 0.17, ey = cfg.eyeY ?? 0.07;
  const eyeZ = surfZ(ex, ey) + 0.012;
  const eyes = [-1, 1].map((s) => {
    const e = makeEye();
    e.g.position.set(ex * s, ey, eyeZ);
    head.add(e.g);
    return e;
  });
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14, Math.PI), mouthMat);
  smile.rotation.z = Math.PI;
  const frown = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 14, Math.PI), mouthMat);
  const open = new THREE.Group();
  const openM = new THREE.Mesh(new THREE.CircleGeometry(0.075, 14, Math.PI, Math.PI), mouthMat);
  const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12, Math.PI, Math.PI), tongueMat);
  tongue.position.set(0, -0.03, 0.004);
  open.add(openM, tongue);
  smile.position.set(0, mouthY, mouthZ);
  frown.position.set(0, mouthY - 0.04, mouthZ);
  open.position.set(0, mouthY + 0.02, mouthZ);
  head.add(smile, frown, open);
  const blushMat = mat("#EE8F86", { keep: true, opacity: 0.5 });
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), blushMat);
    b.scale.set(1, 0.55, 0.4);
    b.position.set((ex + 0.12) * s, ey - 0.13, surfZ(ex + 0.12, ey - 0.13));
    head.add(b);
  }

  // --- "not fed well" details for Sluggish ---
  // tired shadows under the eyes
  const bagMat = mat("#5E5470", { keep: true, opacity: 0 });
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), bagMat);
    b.scale.set(1.15, 0.42, 0.35);
    b.position.set(ex * s, ey - 0.07, surfZ(ex, ey - 0.07) + 0.004);
    head.add(b);
  }
  // wobbly, uneasy mouth
  const wpts: THREE.Vector3[] = [];
  for (let k = 0; k <= 12; k++) wpts.push(new THREE.Vector3(-0.065 + k * 0.0108, Math.sin(k * 1.4) * 0.011, 0));
  const wobble = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wpts), 24, 0.011, 6, false), mouthMat);
  wobble.position.set(0, mouthY - 0.015, mouthZ);
  head.add(wobble);
  // a nervous sweat drop beside the head
  const dropMat = mat("#9FD3EA", { keep: true, opacity: 0, smooth: true });
  const drop = new THREE.Group();
  const dropBall = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), dropMat);
  const dropTip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.07, 14), dropMat);
  dropTip.position.y = 0.045;
  drop.add(dropBall, dropTip);
  const dropX = ex + 0.2, dropY0 = ey + 0.2;
  drop.position.set(dropX, dropY0, surfZ(dropX * 0.9, dropY0) + 0.03);
  head.add(drop);
  // empty food bowl on the plinth
  const bowlMat = mat("#C9CDD6", { keep: true });
  const bowl = new THREE.Group();
  const bowlShell = new THREE.Mesh(
    facet(new THREE.LatheGeometry([
      new THREE.Vector2(0, 0), new THREE.Vector2(0.22, 0), new THREE.Vector2(0.3, 0.05), new THREE.Vector2(0.33, 0.15),
      new THREE.Vector2(0.29, 0.15), new THREE.Vector2(0.25, 0.07), new THREE.Vector2(0, 0.07),
    ], 9), 0.008),
    bowlMat,
  );
  const crumbMat = mat("#C8A97A", { keep: true });
  for (const [px, py, pz] of [[0.06, 0.08, 0.03], [-0.08, 0.08, -0.04], [0.02, 0.08, -0.09]]) {
    const c = new THREE.Mesh(ico(0.022, 0), crumbMat);
    c.position.set(px, py, pz);
    bowl.add(c);
  }
  bowl.add(bowlShell);
  bowl.position.set(0.82, 0, 0.62);
  root.add(bowl);

  // --- Overfed ("food coma") details ---
  const feast = new THREE.Group();
  feast.add(new THREE.Mesh(bowlShell.geometry, bowlMat));
  const pastryCols = ["#E3B26A", "#C98A5A", "#F0D9A8", "#D9A55B", "#E8C48A"];
  [[0, 0.14, 0, 0.16], [0.12, 0.12, 0.05, 0.11], [-0.12, 0.12, -0.02, 0.12], [0.03, 0.27, 0.02, 0.11], [-0.05, 0.13, 0.13, 0.09]].forEach((p, k) => {
    const m = new THREE.Mesh(facet(ico(p[3], 0), 0.02), mat(pastryCols[k], { keep: true }));
    m.position.set(p[0], p[1], p[2]);
    m.scale.y = 0.75;
    feast.add(m);
  });
  const berry = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 5), mat("#D9534F", { keep: true }));
  berry.rotation.x = Math.PI;
  berry.position.set(0.04, 0.4, 0.03);
  feast.add(berry);
  // a cannolo that rolled out of the bowl
  const can = new THREE.Group();
  const shell = new THREE.Mesh(facet(new THREE.CylinderGeometry(0.055, 0.055, 0.26, 7), 0.006), mat("#C98A4A", { keep: true }));
  shell.rotation.z = Math.PI / 2;
  for (const sd of [-1, 1]) {
    const cr = new THREE.Mesh(ico(0.05, 0), mat("#F5EBD8", { keep: true }));
    cr.position.x = 0.14 * sd;
    can.add(cr);
  }
  can.add(shell);
  can.position.set(-0.2, 0.06, 0.32);
  can.rotation.y = 0.6;
  feast.add(can);
  feast.position.set(0.82, 0, 0.62);
  root.add(feast);
  // puffed cheeks
  const cheeks = [-1, 1].map((sd) => {
    const c = P(ico(0.12, 1), F, 0.01);
    c.position.set((ex + 0.13) * sd, ey - 0.14, surfZ(ex + 0.13, ey - 0.14) - 0.06);
    head.add(c);
    return c;
  });
  // crumbs on the face
  const faceCrumbs = [[0.07, -0.02], [-0.09, 0.01], [0.02, -0.05]].map(([dx, dy]) => {
    const c = new THREE.Mesh(ico(0.016, 0), crumbMat);
    c.position.set(dx, mouthY + dy, mouthZ + 0.02);
    head.add(c);
    return c;
  });
  // round "burp" mouth
  const oMouth = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.012, 6, 14), mouthMat);
  oMouth.position.set(0, mouthY, mouthZ);
  head.add(oMouth);

  // tail
  const tail = new THREE.Group();
  inner.add(tail);
  let tailAxis: "y" | "z" = "y";
  let tailBase = 0;
  if (cfg.tail === "tuft") {
    tail.position.set(0.1, 0.1, -0.45);
    const t = P(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 5), Fd, 0.01);
    t.geometry.rotateZ(-Math.PI / 2);
    t.position.x = 0.42;
    const tip = P(ico(0.1, 0), D, 0.02);
    tip.position.x = 0.88;
    tail.add(t, tip);
    tailBase = -0.9;
  } else if (cfg.tail === "curl") {
    // Shiba's curled tail, sitting up over the back like a cinnamon roll
    tail.position.set(0.28, 1.08, -0.42);
    const a0 = -Math.PI / 2 - 0.3, arc = Math.PI * 1.6;
    const t = P(new THREE.TorusGeometry(0.19, 0.085, 5, 10, arc), F, 0.02);
    t.rotation.z = a0;
    const inner2 = P(new THREE.TorusGeometry(0.19, 0.05, 4, 10, arc * 0.8), L, 0.0);
    inner2.rotation.z = a0 + arc * 0.2;
    inner2.position.z = 0.05;
    const tip = P(ico(0.08, 0), L, 0.01);
    tip.position.set(Math.cos(a0 + arc) * 0.19, Math.sin(a0 + arc) * 0.19, 0.02);
    tail.add(t, inner2, tip);
    tailAxis = "z";
  } else if (cfg.tail === "curly") {
    tail.position.set(0, 0.42, -0.56);
    const t = P(new THREE.TorusGeometry(0.07, 0.028, 5, 10, Math.PI * 1.7), Fd, 0.005);
    t.rotation.y = Math.PI / 2;
    tail.add(t);
    tailAxis = "z";
  } else if (cfg.tail === "ringed") {
    tail.position.set(0.1, 0.1, -0.45);
    const t = P(new THREE.CylinderGeometry(0.045, 0.05, 0.9, 6), Fd, 0.01);
    t.geometry.rotateZ(-Math.PI / 2);
    t.position.x = 0.45;
    tail.add(t);
    const R = mat(cfg.stripes ?? cfg.dark);
    for (const px of [0.35, 0.55, 0.72]) {
      const r = P(new THREE.CylinderGeometry(0.056, 0.056, 0.05, 6), R, 0);
      r.geometry.rotateZ(-Math.PI / 2);
      r.position.x = px;
      tail.add(r);
    }
    const tip = P(ico(0.07, 0), R, 0.01);
    tip.position.x = 0.92;
    tail.add(tip);
    tailBase = -0.9;
  } else if (cfg.tail === "woolly") {
    tail.position.set(0, 0.35, -0.58);
    tail.add(P(ico(0.14, 1), mat(cfg.wool ?? cfg.light), 0.02));
  } else if (cfg.tail === "long") {
    tail.position.set(0, 0.55, -0.5);
    const t = P(new THREE.ConeGeometry(0.14, 0.8, 6), mat(cfg.mane ?? cfg.dark), 0.03);
    t.rotation.x = Math.PI - 0.35;
    t.position.set(0, -0.3, -0.12);
    tail.add(t);
  } else if (cfg.tail === "stub") {
    tail.position.set(0, 0.3, -0.55);
    tail.add(P(ico(0.1, 0), Fd, 0.01));
  }

  // capybara's yuzu
  let yuzuHead: THREE.Group | null = null, yuzuGround: THREE.Group | null = null;
  if (cfg.yuzu) {
    const yz = () => {
      const g = new THREE.Group();
      const y = P(ico(0.13, 1), mat("#E9A84C"), 0.02);
      const lf = P(new THREE.ConeGeometry(0.05, 0.12, 3), mat("#7FA36A"), 0);
      lf.position.set(0.04, 0.14, 0);
      lf.rotation.z = -0.8;
      g.add(y, lf);
      return g;
    };
    yuzuHead = yz();
    yuzuHead.position.set(0, 0.52, -0.02);
    head.add(yuzuHead);
    yuzuGround = yz();
    yuzuGround.position.set(0.75, 0.12, 0.55);
    yuzuGround.rotation.z = 1.9;
    inner.add(yuzuGround);
  }

  const seed = Math.random() * 10;
  const hsl = { h: 0, s: 0, l: 0 };
  let lastColour = -1;

  return {
    root,
    headTop: (B.headY + 0.5) * scale,
    zAnchor: new THREE.Vector3(0.55, (B.headY + 0.72) * scale, 0),
    ph: 0,
    grumble: 0,
    burp: 0,
    oof: 0,
    applyColour(v, x, u) {
      const k = v + x * 0.5 + u * 3;
      if (Math.abs(k - lastColour) < 0.003) return;
      lastColour = k;
      for (const m of mats) {
        if (m.userData.keep) continue;
        (m.userData.base as THREE.Color).getHSL(hsl);
        // u = underfed pallor: drained, slightly cool and pale (never darker, never a size change)
        const h = hsl.h + (0.16 - hsl.h) * 0.12 * u;
        m.color.setHSL(
          h,
          clamp(hsl.s * (0.15 + 0.85 * v) * (1 + 0.12 * x) * (1 - 0.5 * u), 0, 1),
          clamp(hsl.l * (0.9 + 0.1 * v) + (1 - v) * 0.05 + x * 0.02 + u * 0.05, 0, 1),
        );
      }
    },
    update(t, v, x, ctx) {
      const u = ctx.unwell, o = ctx.over;
      const bp = (t * 0.19 + seed * 0.53) % 1, burp = !reduce && bp < 0.09 ? Math.sin((bp / 0.09) * Math.PI) * o : 0;
      this.burp = burp;
      // stuffed discomfort: every ~7 s a wince with an "oof…"
      const ofPh = (t * 0.14 + seed * 0.71) % 1, oof = !reduce && ofPh < 0.16 ? Math.sin((ofPh / 0.16) * Math.PI) * o : 0;
      this.oof = oof;
      const vE = smooth(v, 0.2, 0.7);
      const glance = u * clamp(Math.sin(t * 0.45 + seed) * 1.6, 0, 1); // looks over at the empty bowl
      const grPh = (t * 0.23 + seed * 0.37) % 1, grumble = !reduce && grPh < 0.1 ? Math.sin((grPh / 0.1) * Math.PI) * u : 0;
      this.grumble = grumble;
      const tap = ctx.happy > 0 ? Math.sin(ctx.happy * Math.PI) : 0;
      const ph = (t * 0.8 + seed) % 1;
      this.ph = ph;
      let hop = 0, sq = 1;
      if (!reduce) {
        if (ph > 0.42 && ph < 0.52) sq = 1 - 0.14 * x * Math.sin(((ph - 0.42) / 0.1) * Math.PI);
        if (ph >= 0.52) hop = Math.sin(((ph - 0.52) / 0.48) * Math.PI) * 0.3 * x;
      }
      const lift = Math.max(hop, tap * 0.25);
      const sigh = Math.sin(t * 0.9) * 0.025 * u + Math.sin(t * 1.1) * 0.03 * o;
      const breath = 1 + Math.sin(t * lerp(1.0, 2.2, v)) * lerp(0.03, 0.012, v) + sigh;
      inner.position.y = lerp(-0.08, 0, v) + lift;
      inner.scale.set(scale * (1 + (1 - sq) * 0.5), scale * sq, scale * (1 + (1 - sq) * 0.5));
      body.rotation.x = lerp(0.32, -0.04, v) - x * 0.08 + u * 0.05 - o * 0.16 + oof * 0.14;
      body.rotation.z = Math.sin(t * 4.2) * 0.09 * x + Math.sin(t * 46) * 0.035 * grumble;
      body.scale.y = lerp(0.88, 1, v) * breath;
      // fuller belly, wider haunches when overfed (+ a little jiggle on each burp)
      const puff = o * (1 + burp * 0.06);
      torso.scale.set(torsoBase.x * (1 + 0.18 * puff), torsoBase.y, torsoBase.z * (1 + 0.22 * puff));
      torsoShade.scale.copy(torso.scale);
      bib.scale.set(bibBase.x * (1 + 0.2 * puff), bibBase.y, bibBase.z * (1 + 0.3 * puff));
      belly.visible = o > 0.02;
      belly.scale.set(bellyBase.x * puff, bellyBase.y * puff, bellyBase.z * puff);
      for (const h of haunches) {
        const b0 = h.userData.base as THREE.Vector3;
        h.scale.set(b0.x * (1 + 0.14 * o), b0.y * (1 + 0.06 * o), b0.z * (1 + 0.1 * o));
        h.position.x = (h.userData.x0 as number) * (1 + 0.08 * o);
      }
      head.rotation.x = lerp(0.42, 0, v) - x * 0.14 - tap * 0.15 + glance * 0.22 - o * 0.06 - burp * 0.18 + oof * 0.16;
      head.rotation.z = Math.sin(t * 0.9 + cfg.phase) * 0.12 * smooth(v, 0.6, 1) * (1 - x) * (1 - u) + Math.sin(t * 4.2 + 0.6) * 0.2 * x + u * 0.1;
      head.rotation.y = Math.sin(t * 0.6 + cfg.phase * 2) * 0.12 * v * (1 - x) * (1 - u) - glance * 0.45;

      for (const p of ears) {
        const s = p.userData.side as number;
        const twitch = Math.sin(t * 9 + s) * 0.12 * x;
        if (cfg.ears === "tall") p.rotation.z = lerp(-1.15 * s, -0.22 * s, smooth(v, 0.15, 0.7)) + Math.max(0, Math.sin(t * 3 + s)) * 0.06 * s * v + twitch * s;
        else if (cfg.ears === "big") {
          p.rotation.y = lerp(-0.1 * s, -0.45 * s, v) + Math.sin(t * lerp(lerp(0.8, 3, v), 7, x)) * (0.18 + 0.2 * x) * s * v;
          p.rotation.z = lerp(-0.35 * s, 0, v);
        } else p.rotation.z = lerp(-0.7 * s, 0, smooth(v, 0.15, 0.7)) + twitch;
      }

      const happyEyes = tap > 0.05 || (x > 0.45 && Math.sin(t * 1.3 + seed) > -0.35);
      for (const e of eyes) {
        e.dot.visible = !happyEyes;
        e.arc.visible = happyEyes;
        let sy = lerp(0.22, 1, vE) * lerp(1, 0.68, u) * lerp(1, 0.4, o) * (1 - oof * 0.85);
        if (ctx.blink) sy = 0.12;
        e.dot.scale.y = sy;
        e.g.position.y = ey - (1 - vE) * 0.02 - u * 0.01;
      }
      const openK = Math.max(smooth(x, 0.35, 0.7), tap);
      const uneasy = (u > 0.35 || o > 0.5) && tap < 0.05;
      oMouth.visible = burp > 0.08;
      oMouth.scale.setScalar(0.7 + burp * 0.6);
      for (const c of cheeks) {
        c.visible = o > 0.02;
        c.scale.setScalar(Math.max(o * (1 + burp * 0.15), 0.001));
      }
      for (const c of faceCrumbs) c.visible = o > 0.5;
      const fk = smooth(o, 0.1, 0.5);
      feast.visible = fk > 0.01;
      feast.scale.setScalar(Math.max(fk, 0.001));
      frown.visible = v < 0.45 && !uneasy && !oMouth.visible;
      wobble.visible = uneasy && !oMouth.visible;
      open.visible = !frown.visible && !uneasy && openK > 0.5;
      smile.visible = !frown.visible && !uneasy && !open.visible && !oMouth.visible;
      open.scale.setScalar(0.7 + 0.4 * openK + Math.sin(t * 8) * 0.05 * x);
      blushMat.opacity = lerp(lerp(0.35, 0.9, Math.max(x, tap)) * (1 - u * 0.9), 0.3, o);
      bagMat.opacity = Math.max(smooth(u, 0.2, 0.7), o * 0.6) * 0.55;

      const dp = (t * 0.35 + seed) % 1;
      drop.position.y = dropY0 - dp * 0.12;
      dropMat.opacity = Math.max(smooth(u, 0.3, 0.7), o * 0.8) * Math.sin(dp * Math.PI) * 0.9;
      drop.visible = u > 0.3 || o > 0.3;
      const bk = smooth(u, 0.15, 0.4);
      bowl.visible = bk > 0.01;
      bowl.scale.setScalar(Math.max(bk, 0.001));

      if (trunk) {
        trunk.forEach((s, i) => {
          const curl = -0.34 - 0.12 * Math.sin(t * lerp(1.8, 4, x) - i * 0.6) - x * 0.22;
          s.rotation.x = i === 0 ? lerp(lerp(-0.25, -0.5, v), -1.0, x) : lerp(-0.04, curl, v) - tap * 0.25;
          s.rotation.z = Math.sin(t * 1.2 - i * 0.5) * 0.06 * v;
        });
      }
      const wag = Math.sin(t * lerp(lerp(1.5, 6, v), 13, x)) * (0.28 + 0.15 * x) * smooth(v, 0.4, 0.9) * (1 - o * 0.9);
      if (tailAxis === "z") tail.rotation.z = wag * 0.8 + lerp(0.9, 0, smooth(v, 0.2, 0.7));
      else {
        tail.rotation.y = tailBase + wag;
        tail.rotation.z = tap * 0.4 + x * 0.3;
      }

      if (yuzuHead && yuzuGround) {
        const hungry = smooth(u, 0.3, 0.6); // no yuzu at all when underfed
        const on = smooth(v, 0.3, 0.5) * (1 - hungry);
        yuzuHead.visible = on > 0.02;
        yuzuHead.scale.setScalar(Math.max(on, 0.001));
        yuzuHead.position.y = 0.52 + Math.abs(Math.sin(t * 6)) * 0.08 * x;
        yuzuHead.rotation.y = t * 2.5 * x;
        const ground = (1 - smooth(v, 0.3, 0.5)) * (1 - hungry);
        yuzuGround.visible = ground > 0.02;
        yuzuGround.scale.setScalar(Math.max(ground, 0.001));
      }
      return lift;
    },
  };
}
