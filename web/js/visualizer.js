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
import { Radio, radioSongs } from "./radio.js";
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
// The line weaves down the pier in one S (right, then left), so the souls there hide each other less: how far
// it swings (metres), and its middle, a little left of the pier's. A soul's body reaches about 0.34 m to each
// side, its lantern 0.46 m to the right; the rails' inner faces are 1.24 m from the middle: so the lanterns on
// the right and the bodies on the left come about as close to the rails.
const PIER_WEAVE = 0.85, PIER_MID = -0.05;
const FIRST_LANE = 16;             // metres: the first lane across the sand
// how strongly a lantern colours its soul, the same at every distance: close up, a glow on the side toward it
// this strong at its brightest; mid-distance and far souls are too small for a glow, so they are tinted all over
// about as much as that glow averages
const LAMP_ON_BODY = 0.175, LAMP_ON_SMALL = 0.1, LAMP_REACH = 0.55; // ...and how far the close-up glow reaches, in soul heights
const SOUL_BODY = [212, 245, 255]; // a small soul's colour before its lantern's light
const FAR_S = 4.5;                 // souls drawn smaller than this many px are single points
const LEAVE_FOR = 1.8, LEAVE_RISE = 1.4; // a soul that left the mempool unmined rises this many metres as it fades out over this many seconds
const FALL = 2.0, CATCHUP = 4;     // seconds for a new soul to drop in (as long as a vortex's, VORTEX_FALL: they all fall alike); how fast the line closes up (1/s)
// A soul with two or more inputs drops in as one shooting star per input, swirling around the line of its fall by
// gravity (see vortexGravity): the biggest input on that line, the smaller an input, the farther out it starts
// (amounts compared within the transaction). They all meet the centre by VORTEX_MEET of the fall, and the rest
// of the way it comes down as one, like any soul. Only for souls drawn at least VORTEX_MIN_S px tall (far off, it wouldn't
// show), with at most VORTEX_STARS stars (the biggest inputs).
const VORTEX_FALL = 2.0, VORTEX_MEET = 0.57, VORTEX_TRAIL = 0.16; // s; of the fall; of the fall
const VORTEX_STARS = 48, VORTEX_MIN_S = 10, VORTEX_R = 0.4, VORTEX_CLEAR = 0.22; // stars at most; px; metres: the orbit's scale; metres: the small ones' clearance
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
const EXPLORER_TX = "https://bchexplorer.info/tx/"; // + txid: a transaction's page on the block explorer
// lantern colour by fee: hue goes evenly with each doubling of sats/byte, from red (0 degrees) at 1 and below
// to hot magenta (320) at 512 and above
const FEE_HUE_TOP = 320, FEE_TOP = 512, FEE_HUE_STEP = 5;
const TYPICAL_BYTES = 225;         // a transaction this size gets a soul of normal size
const SIZE_GROWTH = 0.08;          // ...and each doubling of its bytes adds this much (each halving removes it); no limit
const DOLLY_FROM = 2;              // bags: two or more ride on a dolly; a single one floats behind the soul
const DOLLY_X = -0.42;              // the dolly's middle, soul heights left of the soul's centre (was -0.84: it read as the next soul's)
const BAG_H = 0.11;                // bag height, in soul heights
const shotFw = /fw=([\d,]+)/.exec(location.hash); // test: fireworks for these donations (sats), launched 2.3 s (or &fwago=N s) before the shot
const shotFwAgo = +(/fwago=([\d.]+)/.exec(location.hash) || [0, 2.3])[1];
const shotLyric = /lyric=([^&]+)/.exec(location.hash); // test: this line of lyrics in the sky (#shot=…&lyric=Some%20words)
const shotDonors = /donors/.test(location.hash);   // test: every made-up soul is a donor (sparklers everywhere)
const shotWild = /wild(?:=(\w+))?/.exec(location.hash); // test: every made-up soul has strange inputs (#wild, or #wild=many|whale|any)
const shotBoat = /boat=([\d.]+)/.exec(location.hash), shotFull = +(/full=([\d.]+)/.exec(location.hash) || [0, 0])[1]; // test: a test boat then, for a block this full
const shotPick = /pick=(\d+)/.exec(location.hash); // test: open the details of the soul at this place in line (at once in a #shot, else after 1.5 s)
const shot = /shot=([\d.]+)/.exec(location.hash), shotAdd = /add=([\d.]+)/.exec(location.hash), shotDrop = /drop=([\d.]+)/.exec(location.hash);
const asked = new URLSearchParams(location.search).get("source");
const source = shot ? (asked === "stress" ? "stress" : "synthetic") : ["synthetic", "stress", "none"].includes(asked) ? asked : "live";
const stress = source === "stress", synthetic = source === "synthetic" || stress; // synthetic: any made-up traffic
let W = 0, H = 0, DPR = 1, yh = 0, cy = 0, f = 0, bg = null, pier = null, path = null;
let landTop = null, skyClip = null; // the top of the land (y every 2 px from x = -4), and the sky above it as a clip path
let slots = null, cap = 0, farZ = 0, farCv = null, farCtx = null, farDirty = true;
let poolCv = null, poolCtx = null; // the middle distance's lantern light on the ground, repainted with the far souls
let trailCv = null, trailCtx = null; // the light trails of souls flying to the ferry (see streaks)
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
  for (let z = PIER_START; z <= PIER_END; z += 0.4) pts.push([PIER_MID + PIER_WEAVE * Math.sin((2 * Math.PI * (z - PIER_START)) / (PIER_END - PIER_START)), z]);
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

  // the waterline: wavy, so the wet sand and its sheen follow it rather than a straight edge
  const yw = Y(SHORE + 1.3), ys = Y(SHORE);
  const waterline = () => {
    g.beginPath();
    for (let xs = 0; xs <= W + 8; xs += 8) {
      const xw = across(xs, SHORE);
      const zz = SHORE + 0.25 * Math.sin(xw * 0.35) + 0.15 * Math.sin(xw * 1.1);
      const y = Y(zz, -0.05);
      xs === 0 ? g.moveTo(xs, y) : g.lineTo(xs, y);
    }
  };
  // dark wet sand above it, darkening toward the water (down past its lowest dip; the water covers the rest)
  const yl = Y(SHORE - 0.5);
  gr = g.createLinearGradient(0, yw, 0, ys);
  gr.addColorStop(0, "rgba(20,24,30,0)"); gr.addColorStop(0.75, "rgba(20,24,30,0.8)"); gr.addColorStop(1, "rgba(24,29,37,0.85)");
  g.fillStyle = gr; g.fillRect(0, yw, W, yl - yw);
  // the sky's sheen on the wettest sand: a soft glow along the waterline (its lower half is under the water)
  waterline(); g.lineJoin = "round";
  for (const [wd, a] of [[ppm(SHORE) * 0.5, 0.05], [ppm(SHORE) * 0.28, 0.07], [ppm(SHORE) * 0.12, 0.09]]) {
    g.strokeStyle = `rgba(90,106,126,${a})`; g.lineWidth = wd; g.stroke();
  }
  groundGlow(g, across(mx, SHORE + 0.6), SHORE + 0.6, 0, 1.6, "180,205,200", 0.22); // the moon's gleam on the wet sand

  // water from the shoreline to the bottom of the frame
  waterline();
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
// forming: the pools of the souls in list that are arriving (fading in as their souls form, see fillCooled), else
// of the rest
function drawPools(list, forming = false) {
  ctx.globalCompositeOperation = "lighter";
  for (const s of list) {
    if ((s.st === 1) !== forming || (forming && !(s.f > 0))) continue;
    standAt(s);
    const x = gx + 0.4, e = ground(gz), D = depth(gz, e), w = (f * POOL_R) / D;
    const a = smooth(((0.9 * f) / D - 6) / (POOL_FULL - 6)) * (forming ? fillCooled(s.f * FORM) : 1);
    if (a < 0.02) continue;
    const y1 = Y(gz - POOL_R, e), y2 = Y(gz + POOL_R, e);
    ctx.globalAlpha = POOL_ALPHA * a;
    ctx.drawImage(poolSprite(s.tr.lamp), W / 2 + (f * x) / D - w, y2, 2 * w, y1 - y2);
  }
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
}

// Lantern colour for a fee rate, in steps of FEE_HUE_STEP degrees of hue (so lanterns share the glows made for
// each colour: 65 colours at most).
function lampColor(rate) {
  const h = FEE_HUE_STEP * Math.round((FEE_HUE_TOP / FEE_HUE_STEP) * clamp(Math.log2(rate) / Math.log2(FEE_TOP), 0, 1));
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
    smallBody: smallBodyCss(c),                                           // a mid soul's body, tinted, in one fill
    bags: Math.max(0, (tx.outputs ? tx.outputs.length : 1) - 1),          // one per extra output
    nft: !!tx.nft, ft: !!tx.ft, memo: !!tx.memo,
    donation: tx.donation > 0 ? tx.donation : 0,                          // sats to the site: a sparkler, not a lantern
    scale: 1 + SIZE_GROWTH * Math.log2(bytes / TYPICAL_BYTES), // bigger transaction, bigger soul
  };
}

