// Fireworks for donations, sent up from beyond the mountains. Each bursts into a sea animal drawn in sparks;
// the bigger the donation, the bigger the animal: from 0.001 BCH an amoeba, and one animal up per doubling
// (shrimp, starfish, crab, octopus, dolphin, shark, whale from 0.128 BCH). Under 0.001 BCH: a small plain burst.

export const FIRST_ANIMAL_SATS = 100000; // 0.001 BCH
export const ANIMALS = ["amoeba", "shrimp", "starfish", "crab", "octopus", "dolphin", "shark", "whale"];

// which firework a donation gets: -1 a plain burst, else an index into ANIMALS
export function fireworkTier(sats) {
  if (!(sats >= FIRST_ANIMAL_SATS)) return -1;
  return Math.min(ANIMALS.length - 1, Math.floor(Math.log2(sats / FIRST_ANIMAL_SATS) + 1e-9));
}

// ---- the animals: strokes in a box about -1..1 (y down), each with a colour (index into the animal's palette).
// A stroke is a list of points joined by a smooth curve (closed: back to its start), or a function giving points.
const ring = (cx, cy, rx, ry, n = 24, f = () => 1) => {
  const p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = f(a); p.push([cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)]); }
  return p;
};
const mirror = (pts) => pts.map(([x, y]) => [-x, y]);
const S = (pts, col, closed = false) => ({ pts, col, closed });
// points given pointing along +x from the origin, moved to (x, y), turned by `ang` and scaled by `k`
const place = (pts, x, y, ang, k) => pts.map(([px, py]) => [x + k * (px * Math.cos(ang) - py * Math.sin(ang)), y + k * (px * Math.sin(ang) + py * Math.cos(ang))]);
// a crab's pincer, pointing along +x from the wrist at the origin: palm, then two fingers held open
const CLAW = [[0, -0.07], [0.1, -0.12], [0.22, -0.15], [0.33, -0.14], [0.44, -0.12], [0.55, -0.09], [0.45, -0.05],
  [0.36, -0.02], [0.44, 0.04], [0.5, 0.1], [0.38, 0.14], [0.24, 0.15], [0.12, 0.12], [0, 0.07]];
// an octopus arm from (x, y), setting off at angle `h` (y down), `len` long, bending more and more toward its tip
// until it curls up (turn: +1 clockwise, -1 counter-clockwise)
const arm = (x, y, h, len, turn) => {
  const p = [[x, y]], n = 14;
  for (let i = 1; i <= n; i++) {
    const t = i / n, a = h + turn * (0.6 * t + 4.2 * t ** 4), ds = (len / n) * (1 - 0.45 * t);
    x += ds * Math.cos(a); y += ds * Math.sin(a); p.push([x, y]);
  }
  return p;
};

