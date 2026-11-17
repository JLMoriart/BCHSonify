// The Ferry Line: the mempool as a line of souls waiting for the ferry. Runs two pages: index.html, for
// visitors (the scene with Mute and Volume, playing the published sound, web/sound.json), and studio.html
// (the same scene, plus the test controls and the sound workbench below it).
// Live: each soul is a transaction waiting in the node's mempool (from the relay), and each
// ferry takes the transactions of one block. ?source=synthetic runs on made-up traffic instead, and
// ?source=none on nothing. The page also plays the sonification from the same events.
// Layout: a perspective view inland from the end of a pier. Souls nearer the front of the
// line are closer and drawn in detail; far ones shrink to single points of light.

import { RelayFeed, relayUrl } from "./feed.js";
import { ANIMALS, FIRST_ANIMAL_SATS, Fireworks } from "./fireworks.js";
import { setupAbout } from "./about.js";
import { setupDonate } from "./donate.js";
import { CONFIG, SATS_PER_BCH, blockHold } from "./mapping.js";
import { Sonifier } from "./sonifier.js";
import { soundControls } from "./soundstart.js";
import { startingSound, workbench } from "./workbench.js";

const cv = document.getElementById("scene");
const mainCtx = cv.getContext("2d");
let ctx = mainCtx; // what everything draws into: the canvas, or for a moment the ghost ferry's own layer
const studio = !!document.getElementById("sections"); // studio.html: test controls and the workbench
// a studio control, or (on the visitors' page, which hasn't got it) a stand-in that takes its settings harmlessly
const ctl = (id) => document.getElementById(id) || {};
const countEl = ctl("count");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// world: metres. The camera hangs CAM metres above the water off the end of the pier (z = 0), looking inland (+z) and
// tilted PITCH degrees down, so the front of the line is seen from about 50 degrees above and nobody
// hides whoever is behind. FOCAL is the focal length in frame heights (0.8: about 64 degrees top to bottom).
// Together they put the horizon 14% down the frame and the water at z = 6 at the bottom edge.
const CAM = 9, PITCH = 24, FOCAL = 0.8;
const COS = Math.cos((PITCH * Math.PI) / 180), SIN = Math.sin((PITCH * Math.PI) / 180);
const NEAR_Z = -1;                 // nothing is drawn closer than this (keeps the ferry's far end in front of the lens)
const LANE_CLEAR = 1.4, LANE_MIN_GAP = 1.4; // lanes sit far enough apart that something LANE_CLEAR m tall hides nobody behind it
const ARC_REACH = 40;              // metres: flights to the ferry arc higher from farther off, levelling out around here
// The pier runs from PIER_FRONT out in the water to PIER_END on the beach; the line starts at PIER_START.
const DECK = 0.55, SHORE = 10.5, PIER_FRONT = 7.6, PIER_START = 7.9, PIER_END = 12.5, SPACING = 1.15;
const FIRST_LANE = 16;             // metres: the first lane across the sand
// how strongly a lantern colours its soul, the same at every distance: close up, a glow on the side toward it
// this strong at its brightest; mid-distance and far souls are too small for a glow, so they are tinted all over
// about as much as that glow averages
const LAMP_ON_BODY = 0.175, LAMP_ON_SMALL = 0.1, LAMP_REACH = 0.55; // ...and how far the close-up glow reaches, in soul heights
const SOUL_BODY = [212, 245, 255]; // a small soul's colour before its lantern's light
const FAR_S = 4.5;                 // souls drawn smaller than this many px are single points
const LEAVE_FOR = 1.8, LEAVE_RISE = 1.4; // a soul that left the mempool unmined rises this many metres as it fades out over this many seconds
const FALL = 1.1, CATCHUP = 4;     // seconds for a new soul to drop in; how fast the line closes up (1/s)
// The ferry glides in from the right, stops across the water in front of the pier, and carries on to the left.
const FERRY_X = 0, FERRY_Z = 7.2;   // where it stops (its middle, metres): its near side just above the bottom of the frame, the end of the pier hidden under it
// The ferry is a ghost: it appears at the pier, still, fading in over FERRY_FADE s with a shimmer; takes its
// souls; then speeds away to the left (solid) and is gone in FERRY_OUT s. The fuller its block, the slower it
// speeds up: a full block 1/32 the acceleration of an empty one (so √32 ≈ 5.7 times as long to leave). "Full" in the
// sound's sense, the block note's hold (blockHold: the cube root of size / limit).
const FERRY_FADE = 1.2, FERRY_OUT = 2.2;
const SHIMMER = 7; // px, how far the ghost ferry's rows sway, at the start of its fade
const BOW_LAMP = [3.55, 0, 2.65];   // the great lantern that takes in the souls: metres ahead of the boat's middle, aside, up
const CALL_AT = 1.6, CALL_SPREAD = 1.1; // first soul leaves this long after the block; the rest follow over this long
const START_SOULS = 2500, ARRIVALS_PER_S = 4, FIRST_BLOCK = 8, BLOCK_EVERY = 45; // made-up traffic (?source=synthetic)
// stress test (?source=stress): made-up blocks this often, each filled to the block size limit in fee order;
// transactions arrive at STRESS_FILL times the bytes a full block holds per interval, so every block is full and
// the cheapest tenth piles up behind
const STRESS_LIMIT = 32e6, STRESS_BLOCK_EVERY = 60, STRESS_FILL = 1.1;
const FERRY_STAY = 0.8;            // seconds the ferry stays docked at least, even with nobody to take
const UNKNOWN_FEE_RATE = 1;        // sats/byte assumed when the relay couldn't get a transaction's fee
const EXPLORER_TX = "https://bchexplorer.cash/tx/"; // + txid: a transaction's page on the block explorer
// lantern colour by fee: one colour per doubling of sats/byte, 1 red, 2 orange, 4 yellow, 8 green, 16 blue,
// 32 indigo, 64 violet, 128 purple, 256 and up hot magenta; evenly between them per doubling (hue, degrees)
const FEE_HUES = [0, 30, 60, 120, 240, 258, 275, 295, 320];
const TYPICAL_BYTES = 225;         // a transaction this size gets a soul of normal size
const SIZE_GROWTH = 0.08;          // ...and each doubling of its bytes adds this much (each halving removes it); no limit
const DOLLY_FROM = 2;              // bags: two or more ride on a dolly; a single one floats behind the soul
const DOLLY_X = -0.42;              // the dolly's middle, soul heights left of the soul's centre (was -0.84: it read as the next soul's)
const BAG_H = 0.11;                // bag height, in soul heights
const shotFw = /fw=([\d,]+)/.exec(location.hash); // test: fireworks for these donations (sats), launched 2.3 s (or &fwago=N s) before the shot
const shotFwAgo = +(/fwago=([\d.]+)/.exec(location.hash) || [0, 2.3])[1];
const shotDonors = /donors/.test(location.hash);   // test: every made-up soul is a donor (sparklers everywhere)
const shotBoat = /boat=([\d.]+)/.exec(location.hash), shotFull = +(/full=([\d.]+)/.exec(location.hash) || [0, 0])[1]; // test: a test boat then, for a block this full
const shotPick = /pick=(\d+)/.exec(location.hash); // test: open the details of the soul at this place in line (at once in a #shot, else after 1.5 s)
const shot = /shot=([\d.]+)/.exec(location.hash), shotAdd = /add=([\d.]+)/.exec(location.hash), shotDrop = /drop=([\d.]+)/.exec(location.hash);
const asked = new URLSearchParams(location.search).get("source");
const source = shot ? (asked === "stress" ? "stress" : "synthetic") : ["synthetic", "stress", "none"].includes(asked) ? asked : "live";
const stress = source === "stress", synthetic = source === "synthetic" || stress; // synthetic: any made-up traffic
let W = 0, H = 0, DPR = 1, yh = 0, cy = 0, f = 0, bg = null, pier = null, path = null;
let landTop = null, skyClip = null; // the top of the land (y every 2 px from x = -4), and the sky above it as a clip path
let slots = null, cap = 0, farZ = 0, farCv = null, farCtx = null, farDirty = true;
let lastText = "", frameNo = 0, frozen = false, glints = [];
let gx = 0, gz = 0, sx = 0, sy = 0, sS = 0, wx = 0, wz = 0, we = 0; // scratch outputs, to avoid allocating per soul