// A small soul's body is its pale fill (SOUL_BODY at 0.88) with its lantern's colour over it at LAMP_ON_SMALL:
// two fills of one shape, which come to exactly one fill of this colour and opacity (one drawing step, not two).
const SMALL_BODY_A = 0.88;
function smallBodyCss(c) {
  const a = 1 - (1 - SMALL_BODY_A) * (1 - LAMP_ON_SMALL);
  return `rgba(${SOUL_BODY.map((v, i) => ((v * SMALL_BODY_A * (1 - LAMP_ON_SMALL) + c[i] * LAMP_ON_SMALL) / a).toFixed(2)).join(",")},${a.toFixed(4)})`;
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
const CERT_SCALE = 1.25; // (it was drawn at 1: the sizes below)
function drawCertificate(id, t) {
  const w = 0.42, h = 0.3;
  ctx.save();
  ctx.translate(-0.5, -1.14 + Math.sin(t * 1.3 + id) * 0.015); ctx.rotate(-0.12); ctx.scale(CERT_SCALE, CERT_SCALE);
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
  ctx.fillStyle = "#078a66";                                                              // ribbons, then the seal: Bitcoin Cash green
  ctx.beginPath(); ctx.moveTo(0.085, 0.06); ctx.lineTo(0.07, 0.135); ctx.lineTo(0.095, 0.115); ctx.lineTo(0.11, 0.135); ctx.lineTo(0.135, 0.06); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#0ac18e"; ctx.beginPath();
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, r = k % 2 ? 0.038 : 0.047; ctx.lineTo(0.11 + r * Math.cos(a), 0.055 + r * Math.sin(a)); }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#e9fff7"; ctx.lineWidth = 0.006; ctx.beginPath(); ctx.arc(0.11, 0.055, 0.022, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// A token coin (fungible CashTokens) held in the left hand, at (x, y) in the hand's coordinates: Bitcoin Cash green, its rim
// reeded (ridged all the way round: notched at the edge, and each ridge lit on one side and shaded on the other).
const COIN_R = 0.15, COIN_RIDGES = 28;
function drawCoin(x, y) {
  const R = COIN_R, n = COIN_RIDGES, Ri = R - 0.022, face = R - 0.034;
  ctx.fillStyle = "#08a578"; ctx.strokeStyle = "#03503a"; ctx.lineWidth = 0.007; ctx.beginPath(); // the notched edge
  for (let k = 0; k < 2 * n; k++) { const a = (k / (2 * n)) * Math.PI * 2, r = k % 2 ? Ri : R; ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  for (let k = 0; k < n; k++) { // each ridge: lit half, shaded half
    const a0 = (k / n) * Math.PI * 2, a1 = a0 + Math.PI / n, a2 = a0 + (2 * Math.PI) / n;
    for (const [from, to, c] of [[a0, a1, "#7ff2cd"], [a1, a2, "#056f51"]]) {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, Ri, from, to); ctx.arc(x, y, face, to, from, true); ctx.closePath(); ctx.fill();
    }
  }
  ctx.fillStyle = "#0ac18e"; ctx.strokeStyle = "#04664a"; ctx.lineWidth = 0.01; // the face
  ctx.beginPath(); ctx.arc(x, y, face, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "#078a66"; ctx.lineWidth = 0.008; ctx.beginPath(); ctx.arc(x, y, face * 0.68, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "rgba(230,255,246,0.65)"; ctx.lineWidth = 0.012; ctx.beginPath(); ctx.arc(x, y, face * 0.84, 3.6, 4.9); ctx.stroke(); // a glint
}

// A sparkler held in the right hand (drawn in the hand's coordinates, soul heights): a wire, burnt black toward
// the tip, the tip white-hot, and sparks of the lantern's colour flying off it, new ones 24 times a second.
const SPARK_TIP = [0.52, -0.95];
// A sparkler: a wire whose tip burns white-hot, throwing sparks of its lantern's colour. Each spark is a
// particle that flies straight out from the tip, slowing and drooping a little, and burns out: drawn as a
// short streak behind it (its motion), thinning and dimming as it dies. Spark k of a soul relaunches every
// cycle in a new direction (from a hash), so the sparks move smoothly rather than flickering.
const SPARK_DROOP = 1.2; // soul heights per s², the pull down on a spark
const SPARK_REACH = 1.5; // how far sparks fly before they burn out (1: 0.12..0.34 soul heights), in the same time
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
    const h = hash(seed, 100 + i), a = h * Math.PI * 2, reach = SPARK_REACH * (0.12 + 0.22 * hash(seed, 200 + i)); // soul heights
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
// A full-detail soul's body shading, and its lantern's glow on it: the same for every soul (the glow, for every
// soul with that lantern colour), so made once for each canvas they're drawn on and reused, not made afresh
// for every soul in every frame.
const shades = new WeakMap(); // canvas context -> { body, lamp: colour -> glow }
function shadesFor() {
  let sh = shades.get(ctx);
  if (!sh) {
    const body = ctx.createLinearGradient(0, -1, 0, 0);
    body.addColorStop(0, "rgba(242,252,255,0.98)"); body.addColorStop(0.55, "rgba(204,241,255,0.92)"); body.addColorStop(1, "rgba(160,225,255,0)");
    shades.set(ctx, (sh = { body, lamp: new Map() }));
  }
  return sh;
}
const bodyShade = () => shadesFor().body;
const lampAt = (k) => [0.33 + 0.14 / k, -0.47 - 0.265 / k]; // the lantern, in body units, for a body of scale k
// The body's shading and its lantern's glow painted together, at BODY_RES pixels per soul height, over the
// area a body covers (BODY_BOX: left, top, width, height, in body units): one fill of the swaying outline
// with this is the two fills, one over the other. One per lantern colour and size of soul (k, to 0.02).
const BODY_RES = 96, BODY_BOX = [-0.45, -1.02, 0.9, 1.06];
function bodyPaint(lamp, k) {
  const sh = shadesFor(), kq = Math.round(k * 50) / 50, key = lamp + "|" + kq;
  if (!sh.paint) sh.paint = new Map();
  let p = sh.paint.get(key);
  if (p) return p;
  if (sh.paint.size > 600) sh.paint.clear(); // (a bound; they're cheap to make again)
  const [x0, y0, w, h] = BODY_BOX, c = document.createElement("canvas");
  c.width = Math.ceil(w * BODY_RES); c.height = Math.ceil(h * BODY_RES);
  const main = ctx;
  ctx = c.getContext("2d");
  ctx.setTransform(BODY_RES, 0, 0, BODY_RES, -x0 * BODY_RES, -y0 * BODY_RES); // body units
  ctx.fillStyle = bodyShade(); ctx.fillRect(x0, y0, w, h);
  const [Lx, Ly] = lampAt(kq);
  ctx.translate(Lx, Ly); ctx.fillStyle = lampOnBody(lamp); ctx.fillRect(x0 - Lx, y0 - Ly, w, h);
  ctx = main;
  p = ctx.createPattern(c, "no-repeat");
  p.setTransform(new DOMMatrix([1 / BODY_RES, 0, 0, 1 / BODY_RES, x0, y0]));
  sh.paint.set(key, p);
  return p;
}
function lampOnBody(lamp) {
  const m = shadesFor().lamp;
  let g = m.get(lamp);
  if (!g) {
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, LAMP_REACH);
    g.addColorStop(0, `rgba(${lamp},${LAMP_ON_BODY})`); g.addColorStop(0.55, `rgba(${lamp},${LAMP_ON_BODY * 0.45})`); g.addColorStop(1, `rgba(${lamp},0)`);
    m.set(lamp, g);
  }
  return g;
}

// The parts of a full-detail soul, so the middle distance can stamp the still ones from images (see midSoul):
// behind the body (shadow, glow, lantern light, luggage), the body and face (it sways; the eyes are the detail
// that most shows softening), in front (arms, lantern, coin, scroll), and the certificate (it floats).
const PART_BACK = 1, PART_BODY = 2, PART_FRONT = 4, PART_CERT = 8, PART_ALL = 15;
function drawSoul(x, y, S, s, t, called, part = PART_ALL) {
  const tr = s.tr, id = s.id, k = tr.scale, B = S * k; // B: pixels per soul height for this body
  const body = () => ctx.setTransform(DPR * B, 0, 0, DPR * B, DPR * x, DPR * y);
  const carried = (ox, oy) => ctx.setTransform(DPR * S, 0, 0, DPR * S, DPR * (x + ox * S), DPR * (y + oy * S)); // shifted by (ox, oy) soul heights
  const g = k - 1, ground = 0.222, topY = -(y + 10) / S; // souls float 0.2 m up; ground and canvas top in soul heights
  const rx = 0.33 * g, ry = -0.47 * g;   // how far the right hand has moved from a normal soul's
  const lx = -0.31 * g, ly = -0.48 * g;  // ...the left hand
  const side = -0.3 * g, head = -0.98 * g; // ...the left edge of the body, and the top of the head
  const sw = Math.sin(t * 2.1 + id * 0.9) * 0.08, alpha = ctx.globalAlpha; // alpha: < 1 while fading away
  if (B < 16 && part === PART_ALL) { // mid distance: body, lantern, and a hint of the big things
    body();
    if (called) { ctx.fillStyle = "rgba(255,200,110,0.6)"; ctx.beginPath(); ctx.arc(0, -0.6, 0.66, 0, Math.PI * 2); ctx.fill(); }
    if (tr.bags >= DOLLY_FROM) { // the stack on its dolly, as one block
      carried(side, 0);
      const top = Math.max(topY, ground - 0.085 - tr.bags * BAG_H);
      ctx.fillStyle = "#7c5a44"; ctx.fillRect(DOLLY_X - 0.16, top, 0.32, ground - top);
      body();
    }
    wisp(sw);
    if (alpha === 1) { ctx.fillStyle = tr.smallBody; ctx.fill(); } // pale, in its lantern's light, as one fill
    else { // fading away: the two fills (their sum isn't one fill once both are fainter)
      ctx.fillStyle = `rgba(${SOUL_BODY.join(",")},${SMALL_BODY_A})`; ctx.fill();
      ctx.globalAlpha *= LAMP_ON_SMALL; ctx.fillStyle = tr.lampCss; ctx.fill(); ctx.globalAlpha = alpha;
    }
    if (tr.nft) { carried(side, head); ctx.fillStyle = "#f7efd8"; ctx.fillRect(-0.7, -1.28, 0.4, 0.28); }
    carried(rx, ry); ctx.fillStyle = tr.lampCss;
    if (tr.donation) { ctx.fillRect(0.42, -1.0, 0.16, 0.16); ctx.fillStyle = "#fffbe8"; ctx.fillRect(0.47, -0.95, 0.06, 0.06); } // sparkler
    else ctx.fillRect(0.36, -0.8, 0.15, 0.17);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return;
  }
  if (part & PART_BACK) {
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
  }
  // body
  body();
  if (part & PART_BODY) {
  wisp(sw);
  // shaded, with its lantern's light on the side of the body and face toward it: one fill with the two painted
  // together (bodyPaint), or, for a body bigger than that's painted, the two fills
  const paint = B * DPR <= BODY_RES * 1.5 ? bodyPaint(tr.lamp, k) : null;
  if (paint) { ctx.fillStyle = paint; ctx.fill(); }
  else {
    ctx.fillStyle = bodyShade(); ctx.fill();
    // (the glow is made around (0, 0) once per colour, and moved to the lantern; the traced outline stays put)
    const [Lx, Ly] = lampAt(k);
    ctx.translate(Lx, Ly); ctx.fillStyle = lampOnBody(tr.lamp); ctx.fill(); ctx.translate(-Lx, -Ly);
  }
  }
  if (part & PART_FRONT) { // arms: one shape (the same colour, and apart), so one drawing step
    ctx.fillStyle = "rgba(226,248,255,0.95)"; ctx.beginPath();
    for (const [ax, rot] of [[-0.31, -0.5], [0.31, 0.5]]) {
      ctx.moveTo(ax + 0.065 * Math.cos(rot), -0.48 + 0.065 * Math.sin(rot)); ctx.ellipse(ax, -0.48, 0.065, 0.042, rot, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  if (part & PART_BODY) { // face: drawn live with the body (in the middle distance too), so the eyes stay crisp
  ctx.fillStyle = "#20264a"; ctx.beginPath();
  for (const ex of [-0.1, 0.1]) { ctx.moveTo(ex + 0.034, -0.69); ctx.ellipse(ex, -0.69, 0.034, 0.05, 0, 0, Math.PI * 2); }
  ctx.fill();
  if (B > 40) {
    ctx.fillStyle = "#ffffff";
    for (const ex of [-0.088, 0.112]) { ctx.beginPath(); ctx.arc(ex, -0.705, 0.011, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "rgba(255,150,180,0.45)";
    for (const ex of [-0.18, 0.18]) { ctx.beginPath(); ctx.arc(ex, -0.61, 0.04, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = "#20264a"; ctx.lineWidth = 0.014;
    ctx.beginPath(); ctx.arc(0, -0.645, 0.045, 0.35, Math.PI - 0.35); ctx.stroke();
  }
  }
  if (part & PART_FRONT) {
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
  if (tr.ft) drawCoin(-0.42, -0.53);
  if (tr.memo) {
    ctx.fillStyle = "#efe0bf"; ctx.strokeStyle = "#8b7350"; ctx.lineWidth = 0.01;
    ctx.fillRect(-0.52, -0.38, 0.17, 0.08); ctx.strokeRect(-0.52, -0.38, 0.17, 0.08);
    for (const sx of [-0.52, -0.35]) { ctx.beginPath(); ctx.arc(sx, -0.34, 0.03, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  }
  if (tr.nft && part & PART_CERT) { carried(side, head); drawCertificate(id, t); }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// ---- the middle distance, pre-drawn ----
// Hundreds of souls can stand in the middle distance, near enough to be drawn in full, and a browser's canvas
// spends about the same time on each of a soul's ~20 drawing steps, whatever it draws, so a long line slowed
// the whole page (and starved the sound). So there each soul's still parts are drawn once, into two images
// (behind its body, and in front of it), and stamped every frame, with only its swaying body and its face
// drawn live between them: 5 steps instead of ~20, and it looks the same. An image is redrawn when the soul's size
// changes by 1.5% (it walks forward); in between it's stretched to the exact size. The images live in a few
// shared atlas canvases (1024 px square, at most 32 of them, 134 MB; in practice a few), in square slots: a
// size of slot takes a row of a page at a time, and slots are reused as souls come and go. Not pre-drawn: souls
// donors (the sparkler moves), and any too big for the largest slot. Frozen in the
// images: a single suitcase's bob (at most about half a pixel at this distance). A soul the ferry calls gets
// its images again, with the gold glow it has then (behind its body; it doesn't move).
const ATLAS = 1024, SLOT_SIZES = [24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 256], ATLAS_PAGES = 32, SIZE_STEP = Math.log(1.015);
const atlas = { pages: [], free: new Map() }, preDrawn = new Set(); // pages: { c, g, rows (px used) }; free: slot size -> free slots
const noPreDraw = /nopredraw/.test(location.hash); // test: draw the middle distance live, to compare
// at most this many souls' images drawn in a frame: when hundreds change at once (the ferry calls them, or the
// line walks forward), the rest show their old images, stretched, for a few frames, rather than one long frame
const REDRAWS_PER_FRAME = 30;
let redraws = 0;
function slotTake(size) {
  let list = atlas.free.get(size);
  if (!list) atlas.free.set(size, (list = []));
  if (!list.length) { // a new row of this size's slots, on a page with room for it (or a new page)
    let page = atlas.pages.find((p) => p.rows + size <= ATLAS);
    if (!page) {
      if (atlas.pages.length >= ATLAS_PAGES) return null;
      const c = document.createElement("canvas"); c.width = c.height = ATLAS;
      atlas.pages.push((page = { c, g: c.getContext("2d"), rows: 0 }));
    }
    for (let x = 0; x + size <= ATLAS; x += size) list.push({ page, x, y: page.rows, size });
    page.rows += size;
  }
  return list.pop();
}
const slotGive = (sl) => { if (sl) atlas.free.get(sl.size).push(sl); };
function dropImages(s) { if (s.img) { slotGive(s.img.back); slotGive(s.img.front); s.img = null; } preDrawn.delete(s); }
function atlasReset() { // (new size or DPR)
  for (const s of preDrawn) s.img = null;
  for (const s of liftOffs) s.fly = null;
  preDrawn.clear(); liftOffs.clear(); atlas.pages.length = 0; atlas.free.clear();
}
// what a full-detail soul covers, in soul heights around its origin (see drawSoul), with a margin:
// [left, right, top, bottom]
function soulBox(tr, called) {
  const k = tr.scale, g = k - 1, dolly = tr.bags >= DOLLY_FROM, stack = dolly ? 0.085 - 0.222 + tr.bags * BAG_H : 0;
  let L = Math.min(-0.4 * k, -0.57 - 0.31 * g, dolly ? -0.66 - 0.3 * g : 0) - 0.05, R = 0.93 + 0.33 * g + 0.05;
  let T = Math.min(-1.19 - 0.47 * g, -0.78 * k, -stack) - 0.05, Bt = 0.29 + 0.065 * k + 0.05;
  if (tr.donation) { R = Math.max(R, 1.25 + 0.33 * g); T = Math.min(T, -1.6 - 0.47 * g); } // the sparkler's sparks and glow
  if (called) { L = Math.min(L, -0.93 * k); R = Math.max(R, 0.93 * k); T = Math.min(T, -1.53 * k); Bt = Math.max(Bt, 0.33 * k); } // its glow (radius 0.9 around (0, -0.6))
  return [L, R, T, Bt];
}
// draw the given parts of soul s, at size S, into an atlas slot, with its origin at (ax, ay) in the slot
function drawInSlot(sl, s, S, ax, ay, t, called, part) {
  const main = ctx;
  ctx = sl.page.g;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(sl.x, sl.y, sl.size, sl.size);
  ctx.save(); ctx.beginPath(); ctx.rect(sl.x, sl.y, sl.size, sl.size); ctx.clip();
  drawSoul(sl.x / DPR + ax, sl.y / DPR + ay, S, s, t, called, part);
  ctx.restore();
  ctx = main;
}
// A soul's two images at about size S (redrawn if it has changed size, or been called), or null: draw it live.
// Images are only drawn in a frame's first pass (prepareImages), before any are stamped: a canvas drawn into
// and then stamped from has to be copied whole first, so interleaving the two cost a copy per soul.
function soulImages(s, S, mayDraw = false) {
  const tr = s.tr, k = tr.scale, q = Math.round(Math.log(S) / SIZE_STEP), called = s.st === 2;
  if (s.img && s.img.q === q && s.img.called === called) return s.img;
  if (!mayDraw || redraws >= REDRAWS_PER_FRAME) return s.img; // the old one meanwhile (none yet: drawn live)
  const Sq = Math.exp(q * SIZE_STEP);
  if (Sq * k < 16) return null; // drawn small, as it would be live
  const [L, R, T, Bt] = soulBox(tr, called), need = Math.ceil(Math.max(R - L, Bt - T) * Sq * DPR) + 2, size = SLOT_SIZES.find((z) => z >= need);
  if (!size) return null;
  let img = s.img;
  if (img && img.back.size !== size) { dropImages(s); img = null; }
  if (!img) {
    const back = slotTake(size), front = back && slotTake(size);
    if (!front) { slotGive(back); return null; } // the atlas is full: live
    img = s.img = { back, front }; preDrawn.add(s);
  }
  Object.assign(img, { q, called, Sq, ax: -L * Sq + 1 / DPR, ay: -T * Sq + 1 / DPR });
  redraws++;
  drawInSlot(img.back, s, Sq, img.ax, img.ay, 0, called, PART_BACK);
  drawInSlot(img.front, s, Sq, img.ax, img.ay, 0, called, PART_FRONT);
  return img;
}
// the frame's first pass: the images the middle distance and the souls lifting off will need, drawn now.
// Lift-offs first, with their own allowance: without its picture a soul lifting off is drawn in full, while
// a soul whose image is out of date shows the old one meanwhile.
function prepareImages(t) {
  if (noPreDraw) return;
  redraws = 0;
  for (const s of flyers) if (s.u >= 0 && s.u < 0.35 && 0.9 * ppm(s.oz, s.oe) >= FAR_S) liftOffPicture(s, 0.9 * ppm(s.oz, s.oe), true);
  redraws = 0;
  for (const s of mids) {
    if (s.tr.donation || s.st === 1) continue; // (one arriving: drawn live as it forms)
    standAt(s); project(gx, gz, ground(gz) + 0.2 + 0.05 * Math.sin(t * 1.7 + s.id * 1.3));
    if (sS * s.tr.scale >= 16) soulImages(s, sS, true);
  }
}
// a soul in the middle distance: its images and its live body, or all of it live
function midSoul(s, t) {
  standAt(s); project(gx, gz, ground(gz) + 0.2 + 0.05 * Math.sin(t * 1.7 + s.id * 1.3));
  const tr = s.tr, img = !noPreDraw && sS * tr.scale >= 16 && !tr.donation ? soulImages(s, sS) : null;
  if (!img) { if (s.img) dropImages(s); return drawSoul(sx, sy, sS, s, t, s.st === 2); }
  img.seen = frameNo;
  const sc = sS / img.Sq, x0 = sx - img.ax * sc, y0 = sy - img.ay * sc, d = (img.back.size / DPR) * sc;
  ctx.drawImage(img.back.page.c, img.back.x, img.back.y, img.back.size, img.back.size, x0, y0, d, d);
  drawSoul(sx, sy, sS, s, t, false, PART_BODY);
  ctx.drawImage(img.front.page.c, img.front.x, img.front.y, img.front.size, img.front.size, x0, y0, d, d);
  if (tr.nft) drawSoul(sx, sy, sS, s, t, false, PART_CERT);
}
// give back the images of souls no longer drawn in the middle distance (gone, or moved out of it)
function sweepImages() { for (const s of preDrawn) if (!(s.img && s.img.seen >= frameNo - 30)) dropImages(s); }

// A soul lifting off for the ferry shrinks to a spark over a third of a second or so: drawn from one picture
// of all of it, taken as it lifts off and shrunk, not drawn afresh at every size (frozen meanwhile: its sway).
const liftOffs = new Set(); // souls holding a lift-off picture
function liftOffPicture(s, S, mayDraw = false) {
  if (s.fly) return s.fly;
  if (!mayDraw || redraws >= REDRAWS_PER_FRAME) return null; // (drawn live this frame)
  const [L, R, T, Bt] = soulBox(s.tr, false), need = Math.ceil(Math.max(R - L, Bt - T) * S * DPR) + 2, size = SLOT_SIZES.find((z) => z >= need);
  const sl = size && slotTake(size);
  if (!sl) return null;
  const fly = (s.fly = { sl, S, ax: -L * S + 1 / DPR, ay: -T * S + 1 / DPR, seen: frameNo });
  drawInSlot(sl, s, S, fly.ax, fly.ay, now, false, PART_ALL);
  redraws++; liftOffs.add(s);
  return fly;
}
function sweepLiftOffs() { for (const s of liftOffs) if (!(s.fly && s.fly.seen >= frameNo - 2)) { if (s.fly) slotGive(s.fly.sl); s.fly = null; liftOffs.delete(s); } }

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
// 0.05 BCH (sigma 2.2); 5% hold an NFT, 9% tokens, 7% an OP_RETURN. rate: its fee, sats/byte.
function madeUpTx(rate) {
  const r = rnd() * 12.5, nOut = rnd() < 0.015 ? 8 + Math.floor(rnd() * 53) : r < 2 ? 1 : r < 10 ? 2 : r < 12 ? 3 : 5, outputs = [];
  const nIn = 1 + Math.floor(6 * rnd() * rnd());
  for (let i = 0; i < nOut; i++) {
    const g = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    outputs.push(Math.max(546, Math.floor(Math.exp(Math.log(0.05) + 2.2 * g) * SATS_PER_BCH)));
  }
  const tx = { type: "tx", t: sonifier.serverNow(), txid: `synthetic-${nextId}`, outputs, size: 10 + 148 * nIn + 34 * nOut, nft: rnd() < 0.05, ft: rnd() < 0.09, memo: rnd() < 0.07 };
  if (rnd() < 0.01 || shotDonors) madeUpDonation(tx); // ~one every 25 s
  tx.fee = Math.round(rate * tx.size);
  if (shotWild || rnd() < 0.15) wildInputs(tx, rate); // ~1 in 7: something to test the input vortex with
  else tx.inputs = madeUpInputs(nIn, tx);
  return tx;
}
// a made-up transaction's inputs made strange, and its outputs made to match (inputs = outputs + fee):
// a consolidation of 20 to 200 small coins, a whale and a few crumbs of dust, or 2 to 60 coins of anything
// from dust to 100 BCH
function wildInputs(tx, rate) {
  const logU = (lo, hi) => Math.round(Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo))));
  const kind = { many: 0.5, whale: 1.5, any: 2.5 }[shotWild && shotWild[1]] ?? rnd() * 3, ins = [];
  if (kind < 1) {
    const n = logU(20, 200);
    for (let i = 0; i < n; i++) ins.push(logU(546, 2e6));
  } else if (kind < 2) {
    ins.push(logU(1e9, 1e10));
    for (let i = 0, n = 1 + Math.floor(rnd() * 8); i < n; i++) ins.push(logU(546, 5000));
  } else {
    const n = logU(2, 60);
    for (let i = 0; i < n; i++) ins.push(logU(546, 1e10));
  }
  for (let i = ins.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ins[i], ins[j]] = [ins[j], ins[i]]; }
  const nOut = tx.outputs.length;
  tx.size = 10 + 148 * ins.length + 34 * nOut;
  tx.fee = Math.round(rate * tx.size);
  const total = ins.reduce((a, v) => a + v, 0), need = tx.fee + 546 * nOut + (tx.donation || 0);
  if (total < need) ins[0] += need - total; // enough to pay for it
  const spend = ins.reduce((a, v) => a + v, 0) - tx.fee - (tx.donation || 0), w = tx.outputs.map(() => -Math.log(1 - rnd()));
  const plain = tx.outputs.length - (tx.donation ? 1 : 0), sw = w.slice(0, plain).reduce((a, v) => a + v, 0);
  for (let i = 0; i < plain; i++) tx.outputs[i] = 546 + Math.floor(((spend - 546 * plain) * w[i]) / sw);
  tx.outputs[plain - 1] += spend - tx.outputs.slice(0, plain).reduce((a, v) => a + v, 0);
  tx.inputs = ins;
}
// what a made-up transaction's n inputs spend: its outputs and fee between them, at random, each at least
// 546 sats (fewer inputs if there isn't enough for that)
function madeUpInputs(n, tx) {
  const total = tx.outputs.reduce((a, v) => a + v, 0) + tx.fee, k = Math.max(1, Math.min(n, Math.floor(total / 546)));
  const w = Array.from({ length: k }, () => -Math.log(1 - rnd())), sum = w.reduce((a, v) => a + v, 0), rest = total - 546 * k;
  const ins = w.map((v) => 546 + Math.floor((rest * v) / sum));
  ins[k - 1] += total - ins.reduce((a, v) => a + v, 0);
  return ins;
}
// make a made-up transaction a donation: 0.0005 to 0.3 BCH (log-uniform), so every firework turns up
function madeUpDonation(tx) {
  tx.donation = Math.round(50000 * Math.pow(600, rnd()));
  tx.outputs.push(tx.donation); tx.size += 34;
}
function addMadeUp(fee, delay, sound) { // sound: also play it (not for the crowd at the start or the 1,000 at once)
  const tx = madeUpTx(fee);
  addSoul(fee, delay, tx);
  if (sound) { sonifier.event(tx); celebrate(tx); }
}
// a firework for a donation as it arrives (not for ones already waiting when the page starts), hidden or not:
// a hidden page still moves along (runUnseen), so coming back while it's going shows the rest of it
function celebrate(tx) {
  if (tx.donation > 0 && landTop) fireworks.launch(tx.donation, sky);
}
const fireworks = new Fireworks(mulberry(23));
const sky = { get W() { return W; }, skyline: (x) => landTop[clamp(Math.round((x + 4) / 2), 0, landTop.length - 1)] };
// A stress-test transaction: drawn to show every look a soul can have, often. Fee: a third at the 1 sat/B
// minimum, a third across 1-10, a third 10-1,500 (every lantern colour, and past hot magenta). 0.5% donate. Outputs: no bag, one
// suitcase, small and tall dollies, 5% up to 2,000 (a stack well off the top of the frame). Inputs: mostly
// 1-2, some consolidations up to 600 (big souls). Never over the 100 kB standard limit. Amounts log-uniform from
// dust to 1,000 BCH, so every harmonic sounds. NFT, fungible tokens and OP_RETURN each independently common.
function stressTx() {
  const r = rnd();
  const fee = r < 0.33 ? 1 : r < 0.66 ? 1 + 9 * rnd() : 10 * Math.pow(150, rnd());
  const o = rnd(), nOut = o < 0.3 ? 1 : o < 0.55 ? 2 : o < 0.8 ? 3 + Math.floor(3 * rnd()) : o < 0.95 ? 6 + Math.floor(55 * rnd()) : 61 + Math.floor(1940 * rnd() * rnd());
  const i = rnd(), nIn = i < 0.7 ? 1 + Math.floor(2 * rnd()) : i < 0.95 ? 3 + Math.floor(18 * rnd()) : 21 + Math.floor(580 * rnd());
  const nft = rnd() < 0.15, ft = rnd() < 0.2, memo = rnd() < 0.15;
  const ins = Math.min(nIn, Math.floor((99000 - 34 * nOut) / 148)); // under 100 kB with its outputs
  const size = 10 + 148 * Math.max(1, ins) + 34 * nOut + (nft || ft ? 40 : 0) + (memo ? 60 : 0), outputs = [];
  for (let k = 0; k < nOut; k++) outputs.push(Math.floor(546 * Math.pow(1000 * SATS_PER_BCH / 546, rnd())));
  const tx = { type: "tx", t: sonifier.serverNow(), txid: `synthetic-${nextId}`, outputs, size, fee: Math.round(fee * size), nft, ft, memo };
  if (rnd() < 0.005) madeUpDonation(tx); // ~0.9 a second
  tx.fee = Math.round(fee * tx.size);
  if (shotWild) wildInputs(tx, fee);
  else tx.inputs = madeUpInputs(Math.max(1, ins), tx);
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
  if (delay >= 0 && !reduce && lo < cap) { s.st = 1; s.t0 = now + delay; s.u = -1; s.f = 0; s.dx = (hash(s.id, 7) - 0.5) * 0.12; s.vortex = undefined; arrivals.push(s); } // (its vortex: worked out as it starts to fall, in step)
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
  for (const s of arrivals) if (s.vortex === undefined && now >= s.t0) s.vortex = vortexOf(s); // (as it starts to fall: where it is then)
  for (let i = arrivals.length - 1; i >= 0; i--) {
    const s = arrivals[i];
    const fall = s.vortex ? VORTEX_FALL : FALL, since = now - s.t0;
    s.u = Math.min(1, since / fall); s.f = clamp((since - fall) / FORM, 0, 1); // falling; then forming (see LAND_FROM)
    if (since >= fall + FORM) { s.st = 0; s.vortex = null; arrivals.splice(i, 1); farDirty = true; }
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
  // top: just above the frame. Every soul falls alike (evenly enough that a vortex's turns show).
  // (it lands floating up and down just as the souls in line do, so it doesn't jump when it joins them)
  const left = Math.pow(1 - u, 1.5), stand = ground(gz) + 0.2 + 0.05 * Math.sin(now * 1.7 + s.id * 1.3), top = aboveFrame(gz, 40);
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
// Landing: the light falls toward the middle of the soul's body (LAND_MID soul heights up), its tail shortening
// and fading over the last part of its fall (from u = LAND_FROM); once it is there, the soul forms from it (over
// FORM seconds, s.f 0..1): the light spreads out from its point to fill the soul's outline (FILL_SPREAD s), and
// the glowing shape cools into the soul (from FILL_COOL s on, over FILL_COOLING s), while the light itself fades
// into it, with a soft swell of its glow as the shape lights up. At rest the light is gone and the soul is there.
const LAND_FROM = 0.68, LAND_MID = 0.6, FORM = 0.85, FILL_SPREAD = 0.5, FILL_COOL = 0.35, FILL_COOLING = 0.5;
const ease01 = (v) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
const fillCooled = (fs) => ease01((fs - FILL_COOL) / FILL_COOLING); // 0: all light .. 1: all soul (fs: seconds forming)
// the soul's outline, lit from its light at (hx, hy) out to R px, a: how much it still glows; x, y, size, t as for
// drawSoul (the same sway), so the light fills exactly the body that's fading in under it
function litOutline(x, y, size, s, t, hx, hy, R, a, col) {
  const B = size * s.tr.scale, sw = Math.sin(t * 2.1 + s.id * 0.9) * 0.08;
  ctx.setTransform(DPR * B, 0, 0, DPR * B, DPR * x, DPR * y);
  const cx = (hx - x) / B, cy = (hy - y) / B, r = R / B, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${col},${0.85 * a})`); g.addColorStop(0.7, `rgba(${col},${0.77 * a})`); g.addColorStop(1, `rgba(${col},0)`);
  ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g;
  wisp(sw);
  if (B >= 16) for (const [ax, rot] of [[-0.31, -0.5], [0.31, 0.5]]) { // the arms (a full-detail soul's)
    ctx.moveTo(ax + 0.065 * Math.cos(rot), -0.48 + 0.065 * Math.sin(rot)); ctx.ellipse(ax, -0.48, 0.065, 0.042, rot, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = "source-over"; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
// The stars of a soul with several inputs (see VORTEX_FALL), or null for a soul that drops in as one light. The
// biggest input is the centre (big); each other star { amount, r: how far out it starts (metres), head: its size,
// path, heads, dead: its course by gravity (see vortexGravity) }.
function vortexOf(s) {
  // (one input, or none known: its one star, the centre, with the same light and trail as any vortex's)
  const ins = s.tx.inputs && s.tx.inputs.length ? s.tx.inputs : [1];
  standAt(s); project(gx, gz, ground(gz));
  if (sS < VORTEX_MIN_S) return null;
  return vortexStars(ins, s.id);
}
function vortexStars(ins, id) {
  const s = { id }; // (only its id: for the hashes)
  const pick = ins.length > VORTEX_STARS ? [...ins].sort((a, b) => b - a).slice(0, VORTEX_STARS) : ins;
  const n = pick.length, lo = Math.log(Math.max(1, Math.min(...pick))), hi = Math.log(Math.max(1, Math.max(...pick)));
  // the orbits' scale: a little wider up to 12 inputs, then with the square root of how many there are (from 10),
  // so many lights stay about as far apart as ten do instead of crowding into a cloud
  const R0 = VORTEX_R * (1 + 0.2 * Math.min(1, (n - 2) / 10)) * Math.sqrt(Math.max(1, n / 10));
  const big = pick.indexOf(Math.max(...pick));
  const stars = pick.map((a, k) => {
    const rel = hi > lo ? (Math.log(Math.max(1, a)) - lo) / (hi - lo) : 0.5; // 0 the smallest input here .. 1 the biggest
    return {
      amount: Math.max(1, a), big: k === big, head: 1.5 + 3.5 * rel * rel,
      // (the small ones kept out of the big ones' glow by VORTEX_CLEAR)
      r: R0 * (0.12 + 1.2 * Math.pow(1 - rel, 0.45)) * (0.92 + 0.16 * hash(s.id * 131 + k, 9)) + VORTEX_CLEAR * Math.pow(1 - rel, 0.3),
    };
  });
  vortexGravity(stars, id, lo, hi);
  return stars;
}
// The vortex by gravity, worked out once when the soul starts to drop in: the biggest input is the centre, at rest
// on the line of the fall; each other star sets off at its distance (r), at a random angle, on a circular orbit
// round everything closer in. Then only gravity moves them: the centre's pull and each other's (the stars weigh
// GRAV_PULL times the centre all together, each by its amount^0.3), softened closer than GRAV_SOFT metres so close
// passes don't fling them away; cooling (GRAV_COOL), a drag on how far a star's velocity strays from a circular
// orbit, so they gather into clumps and streams instead of heating up and flying apart; and a gentle drag along
// the orbit (GRAV_DRAG). Stars closer than GRAV_REACH of their glows' reach together, and bound to each other
// (moving apart slower than their escape speed there), merge: mass, momentum and amount together, at their centre
// of mass, the heavier carrying on (and bigger); faster ones pass through. One that falls into the centre, bound,
// joins it. Colour: each star's hue is the angle it starts at round the centre (red, through the rainbow and
// hot magenta, back to red), and its saturation how far out it starts (so the centre, white, fits in), kept as a
// vector (cos, sin of the hue, as long as the saturation); merging adds them by mass, so stars of unlike hues
// make a paler light, and a crowd of them tends to white. Where a star goes after it starts doesn't change it. Time: 1 = the closing (VORTEX_MEET of the fall), in GRAV_STEPS stored steps (GRAV_SUB each); G is set
// so a star at the middle distance would go round GRAV_TURNS times. Each star gets path (x across, z inland,
// metres from the line of the fall, per step), heads (its size per step), hues (its hue vector per step)
// and dead (the step it merged at).
const GRAV_PULL = 3, GRAV_SOFT = 0.2, GRAV_COOL = 10, GRAV_DRAG = 0.8, GRAV_TURNS = 2, GRAV_REACH = 0.2, GRAV_STEPS = 160, GRAV_SUB = 2;
const gravHead = (amt, lo, hi) => { const rel = hi > lo ? clamp((Math.log(amt) - lo) / (hi - lo), 0, 1) : 0.5; return 1.5 + 3.5 * rel * rel; };
const gravGlow = (head) => 0.042 * head; // a star's glow's reach, metres (about 4.7 core radii of 0.009 m per unit of head)
function vortexGravity(stars, id, lo, hi) {
  const lights = stars.filter((s) => !s.big), n = lights.length, e2 = GRAV_SOFT * GRAV_SOFT, dt = 1 / (GRAV_STEPS * GRAV_SUB);
  let M = 1;
  const wt = lights.map((s) => Math.pow(s.amount, 0.3)), wsum = wt.reduce((a, b) => a + b, 0) || 1;
  const m = Float64Array.from(wt, (w) => (GRAV_PULL * w) / wsum), amt = Float64Array.from(lights, (s) => s.amount);
  const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
  const ax = new Float64Array(n), ay = new Float64Array(n), alive = new Uint8Array(n).fill(1), dead = new Int32Array(n).fill(GRAV_STEPS + 1);
  const into = new Int32Array(n).fill(-2), rank = new Float64Array(n), idx = Array.from({ length: n }, (_, i) => i);
  const hx = new Float64Array(n), hy = new Float64Array(n); // hue vectors
  const reach = Float64Array.from(lights, (s) => GRAV_REACH * gravGlow(gravHead(s.amount, lo, hi))); // (each one's share of the merging distance)
  const rs = lights.map((s) => s.r).sort((a, b) => a - b), rRef = rs[Math.floor(rs.length / 2)] || 0.5;
  const G = (Math.pow(2 * Math.PI * GRAV_TURNS, 2) * Math.pow(rRef, 3)) / (M * (1 + 0.5 * GRAV_PULL));
  let inside = M;
  for (const i of idx.slice().sort((a, b) => lights[a].r - lights[b].r)) {
    const a = 2 * Math.PI * hash(id * 977 + i, 21), r = lights[i].r, vc = Math.sqrt((G * inside) / r);
    x[i] = r * Math.cos(a); y[i] = r * Math.sin(a); vx[i] = -vc * Math.sin(a); vy[i] = vc * Math.cos(a);
    const sat = Math.pow(clamp(r / (1.2 * rRef), 0, 1), 0.7); // (the farther out it starts, the more saturated)
    hx[i] = sat * Math.cos(a); hy[i] = sat * Math.sin(a);
    inside += m[i];
  }
  const path = lights.map(() => new Float32Array((GRAV_STEPS + 1) * 2)), heads = lights.map(() => new Float32Array(GRAV_STEPS + 1));
  const hues = lights.map(() => new Float32Array((GRAV_STEPS + 1) * 2));
  const accel = () => {
    const live = idx.filter((i) => alive[i]).sort((a, b) => x[a] * x[a] + y[a] * y[a] - (x[b] * x[b] + y[b] * y[b]));
    let enc = M; for (const i of live) { rank[i] = enc; enc += m[i]; } // the mass closer in than each star
    for (const i of live) {
      const q = x[i] * x[i] + y[i] * y[i], r2 = q + e2, r = Math.sqrt(q) || 1e-6, f = (G * M) / (r2 * Math.sqrt(r2));
      const vc = Math.sqrt((G * rank[i]) / r), cx = (-vc * y[i]) / r, cy = (vc * x[i]) / r; // its circular orbit's velocity
      ax[i] = -f * x[i] - GRAV_COOL * (vx[i] - cx) - GRAV_DRAG * cx; ay[i] = -f * y[i] - GRAV_COOL * (vy[i] - cy) - GRAV_DRAG * cy;
    }
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
      const i = live[a], j = live[b], dx = x[j] - x[i], dy = y[j] - y[i], r2 = dx * dx + dy * dy + e2, f = G / (r2 * Math.sqrt(r2));
      ax[i] += f * m[j] * dx; ay[i] += f * m[j] * dy; ax[j] -= f * m[i] * dx; ay[j] -= f * m[i] * dy;
    }
  };
  const merge = (k) => {
    let any = false;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const r = Math.hypot(x[i], y[i]);
      if (r < reach[i] && vx[i] * vx[i] + vy[i] * vy[i] < (2 * G * (M + m[i])) / Math.sqrt(r * r + e2)) {
        alive[i] = 0; dead[i] = k; into[i] = -1; M += m[i]; any = true; continue; // into the centre
      }
      for (let j = i + 1; j < n; j++) {
        if (!alive[j]) continue;
        const dx = x[j] - x[i], dy = y[j] - y[i], rr = reach[i] + reach[j];
        if (dx * dx + dy * dy > rr * rr) continue;
        const d = Math.hypot(dx, dy), mm = m[i] + m[j];
        const dvx = vx[j] - vx[i], dvy = vy[j] - vy[i];
        if (dvx * dvx + dvy * dvy > (2 * G * mm) / Math.sqrt(d * d + e2)) continue; // passing through, too fast to hold
        const [a, b] = m[i] >= m[j] ? [i, j] : [j, i];
        x[a] = (m[i] * x[i] + m[j] * x[j]) / mm; y[a] = (m[i] * y[i] + m[j] * y[j]) / mm;
        vx[a] = (m[i] * vx[i] + m[j] * vx[j]) / mm; vy[a] = (m[i] * vy[i] + m[j] * vy[j]) / mm;
        hx[a] = (m[i] * hx[i] + m[j] * hx[j]) / mm; hy[a] = (m[i] * hy[i] + m[j] * hy[j]) / mm;
        m[a] = mm; amt[a] = amt[i] + amt[j]; reach[a] = GRAV_REACH * gravGlow(gravHead(amt[a], lo, hi)); alive[b] = 0; dead[b] = k; into[b] = a; any = true;
        path[b][2 * k] = x[a]; path[b][2 * k + 1] = y[a]; // (its trail runs into where they met)
        if (b === i) break;
      }
    }
    return any;
  };
  const store = (k) => {
    for (let i = 0; i < n; i++) {
      if (alive[i]) {
        path[i][2 * k] = x[i]; path[i][2 * k + 1] = y[i]; heads[i][k] = gravHead(amt[i], lo, hi); hues[i][2 * k] = hx[i]; hues[i][2 * k + 1] = hy[i];
      } else { // gone: it stays where it went (for the end of its trail), as it was
        const d = dead[i];
        if (into[i] === -1 && k === d) { path[i][2 * d] = 0; path[i][2 * d + 1] = 0; } // (into the centre)
        path[i][2 * k] = path[i][2 * d]; path[i][2 * k + 1] = path[i][2 * d + 1];
        heads[i][k] = heads[i][d - 1]; hues[i][2 * k] = hues[i][2 * d - 2]; hues[i][2 * k + 1] = hues[i][2 * d - 1];
      }
    }
  };
  lights.forEach((s, i) => { s.path = path[i]; s.heads = heads[i]; s.hues = hues[i]; s.dead = GRAV_STEPS + 1; });
  store(0); accel();
  // Worked out as it's needed, not all at once: stars.advance(K) runs it on to stored step K (a couple of steps a
  // frame as it plays; see vortexReady), so many vortexes starting together don't stall a frame.
  let k = 0;
  stars.advance = (K) => {
    for (K = Math.min(GRAV_STEPS, K); k < K; ) {
      k++;
      for (let s = 0; s < GRAV_SUB; s++) { // leapfrog: kick, drift, kick
        for (let i = 0; i < n; i++) if (alive[i]) { vx[i] += 0.5 * dt * ax[i]; vy[i] += 0.5 * dt * ay[i]; x[i] += dt * vx[i]; y[i] += dt * vy[i]; }
        accel();
        for (let i = 0; i < n; i++) if (alive[i]) { vx[i] += 0.5 * dt * ax[i]; vy[i] += 0.5 * dt * ay[i]; }
        if (merge(k)) accel();
      }
      for (let i = 0; i < n; i++) if (!alive[i] && lights[i].dead > GRAV_STEPS) lights[i].dead = dead[i];
      store(k);
    }
  };
}
// a vortex worked out as far as v (0..1 of the way to meeting), and a step beyond (for in between)
const vortexReady = (stars, v) => stars.advance(Math.ceil(clamp(v, 0, 1) * GRAV_STEPS) + 1);
const starGone = (st, v) => !st.big && v * GRAV_STEPS > st.dead; // merged into another star (or the centre) by v
const starHead = (st, v) => (st.big ? st.head : st.heads[Math.min(GRAV_STEPS, Math.max(0, Math.round(v * GRAV_STEPS)))]);
// A star's colour at v as "r,g,b": its hue (see vortexGravity), as saturated as its hue vector is long (set by
// how far out it started; paler for a merger of unlike hues), over the falling light's pale blue-white. The
// centre: that blue-white.
const STAR_WHITE = [190, 240, 255];
function hueRGB(h) { // full saturation, 60% light (as the lanterns), h in degrees
  const ch = (n) => { const k = (((n + h / 30) % 12) + 12) % 12; return 255 * (0.6 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [ch(0), ch(8), ch(4)];
}
const whiters = new Map(), whiter = (c) => { // halfway to white (kept, as starColour's colours are few)
  let w = whiters.get(c);
  if (!w) { if (whiters.size > 2048) whiters.clear(); w = c.split(",").map((x) => Math.round((+x + 255) / 2)).join(","); whiters.set(c, w); }
  return w;
};
function starColour(st, v) {
  if (st.big) return STAR_WHITE.join(",");
  const k = Math.min(GRAV_STEPS, Math.max(0, Math.round(clamp(v, 0, 1) * GRAV_STEPS))), cx = st.hues[2 * k], cy = st.hues[2 * k + 1];
  const sat = clamp(Math.hypot(cx, cy), 0, 1);
  const c = hueRGB((Math.atan2(cy, cx) * 180) / Math.PI);
  return STAR_WHITE.map((w, i) => (Math.round(w + (c[i] - w) * sat) >> 3) << 3).join(","); // (to the nearest 8: the glows are kept by colour)
}
// where a star is at v (0..1 of the way to meeting), metres from the line of the fall -> [across, inland]; drawn in
// toward the centre over the last part, so they all meet it on cue
function starOffset(st, v) {
  if (st.big) return [0, 0];
  const f = clamp(v, 0, 1) * GRAV_STEPS, i = Math.min(GRAV_STEPS - 1, Math.floor(f)), fr = f - i, P = st.path;
  const k = 1 - ease01((v - 0.6) / 0.4);
  return [(P[2 * i] + (P[2 * i + 2] - P[2 * i]) * fr) * k, (P[2 * i + 1] + (P[2 * i + 3] - P[2 * i + 1]) * fr) * k];
}
// where one of a soul's stars is at u (0..1 of the fall) -> wx, wz, we
function starPos(s, st, u) {
  const [dx, dz] = starOffset(st, Math.min(1, u / VORTEX_MEET));
  arrivalPos(s, u);
  wx += dx; wz = Math.max(1.5, wz + dz);
}
// A falling soul's light: a bright core with a glow around it, in proportion to its soul (S0: a normal soul's
// height where it lands, px, so the light keeps its size as it falls) and as much bigger for a bigger transaction
// as its soul is (k: its traits' scale, which grows with the log of its bytes); forming (fs: seconds since it
// landed; see FORM), the core fades and the glow spreads and fades into the lit outline, swelling softly as it does.
const HEAD_R = 2.2, HEAD_GLOW = 0.55;
const headCoreR = (S0, k) => Math.max(HEAD_R, 0.05 * S0) * k, headGlowR = (S0, k) => Math.max(4, 0.25 * S0) * k;
// the light's glow, drawn once per colour and stamped: 1 at the middle, 0.4 a third of the way out, gone at the edge
const headGlows = new Map();
function headGlow(col) {
  let c = headGlows.get(col);
  if (!c) {
    c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.3, `rgba(${col},0.4)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); headGlows.set(col, c);
  }
  return c;
}
function arrivalHead(hx, hy, S0, k, fs, col) {
  const spread = ease01(fs / FILL_SPREAD), core = 1 - ease01(fs / 0.35);
  const swell = 0.5 * Math.sin(Math.PI * clamp((fs - 0.25) / 0.45, 0, 1)), glow = 1 - ease01(fs / 0.45) + swell;
  const r = headGlowR(S0, k) + (0.7 * S0 * k - headGlowR(S0, k)) * spread, a = HEAD_GLOW * glow;
  ctx.globalAlpha = Math.min(1, a); ctx.drawImage(headGlow(col), hx - r, hy - r, 2 * r, 2 * r); ctx.globalAlpha = 1;
  if (core > 0) { ctx.fillStyle = `rgba(${col},${core})`; ctx.beginPath(); ctx.arc(hx, hy, headCoreR(S0, k), 0, Math.PI * 2); ctx.fill(); }
}
// Far off, where a soul is too small for its vortex (see VORTEX_MIN_S), one with many inputs gets a cheap stand-in:
// a few coloured dots (about log2 of its inputs, 3 to 8), each with a short fading tail, on a tilted ring round its
// light, turning faster and closing onto it as a vortex would, coloured round the wheel like a vortex's stars. Only
// from FAR_SWIRL_FROM inputs, fading in to full by 3 more, so there's no pop where it starts.
const FAR_SWIRL_FROM = 5;
const FAR_SWIRL_COLS = Array.from({ length: 9 }, (_, n) => Array.from({ length: n }, (_, i) => `rgb(${hueRGB((360 * i) / n).map(Math.round)})`)); // [count][i]
function drawFarSwirls(list) {
  const N = 6;
  ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "butt";
  for (const s of list) {
    const ins = s.tx.inputs, n = ins ? ins.length : 0;
    if (s.vortex || n < FAR_SWIRL_FROM || s.u < 0 || s.u >= VORTEX_MEET) continue;
    const k = ease01((n - FAR_SWIRL_FROM) / 3);
    if (!k) continue;
    const count = clamp(Math.round(Math.log2(n)), 3, 8), spin = 2 * Math.PI * hash(s.id, 22);
    const reach = VORTEX_R * 1.2 * Math.sqrt(Math.max(1, n / 10)) * 1.3; // metres: about where a vortex's stars start
    arrivalPos(s, s.u); project(wx, wz, we);
    const up = LAND_MID * sS; // (aimed at the body's middle, as the light is)
    const at = (i, uu) => { // dot i at uu: on the closing, turning ring round where the light was then -> sx, sy
      const v = Math.min(1, uu / VORTEX_MEET), r = reach * (1 - Math.pow(v, 1.6));
      const th = (2 * Math.PI * i) / count + spin + 2 * Math.PI * 2 * (0.4 * v + 0.6 * v * v * v);
      arrivalPos(s, uu); project(wx + r * Math.cos(th), Math.max(1.5, wz + r * Math.sin(th)), we);
      return 0.65 + 0.35 * Math.sin(th); // (nearer: brighter)
    };
    const fade = k * (1 - ease01((s.u / VORTEX_MEET - 0.7) / 0.3));
    for (let i = 0; i < count; i++) {
      ctx.strokeStyle = ctx.fillStyle = FAR_SWIRL_COLS[count][i];
      let px = 0, py = 0;
      for (let j = 0; j <= N; j++) { // its tail, then the dot
        const a = at(i, Math.max(0, s.u - VORTEX_TRAIL * 0.6 * (1 - j / N))), x = sx, y = sy - up;
        if (j) {
          const q = j / N; ctx.globalAlpha = 0.6 * q * fade * a; ctx.lineWidth = 0.6 + 0.6 * q;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        }
        if (j === N) { ctx.globalAlpha = fade * a; ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6); }
        px = x; py = y;
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-over";
}
// The vortexes of the souls dropping in: each star a light with a tail, as bright as it is near. Merging (over
// the last part of the closing) the small ones fade into the biggest, and it turns into the soul's own light
// (arrivalHead: its size, colour and glow) just as they meet, where streaks() takes over the head; the biggest
// star's trail goes on as the soul's tail, all the way down, shortening and fading as the soul lands.
// a star's glow, drawn once per colour (starColour's, to the nearest 8 in each channel) and stamped: a radial fade
// of that colour, 0.9 at the middle, 0.35 a third of the way out, gone at the edge
const starGlows = new Map();
function starGlow(key) {
  let c = starGlows.get(key);
  if (!c) {
    if (starGlows.size > 2048) starGlows.clear();
    c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, `rgba(${key},0.9)`); gr.addColorStop(0.3, `rgba(${key},0.35)`); gr.addColorStop(1, `rgba(${key},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32); starGlows.set(key, c);
  }
  return c;
}
function drawVortexes(list) {
  const col = "190,240,255";
  ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "butt"; // (flat ends: the steps of a trail meet without overlapping, so no bright beads where they join)
  for (const s of list) {
    if (!s.vortex || s.u < 0) continue;
    arrivalPos(s, s.u); project(wx, wz, we);
    const up = LAND_MID * sS; // aimed at the body's middle, lifted just as the soul's own light is (see streaks)
    standAt(s); project(gx, gz, ground(gz)); const S0 = sS;
    const N = s.vortex.length < 2 ? 10 : S0 < 25 ? 10 : 16; // trail steps (fewer where it's small, or a lone light's nearly straight trail): enough that the fade looks smooth
    const v = Math.min(1, s.u / VORTEX_MEET), mg = clamp((v - 0.55) / 0.45, 0, 1), m = mg * mg * (3 - 2 * mg);
    vortexReady(s.vortex, v);
    const fade = clamp((v - 0.82) / 0.18, 0, 1); // the small ones: into the biggest, at the end of their plunge
    const head = s.u < VORTEX_MEET, land = landing(s), big = s.tr.scale; // big: its transaction's size, as its soul's
    const vTail = Math.max(0, s.u - VORTEX_TRAIL) / VORTEX_MEET; // (when its trail starts)
    // many small ones: their glows and trails each dimmer, so together they don't blaze white, and more so as they close in (their
    // cores not: each input stays a light of its own)
    let n1 = 0; for (const st of s.vortex) if (!st.big && !starGone(st, v)) n1++; // (those still their own)
    n1 = Math.max(1, n1);
    const crowd = Math.min(1, 3 / Math.sqrt(n1 * (1 + n1 * v * v)));
    for (const st of s.vortex) {
      if (!st.big && (!head || starGone(st, vTail))) continue; // (merged before its trail began: nothing left of it)
      const size = starHead(st, v), sc = starColour(st, v); // (its colour now)
      const keep = st.big ? 1 - land : (1 - fade) * crowd; // how much of this star (its trail) is still to be seen
      const hr = Math.max(0.8 / 0.55, (headCoreR(S0, big) * size) / 5 / 0.55); // (the biggest: the soul's light)
      let px = 0, py = 0, a = 1;
      ctx.strokeStyle = `rgb(${sc})`; // (one colour; each step's strength by globalAlpha)
      for (let k = 0; k <= N; k++) {
        const uk = Math.max(0, s.u - VORTEX_TRAIL * (1 - k / N));
        starPos(s, st, uk); project(wx, wz, we);
        const x = sx, y = sy - up;
        a = clamp(0.55 + 2.5 * (sS / S0 - 0.95), 0.45, 1);
        if (k && keep > 0 && !starGone(st, Math.min(1, uk / VORTEX_MEET) - 1 / GRAV_STEPS)) { // (a merged one's trail: up to where it met)
          const q = st.big && land > 0 ? clamp((k / N - land) / (1 - land), 0, 1) : k / N; // (landing: shortening)
          if (q > 0) {
            ctx.globalAlpha = Math.min(1, 0.6 * q * a * keep); ctx.lineWidth = Math.max(0.6, hr * 0.7 * q * (1 - 0.5 * (st.big ? m : fade)));
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
          }
        }
        px = x; py = y;
      }
      ctx.globalAlpha = 1;
      if (!head) continue;
      if (st.big) { // turning into the soul's light
        const R = headGlowR(S0, big), g0 = 0.9 * a * (1 - m) + HEAD_GLOW * m, g1 = 0.35 * a * (1 - m) + 0.4 * HEAD_GLOW * m;
        const g = ctx.createRadialGradient(px, py, 0, px, py, R);
        g.addColorStop(0, `rgba(${col},${g0})`); g.addColorStop(0.3, `rgba(${col},${g1})`); g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g; ctx.fillRect(px - R, py - R, 2 * R, 2 * R);
        const r = headCoreR(S0, big);
        ctx.fillStyle = `rgba(${Math.round(255 - 65 * m)},${Math.round(255 - 15 * m)},255,${a + (1 - a) * m})`;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      if (fade >= 1 || starGone(st, v)) continue;
      const R = hr * 2.6;
      ctx.globalAlpha = Math.min(1, a * keep); ctx.drawImage(starGlow(sc), px - R, py - R, 2 * R, 2 * R);
      ctx.globalAlpha = Math.min(1, a * (1 - fade)); ctx.fillStyle = `rgb(${whiter(sc)})`; // its core: halfway to white
      ctx.beginPath(); ctx.arc(px, py, Math.max(0.8, hr * 0.55), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalCompositeOperation = "source-over";
}
const landing = (s) => { const v = clamp((s.u - LAND_FROM) / (1 - LAND_FROM), 0, 1); return v * v * (3 - 2 * v); }; // 0..1, eased
const arrivalWisp = (s) => (s.f > 0 ? sS : 0);                                       // full size, forming
const flightWisp = (s) => (s.u < 0.35 ? 0.9 * ppm(s.oz, s.oe) * (1 - s.u / 0.35) : 0); // shrinks to a spark as it leaves

// souls in the air: a streak of light each, plus the wisp itself while close to the ground. land: arriving
// souls, whose light aims at the body's middle and turns into the soul as it lands (see LAND_FROM)
const thin = [], thick = [], wisps = [];
// Leaving souls (hundreds at once) are drawn into a layer of their own (trailCv) and that is added onto the
// scene in one go: each shape added as light costs about as much as adding a whole layer, and there are four.
function streaks(list, pos, lag, col, wispSize, t, land = false) {
  thin.length = thick.length = wisps.length = 0;
  const main = ctx;
  if (!land) { ctx = trailCtx; ctx.clearRect(0, 0, W, H); }
  ctx.globalCompositeOperation = land ? "lighter" : "source-over"; ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(${col},0.5)`; ctx.lineWidth = 1; ctx.beginPath();
  for (const s of list) {
    if (s.u < 0 || (land && s.vortex && s.u < VORTEX_MEET)) continue; // a vortex: its stars until they meet
    let S0 = 0;
    if (land) { standAt(s); project(gx, gz, ground(gz)); S0 = sS; } // its soul's height where it lands: the light's size
    pos(s, s.u); project(wx, wz, we);
    const up = land ? LAND_MID * sS : 0, hx = sx, hy = sy, hS = sS; // lifted by the soul's height at the head, so it lands at the chest
    pos(s, Math.max(0, s.u - (s.vortex ? 0 : lag))); project(wx, wz, we); // (a vortex: its biggest star's trail is its tail)
    const tx = sx, ty = sy - up; // (the tail lifted as much as its head: a soul's size doesn't change as it falls)
    sx = hx; sy = hy; sS = hS;
    const m = land ? landing(s) : 0, fs = land ? (s.f || 0) * FORM : 0; // m: the tail going; fs: seconds forming
    if (sS >= 6) thick.push(tx, ty, sx, sy - up, m, sS, s.tr.scale, S0, fs); else { ctx.moveTo(tx, ty); ctx.lineTo(sx, sy - up); thin.push(sx, sy - up, sS); }
    const ws = wispSize(s);
    if (ws >= FAR_S) wisps.push(s, sx, sy, ws, land ? fs : m);
  }
  ctx.stroke();
  ctx.lineWidth = 1.7;
  if (!land) { // leaving: every tail and every head alike, so all the tails as one shape and all the heads as another
    ctx.beginPath();
    for (let i = 0; i < thick.length; i += 9) { ctx.moveTo(thick[i], thick[i + 1]); ctx.lineTo(thick[i + 2], thick[i + 3]); }
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter"; // the heads add to their tails, as on the scene
    ctx.fillStyle = `rgb(${col})`; ctx.beginPath();
    for (let i = 0; i < thick.length; i += 9) { ctx.moveTo(thick[i + 2] + 2.2, thick[i + 3]); ctx.arc(thick[i + 2], thick[i + 3], 2.2, 0, Math.PI * 2); }
    ctx.fill();
  } else for (let i = 0; i < thick.length; i += 9) { // landing: one by one, each fades on its own as it lands
    const [ax, ay, hx, hy, m, , k, S0, fs] = thick.slice(i, i + 9);
    if (m < 1 && (ax !== hx || ay !== hy)) {
      ctx.strokeStyle = `rgba(${col},${0.5 * (1 - m)})`;
      ctx.beginPath(); ctx.moveTo(ax + (hx - ax) * m, ay + (hy - ay) * m); ctx.lineTo(hx, hy); ctx.stroke(); // tail shortening
    }
    arrivalHead(hx, hy, S0, k, fs, col);
  }
  ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); // the far ones' heads: small squares, as one shape
  for (let i = 0; i < thin.length; i += 3) { const w = clamp(thin[i + 2] * 0.5, 1.2, 2.4); ctx.rect(thin[i] - w / 2, thin[i + 1] - w / 2, w, w); }
  ctx.fill();
  if (!land) { ctx = main; ctx.globalCompositeOperation = "lighter"; ctx.drawImage(trailCv, 0, 0, W, H); }
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < wisps.length; i += 5) {
    const s = wisps[i], x = wisps[i + 1], y = wisps[i + 2], size = wisps[i + 3], m = wisps[i + 4];
    if (land) { // forming: the soul under its lit outline, cooling into it (see FORM)
      const fs = m, cooled = fillCooled(fs);
      if (cooled > 0) { ctx.globalAlpha = cooled; drawSoul(x, y, size, s, t, false); ctx.globalAlpha = 1; }
      if (cooled < 1) {
        const k = s.tr.scale, S0 = size, R = headGlowR(S0, k) + (1.25 * S0 * k - headGlowR(S0, k)) * ease01(fs / FILL_SPREAD);
        litOutline(x, y, size, s, t, x, y - LAND_MID * size, R, 1 - cooled, col);
      }
      continue;
    }
    const fly = !noPreDraw && liftOffPicture(s, 0.9 * ppm(s.oz, s.oe)); // leaving: shrinking, from its picture
    if (!fly) { drawSoul(x, y, size, s, t, false); continue; }
    fly.seen = frameNo;
    const sc = size / fly.S, d = (fly.sl.size / DPR) * sc;
    ctx.drawImage(fly.sl.page.c, fly.sl.x, fly.sl.y, fly.sl.size, fly.sl.size, x - fly.ax * sc, y - fly.ay * sc, d, d);
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
// BCH Radio's lyrics: the line being sung, in soft glowing text in the sky. It goes in the clear stretch of the
// top row between the buttons and the moon, or on a narrow screen across the sky just under the buttons; a
// line too long for one row at a readable size is split in two.
let radio = null, lyricFit = null;
const LYRIC_FONT = (fs) => `italic 500 ${fs.toFixed(1)}px Inter, system-ui, sans-serif`;
function fitLyric(text) {
  const r = cv.getBoundingClientRect(), rel = (e) => { const b = e && e.getBoundingClientRect(); return b && b.width ? { left: b.left - r.left, right: b.right - r.left, top: b.top - r.top, bottom: b.bottom - r.top } : null; };
  const corner = rel(document.querySelector(".corner")), sound = rel(document.querySelector(".sound"));
  const mr = Math.min(Math.max(9, H * 0.03), yh * 0.2), moonL = W * MOON_X - mr * 1.8; // the moon (as renderBg draws it)
  const fs0 = clamp(H * 0.032, 16, 28);
  let x0 = (corner ? corner.right : 0) + 18, x1 = Math.min(moonL, sound ? sound.left : W) - 18, y = corner ? (corner.top + corner.bottom) / 2 : 30;
  if (x1 - x0 < 300) { x0 = 16; x1 = W - 16; y = Math.max(corner ? corner.bottom : 0, sound ? sound.bottom : 0) + fs0 * 0.9; } // narrow: under them
  const room = x1 - x0, width = (t, fs) => { ctx.font = LYRIC_FONT(fs); return ctx.measureText(t).width; };
  let rows = [text], fs = fs0;
  const w1 = width(text, fs0);
  if (w1 > room) {
    if (w1 * 0.8 <= room) fs = (fs0 * room) / w1; // a little smaller still fits
    else { // two rows, split at the space nearest the middle
      const sp = [...text.matchAll(/ /g)].map((m) => m.index);
      const cut = sp.length ? sp.reduce((a, b) => (Math.abs(b - text.length / 2) < Math.abs(a - text.length / 2) ? b : a)) : -1;
      if (cut > 0) rows = [text.slice(0, cut), text.slice(cut + 1)];
      fs = Math.max(11, Math.min(fs0, ...rows.map((t) => (fs0 * room) / width(t, fs0))));
      y += y > (corner ? corner.bottom : 0) ? fs * 0.55 : 6; // under the buttons: the first row stays where it was; beside them: off the top edge
    }
  }
  return { key: text + "|" + W + "|" + H, font: LYRIC_FONT(fs), rows, x: (x0 + x1) / 2, y, gap: fs * 1.15 };
}
function drawLyric() {
  const ly = shotLyric ? { text: decodeURIComponent(shotLyric[1]), a: 1 } : radio && radio.lyric();
  if (!ly) return;
  ctx.save();
  if (!lyricFit || lyricFit.key !== ly.text + "|" + W + "|" + H) lyricFit = fitLyric(ly.text); // once per line (and frame size)
  const L = lyricFit;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = L.font;
  ctx.shadowColor = `rgba(140,225,205,${0.6 * ly.a})`; ctx.shadowBlur = 14;
  ctx.fillStyle = `rgba(238,246,255,${0.92 * ly.a})`;
  L.rows.forEach((t, i) => ctx.fillText(t, L.x, L.y + (i - (L.rows.length - 1) / 2) * L.gap));
  ctx.restore();
}

// Arriving souls are drawn in their places in the line, back to front with the rest (so the souls, stacks and
// pier in front of where one lands are in front of its light, and the boat in front of all of them): each run of
// them between two standing souls together, with their lights. farArrivals: those landing far off (or over the
// horizon), before the middle distance.
const farArrivals = [], arrivalRun = [];
function drawArrivals(list, t) {
  ctx.save();
  drawVortexes(list); drawFarSwirls(list); streaks(list, arrivalPos, 0.08, "190,240,255", arrivalWisp, t, true);
  ctx.restore();
}
function inOrder(list, one, t) { // list's souls, back to front; one(s, t) draws a standing soul
  for (let i = 0; i < list.length; ) {
    if (list[i].st !== 1) { one(list[i++], t); continue; }
    arrivalRun.length = 0;
    while (i < list.length && list[i].st === 1) arrivalRun.push(list[i++]);
    drawArrivals(arrivalRun, t);
  }
}
function draw() {
  const t = reduce ? 20 : now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  ctx.drawImage(bg, 0, 0, W, H);
  fireworks.draw(ctx, skyClip);
  drawLyric();
  drawSurf(t);
  if (block) { ctx.globalAlpha = ferryAlpha(now); drawFerryWater(t); ctx.globalAlpha = 1; }
  const n = Math.min(line.length, cap); // anyone past the last place is over the horizon
  mids.length = nears.length = farArrivals.length = 0;
  for (const s of arrivals) s.placed = false;
  for (let i = n - 1; i >= 0; i--) {
    const s = line[i];
    if (s.st >= 3) continue;
    standAt(s);
    if (gz >= farZ) continue;
    (gz >= PIER_END + 0.3 ? mids : nears).push(s);
    s.placed = true; // (an arriving one: drawn there)
  }
  for (const s of arrivals) if (!s.placed) farArrivals.push(s);
  // the middle distance's pools: hundreds of glows, so painted into their own layer only when souls have moved
  // (whenever the far souls are), and that added on; adding light is adding light, so it's the same picture
  if (farDirty) { const main = ctx; ctx = poolCtx; ctx.clearRect(0, 0, W, H); drawPools(mids); ctx = main; }
  ctx.globalCompositeOperation = "lighter"; ctx.drawImage(poolCv, 0, 0, W, H); ctx.globalCompositeOperation = "source-over";
  drawPools(mids, true); // arriving souls' pools: onto the scene, not the layer, as they change every frame
  if (farDirty) { drawFar(n); farDirty = !!block; } // called souls pulse, so keep redrawing during a block
  ctx.drawImage(farCv, 0, 0, W, H); // far souls: painted, like the nearer ones
  if (farArrivals.length) drawArrivals(farArrivals, t);
  const soul = (s) => {
    standAt(s); project(gx, gz, ground(gz) + 0.2 + 0.05 * Math.sin(t * 1.7 + s.id * 1.3));
    drawSoul(sx, sy, sS, s, t, s.st === 2);
  };
  prepareImages(t);
  inOrder(mids, midSoul, t);
  if (frameNo % 60 === 0) sweepImages();
  if (liftOffs.size) sweepLiftOffs();
  if (leavers.length) drawLeavers(t, false);
  ctx.drawImage(pier, 0, 0, W, H);
  drawPools(nears); drawPools(nears, true);
  inOrder(nears, soul, t);
  if (leavers.length) drawLeavers(t, true);
  if (block) drawGhostFerry(t);
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
const frameMs = []; let frameCount = 0; // (studio diagnostics) the work each recent frame took; frames so far
function frame(ts) {
  const t0 = performance.now();
  step(clamp(lastTs ? (ts - lastTs) / 1000 : 0, 0, 0.05));
  lastTs = Math.max(lastTs, ts);
  draw();
  frameMs.push(performance.now() - t0); frameCount++;
  if (frameMs.length > 120) frameMs.splice(0, frameMs.length - 120);
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
  poolCv = document.createElement("canvas"); poolCv.width = cv.width; poolCv.height = cv.height;
  poolCtx = poolCv.getContext("2d"); poolCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  trailCv = document.createElement("canvas"); trailCv.width = cv.width; trailCv.height = cv.height;
  trailCtx = trailCv.getContext("2d"); trailCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  farCtx = farCv.getContext("2d"); farCtx.setTransform(DPR, 0, 0, DPR, 0, 0); farCtx.globalCompositeOperation = "lighter";
  farDirty = true; atlasReset();
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
    const total = outs.reduce((a, v) => a + v, 0), shown = [...outs].sort((a, b) => b - a).slice(0, 6).map(bch).join(", "); // largest first
    rows.push(["Outputs", `${outs.length} · ${bch(total)} in all`]);
    rows.push(["", shown + (outs.length > 6 ? `, and ${outs.length - 6} more` : "")]);
  } else rows.push(["Outputs", "unknown: it was already waiting when the relay started"]);
  const ins = tx.inputs || null;
  if (ins) {
    const total = ins.reduce((a, v) => a + v, 0), shown = [...ins].sort((a, b) => b - a).slice(0, 6).map(bch).join(", "); // largest first
    rows.push(["Inputs", `${ins.length} · ${bch(total)} in all`]);
    rows.push(["", shown + (ins.length > 6 ? `, and ${ins.length - 6} more` : "")]);
  } else rows.push(["Inputs", outs ? "unknown" : "unknown: it was already waiting when the relay started"]);
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
    const a = el("a", "View on bchexplorer.info ↗");
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

// Studio diagnostics: how hard the page is working (the readout, and window.__diag() for tests), and a burst of
// 500 made-up transactions at once (through the live path when live: sound, drop and all).
if (studio) {
  let frames = 0, lastCount = 0, clock0 = null;
  const diag = () => {
    const ms = frameMs.slice(-Math.max(1, frames)), ctxA = sonifier.ctx;
    let osc = 0;
    for (const v of sonifier.voices.values()) if (v.groups) for (const g of v.groups) if (g.osc) osc++;
    const drift = ctxA && ctxA.state === "running" ? ctxA.currentTime - performance.now() / 1000 : null;
    if (drift != null && clock0 == null) clock0 = drift;
    return {
      fps: frames, frameAvg: ms.reduce((a, b) => a + b, 0) / ms.length, frameMax: Math.max(...ms),
      line: line.length, falling: arrivals.length, flying: flyers.length,
      notes: sonifier.voices.size, oscillators: osc, waves: sonifier.waves ? sonifier.waves.waves.length : 0,
      audio: ctxA ? ctxA.state : "none", driftMs: drift == null || clock0 == null ? null : (drift - clock0) * 1000,
      hidden: document.hidden, radio: !!(radio && radio.on && !radio.audio.paused),
      preDrawn: preDrawn.size, atlasPages: atlas.pages.length, atlasMB: (atlas.pages.length * ATLAS * ATLAS * 4) / 1e6,
    };
  };
  window.__diag = diag;
  setInterval(() => {
    frames = frameCount - lastCount; lastCount = frameCount;
    if (document.hidden) return;
    const d = diag();
    ctl("diag").textContent = `${d.fps} fps · frame ${d.frameAvg.toFixed(1)} ms avg, ${d.frameMax.toFixed(0)} max · ${d.falling} falling · ` +
      `${d.preDrawn} souls pre-drawn (${d.atlasPages} atlas pages, ${d.atlasMB.toFixed(0)} MB) · ` +
      `${d.notes} notes, ${d.oscillators} oscillators · ${d.waves} waves queued · audio ${d.audio}` + (d.driftMs != null ? `, clock drift ${d.driftMs.toFixed(0)} ms` : "");
  }, 1000);
  ctl("burst").onclick = () => {
    for (let i = 0; i < 500; i++) {
      const tx = madeUpTx(randomFee());
      tx.txid = `synthetic-burst-${nextId}-${i}`;
      if (synthetic) { addSoul(tx.fee / tx.size, 0, tx); sonifier.event(tx); }
      else { sonifier.event(tx); liveFeed.event(tx); }
    }
  };
}
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
  // BCH Radio, if there are songs: it plays into the same volume control as the sonification
  const radioP = radioSongs().then((songs) => (songs.length ? (radio = new Radio(songs, sonifier.context(), sonifier.volume, () => sonifier.serverNow())) : null));
  const ensure = soundControls(sonifier, document.getElementById("mute"), document.getElementById("hint"), start, radioP, document.getElementById("radio"));
  if (studio) {
    start.then((p) => workbench(sonifier, p, ensure, (ev) => testFerry(fullness(ev.size, ev.limit))));
    radioP.then((r) => r && import("./radiotiming.js").then((m) => m.radioTiming(r, ensure, document.getElementById("radioTiming"))));
  }
}

// the lowest the sky (above the mountains) comes down between viewport x0 and x1: the donation window stays below it
const skyBottom = (x0, x1) => {
  const r = cv.getBoundingClientRect();
  if (!landTop) return r.top + yh;
  const at = (x) => clamp(Math.round((x - r.left + 4) / 2), 0, landTop.length - 1);
  let y = 0;
  for (let i = at(x0), e = at(x1); i <= e; i++) y = Math.max(y, landTop[i]);
  return r.top + y;
};
setupDonate(document.getElementById("donate"), document.getElementById("give"), skyBottom);
// The About window's pictures, drawn with the scene's own drawing (so they look just like it): each
// <canvas data-fig="…"> in it, drawn when it opens (and again if the window is resized while it's open).
const aboutSoul = (tx, rate, id) => ({ id, fee: rate, tx, tr: txTraits(tx, rate) });
const aboutTx = (outs, more = {}) => ({ outputs: Array.from({ length: outs }, () => 100000), size: TYPICAL_BYTES, ...more });
function aboutBackdrop(w, h, horizon) { // the night: sky, and the beach from the horizon down
  const sky = ctx.createLinearGradient(0, 0, 0, h * horizon);
  sky.addColorStop(0, "#0a1230"); sky.addColorStop(1, "#1c2650");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * horizon);
  const gr = ctx.createLinearGradient(0, h * horizon, 0, h);
  gr.addColorStop(0, "#3a3430"); gr.addColorStop(1, "#272320");
  ctx.fillStyle = gr; ctx.fillRect(0, h * horizon, w, h - h * horizon);
}
// souls standing in a row: [tx, rate] each, at size S, their feet (tail tips) at y
function aboutRow(w, h, S, y, souls, t = 0) {
  aboutBackdrop(w, h, 0.42);
  souls.forEach(([tx, rate], i) => drawSoul(((i + 0.5) * w) / souls.length + 0.1 * S, y, S, aboutSoul(tx, rate, 7 + i * 13), t, false));
}
// the first picture's fee rate at t seconds: 1 sat/byte to 512 and back, every doubling taking as long, over 8 s
const aboutFee = (t) => Math.pow(2, 9 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 8)));
// the arrival of a soul with these inputs, frozen at u (0..1 of its fall), seen from in front and a little above
function aboutArrival(w, h, ins, id, u) {
  aboutBackdrop(w, h, 0.62);
  const S0 = Math.min(56, w * 0.42), ppm = S0 / 0.9, col = "190,240,255", k = 1;
  const chest = { x: w / 2, y: h - 26 - LAND_MID * S0 }, top = -24;
  const axis = (uu, lean) => { const left = Math.pow(1 - clamp(uu, 0, 1), lean); return { x: chest.x + 10 * left, y: chest.y + (top - chest.y) * left }; };
  ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "butt";
  { // (one input: just its centre's light and trail, as in the scene)
    const stars = vortexStars(ins, id), v = Math.min(1, u / VORTEX_MEET);
    vortexReady(stars, v);
    // (scaled to fit: the farthest any light is out from the centre over the time its trail shows, in the picture's
    // half-width, with room for its glow)
    let reach = 0.3;
    for (const st of stars) if (!st.big) for (let j = 0; j <= 8; j++) {
      const vv = Math.min(1, Math.max(0, u - VORTEX_TRAIL * (1 - j / 8)) / VORTEX_MEET);
      if (!starGone(st, vv)) reach = Math.max(reach, Math.hypot(...starOffset(st, vv)));
    }
    const fit = Math.min(ppm, (w / 2 - 12) / reach);
    const n1 = Math.max(1, stars.filter((st) => !st.big && !starGone(st, v)).length);
    const crowd = Math.min(1, 3 / Math.sqrt(n1 * (1 + n1 * v * v))), N = 16;
    const at = (st, uu) => { // like starPos, on the picture: depth shows as height and brightness
      const [dx, dz] = starOffset(st, Math.min(1, uu / VORTEX_MEET)), c = axis(uu - u + 0.5, 1.5); // (now drawn where it would be half way down, whenever it's frozen)
      return { x: c.x + dx * fit, y: c.y - dz * fit * 0.35, a: clamp(0.72 + (0.28 * dz) / 0.6, 0.45, 1) };
    };
    for (const st of stars) {
      if (!st.big && starGone(st, v)) continue;
      const hr = Math.max(0.8 / 0.55, (headCoreR(S0, k) * starHead(st, v)) / 5 / 0.55), keep = st.big ? 1 : crowd;
      const sc = starColour(st, v);
      let prev = null, p = null;
      for (let j = 0; j <= N; j++) {
        const uk = Math.max(0, u - VORTEX_TRAIL * (1 - j / N));
        p = at(st, uk);
        if (prev) {
          const q = j / N; ctx.strokeStyle = `rgba(${sc},${0.6 * q * p.a * keep})`; ctx.lineWidth = Math.max(0.6, hr * 0.7 * q);
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        }
        prev = p;
      }
      if (st.big) { arrivalHead(p.x, p.y, S0, k, 0, col); continue; }
      const R = hr * 2.6, g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R), ga = p.a * keep;
      g.addColorStop(0, `rgba(${sc},${0.9 * ga})`); g.addColorStop(0.3, `rgba(${sc},${0.35 * ga})`); g.addColorStop(1, `rgba(${sc},0)`);
      ctx.fillStyle = g; ctx.fillRect(p.x - R, p.y - R, 2 * R, 2 * R);
      ctx.fillStyle = `rgba(${whiter(sc)},${p.a})`; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.8, hr * 0.55), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalCompositeOperation = "source-over";
}
// some inputs for a picture: amounts spread over a few orders of magnitude, the same every time
const aboutInputs = (n, id) => Array.from({ length: n }, (_, i) => Math.round(Math.exp(Math.log(2000) + 9 * hash(id * 31 + i, 12))));
// the pictures' arrivals, by inputs: [the id that sets where its lights start, when to freeze it (u)], chosen (by
// trying 400) to have its first merge late, and frozen before it: 3 inputs merge at v 1.0 (of the closing), 10 at
// 0.43, 50 at 0.0625 (that many start close enough that some merge almost at once: the best of a few hundred thousand)
const ABOUT_ARRIVALS = { 3: [9, 0.2], 10: [176, 0.22], 50: [382848, 0.0348] };
const ABOUT_FIGS = {
  spirit: (w, h, cv, t = 0) => aboutRow(w, h, 92, h - 32, [[aboutTx(1), aboutFee(t)]], t),
  fees: (w, h) => { // the lanterns' colours, 1 to 512 sat/byte (every doubling the same width)
    for (let x = 0; x < w; x++) { ctx.fillStyle = `rgb(${lampColor(Math.pow(2, (9 * (x + 0.5)) / w))})`; ctx.fillRect(x, 0, 1.5, h); }
  },
  bags: (w, h) => aboutRow(w, h, 66, h - 26, [[aboutTx(2), 1]]),
  dolly: (w, h) => aboutRow(w, h, 66, h - 26, [[aboutTx(3), 1]]),
  stack: (w, h) => aboutRow(w, h, 66, h - 26, [[aboutTx(41), 1]]), // a great many: the stack goes up out of the picture
  inputs: (w, h, cv) => { // each frozen before any of its lights have merged, so it shows as many as its label says
    const n = +cv.dataset.n, [id, u] = ABOUT_ARRIVALS[n] || [n, 0.2];
    aboutArrival(w, h, aboutInputs(n, n), id, u);
  },
  tokens: (w, h) => aboutRow(w, h, 88, h - 30, [[aboutTx(1, { nft: true }), 1], [aboutTx(1, { ft: true }), 1]]),
};
function drawAboutFigure(cv, t = 0) {
  const w = cv.clientWidth, h = cv.clientHeight, main = ctx;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * DPR) || cv.height !== Math.round(h * DPR)) { cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR); }
  ctx = cv.getContext("2d"); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  try { ABOUT_FIGS[cv.dataset.fig](w, h, cv, t); } finally { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx = main; }
}
let aboutLoop = 0;
function drawAboutFigures(dialog) {
  for (const cv of dialog.querySelectorAll("canvas[data-fig]")) drawAboutFigure(cv);
  const live = dialog.querySelector('canvas[data-fig="spirit"]'), t0 = performance.now();
  if (!live || aboutLoop) return;
  const step = (ms) => { // the first picture lives (its lantern's colour, and its sway) while the window is open
    if (!dialog.open) { aboutLoop = 0; return; }
    drawAboutFigure(live, (ms - t0) / 1000);
    aboutLoop = requestAnimationFrame(step);
  };
  aboutLoop = requestAnimationFrame(step);
}
{
  // (drawn here, after setupAbout's own click handler has opened it, so a browser still holding an older about.js
  // draws them too)
  const dialog = document.getElementById("aboutDialog"), button = document.getElementById("about");
  setupAbout(button, dialog);
  button.addEventListener("click", () => drawAboutFigures(dialog));
  if (dialog.open) drawAboutFigures(dialog); // (opened by a link to #about)
  addEventListener("resize", () => { if (dialog.open) drawAboutFigures(dialog); });
}
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