const SHAPES = {
  amoeba: {
    palette: ["#7dffb0", "#c6ff6b", "#ffffff"],
    strokes: [
      S(ring(0, 0, 0.85, 0.7, 40, (a) => 1 + 0.16 * Math.sin(3 * a + 1) + 0.1 * Math.sin(5 * a + 2) + 0.22 * Math.max(0, Math.sin(2 * a - 0.6)) ** 6), 0, true),
      S(ring(0.12, -0.05, 0.24, 0.2, 16), 1, true), // nucleus
      S(ring(0.14, -0.06, 0.07, 0.06, 6), 2, true),
      S(ring(-0.4, 0.22, 0.09, 0.08, 8), 1, true), // vacuoles
      S(ring(0.5, 0.25, 0.07, 0.07, 8), 1, true),
      S(ring(-0.25, -0.38, 0.06, 0.06, 8), 1, true),
    ],
  },
  shrimp: { // curled, facing left
    palette: ["#ff8a6b", "#ffc29e", "#ffffff"],
    strokes: [
      S([[-0.8, 0.02], [-0.55, -0.33], [-0.12, -0.52], [0.35, -0.44], [0.68, -0.12], [0.74, 0.25], [0.55, 0.56]], 0), // back
      S([[-0.72, 0.17], [-0.48, -0.08], [-0.13, -0.24], [0.2, -0.19], [0.42, 0.0], [0.47, 0.28], [0.4, 0.52]], 0), // belly
      S([[-0.8, 0.02], [-0.72, 0.17]], 0),
      S([[-0.32, -0.45], [-0.3, -0.15]], 1), S([[0.05, -0.53], [0.03, -0.22]], 1), // shell segments
      S([[0.38, -0.43], [0.27, -0.13]], 1), S([[0.66, -0.1], [0.44, 0.03]], 1),
      S([[0.55, 0.56], [0.3, 0.85], [0.4, 0.52]], 1), S([[0.55, 0.56], [0.62, 0.92], [0.48, 0.55]], 1), // tail fan
      S([[0.55, 0.56], [0.86, 0.78], [0.5, 0.52]], 1),
      S([[-0.78, -0.02], [-0.95, -0.45], [-0.75, -0.85], [-0.35, -0.95]], 2), // antennae
      S([[-0.8, 0.05], [-1.0, -0.2], [-0.98, -0.65], [-0.7, -0.98]], 2),
      S([[-0.5, -0.08], [-0.55, 0.22]], 1), S([[-0.32, -0.17], [-0.36, 0.12]], 1), // legs
      S([[-0.14, -0.23], [-0.16, 0.05]], 1), S([[0.05, -0.22], [0.04, 0.05]], 1),
      S(ring(-0.62, -0.07, 0.05, 0.05, 6), 2, true), // eye
    ],
  },
  starfish: {
    palette: ["#ffb347", "#ff6fa8", "#fff2a8"],
    strokes: [
      S(ring(0, 0.05, 0.95, 0.95, 70, (a) => 0.36 + 0.64 * (0.5 + 0.5 * Math.cos(5 * (a + Math.PI / 2)))), 0, true),
      S(ring(0, 0.05, 0.16, 0.16, 10), 1, true),
      ...[0, 1, 2, 3, 4].flatMap((k) => { // a row of dots along each arm
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
        return [0.35, 0.55, 0.72].map((r) => S(ring(r * Math.cos(a), 0.05 + r * Math.sin(a), 0.045, 0.045, 5), k % 2 ? 1 : 2, true));
      }),
    ],
  },
  crab: { // face on, claws raised, standing on bent legs
    palette: ["#ffb02e", "#ff7a2a", "#fff1b0"],
    strokes: [
      S([[-0.44, 0.0], [-0.4, -0.16], [-0.22, -0.25], [0, -0.23], [0.22, -0.25], [0.4, -0.16], [0.44, 0.0], [0.3, 0.09], [0, 0.11], [-0.3, 0.09]], 0, true), // shell
      S([[-0.36, -0.05], [-0.16, -0.1], [0, -0.06], [0.16, -0.1], [0.36, -0.05]], 1), // brow
      S([[-0.28, 0.11], [0, 0.21], [0.28, 0.11]], 1), // underside
      ...[1, -1].flatMap((sd) => {
        const m = (pts) => (sd > 0 ? pts : mirror(pts));
        const claw = place(CLAW, -0.5, -0.17, -2.2, 1.3);
        return [
          S(m(claw), 1, false), // pincer, opening up and out
          S(m([[-0.22, 0.02], [-0.38, -0.03], claw[0]]), 0), // arm, top edge
          S(m([[-0.2, 0.12], [-0.4, 0.07], claw[claw.length - 1]]), 0), // ...bottom edge
          S(m([[-0.36, 0.05], [-0.66, -0.02], [-0.76, 0.3], [-0.82, 0.74]]), 0), // legs: up to the knee, then down
          S(m([[-0.3, 0.12], [-0.54, 0.08], [-0.6, 0.34], [-0.6, 0.66]]), 0),
          S(m([[-0.22, 0.17], [-0.38, 0.17], [-0.42, 0.38], [-0.38, 0.58]]), 0),
          S(m([[-0.08, -0.22], [-0.12, -0.33]]), 1), // eye stalk
          S(ring(-0.125 * sd, -0.37, 0.035, 0.035, 6), 2, true), // eye
        ];
      }),
    ],
  },
  octopus: { // head and mantle up to the right, eight arms spread out and curling at the tips
    palette: ["#d76bff", "#ff7ad9", "#ffe3ff"],
    strokes: [
      S([[-0.26, -0.02], [-0.3, -0.24], [-0.2, -0.5], [0.02, -0.78], [0.3, -0.9], [0.54, -0.76], [0.56, -0.48], [0.4, -0.26], [0.26, -0.02]], 0), // mantle
      ...[[-0.22, 2.75, 0.9, 1], [-0.15, 2.3, 0.85, 1], [-0.08, 1.9, 0.8, 1], [-0.02, 1.7, 0.75, -1],
        [0.03, 1.45, 0.75, 1], [0.09, 1.25, 0.8, -1], [0.16, 0.85, 0.85, -1], [0.23, 0.4, 0.9, -1]]
        .map(([x0, h, len, turn], i) => S(arm(x0, 0.0, h, len, turn), i % 2)),
      S(ring(-0.16, -0.16, 0.07, 0.06, 8), 2, true), S([[-0.2, -0.16], [-0.12, -0.16]], 2), // eyes, with their slit pupils
      S(ring(0.18, -0.16, 0.07, 0.06, 8), 2, true), S([[0.14, -0.16], [0.22, -0.16]], 2),
    ],
  },
  dolphin: { // leaping, facing right
    palette: ["#5fd3ff", "#b6f0ff", "#ffffff"],
    rot: -0.32, bend: 0.2,
    strokes: [
      S([[1.0, 0.04], [0.88, 0.0], [0.8, -0.05], [0.72, -0.14], [0.58, -0.2], [0.32, -0.23], [0.12, -0.24], // beak, melon, back
        [-0.02, -0.4], [-0.1, -0.55], [-0.06, -0.38], [-0.13, -0.22], // dorsal fin, swept back
        [-0.45, -0.14], [-0.74, -0.06], [-0.86, -0.04], [-1.0, -0.2], [-0.94, -0.02], [-0.98, 0.15], [-0.85, 0.04], // tail stock, flukes
        [-0.72, 0.06], [-0.42, 0.14], [-0.05, 0.2], [0.32, 0.18], [0.6, 0.12], [0.84, 0.06]], 0, true), // belly, jaw
      S([[0.48, 0.13], [0.38, 0.22], [0.27, 0.31], [0.31, 0.2], [0.36, 0.15]], 1), // flipper
      S([[0.94, 0.03], [0.8, 0.02]], 1), // mouth line
      S(ring(0.66, -0.06, 0.025, 0.025, 5), 2, true), // eye
    ],
  },
  shark: { // facing right
    palette: ["#9fb8d8", "#e6f0ff", "#ff6b6b"],
    strokes: [
      S([[1.0, -0.01], [0.9, -0.1], [0.7, -0.16], [0.4, -0.2], [0.22, -0.21], // snout, back
        [0.1, -0.42], [0.02, -0.62], [-0.01, -0.42], [-0.04, -0.28], [-0.12, -0.19], // dorsal fin
        [-0.36, -0.14], [-0.5, -0.12], [-0.56, -0.19], [-0.58, -0.11], [-0.72, -0.06], // second dorsal, tail stock
        [-0.86, -0.25], [-1.0, -0.5], [-0.93, -0.22], [-0.87, -0.02], [-0.95, 0.16], [-0.98, 0.28], [-0.82, 0.08], // tail
        [-0.7, 0.05], [-0.54, 0.08], [-0.57, 0.15], [-0.46, 0.1], [-0.3, 0.14], [-0.33, 0.21], [-0.2, 0.15], // anal and pelvic fins
        [0.1, 0.18], [0.46, 0.15], [0.74, 0.08], [0.92, 0.03]], 0, true), // belly, under the snout
      S([[0.42, 0.15], [0.3, 0.3], [0.16, 0.46], [0.18, 0.32], [0.24, 0.17]], 0), // pectoral fin
      ...[0.44, 0.49, 0.54, 0.59].map((x) => S([[x + 0.01, -0.07], [x - 0.02, 0.09]], 1)), // gills
      S([[0.84, 0.06], [0.72, 0.09], [0.64, 0.08]], 2), // mouth
      S(ring(0.76, -0.06, 0.025, 0.025, 5), 1, true), // eye
    ],
  },
  whale: { // facing right, spouting
    palette: ["#4d7dff", "#9fe8ff", "#ffffff"],
    strokes: [
      S([[1.0, 0.08], [0.82, -0.16], [0.35, -0.3], [-0.25, -0.24], [-0.65, -0.09], [-0.86, -0.02]], 0), // back
      S([[1.0, 0.08], [0.85, 0.22], [0.45, 0.32], [-0.05, 0.3], [-0.5, 0.18], [-0.86, 0.03]], 0), // belly
      S([[-0.86, 0], [-1.02, -0.36], [-0.93, -0.02], [-1.04, 0.3], [-0.86, 0.03]], 0), // flukes
      S([[0.3, 0.3], [0.08, 0.62], [0.16, 0.3]], 1), // flipper
      S([[0.98, 0.1], [0.72, 0.13], [0.52, 0.12]], 1), // mouth
      S([[0.82, 0.2], [0.42, 0.25]], 1), S([[0.78, 0.25], [0.35, 0.29]], 1), // throat grooves
      S(ring(0.6, 0.02, 0.04, 0.04, 6), 2, true), // eye
      S([[0.55, -0.28], [0.5, -0.6], [0.36, -0.8]], 2), S([[0.55, -0.28], [0.56, -0.7], [0.56, -0.92]], 2), // spout
      S([[0.55, -0.28], [0.62, -0.6], [0.76, -0.8]], 2),
    ],
  },
};