// x: metres right of the pier's centre line, z: metres inland from the camera, e: metres above the water
const depth = (z, e = 0) => z * COS + (CAM - e) * SIN;            // distance along the camera's line of sight
const ppm = (z, e = 0) => f / depth(z, e);                         // pixels per metre at that point
const P = (x, z, e = 0) => { const D = depth(z, e); return [W / 2 + (f * x) / D, cy + (f * ((CAM - e) * COS - z * SIN)) / D]; };
const Y = (z, e = 0) => cy + (f * ((CAM - e) * COS - z * SIN)) / depth(z, e); // screen y of a point (any x)
const across = (xs, z, e = 0) => ((xs - W / 2) * depth(z, e)) / f; // metres from the centre line under screen x, at that distance
// the height at which a point z metres inland sits `above` pixels over the top edge of the frame
const aboveFrame = (z, above) => { const t = -(cy + above) / f; return CAM - (z * (SIN + t * COS)) / (COS - t * SIN); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (v) => { const x = clamp(v, 0, 1); return x * x * (3 - 2 * x); };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function mulberry(s) { return () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(id, salt) {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- the line: down the pier, onto the beach, then switchbacks to the horizon ----
function buildPath() {
  const pts = [];
  for (let z = PIER_START; z <= PIER_END; z += 0.4) pts.push([0.55 * Math.sin((z - PIER_START) * 0.9), z]);
  pts.push([0, PIER_END + 1.2], [0, FIRST_LANE]);
  const half = (z) => (W * 0.45) / ppm(z); // every lane spans ~90% of the screen width
  let z = FIRST_LANE, dir = 1;
  while (z < 1500) {
    const a = half(z);
    pts.push([dir * a, z]);
    const z2 = z + Math.max(LANE_MIN_GAP, (LANE_CLEAR * z) / CAM), a2 = half(z2);
    for (let i = 1; i <= 10; i++) {
      const u = i / 10;
      pts.push([dir * (a + (a2 - a) * u + (z2 - z) * 0.35 * Math.sin(Math.PI * u)), z + (z2 - z) * u]);
    }
    z = z2; dir = -dir;
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  path = { pts, cum, length: cum[cum.length - 1] };
  // Standing places, front of the line first, at least SPACING apart along the line. Each new place must
  // also leave the soul there visible past the last few souls in front of it, judged on screen: either far
  // enough to the side (SIDE_CLEAR soul heights) or far enough behind that its head clears theirs (HEAD_CLEAR
  // of its height). Along a lane souls stand side by side and that holds at SPACING; along the pier and round
  // each turn between lanes, where the line runs away from us, it spaces them out.
  const SIDE_CLEAR = 1.1, HEAD_CLEAR = 0.7, LOOK_BACK = 4, STEP = 0.05;
  const WALK_CLEAR = 1.05; // ...from the end of the pier to the first lane, the whole soul clears the one in front
  const out = [], seen = []; // seen: screen x, top and height of recent places
  let j = 1, s = 0.5 * SPACING;
  const at = (d) => { // point d metres along the line
    while (cum[j] < d) j++;
    const u = (d - cum[j - 1]) / (cum[j] - cum[j - 1]);
    return [pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * u, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * u];
  };
  const view = (q) => { project(q[0], q[1], ground(q[1]) + 0.2); return [sx, sy - sS, sS]; };
  const visible = (v, z) => {
    const head = z > PIER_END - 0.3 && z < FIRST_LANE + 0.05 ? WALK_CLEAR : HEAD_CLEAR;
    return seen.every((w) => Math.abs(v[0] - w[0]) >= SIDE_CLEAR * Math.max(v[2], w[2]) || w[1] - v[1] >= head * v[2]);
  };
  let q = at(s);
  out.push(q[0], q[1]); seen.push(view(q));
  for (;;) {
    let d = s + SPACING, v = null;
    for (; d < path.length; d += STEP) { q = at(d); v = view(q); if (visible(v, q[1])) break; }
    if (d >= path.length) break;
    s = d; out.push(q[0], q[1]); seen.push(v);
    if (seen.length > LOOK_BACK) seen.shift();
  }
  cap = out.length / 2;
  slots = Float32Array.from(out);
  farZ = ((0.9 * f) / FAR_S - CAM * SIN) / COS; // beyond this, souls are drawn as single points
}

// ---- static layers ----
// The moon hangs low ahead of us over the far mountains, so everything is backlit: faces toward us are in
// shadow and crests catch a rim of moonlight, brightest near the moon.
const MOON_X = 0.79;                 // the moon's place across the frame
// The ₿ of the standard Bitcoin Cash logo, in its own 788 x 788 box (the disc: centre 394,394, radius 394,
// colour #0AC18E; the symbol white). From the logo's SVG as published at cryptologos.cc.
const BCH_LOGO = new Path2D("M516.9,261.7c-19.8-44.9-65.3-54.5-121-45.2L378,147.1L335.8,158l17.6,69.2c-11.1,2.8-22.5,5.2-33.8,8.4L302,166.8l-42.2,10.9l17.9,69.4c-9.1,2.6-85.2,22.1-85.2,22.1l11.6,45.2c0,0,31-8.7,30.7-8c17.2-4.5,25.3,4.1,29.1,12.2l49.2,190.2c0.6,5.5-0.4,14.9-12.2,18.1c0.7,0.4-30.7,7.9-30.7,7.9l4.6,52.7c0,0,75.4-19.3,85.3-21.8l18.1,70.2l42.2-10.9l-18.1-70.7c11.6-2.7,22.9-5.5,33.9-8.4l18,70.3l42.2-10.9l-18.1-70.1c65-15.8,110.9-56.8,101.5-119.5c-6-37.8-47.3-68.8-81.6-72.3C519.3,324.7,530,297.4,516.9,261.7L516.9,261.7z M496.6,427.2c8.4,62.1-77.9,69.7-106.4,77.2l-24.8-92.9C394,404,482.4,372.5,496.6,427.2z M444.6,300.7c8.9,55.2-64.9,61.6-88.7,67.7l-22.6-84.3C357.2,278.2,426.5,249.6,444.6,300.7z");
const MOONLIT = "130,240,200";      // the green moon's glints on the water
const RIM = "224,237,214", RIM_HALO = "209,222,192"; // its light on the crests: a quarter of the way from moonlight white to that green
const NIGHT = [14, 20, 34], HAZE = [78, 104, 120], MIST = [104, 120, 128]; // silhouette, horizon haze, mist in the hollows
// Far scenery beyond the end of the line, back to front. z: metres away; h: tallest, m; lam: metres between
// peaks; haze: 0 a black silhouette, 1 the colour of the sky; rim: how brightly its crest catches the moon.
const RANGES = [
  { z: 60000, h: 5200, lam: 9000, oct: 5, sharp: 1.5, haze: 0.52, rim: 0.45, seed: 5 },  // far mountains
  { z: 26000, h: 2300, lam: 4000, oct: 5, sharp: 1.7, haze: 0.32, rim: 0.7, seed: 9 },   // near mountains
  { z: 8000, h: 260, lam: 800, oct: 3, sharp: 2.2, haze: 0.2, rim: 0.8, seed: 13 },     // big dunes
  { z: 3800, h: 120, lam: 400, oct: 3, sharp: 2.2, haze: 0.13, rim: 0.9, seed: 17 },
  { z: 2200, h: 62, lam: 220, oct: 3, sharp: 2.2, haze: 0.08, rim: 1, seed: 23 },       // just past the end of the line
];

function noise1(seed) { // smooth 1D value noise, 0..1
  const r = mulberry(seed), N = 1024, v = new Float32Array(N);
  for (let i = 0; i < N; i++) v[i] = r();
  return (x) => {
    const i = Math.floor(x), u = x - i, a = v[i & (N - 1)], b = v[(i + 1) & (N - 1)];
    return a + (b - a) * u * u * (3 - 2 * u);
  };
}
function ridges(seed, oct, sharp) { // sharp-crested ridges: summed octaves of folded noise, 0..1
  const ns = [];
  for (let o = 0; o < oct; o++) ns.push(noise1(seed * 131 + o));
  return (x) => {
    let a = 1, fr = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { sum += a * Math.pow(1 - Math.abs(2 * ns[o](x * fr) - 1), sharp); norm += a; a *= 0.5; fr *= 2.1; }
    return sum / norm;
  };
}
// a soft round glow lying on the ground (or deck, or water) at height e, drawn into g
function groundGlow(g, x, z, e, r, rgbStr, a) {
  const [px] = P(x, z, e), w = ppm(z, e) * r, y1 = Y(z - r, e), y2 = Y(z + r, e);
  g.save(); g.translate(px, (y1 + y2) / 2); g.scale(1, (y1 - y2) / (2 * w));
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, w);
  gr.addColorStop(0, `rgba(${rgbStr},${a})`); gr.addColorStop(0.4, `rgba(${rgbStr},${a * 0.4})`); gr.addColorStop(1, `rgba(${rgbStr},0)`);
  g.fillStyle = gr; g.fillRect(-w, -w, 2 * w, 2 * w); g.restore();
}

function renderBg() {
  const c = document.createElement("canvas");
  c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
  const g = c.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const rng = mulberry(11);

  // sky and stars
  const sky = g.createLinearGradient(0, 0, 0, yh);
  sky.addColorStop(0, "#060a18"); sky.addColorStop(0.5, "#101b38"); sky.addColorStop(0.84, "#22395a"); sky.addColorStop(1, "#4d6e7c");
  g.fillStyle = sky; g.fillRect(0, 0, W, yh + 2);
  for (let i = 0, n = Math.round(260 * Math.min(1, yh / (H * 0.3))); i < n; i++) {
    const x = rng() * W, y = rng() * yh * 0.8, a = rng() * 0.85 * (1 - y / (yh * 0.8));
    const s = rng() < 0.06 ? 1.4 : 0.8;
    g.fillStyle = `rgba(232,240,255,${a})`; g.fillRect(x, y, s, s);
  }
  // the moon, and its light spreading along the horizon behind the mountains
  const mx = W * MOON_X, my = yh * 0.3, mr = Math.min(Math.max(9, H * 0.03), yh * 0.2);
  g.save(); g.translate(mx, yh); g.scale(1, 0.4);
  let gr = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.5);
  gr.addColorStop(0, "rgba(190,226,212,0.3)"); gr.addColorStop(1, "rgba(190,226,212,0)"); // moonlight along the horizon
  g.fillStyle = gr; g.fillRect(-W * 0.5, -W * 0.5, W, W); g.restore();
  // the moon is the Bitcoin Cash logo (BCH_LOGO), with a soft greenish halo
  gr = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 6);
  gr.addColorStop(0, "rgba(133,217,181,0.32)"); gr.addColorStop(1, "rgba(133,217,181,0)"); // halfway from moonlight white to the logo's green
  g.fillStyle = gr; g.fillRect(mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
  g.save(); g.translate(mx, my); g.scale(mr / 394, mr / 394); g.translate(-394, -394);
  g.fillStyle = "#0AC18E"; g.beginPath(); g.arc(394, 394, 394, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#FFFFFF"; g.fill(BCH_LOGO);
  g.restore();

  // the open sand where the line stands: flat, darkest near us, with moonlight glancing off it far away
  gr = g.createLinearGradient(0, yh, 0, H);
  gr.addColorStop(0, "#6b6961"); gr.addColorStop(0.07, "#4f4c46"); gr.addColorStop(0.32, "#32302c"); gr.addColorStop(1, "#1d1c1a"); // moonlit sand: silvery, a little warm
  g.fillStyle = gr; g.fillRect(0, yh, W, H - yh);
  g.save(); g.globalCompositeOperation = "lighter"; g.translate(mx, yh); g.scale(1, ((H - yh) * 0.7) / (W * 0.3));
  gr = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.3);
  gr.addColorStop(0, "rgba(120,132,128,0.25)"); gr.addColorStop(1, "rgba(120,132,128,0)");
  g.fillStyle = gr; g.fillRect(-W * 0.3, 0, W * 0.6, W * 0.3); g.restore();
  // wind ripples in the sand: a dark trough and a moonlit edge beyond it, fading with distance
  const rip = noise1(41);
  for (let z = 15, row = 0; z < 160; z += 0.7 + z * 0.03, row++) {
    const a = clamp(ppm(z) * 0.035, 0, 1);
    if (a < 0.03) break;
    for (const [dz, col] of [[0, `rgba(10,10,12,${0.22 * a})`], [0.09, `rgba(185,190,182,${0.07 * a})`]]) {
      g.strokeStyle = col; g.lineWidth = Math.max(0.6, ppm(z) * 0.035);
      g.beginPath(); let on = false;
      for (let xs = -6; xs <= W + 6; xs += 6) {
        const xw = across(xs, z), zz = z + dz + 0.25 * Math.sin(xw * 0.55 + row * 1.7) + 0.1 * Math.sin(xw * 1.7 + row);
        if (rip(xw * 0.35 + row * 9.1) > 0.42) { const y = Y(zz); on ? g.lineTo(xs, y) : g.moveTo(xs, y); on = true; } else on = false;
      }
      g.stroke();
    }
  }

  // dunes and mountains beyond the line, back to front: a silhouette misty toward its base, a halo of
  // moonlight behind the crest, and a thin bright rim on it
  landTop = null;
  for (const R of RANGES) {
    const prof = ridges(R.seed, R.oct, R.sharp), env = noise1(R.seed + 500), base = Y(R.z) + 2;
    const xs = [], ys = [];
    let top = base;
    for (let x = -4; x <= W + 4; x += 2) {
      const xw = across(x, R.z) + R.seed * 1000, y = Y(R.z, R.h * (0.35 + 0.65 * env(xw / (R.lam * 5))) * prof(xw / R.lam));
      xs.push(x); ys.push(y); top = Math.min(top, y);
    }
    if (!landTop) landTop = new Float32Array(ys.length).fill(yh);
    for (let i = 0; i < ys.length; i++) landTop[i] = Math.min(landTop[i], ys[i]);
    const n = xs.length, rimA = (x) => { const d = (x - mx) / (W * 0.3); return R.rim * (0.03 + 0.85 * Math.exp(-d * d)); };
    g.lineJoin = "round"; g.lineCap = "round";
    for (let i = 1; i < n; i += 2) { // halo behind the crest (the body covers its lower half)
      g.strokeStyle = `rgba(${RIM_HALO},${rimA(xs[i]) * 0.22})`; g.lineWidth = R.z > 10000 ? 5 : 4;
      g.beginPath(); g.moveTo(xs[i - 1], ys[i - 1]); g.lineTo(xs[i], ys[i]); g.lineTo(xs[Math.min(n - 1, i + 1)], ys[Math.min(n - 1, i + 1)]); g.stroke();
    }
    const col = mix(NIGHT, HAZE, R.haze);
    gr = g.createLinearGradient(0, top, 0, base);
    gr.addColorStop(0, rgb(col)); gr.addColorStop(1, rgb(mix(col, MIST, 0.5)));
    g.fillStyle = gr; g.beginPath(); g.moveTo(xs[0], base);
    for (let i = 0; i < n; i++) g.lineTo(xs[i], ys[i]);
    g.lineTo(xs[n - 1], base); g.closePath(); g.fill();
    g.lineWidth = R.z > 10000 ? 0.9 : 1.2;
    for (let i = 1; i < n; i++) {
      g.strokeStyle = `rgba(${RIM},${rimA(xs[i])})`;
      g.beginPath(); g.moveTo(xs[i - 1], ys[i - 1]); g.lineTo(xs[i], ys[i]); g.stroke();
    }
  }
  skyClip = new Path2D(); // the sky above the land: fireworks go off beyond the mountains
  skyClip.moveTo(-4, -50); skyClip.lineTo(W + 4, -50);
  for (let i = landTop.length - 1; i >= 0; i--) skyClip.lineTo(-4 + 2 * i, landTop[i]);
  skyClip.closePath();
  // a band of low mist where the desert meets the dunes
  gr = g.createLinearGradient(0, yh - H * 0.012, 0, yh + H * 0.03);
  gr.addColorStop(0, "rgba(130,150,158,0)"); gr.addColorStop(0.5, "rgba(130,150,158,0.2)"); gr.addColorStop(1, "rgba(130,150,158,0)");
  g.fillStyle = gr; g.fillRect(0, yh - H * 0.012, W, H * 0.042);

  // dark wet sand at the waterline, with the sky's sheen on it
  const yw = Y(SHORE + 1.3), ys = Y(SHORE);
  gr = g.createLinearGradient(0, yw, 0, ys);
  gr.addColorStop(0, "rgba(20,24,30,0)"); gr.addColorStop(0.75, "rgba(20,24,30,0.8)"); gr.addColorStop(1, "rgba(62,74,90,0.9)");
  g.fillStyle = gr; g.fillRect(0, yw, W, ys - yw + 2);
  groundGlow(g, across(mx, SHORE + 0.6), SHORE + 0.6, 0, 1.6, "180,205,200", 0.22); // the moon's gleam on the wet sand

  // water from the shoreline to the bottom of the frame
  g.beginPath();
  for (let xs = 0; xs <= W + 8; xs += 8) {
    const xw = across(xs, SHORE);
    const zz = SHORE + 0.25 * Math.sin(xw * 0.35) + 0.15 * Math.sin(xw * 1.1);
    const y = Y(zz, -0.05);
    xs === 0 ? g.moveTo(xs, y) : g.lineTo(xs, y);
  }
  g.lineTo(W + 8, H); g.lineTo(0, H); g.closePath();
  gr = g.createLinearGradient(0, ys, 0, H);
  gr.addColorStop(0, "#1b2d47"); gr.addColorStop(1, "#060c18"); // deep night blue, darkest near us
  g.fillStyle = gr; g.fill();
  g.save(); g.clip();
  for (let z = 4; z < SHORE; z += 0.45 + 0.25 * rng()) { // gentle swell: a lit back and a shaded front on each ridge of water
    for (const [dz, col] of [[0, "rgba(0,6,12,0.07)"], [0.1, "rgba(120,160,215,0.035)"]]) {
      g.strokeStyle = col; g.lineWidth = Math.max(0.8, ppm(z) * 0.05); g.beginPath();
      for (let xs = -8; xs <= W + 8; xs += 8) {
        const xw = across(xs, z), y = Y(z + dz + 0.1 * Math.sin(xw * 0.6 + z * 3) + 0.05 * Math.sin(xw * 1.9 + z));
        xs === -8 ? g.moveTo(xs, y) : g.lineTo(xs, y);
      }
      g.stroke();
    }
  }
  // the moon's glitter path: a column of glints below it, widening toward us; some twinkle (drawSurf)
  glints = [];
  for (let i = 0; i < 150; i++) {
    const u = Math.pow(rng(), 0.8), y = ys + 3 + u * (H - ys - 3), spread = W * (0.025 + 0.11 * u);
    const gx2 = mx + (rng() + rng() + rng() - 1.5) * spread, len = 3 + rng() * (6 + 16 * u);
    if (i < 70) { g.fillStyle = `rgba(${MOONLIT},${0.05 + 0.12 * rng() * (1 - u * 0.5)})`; g.fillRect(gx2 - len / 2, y, len, 1.1); }
    else glints.push([gx2, y, len, rng() * 6.28, 0.8 + rng() * 2.5]);
  }
  g.restore();
  bg = c;
}

// The pier, seen from above: weathered planks with gaps, and posts that rise from the water to carry the rails.
function renderPier() {
  const c = document.createElement("canvas");
  c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
  const g = c.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const rng = mulberry(29);
  const poly = (pts, fill) => {
    g.beginPath();
    for (let i = 0; i < pts.length; i++) { const [px, py] = P(pts[i][0], pts[i][1], pts[i][2]); i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  const Z0 = PIER_FRONT, X = 1.3, PX = 1.42, PW = 0.07, TOP = DECK + 1.0, POST_TOP = TOP + 0.06;
  const posts = [];
  for (let z = Z0 + 0.1; z <= PIER_END - 0.1; z += 1.6) posts.push(z);

  // shade on the water and sand beside the pier
  for (const s of [-1, 1]) {
    poly([[s * X, Z0, 0], [s * (X + 0.5), Z0, 0], [s * (X + 0.5), PIER_END, 0], [s * X, PIER_END, 0]], "rgba(4,6,14,0.3)");
    poly([[s * (X + 0.5), Z0, 0], [s * (X + 1.1), Z0, 0], [s * (X + 1.1), PIER_END, 0], [s * (X + 0.5), PIER_END, 0]], "rgba(4,6,14,0.13)");
  }
  // posts below the deck: the face toward us, from the water or sand up, with a lit outer edge so they read
  // against the dark water
  for (const z of posts) for (const s of [-1, 1]) {
    poly([[s * (PX - PW), z - PW, 0], [s * (PX + PW), z - PW, 0], [s * (PX + PW), z - PW, DECK], [s * (PX - PW), z - PW, DECK]], "#3a2f2a");
    const [ex0, ey0] = P(s * (PX + PW), z - PW, 0), [ex1, ey1] = P(s * (PX + PW), z - PW, DECK);
    g.strokeStyle = "rgba(170,160,150,0.45)"; g.lineWidth = Math.max(0.7, ppm(z) * 0.015);
    g.beginPath(); g.moveTo(ex0, ey0); g.lineTo(ex1, ey1); g.stroke();
  }
  // deck: planks across, each its own shade, with grain and nail heads; dark gaps between them
  poly([[-X, Z0, DECK], [X, Z0, DECK], [X, PIER_END, DECK], [-X, PIER_END, DECK]], "#110d0d");
  for (let z = Z0; z < PIER_END - 0.01; z += 0.27) {
    const z2 = Math.min(PIER_END, z + 0.245), v = (rng() - 0.5) * 24, warm = rng() * 8;
    const x0 = -X + rng() * 0.05, x1 = X - rng() * 0.05, px = Math.max(0.4, ppm(z, DECK));
    poly([[x0, z, DECK], [x1, z, DECK], [x1, z2, DECK], [x0, z2, DECK]], rgb([94 + v + warm, 82 + v, 78 + v - warm]));
    g.strokeStyle = "rgba(26,19,18,0.3)"; g.lineWidth = Math.max(0.5, px * 0.008);
    for (let k = 0; k < 2; k++) {
      const zz = z + 0.05 + rng() * 0.15, a = P(x0 + rng() * 0.7, zz, DECK), b = P(x1 - rng() * 0.7, zz + (rng() - 0.5) * 0.03, DECK);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    g.fillStyle = "rgba(18,14,14,0.65)";
    for (const nx of [-1.17, -0.4, 0.4, 1.17]) {
      const [qx, qy] = P(nx, z + 0.12, DECK), r = Math.max(0.4, px * 0.013);
      g.fillRect(qx - r, qy - r, 2 * r, 2 * r);
    }
  }
  poly([[-X, Z0, DECK], [X, Z0, DECK], [X, Z0, DECK - 0.24], [-X, Z0, DECK - 0.24]], "#2e2421"); // end of the deck, facing us
  for (const s of [-1, 1]) // edge boards
    poly([[s * (X - 0.1), Z0, DECK + 0.01], [s * X, Z0, DECK + 0.01], [s * X, PIER_END, DECK + 0.01], [s * (X - 0.1), PIER_END, DECK + 0.01]], "#4a3d37");
  // steps down to the sand
  for (let i = 0; i < 3; i++) {
    const z0 = PIER_END + i * 0.4, e = DECK * (1 - (i + 1) / 4);
    poly([[-1.1, z0, e], [1.1, z0, e], [1.1, z0 + 0.4, e], [-1.1, z0 + 0.4, e]], i % 2 ? "#574a44" : "#61534c");
  }
  // posts above the deck (front, inner side, top), then the rails along their inner sides
  for (const z of posts.slice().reverse()) for (const s of [-1, 1]) {
    const a = s * (PX - PW), b = s * (PX + PW);
    poly([[a, z - PW, DECK], [b, z - PW, DECK], [b, z - PW, POST_TOP], [a, z - PW, POST_TOP]], "#4b3e38");
    poly([[a, z - PW, DECK], [a, z + PW, DECK], [a, z + PW, POST_TOP], [a, z - PW, POST_TOP]], "#382e2a");
    poly([[a, z - PW, POST_TOP], [b, z - PW, POST_TOP], [b, z + PW, POST_TOP], [a, z + PW, POST_TOP]], "#8a786b");
  }
  for (const s of [-1, 1]) for (const [e, h, w] of [[DECK + 0.5, 0.07, 0.035], [TOP, 0.1, 0.055]]) {
    const i = s * (PX - PW - 2 * w), o = s * (PX - PW);
    poly([[i, Z0, e], [i, PIER_END, e], [i, PIER_END, e - h], [i, Z0, e - h]], "#3d322c");   // inner face
    poly([[i, Z0, e], [o, Z0, e], [o, PIER_END, e], [i, PIER_END, e]], "#857263");           // top
  }
  pier = c;
}

// ---- moving parts ----
// Waves roll in toward the beach (away from us): a faint swell line that breaks into ragged foam with a
// fading trail behind it. At the waterline the wash runs up the sand and slides back. Glints twinkle in
// the moon's glitter path.
const WAVES = 5;
const lace = noise1(77), surfFront = new Float32Array(512), surfBack = new Float32Array(512);
function drawSurf(t) {
  const Z0 = 4, span = SHORE - Z0, step = 10, n = Math.min(512, Math.ceil((W + 20) / step) + 1);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let k = 0; k < WAVES; k++) {
    const cyc = t * 0.075 + k / WAVES, z = Z0 + (cyc % 1) * span, seed = Math.floor(cyc) * 7.3 + k * 31.1;
    const brk = smooth((z - 7.4) / 2), fade = 1 - smooth((z - SHORE + 0.5) / 0.55);
    if (fade < 0.02) continue;
    const trail = 0.2 + 0.9 * brk;
    let yf = 0, yb = 0;
    for (let i = 0; i < n; i++) {
      const xw = across(-10 + i * step, z);
      const zc = z + 0.14 * Math.sin(xw * 0.8 + k * 2.1 + t * 0.35) + 0.07 * Math.sin(xw * 2.1 + k * 1.3);
      surfFront[i] = Y(zc); surfBack[i] = Y(zc - trail); yf += surfFront[i]; yb += surfBack[i];
    }
    if (brk > 0.02) { // foam trailing behind the breaking crest
      const gr = ctx.createLinearGradient(0, yf / n, 0, yb / n);
      gr.addColorStop(0, `rgba(205,222,232,${0.2 * brk * fade})`); gr.addColorStop(1, "rgba(215,232,240,0)");
      ctx.fillStyle = gr; ctx.beginPath();
      for (let i = 0; i < n; i++) ctx.lineTo(-10 + i * step, surfFront[i]);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(-10 + i * step, surfBack[i]);
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(214,230,238,${(0.1 + 0.4 * brk) * fade})`;
    ctx.lineWidth = Math.max(1, ppm(z) * (0.035 + 0.09 * brk));
    const thr = 0.6 - 0.34 * brk; // more of the crest turns to foam as it breaks
    ctx.beginPath();
    for (let i = 0, on = false; i < n; i++) {
      const xs = -10 + i * step;
      if (lace(across(xs, z) * 0.9 + seed) > thr) { on ? ctx.lineTo(xs, surfFront[i]) : ctx.moveTo(xs, surfFront[i]); on = true; } else on = false;
    }
    ctx.stroke();
  }
  // the wash at the waterline
  const sw = 0.5 + 0.5 * Math.sin(t * 0.55), reach = 0.4 * sw * sw;
  ctx.strokeStyle = `rgba(220,234,240,${0.2 + 0.18 * (1 - sw)})`;
  ctx.lineWidth = Math.max(1, ppm(SHORE) * 0.05);
  ctx.beginPath();
  for (let xs = 0, on = false; xs <= W + 8; xs += 8) {
    const xw = across(xs, SHORE);
    const zz = SHORE - 0.2 + reach + 0.25 * Math.sin(xw * 0.35) + 0.15 * Math.sin(xw * 1.1) + 0.06 * Math.sin(xw * 3 + t);
    if (lace(xw * 1.3 + 400) > 0.28) { const y = Y(zz, -0.05); on ? ctx.lineTo(xs, y) : ctx.moveTo(xs, y); on = true; } else on = false;
  }
  ctx.stroke();
  ctx.globalCompositeOperation = "lighter";
  for (const [x, y, len, ph, sp] of glints) {
    const a = Math.sin(t * sp + ph);
    if (a > 0.25) { ctx.fillStyle = `rgba(${MOONLIT},${0.6 * a * a * a})`; ctx.fillRect(x - len / 2, y, len, 1.2); }
  }
  ctx.globalCompositeOperation = "source-over";
}

// Each soul's lantern throws a pool of its colour on the ground (or deck) where it stands.
const POOL_R = 1.2, POOL_ALPHA = 0.12; // metres; how strongly (for a soul at least POOL_FULL px tall; fainter when smaller)
const POOL_FULL = 30;
const poolSprites = new Map();
function poolSprite(lamp) {
  let c = poolSprites.get(lamp);
  if (!c) {
    c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, `rgba(${lamp},1)`); r.addColorStop(0.35, `rgba(${lamp},0.45)`); r.addColorStop(1, `rgba(${lamp},0)`);
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    poolSprites.set(lamp, c);
  }
  return c;
}
function drawPools(list) {
  ctx.globalCompositeOperation = "lighter";
  for (const s of list) {
    standAt(s);
    const x = gx + 0.4, e = ground(gz), D = depth(gz, e), w = (f * POOL_R) / D, a = smooth(((0.9 * f) / D - 6) / (POOL_FULL - 6));
    if (a < 0.02) continue;
    const y1 = Y(gz - POOL_R, e), y2 = Y(gz + POOL_R, e);
    ctx.globalAlpha = POOL_ALPHA * a;
    ctx.drawImage(poolSprite(s.tr.lamp), W / 2 + (f * x) / D - w, y2, 2 * w, y1 - y2);
  }
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
}

// Lantern colour for a fee rate (FEE_HUES), in 8 steps per doubling so lanterns share a few colours.
function lampColor(rate) {
  const d = Math.round(8 * clamp(Math.log2(rate), 0, FEE_HUES.length - 1)) / 8, i = Math.min(d | 0, FEE_HUES.length - 2);
  const h = FEE_HUES[i] + (FEE_HUES[i + 1] - FEE_HUES[i]) * (d - i);
  const ch = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.6 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; // HSL, full saturation, 60% light
  return [ch(0), ch(8), ch(4)];
}

// What a transaction's soul looks like (tx: a relay tx event; ones from before the relay started have no
// outputs). rate: its fee in sats per byte.
function txTraits(tx, rate) {
  const c = lampColor(rate), bytes = tx.size > 0 ? tx.size : TYPICAL_BYTES;
  return {
    lamp: c.join(","),                                                    // lantern light
    lampCss: `rgb(${c.join(",")})`,                                       // ...as a fill colour (the lantern of mid souls)
    litCss: `rgb(${SOUL_BODY.map((v, i) => Math.round(v + (c[i] - v) * LAMP_ON_SMALL)).join(",")})`, // a small soul's body in its light
    glass: `rgb(${c.map((v) => Math.round(v + (255 - v) * 0.55)).join(",")})`, // the lantern itself, paler
    bags: Math.max(0, (tx.outputs ? tx.outputs.length : 1) - 1),          // one per extra output
    nft: !!tx.nft, ft: !!tx.ft, memo: !!tx.memo,
    donation: tx.donation > 0 ? tx.donation : 0,                          // sats to the site: a sparkler, not a lantern
    scale: 1 + SIZE_GROWTH * Math.log2(bytes / TYPICAL_BYTES), // bigger transaction, bigger soul
  };
}

function wisp(sw) {
  const r = 0.3, cy = -0.68;
  ctx.beginPath();
  ctx.moveTo(-r, cy);
  ctx.arc(0, cy, r, Math.PI, 0);
  ctx.bezierCurveTo(r, cy + 0.3, 0.1 + sw, -0.22, sw * 2, 0);
  ctx.bezierCurveTo(-0.08 + sw, -0.2, -r, cy + 0.32, -r, cy);
}

const BAG_COLS = ["#8c5a3c", "#5d6b8a", "#7a4a5f", "#5f7a56", "#9a7b3f"];

// A luggage dolly to the soul's left, bags stacked as high as it takes (only the part on screen is drawn).
// ground: the ground's y in soul units; topY: the top of the canvas in soul units.
function drawDolly(n, id, ground, topY, px) {
  const cx = DOLLY_X, deck = ground - 0.085;
  ctx.strokeStyle = "#7d848f"; ctx.lineWidth = 0.022; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(cx - 0.21, deck + 0.02); ctx.lineTo(cx - 0.21, -0.5); ctx.quadraticCurveTo(cx - 0.21, -0.58, cx - 0.13, -0.58); ctx.stroke(); // upright and grip
  ctx.fillStyle = "#4a4f5a"; ctx.fillRect(cx - 0.22, deck, 0.44, 0.03);
  ctx.fillStyle = "#23262c";
  for (const wx of [-0.13, 0.13]) { ctx.beginPath(); ctx.arc(cx + wx, ground - 0.038, 0.038, 0, Math.PI * 2); ctx.fill(); }
  const outline = BAG_H * px >= 4; // skip outlines once bags are a few pixels tall
  ctx.strokeStyle = "#2b1d14"; ctx.lineWidth = 0.012;
  for (let i = 0; i < n; i++) {
    const by = deck - (i + 1) * BAG_H;
    if (by + BAG_H < topY) break; // the rest is above the top of the frame
    const w = 0.3 + ((i * 7 + id) % 4) * 0.02, bx = cx - w / 2 + (((i * 37 + id * 11) % 5) - 2) * 0.008;
    ctx.fillStyle = BAG_COLS[(i + id) % BAG_COLS.length];
    ctx.fillRect(bx, by, w, BAG_H - 0.006);
    if (outline) ctx.strokeRect(bx, by, w, BAG_H - 0.006);
  }
}

// A certificate of authenticity floating by the soul's head: parchment, gold border, seal and ribbons.
function drawCertificate(id, t) {
  const w = 0.42, h = 0.3;
  ctx.save();
  ctx.translate(-0.5, -1.14 + Math.sin(t * 1.3 + id) * 0.015); ctx.rotate(-0.12);
  ctx.fillStyle = "rgba(255,244,210,0.22)"; ctx.fillRect(-w / 2 - 0.03, -h / 2 - 0.03, w + 0.06, h + 0.06); // faint glow
  ctx.fillStyle = "#f7efd8"; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = "#b8892e"; ctx.lineWidth = 0.02; ctx.strokeRect(-w / 2 + 0.014, -h / 2 + 0.014, w - 0.028, h - 0.028);
  ctx.strokeStyle = "#8a6420"; ctx.lineWidth = 0.006; ctx.setLineDash([0.018, 0.01]);
  ctx.strokeRect(-w / 2 + 0.042, -h / 2 + 0.042, w - 0.084, h - 0.084);
  ctx.setLineDash([]);
  ctx.fillStyle = "#b8892e";
  for (const cx of [-1, 1]) for (const cy of [-1, 1]) { // corner ornaments
    const ox = cx * (w / 2 - 0.042), oy = cy * (h / 2 - 0.042);
    ctx.beginPath(); ctx.moveTo(ox, oy - 0.02); ctx.lineTo(ox + 0.02, oy); ctx.lineTo(ox, oy + 0.02); ctx.lineTo(ox - 0.02, oy); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "#3b2f20"; ctx.fillRect(-0.1, -0.085, 0.2, 0.024);                      // heading
  ctx.fillStyle = "#9a8c72";
  ctx.fillRect(-0.13, -0.035, 0.26, 0.01); ctx.fillRect(-0.13, -0.005, 0.26, 0.01); ctx.fillRect(-0.13, 0.025, 0.14, 0.01); // lines of text
  ctx.fillStyle = "#a3283a";                                                              // ribbons, then the seal
  ctx.beginPath(); ctx.moveTo(0.085, 0.06); ctx.lineTo(0.07, 0.135); ctx.lineTo(0.095, 0.115); ctx.lineTo(0.11, 0.135); ctx.lineTo(0.135, 0.06); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#c93a50"; ctx.beginPath();
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, r = k % 2 ? 0.038 : 0.047; ctx.lineTo(0.11 + r * Math.cos(a), 0.055 + r * Math.sin(a)); }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#f0cd84"; ctx.lineWidth = 0.008; ctx.beginPath(); ctx.arc(0.11, 0.055, 0.022, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// A sparkler held in the right hand (drawn in the hand's coordinates, soul heights): a wire, burnt black toward
// the tip, the tip white-hot, and sparks of the lantern's colour flying off it, new ones 24 times a second.
const SPARK_TIP = [0.52, -0.95];
// A sparkler: a wire whose tip burns white-hot, throwing sparks of its lantern's colour. Each spark is a
// particle that flies straight out from the tip, slowing and drooping a little, and burns out: drawn as a
// short streak behind it (its motion), thinning and dimming as it dies. Spark k of a soul relaunches every
// cycle in a new direction (from a hash), so the sparks move smoothly rather than flickering.
const SPARK_DROOP = 1.2; // soul heights per s², the pull down on a spark
// the glow around a sparkler: [distance out (of its radius), opacity], a bell curve easing to nothing at the edge
const SPARK_GLOW = Array.from({ length: 11 }, (_, i) => { const u = i / 10; return [u, +(0.6 * Math.exp(-5 * u * u) * (1 - u * u)).toFixed(3)]; });
function drawSparkler(tr, id, t, B) {
  const [tx, ty] = SPARK_TIP;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#8a8d94"; ctx.lineWidth = 0.014;
  ctx.beginPath(); ctx.moveTo(0.33, -0.47); ctx.lineTo(0.33 + (tx - 0.33) * 0.6, -0.47 + (ty + 0.47) * 0.6); ctx.stroke();
  ctx.strokeStyle = "#3b3434"; ctx.lineWidth = 0.02; // the burnt part
  ctx.beginPath(); ctx.moveTo(0.33 + (tx - 0.33) * 0.6, -0.47 + (ty + 0.47) * 0.6); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.globalCompositeOperation = "lighter";
  const n = B > 40 ? 24 : 14;
  for (let k = 0; k < n; k++) {
    const seed = id * 131 + k, life = 0.22 + 0.2 * hash(seed, 1), cycle = life + 0.04 + 0.12 * hash(seed, 2);
    const run = t + cycle * hash(seed, 3), i = Math.floor(run / cycle), age = run - i * cycle;
    if (age >= life) continue; // between sparks
    const h = hash(seed, 100 + i), a = h * Math.PI * 2, reach = 0.12 + 0.22 * hash(seed, 200 + i);
    const at = (u) => { // where it is, u seconds into its flight: flying out, slowing, drooping
      const f = u / life, d = reach * f * (2 - f);
      return [tx + Math.cos(a) * d, ty + Math.sin(a) * d + SPARK_DROOP * u * u];
    };
    const f = age / life, [hx, hy] = at(age), [qx, qy] = at(Math.max(0, age - 0.06));
    ctx.strokeStyle = `rgba(${tr.lamp},${0.95 * (1 - f * f)})`; ctx.lineWidth = 0.02 * (1 - 0.6 * f);
    ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(hx, hy); ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,252,240,0.95)"; // the burning tip: a small white-hot point, no halo
  ctx.beginPath(); ctx.arc(tx, ty, 0.022, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

// S: pixels per soul height for a normal-size soul here. Only the body grows with the transaction's size;
// what it carries stays the same size and moves out to stay in its hands, by its head or beside it.
function drawSoul(x, y, S, s, t, called) {
  const tr = s.tr, id = s.id, k = tr.scale, B = S * k; // B: pixels per soul height for this body
  const body = () => ctx.setTransform(DPR * B, 0, 0, DPR * B, DPR * x, DPR * y);
  const carried = (ox, oy) => ctx.setTransform(DPR * S, 0, 0, DPR * S, DPR * (x + ox * S), DPR * (y + oy * S)); // shifted by (ox, oy) soul heights
  const g = k - 1, ground = 0.222, topY = -(y + 10) / S; // souls float 0.2 m up; ground and canvas top in soul heights
  const rx = 0.33 * g, ry = -0.47 * g;   // how far the right hand has moved from a normal soul's
  const lx = -0.31 * g, ly = -0.48 * g;  // ...the left hand
  const side = -0.3 * g, head = -0.98 * g; // ...the left edge of the body, and the top of the head
  const sw = Math.sin(t * 2.1 + id * 0.9) * 0.08, alpha = ctx.globalAlpha; // alpha: < 1 while fading away
  if (B < 16) { // mid distance: body, lantern, and a hint of the big things
    body();
    if (called) { ctx.fillStyle = "rgba(255,200,110,0.6)"; ctx.beginPath(); ctx.arc(0, -0.6, 0.66, 0, Math.PI * 2); ctx.fill(); }
    if (tr.bags >= DOLLY_FROM) { // the stack on its dolly, as one block
      carried(side, 0);
      const top = Math.max(topY, ground - 0.085 - tr.bags * BAG_H);
      ctx.fillStyle = "#7c5a44"; ctx.fillRect(DOLLY_X - 0.16, top, 0.32, ground - top);
      body();
    }
    wisp(sw); ctx.fillStyle = "rgba(212,245,255,0.88)"; ctx.fill();
    ctx.globalAlpha *= LAMP_ON_SMALL; ctx.fillStyle = tr.lampCss; ctx.fill(); ctx.globalAlpha = alpha; // in its lantern's light
    if (tr.nft) { carried(side, head); ctx.fillStyle = "#f7efd8"; ctx.fillRect(-0.7, -1.28, 0.4, 0.28); }
    carried(rx, ry); ctx.fillStyle = tr.lampCss;
    if (tr.donation) { ctx.fillRect(0.42, -1.0, 0.16, 0.16); ctx.fillStyle = "#fffbe8"; ctx.fillRect(0.47, -0.95, 0.06, 0.06); } // sparkler
    else ctx.fillRect(0.36, -0.8, 0.15, 0.17);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return;
  }
  carried(0, 0); // shadow on the ground: from above it shows where a floating soul stands
  ctx.fillStyle = "rgba(24,14,34,0.2)"; ctx.beginPath(); ctx.ellipse(0, ground, 0.2 * k, 0.065 * k, 0, 0, Math.PI * 2); ctx.fill();
  body();
  if (called) { // only a soul being called glows (gold); waiting souls have no aura, so the lanterns stand out
    const glow = ctx.createRadialGradient(0, -0.6, 0.05, 0, -0.6, 0.9);
    glow.addColorStop(0, "rgba(255,205,115,0.85)"); glow.addColorStop(1, "rgba(255,205,115,0)");
    ctx.fillStyle = glow; ctx.fillRect(-0.95, -1.55, 1.9, 1.9);
  }
  // lantern light: the same size and brightness for everyone, coloured by fee per byte. A sparkler's is a
  // wider glow that fades out very gradually (a bell curve), with no edge to see.
  carried(rx, ry);
  if (tr.donation) {
    const [gx, gy] = SPARK_TIP, R = 0.6, lg = ctx.createRadialGradient(gx, gy, 0, gx, gy, R);
    for (const [u, a] of SPARK_GLOW) lg.addColorStop(u, `rgba(${tr.lamp},${a})`);
    ctx.fillStyle = lg; ctx.fillRect(gx - R, gy - R, 2 * R, 2 * R);
  } else {
    const lg = ctx.createRadialGradient(0.47, -0.735, 0, 0.47, -0.735, 0.42);
    lg.addColorStop(0, `rgba(${tr.lamp},0.75)`); lg.addColorStop(0.4, `rgba(${tr.lamp},0.3)`); lg.addColorStop(1, `rgba(${tr.lamp},0)`);
    ctx.fillStyle = lg; ctx.fillRect(0.47 - 0.44, -0.735 - 0.44, 0.88, 0.88);
  }
  // luggage, one bag per extra output: one or two float behind the tail, more go on a dolly
  if (tr.bags >= DOLLY_FROM) { carried(side, 0); drawDolly(tr.bags, id, ground, topY, S); }
  else if (tr.bags) { // one suitcase standing upright, seen face-on (a dolly bag's length is its height), floating behind the tail
    carried(0.1 * g, 0);
    const w = 0.24, h = 0.32, bx = 0.13, by = -0.37 + Math.sin(t * 2 + id) * 0.01;
    ctx.fillStyle = BAG_COLS[id % BAG_COLS.length]; ctx.strokeStyle = "#2b1d14"; ctx.lineWidth = 0.012;
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, 0.03); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + w / 2 - 0.05, by); ctx.lineTo(bx + w / 2 - 0.05, by - 0.035); // handle
    ctx.lineTo(bx + w / 2 + 0.05, by - 0.035); ctx.lineTo(bx + w / 2 + 0.05, by); ctx.stroke();
    ctx.fillStyle = "rgba(43,29,20,0.45)"; // two straps
    ctx.fillRect(bx + w * 0.28, by, 0.022, h); ctx.fillRect(bx + w * 0.72 - 0.022, by, 0.022, h);
  }
  // body
  body();
  wisp(sw);
  const fill = ctx.createLinearGradient(0, -1, 0, 0);
  fill.addColorStop(0, "rgba(242,252,255,0.98)"); fill.addColorStop(0.55, "rgba(204,241,255,0.92)"); fill.addColorStop(1, "rgba(160,225,255,0)");
  ctx.fillStyle = fill; ctx.fill();
  // its lantern's light on the side of the body and face toward it (the lantern, in body units)
  const Lx = 0.33 + 0.14 / k, Ly = -0.47 - 0.265 / k;
  const lamp = ctx.createRadialGradient(Lx, Ly, 0, Lx, Ly, LAMP_REACH);
  lamp.addColorStop(0, `rgba(${tr.lamp},${LAMP_ON_BODY})`); lamp.addColorStop(0.55, `rgba(${tr.lamp},${LAMP_ON_BODY * 0.45})`); lamp.addColorStop(1, `rgba(${tr.lamp},0)`);
  ctx.fillStyle = lamp; ctx.fill();
  // arms
  ctx.fillStyle = "rgba(226,248,255,0.95)";
  ctx.beginPath(); ctx.ellipse(-0.31, -0.48, 0.065, 0.042, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0.31, -0.48, 0.065, 0.042, 0.5, 0, Math.PI * 2); ctx.fill();
  // face
  ctx.fillStyle = "#20264a";
  for (const ex of [-0.1, 0.1]) { ctx.beginPath(); ctx.ellipse(ex, -0.69, 0.034, 0.05, 0, 0, Math.PI * 2); ctx.fill(); }
  if (B > 40) {
    ctx.fillStyle = "#ffffff";
    for (const ex of [-0.088, 0.112]) { ctx.beginPath(); ctx.arc(ex, -0.705, 0.011, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "rgba(255,150,180,0.45)";
    for (const ex of [-0.18, 0.18]) { ctx.beginPath(); ctx.arc(ex, -0.61, 0.04, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = "#20264a"; ctx.lineWidth = 0.014;
    ctx.beginPath(); ctx.arc(0, -0.645, 0.045, 0.35, Math.PI - 0.35); ctx.stroke();
  }
  // lantern on a pole in the right hand, or for a donor, a sparkler burning in the lantern's colour
  carried(rx, ry);
  if (tr.donation) drawSparkler(tr, id, t, B);
  else {
    ctx.strokeStyle = "#5a3b22"; ctx.lineWidth = 0.02;
    ctx.beginPath(); ctx.moveTo(0.33, -0.47); ctx.lineTo(0.47, -0.86); ctx.stroke();
    ctx.fillStyle = tr.glass; ctx.fillRect(0.42, -0.8, 0.1, 0.13);
    ctx.strokeStyle = "#5a3b22"; ctx.lineWidth = 0.012; ctx.strokeRect(0.42, -0.8, 0.1, 0.13);
  }
  // coin in the left hand, scroll under the left arm
  if (tr.ft || tr.memo) carried(lx, ly);
  if (tr.ft) {
    ctx.fillStyle = "#d9b25e"; ctx.strokeStyle = "#8a6420"; ctx.lineWidth = 0.012;
    ctx.beginPath(); ctx.arc(-0.39, -0.53, 0.075, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-0.39, -0.53, 0.045, 0, Math.PI * 2); ctx.stroke();
  }
  if (tr.memo) {
    ctx.fillStyle = "#efe0bf"; ctx.strokeStyle = "#8b7350"; ctx.lineWidth = 0.01;
    ctx.fillRect(-0.52, -0.38, 0.17, 0.08); ctx.strokeRect(-0.52, -0.38, 0.17, 0.08);
    for (const sx of [-0.52, -0.35]) { ctx.beginPath(); ctx.arc(sx, -0.34, 0.03, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  if (tr.nft) { carried(side, head); drawCertificate(id, t); }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// ---- the line: who stands where ----
// line[] is front first: highest fee per byte first, equal fees in arrival order.
// s.p is its place in line (its index in line[], once it has moved there); s.x, s.z where it stands now.
// s.st: 0 waiting, 1 dropping in, 2 called by the ferry, 3 flying to it, 4 aboard
const sonifier = new Sonifier(); // the sound: fed the same events as the line
const line = [], arrivals = [], flyers = [], leavers = []; // leavers: fading away, nearest last
const byTxid = new Map(), blockQueue = []; // live: the soul of each waiting transaction; blocks not yet shown
const SHOW_QUEUED = 3; // blocks waiting for a ferry: at most this many are shown, one after another
const rnd = mulberry(7);
let nextId = 1, now = 0, block = null, lastTook = 0, lastLeft = 0, arrivalAcc = 0, nextBlockAt = FIRST_BLOCK;

const ground = (z) => (z < PIER_END ? DECK : z < PIER_END + 1.2 ? DECK * (1 - (z - PIER_END) / 1.2) : 0);
// where a soul stands on the ground now (it moves there in a straight line, see step) -> gx, gz
function standAt(s) {
  if (!(s.x === s.x)) { locate(s.p); s.x = gx; s.z = gz; } // new: straight to its place
  gx = s.x; gz = s.z;
}
function locate(p) { // place p in line -> gx, gz
  if (p <= 0) { gx = slots[0]; gz = slots[1]; return; }
  if (p >= cap - 1) { gx = slots[cap * 2 - 2]; gz = slots[cap * 2 - 1]; return; }
  const i = p | 0, u = p - i, a = i * 2;
  gx = slots[a] + (slots[a + 2] - slots[a]) * u; gz = slots[a + 1] + (slots[a + 3] - slots[a + 1]) * u;
}
function project(x, z, e) { // -> sx, sy, and sS: the height in pixels of a normal soul there
  const D = depth(z, e);
  sx = W / 2 + (f * x) / D; sy = cy + (f * ((CAM - e) * COS - z * SIN)) / D; sS = (0.9 * f) / D;
}

function randomFee() { // sats per byte: most pay the 1 sat/B minimum
  const r = rnd();
  return r < 0.88 ? 1 : r < 0.97 ? 1 + rnd() : 2 + 48 * rnd() * rnd();
}
// A made-up transaction, shaped like the relay's: 1/2/3/5 outputs weighted 2:8:2:0.5 (like the workbench's
// synthetic feed) plus, 1.5% of the time, 8 to 60 outputs; 1 to 6 inputs, mostly few; amounts log-normal around
// 0.05 BCH (sigma 2.2); 5% hold an NFT, 9% tokens, 7% an OP_RETURN.
function madeUpTx() {
  const r = rnd() * 12.5, nOut = rnd() < 0.015 ? 8 + Math.floor(rnd() * 53) : r < 2 ? 1 : r < 10 ? 2 : r < 12 ? 3 : 5, outputs = [];
  const nIn = 1 + Math.floor(6 * rnd() * rnd());
  for (let i = 0; i < nOut; i++) {
    const g = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    outputs.push(Math.max(546, Math.floor(Math.exp(Math.log(0.05) + 2.2 * g) * SATS_PER_BCH)));
  }
  const tx = { type: "tx", t: sonifier.serverNow(), txid: `synthetic-${nextId}`, outputs, size: 10 + 148 * nIn + 34 * nOut, nft: rnd() < 0.05, ft: rnd() < 0.09, memo: rnd() < 0.07 };
  if (rnd() < 0.01 || shotDonors) madeUpDonation(tx); // ~one every 25 s
  return tx;
}
// make a made-up transaction a donation: 0.0005 to 0.3 BCH (log-uniform), so every firework turns up
function madeUpDonation(tx) {
  tx.donation = Math.round(50000 * Math.pow(600, rnd()));
  tx.outputs.push(tx.donation); tx.size += 34;
}
function addMadeUp(fee, delay, sound) { // sound: also play it (not for the crowd at the start or the 1,000 at once)
  const tx = madeUpTx();
  addSoul(fee, delay, tx);
  if (sound) { sonifier.event(tx); celebrate(tx); }
}
// a firework for a donation as it arrives (not for ones already waiting when the page starts)
function celebrate(tx) {
  if (tx.donation > 0 && landTop && !document.hidden) fireworks.launch(tx.donation, sky);
}
const fireworks = new Fireworks(mulberry(23));
const sky = { get W() { return W; }, skyline: (x) => landTop[clamp(Math.round((x + 4) / 2), 0, landTop.length - 1)] };
// A stress-test transaction: drawn to show every look a soul can have, often. Fee: a third at the 1 sat/B
// minimum, a third across 1-10, a third 10-300 (every lantern colour, and past hot magenta). 0.5% donate. Outputs: no bag, one
// suitcase, small and tall dollies, 5% up to 2,000 (a stack well off the top of the frame). Inputs: mostly
// 1-2, some consolidations up to 600 (big souls). Never over the 100 kB standard limit. Amounts log-uniform from
// dust to 1,000 BCH, so every harmonic sounds. NFT, fungible tokens and OP_RETURN each independently common.
function stressTx() {
  const r = rnd();
  const fee = r < 0.33 ? 1 : r < 0.66 ? 1 + 9 * rnd() : 10 * Math.pow(30, rnd());
  const o = rnd(), nOut = o < 0.3 ? 1 : o < 0.55 ? 2 : o < 0.8 ? 3 + Math.floor(3 * rnd()) : o < 0.95 ? 6 + Math.floor(55 * rnd()) : 61 + Math.floor(1940 * rnd() * rnd());
  const i = rnd(), nIn = i < 0.7 ? 1 + Math.floor(2 * rnd()) : i < 0.95 ? 3 + Math.floor(18 * rnd()) : 21 + Math.floor(580 * rnd());
  const nft = rnd() < 0.15, ft = rnd() < 0.2, memo = rnd() < 0.15;
  const ins = Math.min(nIn, Math.floor((99000 - 34 * nOut) / 148)); // under 100 kB with its outputs
  const size = 10 + 148 * Math.max(1, ins) + 34 * nOut + (nft || ft ? 40 : 0) + (memo ? 60 : 0), outputs = [];
  for (let k = 0; k < nOut; k++) outputs.push(Math.floor(546 * Math.pow(1000 * SATS_PER_BCH / 546, rnd())));
  const tx = { type: "tx", t: sonifier.serverNow(), txid: `synthetic-${nextId}`, outputs, size, fee: Math.round(fee * size), nft, ft, memo };
  if (rnd() < 0.005) madeUpDonation(tx); // ~0.9 a second
  return { tx, fee };
}
// Stress-test miner: the line is in fee order, so take from the front whatever still fits under the limit.
function mineFull() {
  if (block) return false;
  const chosen = [];
  let bytes = 0;
  for (const s of line) {
    if (s.st > 1 || bytes + s.tx.size > STRESS_LIMIT) continue;
    chosen.push(s); bytes += s.tx.size;
    if (STRESS_LIMIT - bytes < 200) break; // full
  }
  if (!chosen.length) return false;
  beginBlock(chosen, false, fullness(bytes, STRESS_LIMIT));
  sonifier.event({ type: "block", t: sonifier.serverNow(), hash: `synthetic-${nextId}`, size: bytes, limit: STRESS_LIMIT });
  return true;
}
function addSoul(fee, delay, tx) { // fee: sats per byte; delay < 0: appear in place with no drop; tx: its transaction
  const s = { id: nextId++, fee, tx, tr: txTraits(tx, fee), txid: tx.txid, gone: "", x: NaN, z: NaN, p: 0, st: 0, u: 0, t0: 0, dx: 0, launch: 0, dur: 0, ox: 0, oz: 0, oe: 0, k: 0 };
  byTxid.set(tx.txid, s);
  let lo = 0, hi = line.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (line[m].fee >= fee) lo = m + 1; else hi = m; }
  line.splice(lo, 0, s);
  s.p = lo;
  if (delay >= 0 && !reduce && lo < cap) { s.st = 1; s.t0 = now + delay; s.u = -1; s.dx = (hash(s.id, 7) - 0.5) * 0.12; arrivals.push(s); }
  else farDirty = true;
  return s;
}

function compact() { // drop everyone who boarded or left; the rest then close up
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i].st < 3) line[w++] = line[i];
    else byTxid.delete(line[i].txid);
  }
  line.length = w; farDirty = true;
}
function land(s) { // a soul still dropping in is put straight in its place
  if (s.st !== 1) return;
  const i = arrivals.indexOf(s);
  if (i >= 0) arrivals.splice(i, 1);
  s.st = 0; farDirty = true;
}
// Left the mempool without being mined: out of the line at once, but seen rising and fading where it stood
// (unless the show is skipped, or it was past the horizon). Call sortLeavers() after a batch.
function dropSoul(s, unseen) {
  land(s); s.st = 4; s.gone = "dropped"; farDirty = true;
  if (unseen || reduce || s.p >= cap) return;
  standAt(s); s.ox = gx; s.oz = gz; s.launch = now + 0.5 * hash(s.id, 9); // a little stagger, so they don't go as one
  leavers.push(s);
}
const sortLeavers = () => leavers.sort((a, b) => b.oz - a.oz); // back to front

// Made-up miner: mostly the front of the line, skipping ~4% of it, plus ~3% picked from anywhere behind.
function mineBlock() {
  if (block) return false;
  const waiting = line.filter((s) => s.st === 0);
  if (!waiting.length) return false;
  const want = Math.max(1, Math.round(waiting.length * (0.3 + 0.6 * rnd())));
  const strays = Math.round(want * 0.03), chosen = [];
  let i = 0;
  for (; i < waiting.length && chosen.length < want - strays; i++) if (rnd() > 0.04) chosen.push(waiting[i]);
  const picked = new Set();
  for (let k = 0; k < strays && i < waiting.length; k++) picked.add(i + Math.floor(rnd() * (waiting.length - i)));
  [...picked].sort((a, b) => a - b).forEach((j) => chosen.push(waiting[j]));
  beginBlock(chosen, false, fullness(chosen.length * 400, 32e6)); // its size as the sound has it, below
  if (shotDrop) { // test (#shot=…&drop=0.5): that share of the rest leave the mempool unmined, as live ones can
    lastLeft = 0;
    for (const s of waiting) if (s.st === 0 && rnd() < +shotDrop[1]) { dropSoul(s, false); lastLeft++; }
    sortLeavers();
  }
  sonifier.event({ type: "block", t: sonifier.serverNow(), hash: `synthetic-${nextId}`, size: chosen.length * 400, limit: 32e6 }); // as if 400 bytes each
  return true;
}

// how full a block is, 0..1, as the sound has it: its block note's hold as a share of the longest
const fullness = (size, limit) => blockHold({ size, limit }) / CONFIG.blockTarget;
let nextFerry = 0;
// The ferry comes for these souls (front of the line first). unseen: skip the show, they are simply gone.
// full: how full the block is (fullness), for how heavily the ferry speeds away.
function beginBlock(chosen, unseen, full = 0) {
  const n = chosen.length;
  for (const s of chosen) land(s);
  if (unseen) {
    for (const s of chosen) s.st = 4;
    compact(); lastTook = n;
    return;
  }
  block = { t0: now, phase: "load", chosen, next: 0, aboard: 0, flash: 0, leaveT: 0, tally: null, full, seed: nextFerry++ };
  if (reduce) { // no flights: they are simply aboard, and the ferry shows for a moment
    for (const s of chosen) s.st = 4;
    compact();
    Object.assign(block, { phase: "leave", next: n, aboard: n, leaveT: now + 2.5 });
  } else chosen.forEach((s, r) => { s.st = 2; s.launch = now + CALL_AT + CALL_SPREAD * (r / n); });
  farDirty = true;
}

// ---- live: the relay's events ----
function addTx(tx, delay) {
  if (tx.confirmed || byTxid.has(tx.txid)) return; // confirmed: it never waited in line
  addSoul(tx.fee >= 0 && tx.size > 0 ? tx.fee / tx.size : UNKNOWN_FEE_RATE, delay, tx);
}
function liveBlock(ev, unseen) {
  const chosen = [];
  for (const id of ev.txids || []) { const s = byTxid.get(id); if (s && s.st < 2) chosen.push(s); }
  for (const id of ev.dropped || []) { // left the mempool without being mined
    const s = byTxid.get(id);
    if (s && s.st < 2) { dropSoul(s, unseen); lastLeft++; }
  }
  sortLeavers();
  chosen.sort((a, b) => a.p - b.p);
  beginBlock(chosen, unseen, fullness(ev.size, ev.limit));
  if (!block) compact();
}
const liveFeed = {
  hello(msg) { // (re)connected: start over from the relay's list of waiting transactions
    line.length = arrivals.length = flyers.length = leavers.length = blockQueue.length = 0;
    byTxid.clear(); block = null; lastTook = lastLeft = 0; farDirty = true;
    closeDetails(); // its soul is gone with the old line
    for (const tx of msg.mempool || []) addTx(tx, -1);
  },
  event(ev) {
    if (ev.type === "tx") { addTx(ev, document.hidden ? -1 : 0); celebrate(ev); } // nobody watching: no drop to catch up on later
    else if (ev.type === "block") blockQueue.push(ev);
  },
};

// where the ferry's middle is across the frame at time `at`: in front of the pier, then (leaving) speeding
// off to the left until all of it is past the frame's edge
function ferryX(at) {
  const b = block;
  if (b.phase !== "leave") return FERRY_X;
  const u = clamp((at - b.leaveT) / leaveFor(b), 0, 1);
  return FERRY_X + (ferryGone() - FERRY_X) * u * u;
}
// the ferry's middle once the last of it (the stern and roof, and the end of its wake on the water) is a few
// pixels past the left edge of the frame: the furthest left that each of those corners needs to go
const FERRY_TAIL = [[3.5, 4.6], [7.8, 0]]; // [metres behind the middle, up to this high]
function ferryGone() {
  let x = Infinity;
  for (const [back, up] of FERRY_TAIL) for (const v of [-1.8, 1.8]) for (const e of [0, up]) {
    x = Math.min(x, across(-4, FERRY_Z - v, e) - back); // the corner `back` metres behind the middle sits at -4 px
  }
  return x;
}
// seconds for the ferry to leave: the same run at 1/(1 + 31 full) the acceleration
const leaveFor = (b) => FERRY_OUT * Math.sqrt(1 + 31 * b.full);
// how solid the ferry is (0 not there, 1 solid): fading in at the pier, then solid until it's gone
const ferryAlpha = (at) => (block.phase === "leave" ? 1 : smooth((at - block.t0) / FERRY_FADE));

function step(dt) {
  now += dt;
  fireworks.step(dt);
  if (stress) {
    arrivalAcc += (dt * STRESS_FILL * STRESS_LIMIT) / STRESS_BLOCK_EVERY; // bytes due
    while (arrivalAcc > 0) { const { tx, fee } = stressTx(); arrivalAcc -= tx.size; addSoul(fee, 0, tx); sonifier.event(tx); celebrate(tx); }
    if (now >= nextBlockAt && mineFull()) nextBlockAt = now + STRESS_BLOCK_EVERY;
  } else if (synthetic) {
    arrivalAcc += dt * ARRIVALS_PER_S;
    while (arrivalAcc >= 1) { arrivalAcc -= 1; addMadeUp(randomFee(), 0, true); }
    if (now >= nextBlockAt && mineBlock()) nextBlockAt = now + BLOCK_EVERY;
  } else if (!block && blockQueue.length) { // one ferry at a time: each block waits its turn for the show (a
    // block seconds behind another gets its own ferry once the first has gone), but if more than SHOW_QUEUED
    // piled up (a tab in the background, say), the older ones are simply gone
    lastLeft = 0; // counted over this block and any skipped ones before it
    while (blockQueue.length > SHOW_QUEUED) liveBlock(blockQueue.shift(), true);
    liveBlock(blockQueue.shift(), false);
  }

  // everyone not in their place moves toward it, in a straight line across the ground (there are no ropes to
  // follow)
  const k = 1 - Math.exp(-dt * CATCHUP);
  for (let i = 0; i < line.length; i++) {
    const s = line[i];
    s.p = i;
    locate(i);
    if (s.x !== gx || s.z !== gz) {
      const dx = gx - s.x, dz = gz - s.z;
      if (reduce || !(s.x === s.x) || Math.abs(dx) + Math.abs(dz) < 0.01 + gz * 0.001) { s.x = gx; s.z = gz; }
      else { s.x += dx * k; s.z += dz * k; }
      farDirty = true;
    }
  }
  for (let i = leavers.length - 1; i >= 0; i--) if (now >= leavers[i].launch + LEAVE_FOR) leavers.splice(i, 1);
  for (let i = arrivals.length - 1; i >= 0; i--) {
    const s = arrivals[i];
    s.u = (now - s.t0) / FALL;
    if (s.u >= 1) { s.st = 0; arrivals.splice(i, 1); farDirty = true; }
  }
  const b = block;
  if (!b) return;
  b.flash *= Math.exp(-dt * 6);
  if (b.phase === "load") {
    while (b.next < b.chosen.length && b.chosen[b.next].launch <= now) { // lift off from wherever it stands
      const s = b.chosen[b.next++];
      if (s.p >= cap) { s.st = 4; b.aboard++; continue; } // over the horizon: no flight to see, just aboard
      standAt(s);
      s.ox = gx; s.oz = gz; s.oe = ground(gz) + 0.3; s.launch = now; s.u = 0;
      s.dur = 0.55 + 0.45 * clamp(Math.log(gz / 10) / Math.log(150), 0, 1) + 0.15 * rnd();
      s.k = 0.08 + 0.1 * hash(s.id, 8);
      s.st = 3; flyers.push(s); farDirty = true;
    }
    for (let i = flyers.length - 1; i >= 0; i--) {
      const s = flyers[i];
      s.u = (now - s.launch) / s.dur;
      if (s.u >= 1) { s.st = 4; flyers.splice(i, 1); b.aboard++; b.flash = Math.min(1, b.flash + 0.25); }
    }
    if (b.aboard === b.chosen.length && now >= b.t0 + FERRY_FADE + FERRY_STAY) { compact(); b.phase = "leave"; b.leaveT = now + 0.25; }
  } else if (now >= b.leaveT + leaveFor(b)) { if (!b.test) lastTook = b.chosen.length; block = null; }
}

// where a soul is partway through its drop (u 0..1) -> wx, wz, we
function arrivalPos(s, u) {
  standAt(s);
  const left = Math.pow(1 - u, 2.2), stand = ground(gz) + 0.2, top = aboveFrame(gz, 40); // top: just above the frame
  wx = gx + s.dx * gz * left; wz = gz; we = stand + (top - stand) * left;
}
// where a soul is partway through its flight to the ferry's lantern -> wx, wz, we
function flightPos(s, u) {
  const uu = u * u * (3 - 2 * u), lx = ferryX(now) - BOW_LAMP[0], lz = FERRY_Z;
  wz = s.oz * Math.pow(lz / s.oz, uu); // even steps in apparent size, so far souls don't hang at the horizon
  const w = Math.abs(lz - s.oz) > 0.05 ? (wz - s.oz) / (lz - s.oz) : uu;
  wx = s.ox + (lx - s.ox) * w;
  we = s.oe + (BOW_LAMP[2] - s.oe) * w + s.k * ARC_REACH * (1 - Math.exp(-wz / ARC_REACH)) * Math.sin(Math.PI * uu);
}
// Landing: the light falls toward the middle of the soul's body (LAND_MID soul heights up), and over the last
// part of its fall (from u = LAND_FROM) the soul condenses around it: the tail fades, the light swells into a
// soft glow and dims, and the soul fades in, full size, inside it. At rest the glow is gone and the soul is there.
const LAND_FROM = 0.68, LAND_MID = 0.6;
const landing = (s) => { const v = clamp((s.u - LAND_FROM) / (1 - LAND_FROM), 0, 1); return v * v * (3 - 2 * v); }; // 0..1, eased
const arrivalWisp = (s) => (s.u > LAND_FROM ? sS : 0);                               // full size, fading in
const flightWisp = (s) => (s.u < 0.35 ? 0.9 * ppm(s.oz, s.oe) * (1 - s.u / 0.35) : 0); // shrinks to a spark as it leaves

// souls in the air: a streak of light each, plus the wisp itself while close to the ground. land: arriving
// souls, whose light aims at the body's middle and turns into the soul as it lands (see LAND_FROM)
const thin = [], thick = [], wisps = [];
function streaks(list, pos, lag, col, wispSize, t, land = false) {
  thin.length = thick.length = wisps.length = 0;
  ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(${col},0.5)`; ctx.lineWidth = 1; ctx.beginPath();
  for (const s of list) {
    if (s.u < 0) continue;
    pos(s, Math.max(0, s.u - lag)); project(wx, wz, we);
    const up = land ? LAND_MID * sS : 0, tx = sx, ty = sy - up; // (a soul's size doesn't change as it falls)
    pos(s, s.u); project(wx, wz, we);
    const m = land ? landing(s) : 0;
    if (sS >= 6) thick.push(tx, ty, sx, sy - up, m, sS); else { ctx.moveTo(tx, ty); ctx.lineTo(sx, sy - up); thin.push(sx, sy - up, sS); }
    const ws = wispSize(s);
    if (ws >= FAR_S) wisps.push(s, sx, sy, ws, m);
  }
  ctx.stroke();
  ctx.lineWidth = 1.7;
  for (let i = 0; i < thick.length; i += 6) { // near ones one by one: each fades on its own as it lands
    const [ax, ay, hx, hy, m, S] = thick.slice(i, i + 6);
    if (m < 1) {
      ctx.strokeStyle = `rgba(${col},${0.5 * (1 - m)})`;
      ctx.beginPath(); ctx.moveTo(ax + (hx - ax) * m, ay + (hy - ay) * m); ctx.lineTo(hx, hy); ctx.stroke(); // tail shortening
    }
    if (m > 0) { // the light swelling into a soft glow the size of the body, and dimming
      const r = 2.2 + 0.55 * S * m, g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r), a = 0.9 * (1 - m);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.35, `rgba(${col},${a * 0.45})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(hx - r, hy - r, 2 * r, 2 * r);
    } else {
      ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(hx, hy, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = `rgb(${col})`;
  for (let i = 0; i < thin.length; i += 3) { const w = clamp(thin[i + 2] * 0.5, 1.2, 2.4); ctx.fillRect(thin[i] - w / 2, thin[i + 1] - w / 2, w, w); }
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < wisps.length; i += 5) {
    const m = wisps[i + 4];
    if (land) ctx.globalAlpha = m; // fading in (leaving souls shrink instead)
    drawSoul(wisps[i + 1], wisps[i + 2], wisps[i + 3], wisps[i], t, false);
  }
  ctx.globalAlpha = 1;
}

// ---- the ferry: a lacquered bathhouse boat, all vermilion pillars, glowing paper screens and a tiled
// roof with upturned eaves, and a great paper lantern hung over its bow that takes in the souls ----
// Boat coordinates: u metres toward the bow (it always points left), v metres toward us, e metres up.
const MOON_DIR = (() => { const l = Math.hypot(0.25, 1, 0.35); return [0.25 / l, 1 / l, 0.35 / l]; })(); // (x, z, e)
const HULL_U = [], HULL_W = [], HULL_E = [];
for (let i = 0; i <= 14; i++) { // hull plan: half-width and gunwale height along its length
  const u = -3.2 + (6.4 * i) / 14, bow = Math.max(0, (u - 0.8) / 2.4), stern = Math.max(0, (-u - 2.6) / 0.6);
  HULL_U.push(u);
  HULL_W.push(1.1 * Math.max(0.06, Math.sqrt(Math.max(0, 1 - bow * bow))) * (1 - 0.15 * stern * stern));
  HULL_E.push(0.8 + 0.45 * bow * bow + 0.15 * Math.max(0, (-u - 2) / 1.2) ** 2);
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function facing(pts, inside) { // a polygon's outward unit normal (Newell), pointing away from `inside`
  let nx = 0, ny = 0, nz = 0, cx = 0, cy3 = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    cx += a[0]; cy3 += a[1]; cz += a[2];
  }
  const c = [cx / pts.length, cy3 / pts.length, cz / pts.length], l = Math.hypot(nx, ny, nz) || 1;
  let n = [nx / l, ny / l, nz / l];
  if (dot3(n, [c[0] - inside[0], c[1] - inside[1], c[2] - inside[2]]) < 0) n = [-n[0], -n[1], -n[2]];
  const toCam = [-c[0], -c[1], CAM - c[2]];
  return { pts, n, c, vis: dot3(n, toCam) > 0, far: Math.hypot(toCam[0], toCam[1], toCam[2]) };
}
const moonlit = (col, n) => { const k = 0.4 + 0.2 * Math.max(0, n[2]) + 0.5 * Math.max(0, dot3(n, MOON_DIR)); return rgb(col.map((v) => Math.round(v * k))); };
function path3(pts, close = true) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) { const [px, py] = P(pts[i][0], pts[i][1], pts[i][2]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  if (close) ctx.closePath();
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const patch = (A, B, C, D, s, t) => lerp3(lerp3(A, B, s), lerp3(D, C, s), t); // a point on wall A-B (bottom) to D-C (top)

// On the water around the ferry (drawn under the pier): shade under the hull, the screens' glow, the great
// lantern's reflection, and a wake while it moves or rings spreading from it while it rests.
function drawFerryWater(t) {
  const bx = ferryX(now), Z = FERRY_Z, B3 = (u, v, e) => [bx - u, Z - v, e];
  const speed = Math.abs(ferryX(now) - ferryX(now - 0.05)) / 0.05, moving = clamp(speed / 5, 0, 1);
  const lw = (m) => Math.max(0.5, ppm(Z) * m);
  ctx.fillStyle = "rgba(3,6,12,0.35)";
  path3([...Array(15).keys()].map((i) => B3(-3.3 + (6.6 * i) / 14, HULL_W[i] * 1.3, -0.02)).concat([...Array(15).keys()].reverse().map((i) => B3(-3.3 + (6.6 * i) / 14, -HULL_W[i] * 1.3, -0.02))));
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  groundGlow(ctx, bx + 0.55, Z - 2, 0, 2.6, "255,196,120", 0.16);
  const [rx0, ry0] = P(bx - BOW_LAMP[0], Z - 0.3, -BOW_LAMP[2]), rpx = ppm(Z, 0);
  ctx.save(); ctx.translate(rx0 + Math.sin(t * 2.3) * rpx * 0.06, ry0); ctx.scale(1, 3);
  const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rpx * 0.55);
  gr.addColorStop(0, "rgba(255,206,140,0.35)"); gr.addColorStop(1, "rgba(255,206,140,0)");
  ctx.fillStyle = gr; ctx.fillRect(-rpx * 0.55, -rpx * 0.55, rpx * 1.1, rpx * 1.1); ctx.restore();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (moving > 0.02) for (const sd of [1, -1]) {
    ctx.lineWidth = lw(0.07);
    ctx.strokeStyle = `rgba(230,242,248,${0.5 * moving})`; // bow wave, curling out from the stem
    path3([B3(2.95, 0, 0), B3(2.2, 0.8 * sd, 0), B3(1.3, 1.25 * sd, 0)], false); ctx.stroke();
    for (let j = 0; j < 6; j++) { // wake: foam spreading behind the stern, fading as it goes
      const u0 = -3.1 - j * 0.8, u1 = u0 - 0.55;
      ctx.strokeStyle = `rgba(230,242,248,${0.42 * moving * (1 - j / 6)})`;
      path3([B3(u0, (0.85 + 0.16 * j) * sd, 0), B3(u1, (0.85 + 0.16 * (j + 0.7)) * sd, 0)], false); ctx.stroke();
    }
  }
  for (const ph of [0, 0.5]) { // rings spreading from the hull while it rests
    const r = (t * 0.3 + ph) % 1, a = 0.22 * (1 - r) * (1 - moving);
    if (a < 0.01) continue;
    ctx.strokeStyle = `rgba(220,235,245,${a})`; ctx.lineWidth = lw(0.04);
    path3([...Array(15).keys()].map((i) => B3((-3.05 + (5.8 * i) / 14) * (1 + 0.12 * r), HULL_W[i] * 0.84 * (1 + 0.8 * r) + 0.1 * r, -0.02))
      .concat([...Array(15).keys()].reverse().map((i) => B3((-3.05 + (5.8 * i) / 14) * (1 + 0.12 * r), -HULL_W[i] * 0.84 * (1 + 0.8 * r) - 0.1 * r, -0.02))));
    ctx.stroke();
  }
}

// The ferry, solid, or while it fades in a ghost of it: drawn into a layer of its own, then laid on the
// scene in thin rows, each swaying sideways in a ripple that runs up the boat and stills as it solidifies,
// with glints of light twinkling over it while it's least there.
let ferryCv = null;
function drawGhostFerry(t) {
  const a = ferryAlpha(now);
  if (a >= 1) { drawFerry(t); return; }
  if (a <= 0.003) return;
  if (!ferryCv) ferryCv = document.createElement("canvas");
  if (ferryCv.width !== cv.width || ferryCv.height !== cv.height) { ferryCv.width = cv.width; ferryCv.height = cv.height; }
  const fl = ferryCv.getContext("2d");
  fl.setTransform(1, 0, 0, 1, 0, 0); fl.clearRect(0, 0, ferryCv.width, ferryCv.height);
  fl.setTransform(DPR, 0, 0, DPR, 0, 0); fl.globalAlpha = 1; fl.globalCompositeOperation = "source-over";
  ctx = fl;
  try { drawFerry(t); } finally { ctx = mainCtx; }
  // the rows the boat (and its lantern's glow) can cover
  const bx = ferryX(now), [, top] = P(bx, FERRY_Z, 7), [, bottom] = P(bx, FERRY_Z - 2, -0.5);
  const y0 = Math.max(0, Math.floor((top - 20) * DPR)), y1 = Math.min(cv.height, Math.ceil((bottom + 10) * DPR));
  const row = Math.max(2, Math.round(2 * DPR)), sway = SHIMMER * DPR * (1 - a) * (1 - a);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let y = y0; y < y1; y += row) {
    const yc = y / DPR, dx = sway * (Math.sin(yc * 0.12 + t * 9) + 0.5 * Math.sin(yc * 0.041 - t * 5.3));
    ctx.globalAlpha = a * (0.9 + 0.1 * Math.sin(yc * 0.5 + t * 23)); // a faint flicker along the rows
    ctx.drawImage(ferryCv, 0, y, cv.width, row, dx, y, cv.width, row);
  }
  ctx.restore();
  const m = 4 * a * (1 - a); // glints: most while it's half there
  if (m < 0.02) return;
  const [lx] = P(bx - 3.3, FERRY_Z, 1), [rx] = P(bx + 3.3, FERRY_Z, 1), [, gy0] = P(bx, FERRY_Z, 4), [, gy1] = P(bx, FERRY_Z, 0);
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < 40; k++) {
    const h1 = hash(block.seed * 97 + k, 1), h2 = hash(block.seed * 97 + k, 2), h3 = hash(block.seed * 97 + k, 3);
    const gx = lx + (rx - lx) * h1, gy = gy1 + (gy0 - gy1) * h2 - (t - block.t0) * 10 * (0.5 + h3);
    const tw = Math.max(0, Math.sin(t * (7 + 6 * h3) + k * 2.1)), al = m * tw * tw, r = 1 + 1.5 * h3;
    if (al < 0.03) continue;
    ctx.fillStyle = `rgba(215,240,255,${al})`;
    ctx.fillRect(gx - r * 0.35, gy - r * 2.2, r * 0.7, r * 4.4); ctx.fillRect(gx - r * 2.2, gy - r * 0.35, r * 4.4, r * 0.7); // a little cross
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawFerry(t) {
  const b = block, bx = ferryX(now), bob = 0.04 * Math.sin(t * 1.3), Z = FERRY_Z;
  const B3 = (u, v, e) => [bx - u, Z - v, e + bob]; // boat coordinates -> world (x, z, e)
  const px0 = ppm(Z, 1.5), lw = (m) => Math.max(0.5, px0 * m); // line widths in metres
  let gr;
  const G = [], Bd = [], WL = [];
  for (const side of [1, -1]) for (let i = 0; i <= 14; i++) {
    const u = HULL_U[i], w = HULL_W[i] * side, uw = -3.05 + (5.8 * i) / 14;
    G.push(B3(u, w, HULL_E[i])); Bd.push(B3(u, w * 0.99, HULL_E[i] - 0.16)); WL.push(B3(uw, w * 0.84, 0));
  }
  const near = (i) => i, far = (i) => 15 + i; // ring indices: the side toward us, the side away

  // hull: a vermilion band under the gunwale, black lacquer below it
  const inHull = B3(0, 0, 0.3), faces = [];
  for (const sd of [near, far]) for (let i = 0; i < 14; i++) {
    faces.push([facing([G[sd(i)], G[sd(i + 1)], Bd[sd(i + 1)], Bd[sd(i)]], inHull), [168, 50, 40]]);
    faces.push([facing([Bd[sd(i)], Bd[sd(i + 1)], WL[sd(i + 1)], WL[sd(i)]], inHull), [44, 30, 28]]);
  }
  for (const i of [0, 14]) faces.push([facing([G[near(i)], G[far(i)], WL[far(i)], WL[near(i)]], inHull), [44, 30, 28]]);
  faces.filter((f) => f[0].vis).sort((a, c) => c[0].far - a[0].far).forEach(([f, col]) => { path3(f.pts); ctx.fillStyle = moonlit(col, f.n); ctx.fill(); });
  const deck = G.slice(0, 15).concat(G.slice(15).reverse());
  path3(deck); ctx.fillStyle = moonlit([120, 92, 74], [0, 0, 1]); ctx.fill();
  ctx.strokeStyle = "rgba(217,164,71,0.85)"; ctx.lineWidth = lw(0.035); path3(G.slice(0, 15), false); ctx.stroke(); // gold trim
  ctx.strokeStyle = "rgba(228,234,255,0.55)"; ctx.lineWidth = 1.1; path3(G.slice(15), false); ctx.stroke();    // moonlit far edge

  // cabin: vermilion frame, paper screens lit from inside, an indigo curtain over the door at the front
  const E0 = 0.8, E1 = 2.0, CU0 = -2.4, CU1 = 1.3, CV = 0.82, inCab = B3(-0.55, 0, 1.4);
  const walls = [
    { pts: [B3(CU0, CV, E0), B3(CU1, CV, E0), B3(CU1, CV, E1), B3(CU0, CV, E1)], panels: 4 },
    { pts: [B3(CU1, -CV, E0), B3(CU0, -CV, E0), B3(CU0, -CV, E1), B3(CU1, -CV, E1)], panels: 4 },
    { pts: [B3(CU1, CV, E0), B3(CU1, -CV, E0), B3(CU1, -CV, E1), B3(CU1, CV, E1)], panels: 1, door: true },
    { pts: [B3(CU0, -CV, E0), B3(CU0, CV, E0), B3(CU0, CV, E1), B3(CU0, -CV, E1)], panels: 2 },
  ].map((w) => Object.assign(w, facing(w.pts, inCab))).filter((w) => w.vis).sort((a, c) => c.far - a.far);
  for (const w of walls) {
    const [A, B2, C, D] = w.pts;
    path3(w.pts); ctx.fillStyle = moonlit([178, 58, 44], w.n); ctx.fill();
    for (let k = 0; k < w.panels; k++) {
      const s0 = (k + 0.1) / w.panels, s1 = (k + 0.9) / w.panels, q = (s, tt) => patch(A, B2, C, D, s, tt);
      if (w.door) {
        for (let j = 0; j < 3; j++) { // three hanging panels of cloth
          const a0 = 0.12 + 0.26 * j, a1 = a0 + 0.24;
          path3([q(a0, 0.5), q(a1, 0.5), q(a1, 0.9), q(a0, 0.9)]); ctx.fillStyle = "#2b3d6b"; ctx.fill();
        }
        path3([q(0.1, 0.12), q(0.9, 0.12), q(0.9, 0.5), q(0.1, 0.5)]); ctx.fillStyle = "#ffd391"; ctx.fill();
        continue;
      }
      path3([q(s0, 0.14), q(s1, 0.14), q(s1, 0.86), q(s0, 0.86)]); ctx.fillStyle = "#ffd391"; ctx.fill();
      ctx.strokeStyle = "rgba(122,62,30,0.55)"; ctx.lineWidth = lw(0.015);
      for (const tt of [0.38, 0.62]) { path3([q(s0, tt), q(s1, tt)], false); ctx.stroke(); }
      path3([q((s0 + s1) / 2, 0.14), q((s0 + s1) / 2, 0.86)], false); ctx.stroke();
    }
  }

  // roof: dark tiles, a hip roof whose eaves turn up at the corners, gold trim, a moonlit far edge
  const EU0 = -2.75, EU1 = 1.65, EV = 1.12, EE = 2.02, RU0 = -1.85, RU1 = 0.75, RE = 2.78, inRoof = B3(-0.55, 0, 1.6);
  const eave = (u0, v0, u1, v1) => { const out = []; for (let k = 0; k <= 8; k++) { const s2 = k / 8; out.push([u0 + (u1 - u0) * s2, v0 + (v1 - v0) * s2, EE + 0.22 * Math.abs(2 * s2 - 1) ** 3]); } return out; };
  const R0 = [RU0, 0, RE], R1 = [RU1, 0, RE];
  const roofs = [
    { e: eave(EU0, EV, EU1, EV), top: [R1, R0], tiles: true, nearSide: true },
    { e: eave(EU1, -EV, EU0, -EV), top: [R0, R1], tiles: true, farSide: true },
    { e: eave(EU1, EV, EU1, -EV), top: [R1] },
    { e: eave(EU0, -EV, EU0, EV), top: [R0] },
  ].map((r) => Object.assign(r, facing(r.e.concat(r.top).map((p) => B3(...p)), inRoof))).filter((r) => r.vis).sort((a, c) => c.far - a.far);
  for (const r of roofs) {
    path3(r.pts); ctx.fillStyle = moonlit([58, 78, 86], r.n); ctx.fill();
    ctx.strokeStyle = "rgba(8,14,18,0.45)"; ctx.lineWidth = lw(0.02);
    const ridgeOf = (p) => (r.top.length === 1 ? r.top[0] : [clamp(p[0], RU0, RU1), 0, RE]);
    for (const tt of [0.2, 0.4, 0.6, 0.8]) { path3(r.e.map((p) => B3(...lerp3(p, ridgeOf(p), tt))), false); ctx.stroke(); }
    for (let k = 1; k < r.e.length - 1; k++) { path3([B3(...r.e[k]), B3(...ridgeOf(r.e[k]))], false); ctx.stroke(); }
    // gold trim along the eaves, wrapping round the ends; only the far side's eave is a moonlit silver edge.
    // (By the roof's side, not by which way its face points: the ends face exactly sideways, so that would be
    // a coin toss of rounding error from frame to frame, and their trim flickered between the two.)
    const gold = !r.farSide;
    ctx.strokeStyle = gold ? "rgba(214,166,72,0.9)" : "rgba(228,234,255,0.6)"; ctx.lineWidth = gold ? lw(0.04) : 1.1;
    path3(r.e.map((p) => B3(...p)), false); ctx.stroke();
  }
  ctx.strokeStyle = "#1a2326"; ctx.lineWidth = lw(0.13); path3([B3(...R0), B3(...R1)], false); ctx.stroke(); // ridge
  ctx.strokeStyle = "rgba(228,234,255,0.5)"; ctx.lineWidth = 1; path3([B3(RU0, -0.05, RE + 0.05), B3(RU1, -0.05, RE + 0.05)], false); ctx.stroke();
  ctx.strokeStyle = "#d4a447"; ctx.lineWidth = lw(0.05);
  for (const [u, d] of [[RU0, -1], [RU1, 1]]) { path3([B3(u, 0, RE), B3(u + 0.12 * d, 0, RE + 0.22), B3(u + 0.28 * d, 0, RE + 0.3)], false); ctx.stroke(); }

  // red paper lanterns hanging from the eave on our side
  const reds = [];
  for (let k = 0; k <= 4; k++) {
    const u = EU0 + 0.25 + ((EU1 - EU0 - 0.5) * k) / 4, s2 = (u - EU0) / (EU1 - EU0), e = EE + 0.22 * Math.abs(2 * s2 - 1) ** 3;
    const top = B3(u, EV, e), mid = B3(u, EV, e - 0.42);
    ctx.strokeStyle = "rgba(20,14,12,0.8)"; ctx.lineWidth = lw(0.012); path3([top, B3(u, EV, e - 0.3)], false); ctx.stroke();
    const [mx2, my2] = P(...mid), rr = ppm(mid[1], mid[2]);
    reds.push([mx2, my2, rr]);
    ctx.fillStyle = "#c8392c"; ctx.beginPath(); ctx.ellipse(mx2, my2, rr * 0.1, rr * 0.13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff8a5c"; ctx.beginPath(); ctx.ellipse(mx2 - rr * 0.02, my2 - rr * 0.02, rr * 0.05, rr * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = "lighter";
  for (const [x, y, rr] of reds) {
    gr = ctx.createRadialGradient(x, y, 0, x, y, rr * 0.55);
    gr.addColorStop(0, "rgba(255,96,60,0.4)"); gr.addColorStop(1, "rgba(255,96,60,0)");
    ctx.fillStyle = gr; ctx.fillRect(x - rr * 0.55, y - rr * 0.55, rr * 1.1, rr * 1.1);
  }
  ctx.globalCompositeOperation = "source-over";

  // the great lantern: a vermilion post at the bow, an arm reaching forward, and the lantern hung from it
  const [LU, , LE] = BOW_LAMP, bowE = HULL_E[13];
  ctx.strokeStyle = moonlit([178, 58, 44], [0, -0.5, 0.5]); ctx.lineWidth = lw(0.11);
  path3([B3(2.75, 0, bowE), B3(2.75, 0, 3.45), B3(3.05, 0, 3.55), B3(LU, 0, 3.48)], false); ctx.stroke();
  ctx.strokeStyle = "rgba(20,14,12,0.85)"; ctx.lineWidth = lw(0.02); path3([B3(LU, 0, 3.48), B3(LU, 0, LE + 0.68)], false); ctx.stroke();
  const lp = B3(LU, 0, LE), [lx, ly] = P(...lp), lpx = ppm(lp[1], lp[2]), lrx = lpx * 0.55, lry = (Y(lp[1], LE + bob - 0.68) - Y(lp[1], LE + bob + 0.68)) / 2;
  const level = Math.min(1, Math.log10(1 + b.aboard) / 3.6), hr = lpx * (1.4 + 1.6 * level + 0.6 * b.flash);
  ctx.globalCompositeOperation = "lighter";
  gr = ctx.createRadialGradient(lx, ly, 0, lx, ly, hr);
  gr.addColorStop(0, `rgba(255,210,140,${0.45 + 0.3 * level})`); gr.addColorStop(0.35, `rgba(255,190,110,${0.18 + 0.2 * level})`); gr.addColorStop(1, "rgba(255,180,100,0)");
  ctx.fillStyle = gr; ctx.fillRect(lx - hr, ly - hr, hr * 2, hr * 2);
  ctx.globalCompositeOperation = "source-over";
  ctx.save(); ctx.beginPath(); ctx.ellipse(lx, ly, lrx, lry, 0, 0, Math.PI * 2); ctx.clip();
  gr = ctx.createRadialGradient(lx - lrx * 0.2, ly - lry * 0.2, 0, lx, ly, lrx * 1.25);
  gr.addColorStop(0, "#fffaf0"); gr.addColorStop(0.55, "#ffdca6"); gr.addColorStop(1, "#e59a55");
  ctx.fillStyle = gr; ctx.fillRect(lx - lrx, ly - lry, lrx * 2, lry * 2);
  ctx.fillStyle = "rgba(196,48,36,0.85)";
  ctx.fillRect(lx - lrx, ly - lry * 0.8, lrx * 2, lry * 0.14); ctx.fillRect(lx - lrx, ly + lry * 0.66, lrx * 2, lry * 0.14);
  ctx.strokeStyle = "rgba(140,70,30,0.3)"; ctx.lineWidth = Math.max(0.5, lpx * 0.012);
  for (let k = 1; k < 9; k++) {
    const yy = ly - lry + (2 * lry * k) / 9, hw = lrx * Math.sqrt(Math.max(0, 1 - ((yy - ly) / lry) ** 2));
    ctx.beginPath(); ctx.moveTo(lx - hw, yy); ctx.quadraticCurveTo(lx, yy + lry * 0.06, lx + hw, yy); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = "#1b1414";
  for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(lx, ly + d * lry * 0.97, lrx * 0.5, lry * 0.09, 0, 0, Math.PI * 2); ctx.fill(); }
  b.tally = b.phase !== "leave" || now < b.leaveT + 0.3 ? [lx + lrx + 10, ly] : null;
}

function drawTally() { // beside the lantern, on top of the flying souls
  const b = block, text = `${b.aboard.toLocaleString("en-US")} aboard`;
  ctx.font = `600 ${W < 560 ? 11 : 13}px Inter, system-ui, sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width, tx = Math.min(b.tally[0], W - tw - 14), ty = b.tally[1];
  ctx.fillStyle = "rgba(21,19,43,0.8)"; ctx.fillRect(tx - 6, ty - 11, tw + 12, 22);
  ctx.fillStyle = "#ffe3ad"; ctx.fillText(text, tx, ty);
}

// far souls live on their own layer, redrawn only when one of them moves, arrives or is called
function drawFar(n) {
  const g = farCtx, pulse = 0.75 + 0.25 * Math.sin(now * 9);
  g.clearRect(0, 0, W, H);
  const gold = [];
  let colour = ""; // each far soul is a point of its body's colour in its lantern's light; neighbours mostly share one
  for (let i = n - 1; i >= 0; i--) {
    const s = line[i];
    if (s.st === 1 || s.st >= 3) continue;
    standAt(s);
    if (gz < farZ) continue;
    project(gx, gz, 0.2);
    if (s.st === 2) { gold.push(sx, sy - sS * 0.65, sS); continue; }
    if (s.tr.litCss !== colour) g.fillStyle = colour = s.tr.litCss;
    g.globalAlpha = sS < 0.6 ? 0.07 : sS < 1.2 ? 0.14 : sS < 2.5 ? 0.3 : 0.8; // dimmer when smaller than a pixel or so
    const w = Math.max(0.7, sS * 0.5), h = Math.max(0.7, sS * 0.75); g.fillRect(sx - w / 2, sy - sS * 0.65 - h / 2, w, h);
  }
  g.fillStyle = "rgb(255,205,115)"; g.globalAlpha = pulse;
  for (let i = 0; i < gold.length; i += 3) { const w = Math.max(1.6, gold[i + 2] * 0.8); g.fillRect(gold[i] - w / 2, gold[i + 1] - w / 2, w, w); }
  g.globalAlpha = 1;
}

// souls that left the mempool unmined: they rise and fade where they stood (near: those on the pier, else the rest)
function drawLeavers(t, near) {
  for (const s of leavers) {
    if (s.oz < PIER_END + 0.3 !== near) continue;
    const u = clamp((now - s.launch) / LEAVE_FOR, 0, 1), a = 1 - u * u * (3 - 2 * u), rise = LEAVE_RISE * u * u;
    if (s.oz >= farZ) { // a point of its lantern's colour, like the far line
      project(s.ox, s.oz, 0.2 + rise);
      ctx.globalAlpha = 0.8 * a; ctx.fillStyle = s.tr.litCss;
      const w = Math.max(0.7, sS * 0.5); ctx.fillRect(sx - w / 2, sy - sS * 0.65 - w / 2, w, w);
    } else {
      project(s.ox, s.oz, ground(s.oz) + 0.2 + rise + 0.05 * Math.sin(t * 1.7 + s.id * 1.3));
      ctx.globalAlpha = a; drawSoul(sx, sy, sS, s, t, false);
    }
  }
  ctx.globalAlpha = 1;
}

const mids = [], nears = [];
function draw() {
  const t = reduce ? 20 : now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  ctx.drawImage(bg, 0, 0, W, H);
  fireworks.draw(ctx, skyClip);
  drawSurf(t);
  if (block) { ctx.globalAlpha = ferryAlpha(now); drawFerryWater(t); ctx.globalAlpha = 1; }
  const n = Math.min(line.length, cap); // anyone past the last place is over the horizon
  mids.length = nears.length = 0;
  for (let i = n - 1; i >= 0; i--) {
    const s = line[i];
    if (s.st === 1 || s.st >= 3) continue;
    standAt(s);
    if (gz >= farZ) continue;
    (gz >= PIER_END + 0.3 ? mids : nears).push(s);
  }
  drawPools(mids);
  if (farDirty) { drawFar(n); farDirty = !!block; } // called souls pulse, so keep redrawing during a block
  ctx.drawImage(farCv, 0, 0, W, H); // far souls: painted, like the nearer ones
  const soul = (s) => {
    standAt(s); project(gx, gz, ground(gz) + 0.2 + 0.05 * Math.sin(t * 1.7 + s.id * 1.3));
    drawSoul(sx, sy, sS, s, t, s.st === 2);
  };
  mids.forEach(soul);
  if (leavers.length) drawLeavers(t, false);
  ctx.drawImage(pier, 0, 0, W, H);
  drawPools(nears);
  nears.forEach(soul);
  if (leavers.length) drawLeavers(t, true);
  if (block) drawGhostFerry(t);
  if (arrivals.length) streaks(arrivals, arrivalPos, 0.08, "190,240,255", arrivalWisp, t, true);
  if (flyers.length) streaks(flyers, flightPos, 0.05, "255,214,140", flightWisp, t);
  if (block && block.tally && !block.test) { ctx.globalAlpha = ferryAlpha(now); drawTally(); ctx.globalAlpha = 1; } // a test boat has nobody to count
  if (picked) showPicked(t);
  const v = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.4, W / 2, H * 0.55, Math.max(W, H) * 0.8);
  v.addColorStop(0, "rgba(10,8,24,0)"); v.addColorStop(1, "rgba(10,8,24,0.45)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  if (frameNo++ % 6 === 0) {
    const num = (v) => v.toLocaleString("en-US");
    // souls that have taken off or left are still in line[] until it closes up as the ferry leaves
    const loading = block && !block.test && block.phase === "load";
    let inLine = 0;
    for (const s of line) if (s.st < 3) inLine++;
    const over = Math.max(0, line.length - cap);
    let text = `${num(inLine)} souls in line`;
    if (over) text += ` (${num(over)} past the horizon)`;
    if (loading) text += ` · ferry loading: ${num(block.aboard)} of ${num(block.chosen.length)}`;
    else if (block && !block.test) text += ` · the ferry is leaving with ${num(block.chosen.length)}`;
    else if (lastTook) text += ` · the last ferry took ${num(lastTook)}`;
    if (lastLeft) text += ` · ${num(lastLeft)} left without boarding`;
    if (stress && !block) text += ` · next block in ${Math.max(0, Math.ceil(nextBlockAt - now))} s`;
    if (text !== lastText) countEl.textContent = lastText = text;
  }
}

// The scene keeps to the clock in a background tab too, so on coming back there's nothing left to catch up on.
// A hidden page gets no frames, and its timers run about once a second (as seldom as once a minute after a
// while). So a timer runs the scene up to now, undrawn, whenever no frame has come for a moment. That is
// only for the live feed: made-up traffic simply waits. In view, a frame steps at most 0.05 s, so a stall
// slows the scene for a moment rather than jumping it.
let lastTs = 0;
function frame(ts) {
  step(clamp(lastTs ? (ts - lastTs) / 1000 : 0, 0, 0.05));
  lastTs = Math.max(lastTs, ts);
  draw();
  requestAnimationFrame(frame);
}
function runUnseen() {
  const ts = performance.now(), gap = (ts - lastTs) / 1000;
  if (!lastTs || gap < 0.25) return; // frames are coming
  const n = Math.ceil(gap / Math.max(0.1, gap / 300)); // steps of 0.1 s, or fewer, longer ones after a long gap
  for (let i = 0; i < n; i++) step(gap / n);
  lastTs = ts;
}

function resize() {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!r.width || !r.height || (r.width === W && r.height === H && dpr === DPR)) return; // nothing changed
  W = r.width; H = r.height; DPR = dpr;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  f = H * FOCAL; cy = H / 2; yh = cy - (f * SIN) / COS; // yh: where the horizon falls
  farCv = document.createElement("canvas"); farCv.width = cv.width; farCv.height = cv.height;
  farCtx = farCv.getContext("2d"); farCtx.setTransform(DPR, 0, 0, DPR, 0, 0); farCtx.globalCompositeOperation = "lighter";
  farDirty = true;
  buildPath(); renderBg(); renderPier();
  for (let i = 0; i < line.length; i++) { locate(i); line[i].x = gx; line[i].z = gz; } // places moved: everyone straight to theirs
  if (frozen) draw();
}

// ---- clicking a soul: its transaction's details ----
const panel = document.getElementById("soul");
// the panel: a close-up of the soul (drawn every frame), then its details (rebuilt twice a second)
const portrait = document.createElement("canvas"), info = document.createElement("div");
portrait.className = "portrait"; portrait.setAttribute("aria-hidden", "true"); info.className = "info";
panel.append(portrait, info);
let picked = null, pickedAt = null, panelText = 0;

// where a soul is on screen: [x, foot y, height in px] for one standing in line, or null.
// bob: include its gentle float up and down
function soulScreen(s, t, bob = true) {
  if (s.st === 1 || s.st >= 3) return null;
  standAt(s);
  if (gz >= farZ) { project(gx, gz, 0.2); return [sx, sy - sS * 0.3, Math.max(sS, 3)]; }
  project(gx, gz, ground(gz) + 0.2 + (bob ? 0.05 * Math.sin(t * 1.7 + s.id * 1.3) : 0));
  return [sx, sy, sS * s.tr.scale];
}
// the soul under the pointer: the frontmost whose body is there, else the nearest far point within 8 px
function soulAt(x, y) {
  const n = Math.min(line.length, cap), t = reduce ? 20 : now;
  let best = null, bestD = 8;
  for (let i = 0; i < n; i++) {
    const s = line[i], v = soulScreen(s, t);
    if (!v) continue;
    if (s.z < farZ) {
      const B = Math.max(v[2], 14); // small souls get a target at least 14 px tall
      if (Math.abs(x - v[0]) <= 0.42 * B && y >= v[1] - B && y <= v[1] + 0.05 * B) return s; // nearer souls are drawn on top
    } else {
      const d = Math.hypot(x - v[0], y - (v[1] - v[2] * 0.35));
      if (d < bestD) { bestD = d; best = s; }
    }
  }
  return best;
}

const sats = (v) => `${v.toLocaleString("en-US")} sat${v === 1 ? "" : "s"}`;
const bch = (v) => `${(v / SATS_PER_BCH).toFixed(8).replace(/\.?0+$/, "")} BCH`;
function ago(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ${sec % 60} s`;
  return `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min`;
}
function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }

// fill the panel for the picked soul (rebuilt twice a second, for its waiting time and place in line)
function fillDetails() {
  const s = picked, tx = s.tx, madeUp = s.txid.startsWith("synthetic-"), rows = [];
  const size = tx.size > 0 ? tx.size : null, outs = tx.outputs || null;
  const fee = tx.fee >= 0 ? tx.fee : madeUp && size ? Math.round(s.fee * size) : null;
  rows.push(["Fee", fee != null ? `${sats(fee)} · ${(size ? fee / size : s.fee).toFixed(2)} sat/byte` : `unknown (placed as ${UNKNOWN_FEE_RATE} sat/byte)`]);
  rows.push(["Size", size ? `${size.toLocaleString("en-US")} bytes` : "unknown"]);
  if (outs) {
    const total = outs.reduce((a, v) => a + v, 0), shown = outs.slice(0, 6).map(bch).join(", ");
    rows.push(["Outputs", `${outs.length} · ${bch(total)} in all`]);
    rows.push(["", shown + (outs.length > 6 ? `, and ${outs.length - 6} more` : "")]);
  } else rows.push(["Outputs", "unknown: it was already waiting when the relay started"]);
  const carries = [];
  if (s.tr.donation) carries.push(`sparkler (a donation to this site: ${bch(s.tr.donation)})`);
  if (tx.nft) carries.push("certificate (a CashTokens NFT)");
  if (tx.ft) carries.push("coin (fungible CashTokens)");
  if (tx.memo) carries.push("scroll (an OP_RETURN message)");
  if (s.tr.bags) carries.push(`${s.tr.bags} bag${s.tr.bags === 1 ? "" : "s"} (extra outputs)`);
  if (carries.length) rows.push(["Carries", carries.join(", ")]);
  const waited = tx.t ? ago(sonifier.serverNow() - tx.t) : null;
  if (s.st < 2) {
    const place = line.indexOf(s) + 1;
    rows.push(["Waiting", `${waited ? waited + " · " : ""}place ${place.toLocaleString("en-US")} of ${line.length.toLocaleString("en-US")}`]);
  } else rows.push(["Status", s.st === 2 || s.st === 3 ? "called by the ferry" : s.gone === "dropped" ? "left the mempool without being mined" : "aboard the ferry: in a block"]);

  // Only the text that changed is updated in place: rebuilding the panel would replace its × and link under
  // the pointer, and a click pressed on one element and released on its replacement is no click at all.
  const layout = s.id + "|" + rows.map((r) => r[0]).join("|");
  if (layout === infoLayout) {
    rows.forEach(([, v], i) => { const dd = infoValues[i]; if (dd.textContent !== v) dd.textContent = v; });
    return;
  }
  infoLayout = layout;
  info.replaceChildren();
  const head = el("div", null, "head");
  head.append(el("strong", "Transaction"), el("code", madeUp ? "made-up" : `${s.txid.slice(0, 8)}…${s.txid.slice(-8)}`));
  const x = el("button", "×", "close"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.onclick = closeDetails;
  head.append(x);
  const dl = el("dl");
  infoValues = rows.map(([k, v]) => { const dd = el("dd", v); dl.append(el("dt", k), dd); return dd; });
  info.append(head, dl);
  if (!madeUp) {
    const a = el("a", "View on bchexplorer.cash ↗");
    a.href = EXPLORER_TX + s.txid; a.target = "_blank"; a.rel = "noopener";
    info.append(a);
  }
}
let infoLayout = "", infoValues = []; // what the panel is built for (the soul, and its rows' names), and its values
function openDetails(s) { picked = s; pickedAt = null; panelText = -1; panel.hidden = false; fillDetails(); }
function closeDetails() { picked = null; panel.hidden = true; infoLayout = ""; }

// the close-up: the picked soul drawn in full detail (whatever its distance in the scene), sized to fit
// everything it carries, floating gently as it does in line
function drawPortrait(t) {
  const w = portrait.clientWidth, h = portrait.clientHeight;
  if (!w || !h) return;
  if (portrait.width !== Math.round(w * DPR) || portrait.height !== Math.round(h * DPR)) { portrait.width = Math.round(w * DPR); portrait.height = Math.round(h * DPR); }
  const pc = portrait.getContext("2d"), s = picked, k = s.tr.scale;
  pc.setTransform(1, 0, 0, 1, 0, 0); pc.clearRect(0, 0, portrait.width, portrait.height);
  pc.globalAlpha = 1; pc.globalCompositeOperation = "source-over";
  // its extent in soul heights: the body (k tall) with a certificate over its head and a shadow below; from
  // the dolly or coin on the left to the lantern or sparkler on the right
  const S = Math.min(h / (1.3 * k + 0.4), w / (0.75 * k + 0.7));
  const x = w * 0.48, y = h - 0.3 * S + 0.03 * S * Math.sin(t * 1.7 + s.id * 1.3);
  ctx = pc;
  try { drawSoul(x, y, S, s, t, s.st === 2); } finally { ctx = mainCtx; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
}

// every frame: a ring round the picked soul, and the panel beside it. The panel follows the soul's place
// in line but not its float up and down, and stays put once the soul has left the line.
function showPicked(t) {
  const v = soulScreen(picked, t), still = soulScreen(picked, t, false);
  if (still) pickedAt = still;
  if (now - panelText > 0.5) { panelText = now; fillDetails(); }
  drawPortrait(t);
  if (!pickedAt) return;
  const [x, y, B] = pickedAt;
  if (v) {
    const [x, y, B] = v; // the ring floats with the soul
    ctx.strokeStyle = `rgba(205,244,255,${0.65 + 0.3 * Math.sin(t * 5)})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, y - B * 0.5, Math.max(6, B * 0.5), Math.max(6, B * 0.62), 0, 0, Math.PI * 2); ctx.stroke();
  }
  const pw = panel.offsetWidth, ph = panel.offsetHeight, gap = Math.max(10, B * 0.5);
  const left = x + gap + pw <= W - 8 ? x + gap : Math.max(8, x - gap - pw);
  panel.style.left = `${Math.round(left)}px`; panel.style.top = `${Math.round(clamp(y - B - 8, 8, Math.max(8, H - ph - 8)))}px`; // whole pixels: no shimmer
}

{ // pick with a click or tap; the pointer turns into a hand over a soul
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener("click", (e) => { const s = soulAt(...local(e)); if (s) openDetails(s); else closeDetails(); });
  let hoverAt = null;
  cv.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    if (!hoverAt) requestAnimationFrame(() => { cv.style.cursor = soulAt(...hoverAt) ? "pointer" : ""; hoverAt = null; });
    hoverAt = local(e);
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && picked) closeDetails(); });
}