// points evenly spaced along an animal's strokes (Catmull-Rom curves through their points): [x, y, colour]
function sample(shape, n) {
  const curves = shape.strokes.map((st) => {
    const p = st.pts, m = p.length, pts = [];
    const at = (i) => (st.closed ? p[(i + m) % m] : p[Math.max(0, Math.min(m - 1, i))]);
    const segs = st.closed ? m : m - 1;
    for (let i = 0; i < segs; i++) {
      const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      for (let k = 0; k < 8; k++) {
        const t = k / 8, t2 = t * t, t3 = t2 * t;
        const f = (j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3);
        pts.push([f(0), f(1)]);
      }
    }
    if (!st.closed) pts.push(p[m - 1]);
    if (st.closed) pts.push(pts[0]);
    const cum = [0]; // distance along the curve to each point
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: Math.max(cum[cum.length - 1], 0.05), col: st.col, closed: st.closed };
  });
  const total = curves.reduce((a, c) => a + c.len, 0), out = [];
  const cos = Math.cos(shape.rot || 0), sin = Math.sin(shape.rot || 0);
  const bend = shape.bend || 0; // arch the body: the ends lower than the middle
  for (const c of curves) {
    const k = Math.max(3, Math.round((n * c.len) / total));
    let j = 1;
    for (let i = 0; i < k; i++) { // even steps along it (a closed one doesn't repeat its start at the end)
      const want = (c.len * i) / (c.closed ? k : k - 1);
      while (j < c.pts.length - 1 && c.cum[j] < want) j++;
      const a = c.pts[j - 1], b = c.pts[j], span = c.cum[j] - c.cum[j - 1] || 1;
      const u = Math.max(0, Math.min(1, (want - c.cum[j - 1]) / span)), x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u;
      const yb = y + bend * x * x;
      out.push([x * cos - yb * sin, x * sin + yb * cos, c.col]);
    }
  }
  return out;
}
const cache = new Map();
const pointsOf = (name, n) => { const key = `${name}:${n}`; if (!cache.has(key)) cache.set(key, sample(SHAPES[name], n)); return cache.get(key); };

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Timing, seconds: the rocket climbs for RISE; the sparks fly out against air drag and reach their places in the
// picture BLOOM later, still moving; then they fall, cool and burn out over the next LIFE (each its own share).
const RISE = 1.1, BLOOM = 0.6, LIFE = 5.6;
const DRAG = 2.8 / BLOOM; // per second: by the picture, a spark has DRAG*BLOOM time constants behind it, so it coasts
//                          on about 6% further (e^-2.8 / (1 - e^-2.8)) in the next ~0.2 s while gravity takes over
const OUT_AT_BLOOM = 1 - Math.exp(-DRAG * BLOOM);
const GRAVITY = 0.5 / 3; // the pull down on the sparks, in the firework's half-widths per s² (bigger ones are nearer)
const FALL_DRAG = 0.9; // per second, on the fall (so they drift down rather than plummet)
const TRAIL = 0.07; // s of each spark's path drawn as its streak
const PLAIN = ["#ffd36b", "#ff7ab8", "#7ae0ff", "#b0ff7a"];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Plain bursts sent up with the biggest animals, a reward for the donor. Each: [dx, dy] where it bursts from the
// animal's centre, in the animal's half-widths (dx as the animal faces right; mirrored with it, unless the fifth
// item is true: fixed left to right), its size in the same units, and its delay in seconds after the animal's
// rocket. Bursts that would go off the top or sides are kept just inside.
const ESCORTS = {
  dolphin: () => [ // three with it: ahead of its nose, above its back, and low by its tail
    [1.35, -0.1, 0.5, 0.1], [-0.4, -1.0, 0.46, 0.2], [-1.35, 0.35, 0.42, 0.3],
  ],
  shark: () => [-0.75, -0.25, 0.25, 0.75].map((dx, i) => [dx, -1.05, 0.36, 0.45 + 0.16 * i]), // four in a row above it, tail to nose
  whale: (r) => { // rapid fire sweeping across it above its back, left to right, once
    const N = 16, EVERY = 0.06;
    return Array.from({ length: N }, (_, i) => [-1.15 + (2.3 * i) / (N - 1), -1.1 + (r() - 0.5) * 0.12, 0.24, 0.55 + i * EVERY, true]);
  },
};

// where a spark is, s seconds after the burst, relative to the burst point
function sparkAt(fw, sp, s) {
  if (s <= 0) return [0, 0];
  const out = (1 - Math.exp(-DRAG * s)) / OUT_AT_BLOOM; // 1 at the picture, ~1.06 at rest
  const f = Math.max(0, s - BLOOM), g = fw.g * sp.g; // falling: from rest, up to its terminal speed
  const drop = (g / FALL_DRAG) * (f - (1 - Math.exp(-FALL_DRAG * f)) / FALL_DRAG);
  return [fw.sx * sp.tx * out, sp.ty * out + drop];
}

export class Fireworks {
  constructor(rnd) { this.rnd = rnd; this.list = []; }

  // a firework for a donation of `sats`, from a random place beyond the mountains, mostly toward the middle,
  // with its escort of plain bursts (ESCORTS) for the biggest animals.
  // sky: { W, skyline(x) -> y of the land's top there, H }
  launch(sats, sky) {
    const r = this.rnd, tier = fireworkTier(sats), u = (r() + r() + r()) / 3; // biased toward the centre
    const x = sky.W * (0.08 + 0.84 * u), top = sky.skyline(x);
    const R = Math.min(sky.W * 0.12, top * (tier < 0 ? 0.3 : Math.min(0.6, 0.36 + 0.07 * tier))); // half its width, px
    const by = Math.max(R + 4, top - R * 1.15); // where it bursts: above the ridge if there's room, and never off the top
    const bx = x + (r() - 0.5) * R * 0.3, sx = tier >= 0 && r() < 0.5 ? -1 : 1; // sx -1: the animal faces left
    this.add(tier, x, top, bx, by, R, sx, 0, R * GRAVITY);
    for (const e of tier < 0 ? [] : ESCORTS[ANIMALS[tier]]?.(r) || []) { // [dx, dy, size, delay]: in R, R, R, s
      const rp = e[2] * R, cx = clamp(bx + (e[4] ? e[0] : sx * e[0]) * R, rp + 4, sky.W - rp - 4), cy = Math.max(rp + 4, by + e[1] * R);
      const lx = cx + (r() - 0.5) * rp * 0.6; // where its rocket goes up, drifting a little on the way
      this.add(-1, lx, sky.skyline(lx), cx, cy, rp, 1, e[3], R * GRAVITY); // falling as its animal does
    }
  }