const feedEl = ctl("feed");
// "Test a firework": one button per kind, each sending up the firework a donation of that size would
// (a plain burst for under 0.001 BCH, then one animal per doubling)
{
  const bar = document.getElementById("fwTest");
  if (bar) for (const [label, sats] of [["plain burst", FIRST_ANIMAL_SATS / 2], ...ANIMALS.map((a, k) => [a, FIRST_ANIMAL_SATS * 2 ** k])]) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label[0].toUpperCase() + label.slice(1);
    b.title = `the firework for a donation of ${sats / 1e8} BCH`;
    b.onclick = () => { if (landTop) fireworks.launch(sats, sky); };
    bar.append(b);
  }
}
// a ferry with nobody to take, for a block this full (for checking how it looks; with the workbench's test
// strike). Not while one is already here for a real block.
const testFerry = (full) => { if (!block) { beginBlock([], false, full); block.test = true; } };
if (stress) { // starts with an empty beach; the first full block comes after one interval
  ctl("mine").onclick = () => { if (mineFull()) nextBlockAt = now + STRESS_BLOCK_EVERY; };
  ctl("add").hidden = ctl("cut").hidden = true;
  sonifier.hello({ now: Date.now() / 1000, events: [] });
  nextBlockAt = STRESS_BLOCK_EVERY;
  feedEl.textContent = `stress test: full ${STRESS_LIMIT / 1e6} MB blocks every ${STRESS_BLOCK_EVERY} s`;
} else if (synthetic) {
  ctl("mine").onclick = () => { if (mineBlock()) nextBlockAt = now + BLOCK_EVERY; };
  ctl("add").onclick = () => { for (let i = 0; i < 1000; i++) addMadeUp(randomFee(), rnd() * 1.5, false); };
  ctl("cut").onclick = () => addMadeUp(5 + 45 * rnd(), 0, true);
  sonifier.hello({ now: Date.now() / 1000, events: [] });
  for (let i = 0; i < START_SOULS; i++) addMadeUp(randomFee(), -1, false);
  feedEl.textContent = "made-up traffic";
} else if (source === "none") {
  sonifier.hello({ now: Date.now() / 1000, events: [] });
  feedEl.textContent = "no transactions";
} else {
  const both = { // one connection feeds the sound and the line
    hello(msg) { sonifier.hello(msg); liveFeed.hello(msg); },
    event(ev) { sonifier.event(ev); liveFeed.event(ev); },
  };
  new RelayFeed(relayUrl(), both, (st) => { feedEl.textContent = st; });
}
if (!synthetic) for (const id of ["mine", "add", "cut"]) ctl(id).hidden = true; // only for made-up traffic
const sourceSel = ctl("source");
sourceSel.value = source;
sourceSel.onchange = () => { // a fresh start on the other source
  const q = new URLSearchParams(location.search);
  if (sourceSel.value === "live") q.delete("source"); else q.set("source", sourceSel.value);
  location.search = q.toString();
};
if (!shot) { // sound: the published sound (in the studio: this browser's workbench settings, if any); then
  // start / mute / volume, and in the studio the workbench
  const start = startingSound(studio).then((p) => { sonifier.setBlockParams(p); return p; });
  const ensure = soundControls(sonifier, document.getElementById("mute"), document.getElementById("hint"), start);
  if (studio) start.then((p) => workbench(sonifier, p, ensure, (ev) => testFerry(fullness(ev.size, ev.limit))));
}