  // one rocket and its burst: animal `tier` (or -1, a plain burst) of half-width R px, going up from (x, below
  // the land's top there) to burst at (bx, by), `delay` seconds from now; its sparks fall with gravity g px/s²
  add(tier, x, top, bx, by, R, sx, delay, g) {
    const r = this.rnd;
    const pts = tier < 0 ? null : pointsOf(ANIMALS[tier], 90 + 45 * tier);
    const pal = tier < 0 ? PLAIN.map(hexRgb) : SHAPES[ANIMALS[tier]].palette.map(hexRgb);
    // each spark: its place in the picture, colour, twinkle phase, its own pull of gravity (so the picture
    // slowly smears as it falls) and its share of LIFE before it burns out
    const spark = (tx, ty, col) => ({ tx, ty, col, tw: r() * 6.3, g: 0.8 + 0.4 * r(), life: LIFE * (0.55 + 0.45 * r()) });
    const sparks = pts
      ? pts.map(([px, py, c]) => spark(px * R, py * R, pal[c]))
      : Array.from({ length: Math.round(clamp(R, 30, 60)) }, () => { const a = r() * 6.283, d = R * (0.5 + 0.5 * r()); return spark(d * Math.cos(a), d * Math.sin(a), pal[(r() * pal.length) | 0]); });
    this.list.push({ t: -delay, x, y0: top + 30, bx, by, R, g, sparks, sx });
  }