setupDonate(document.getElementById("donate"), document.getElementById("give"));
setupAbout(document.getElementById("about"), document.getElementById("aboutDialog"));
new ResizeObserver(resize).observe(cv);
resize();
// #shot=12.5 freezes the made-up traffic that many seconds in (for checking a moment); &add=3 drops 1,000 souls at 3 s;
// &drop=0.5: at the first made-up block, half of those left behind leave the mempool unmined
if (shot) {
  frozen = true;
  for (let t = 0; t < +shot[1]; t += 1 / 30) {
    if (shotAdd && Math.abs(t - +shotAdd[1]) < 1 / 60) ctl("add").onclick();
    if (shotBoat && Math.abs(t - +shotBoat[1]) < 1 / 60) { block = null; beginBlock([], false, shotFull); block.test = true; }
    if (shotFw && Math.abs(t - (+shot[1] - shotFwAgo)) < 1 / 60) for (const v of shotFw[1].split(",")) fireworks.launch(+v, sky);
    step(1 / 30);
  }
  if (shotPick && line[+shotPick[1]]) openDetails(line[+shotPick[1]]);
  draw();
} else {
  requestAnimationFrame(frame);
  if (!synthetic) { setInterval(runUnseen, 1000); document.addEventListener("visibilitychange", runUnseen); }
  if (shotPick) setTimeout(() => { if (line[+shotPick[1]]) openDetails(line[+shotPick[1]]); }, 1500);
}