  step(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) if ((this.list[i].t += dt) > RISE + BLOOM + LIFE) this.list.splice(i, 1);
  }

  // draw them, clipped to the sky above the land (so they come up from behind the mountains)
  draw(ctx, clip) {
    if (!this.list.length) return;
    ctx.save(); ctx.clip(clip); ctx.globalCompositeOperation = "lighter";
    for (const fw of this.list) {
      if (fw.t < 0) continue; // not launched yet
      if (fw.t < RISE) { // the rocket: a spark climbing, slowing, with a short tail
        const u = fw.t / RISE, e = 1 - (1 - u) * (1 - u), x = fw.x + (fw.bx - fw.x) * e, y = fw.y0 + (fw.by - fw.y0) * e;
        const tail = Math.max(4, 22 * (1 - u));
        const g = ctx.createLinearGradient(x, y, x, y + tail);
        g.addColorStop(0, "rgba(255,236,190,0.95)"); g.addColorStop(1, "rgba(255,180,90,0)");
        ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + tail); ctx.stroke();
        ctx.fillStyle = "rgba(255,248,220,1)"; ctx.fillRect(x - 1, y - 1, 2, 2);
        continue;
      }
      const s = fw.t - RISE;
      if (s < 0.25) { // the flash
        const f = 1 - s / 0.25, g = ctx.createRadialGradient(fw.bx, fw.by, 0, fw.bx, fw.by, fw.R * 1.2);
        g.addColorStop(0, `rgba(255,250,235,${0.5 * f})`); g.addColorStop(1, "rgba(255,250,235,0)");
        ctx.fillStyle = g; ctx.fillRect(fw.bx - fw.R * 1.2, fw.by - fw.R * 1.2, fw.R * 2.4, fw.R * 2.4);
      }
      const size0 = 1.3 + fw.R / 70, after = s - BLOOM;
      for (const sp of fw.sparks) {
        const age = after / sp.life; // 0 at the picture, 1 burnt out
        if (age >= 1) continue;
        // full brightness until the picture, then cooling: dimmer, smaller, flickering more as it dies
        const a = age <= 0 ? 1 : (1 - age * age) * (age > 0.7 ? 0.55 + 0.45 * Math.sin(fw.t * 40 + sp.tw * 3) : 1);
        const tw = 0.65 + 0.35 * Math.sin(fw.t * 14 + sp.tw); // twinkle
        const size = size0 * (age <= 0 ? 1 : 1 - 0.4 * age);
        const [x, y] = sparkAt(fw, sp, s), [px, py] = sparkAt(fw, sp, s - TRAIL);
        const [r, g, b] = sp.col;
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.4 * a})`; ctx.lineWidth = size * 0.6; // the streak behind it
        ctx.beginPath(); ctx.moveTo(fw.bx + px, fw.by + py); ctx.lineTo(fw.bx + x, fw.by + y); ctx.stroke();
        ctx.fillStyle = `rgba(${r},${g},${b},${a * tw})`;
        ctx.fillRect(fw.bx + x - size / 2, fw.by + y - size / 2, size, size);
      }
    }
    ctx.restore();
  }
}

export { SHAPES, pointsOf };
