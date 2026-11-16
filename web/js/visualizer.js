// The Ferry Line: the mempool as a line of souls waiting for the ferry (visualizer.html).
// A sketch running on made-up traffic for now; nothing here reads the relay yet.
// Layout: a perspective view inland from the end of a pier. Souls nearer the front of the
// line are closer and drawn in detail; far ones shrink to single points of light.

const cv = document.getElementById("scene");
const ctx = cv.getContext("2d");
const countEl = document.getElementById("count");
const labelsBtn = document.getElementById("labels");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// world: metres; camera at the end of the pier, eye height CAM, looking inland along +z
const CAM = 3.6, DECK = 0.55, SHORE = 10.5, PIER_START = 5.8, PIER_END = 12.5, SPACING = 1.15;
const FAR_S = 4.5;                 // souls drawn smaller than this many px are single points
const FALL = 1.1, CATCHUP = 4;     // seconds for a new soul to drop in; how fast the line closes up (1/s)
const FERRY_X = 2.4, FERRY_STERN = 4.6, FERRY_LEN = 5.4, FERRY_IN = 1.0, FERRY_OUT = 1.3;
const LANTERN = [1.9, FERRY_STERN + FERRY_LEN, 2.5];
const CALL_AT = 1.0, CALL_SPREAD = 1.1; // first soul leaves this long after the block; the rest follow over this long
const START_SOULS = 2500, ARRIVALS_PER_S = 4, FIRST_BLOCK = 8, BLOCK_EVERY = 45; // made-up traffic
let W = 0, H = 0, DPR = 1, yh = 0, f = 0, bg = null, pier = null, path = null, lanes = [];
let slots = null, cap = 0, farSlot = 0, pierSlot = 0, farCv = null, farCtx = null, farDirty = true;
let showLabels = false, lastText = "", frameNo = 0, frozen = false;
let gx = 0, gz = 0, sx = 0, sy = 0, sS = 0, wx = 0, wz = 0, we = 0; // scratch outputs, to avoid allocating per soul

const P = (x, z, e = 0) => [W / 2 + (f * x) / z, yh + (f * (CAM - e)) / z];
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
  pts.push([0, PIER_END + 1.2], [0, 16]);
  lanes = [];
  const half = (z) => (z * (W * 0.45)) / f; // every lane spans ~90% of the screen width
  let z = 16, dir = 1;
  while (z < 1500) {
    const a = half(z);
    pts.push([dir * a, z]);
    lanes.push({ z, a });
    const z2 = z * 1.28, a2 = half(z2);
    for (let i = 1; i <= 10; i++) {
      const u = i / 10;
      pts.push([dir * (a + (a2 - a) * u + (z2 - z) * 0.35 * Math.sin(Math.PI * u)), z + (z2 - z) * u]);
    }
    z = z2; dir = -dir;
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  path = { pts, cum, length: cum[cum.length - 1] };
  // one standing place every SPACING metres, front of the line first
  cap = Math.floor(path.length / SPACING) - 1;
  slots = new Float32Array(cap * 2);
  farSlot = cap; pierSlot = 0;
  for (let k = 0, j = 1; k < cap; k++) {
    const s = (k + 0.5) * SPACING;
    while (cum[j] < s) j++;
    const u = (s - cum[j - 1]) / (cum[j] - cum[j - 1]);
    const zz = pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * u;
    slots[k * 2] = pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * u; slots[k * 2 + 1] = zz;
    if (zz < PIER_END + 0.3) pierSlot = k + 1;
    if (farSlot === cap && (0.9 * f) / zz < FAR_S) farSlot = k;
  }
}

// ---- static layers ----
function renderBg() {
  const c = document.createElement("canvas");
  c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
  const g = c.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const rng = mulberry(11);

  const sky = g.createLinearGradient(0, 0, 0, yh);
  sky.addColorStop(0, "#0f0c22"); sky.addColorStop(0.5, "#272050"); sky.addColorStop(0.84, "#6a4970"); sky.addColorStop(1, "#e6ac83");
  g.fillStyle = sky; g.fillRect(0, 0, W, yh + 2);
  for (let i = 0; i < 260; i++) {
    const x = rng() * W, y = rng() * yh * 0.8, a = rng() * 0.85 * (1 - y / (yh * 0.8));
    const s = rng() < 0.06 ? 1.4 : 0.8;
    g.fillStyle = `rgba(240,235,255,${a})`; g.fillRect(x, y, s, s);
  }
  const mx = W * 0.79, my = yh * 0.34, mr = Math.max(9, H * 0.03);
  const mg = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 6);
  mg.addColorStop(0, "rgba(255,240,220,0.28)"); mg.addColorStop(1, "rgba(255,240,220,0)");
  g.fillStyle = mg; g.fillRect(mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
  g.fillStyle = "#f6ecdd"; g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();

  // desert floor and dune ridges, far to near
  const gr = g.createLinearGradient(0, yh, 0, H);
  gr.addColorStop(0, "#d8ae8e"); gr.addColorStop(0.18, "#b48c6b"); gr.addColorStop(1, "#5a4433");
  g.fillStyle = gr; g.fillRect(0, yh, W, H - yh);
  const near = [126, 96, 71], far = [221, 184, 154], nearCrest = [196, 160, 126], farCrest = [236, 200, 168];
  for (let z = 1600; z > 22; z /= 1.16) {
    const amp = (2 + z * 0.035) * smooth((z - 25) / 120), lam = 40 + z * 0.25;
    const t = clamp(Math.log(z / 22) / Math.log(1600 / 22), 0, 1);
    const ph1 = rng() * 6.28, ph2 = rng() * 6.28;
    g.beginPath(); g.moveTo(0, H);
    let top = H;
    for (let xs = 0; xs <= W + 6; xs += 6) {
      const xw = ((xs - W / 2) * z) / f;
      const e = amp * (0.5 + 0.35 * Math.sin((xw / lam) * 6.283 + ph1) + 0.15 * Math.sin((xw / lam) * 15.1 + ph2));
      const y = yh + (f * (CAM - e)) / z;
      g.lineTo(xs, y); top = Math.min(top, y);
    }
    g.lineTo(W + 6, H); g.closePath();
    const band = g.createLinearGradient(0, top, 0, top + Math.max(5, ((f * amp) / z) * 2.5));
    band.addColorStop(0, rgb(mix(nearCrest, farCrest, t))); band.addColorStop(1, rgb(mix(near, far, t)));
    g.fillStyle = band; g.fill();
  }
  const haze = g.createLinearGradient(0, yh - H * 0.03, 0, yh + H * 0.06);
  haze.addColorStop(0, "rgba(240,190,150,0)"); haze.addColorStop(0.4, "rgba(240,190,150,0.35)"); haze.addColorStop(1, "rgba(240,190,150,0)");
  g.fillStyle = haze; g.fillRect(0, yh - H * 0.03, W, H * 0.09);

  // beach: dry sand, then a dark wet band at the waterline
  const yb = P(0, 21)[1], yw = P(0, SHORE + 1.4)[1], ys = P(0, SHORE)[1];
  const beach = g.createLinearGradient(0, yb, 0, ys);
  beach.addColorStop(0, "rgba(186,152,121,0)"); beach.addColorStop(0.25, "#bb9a7b"); beach.addColorStop(1, "#a88a6d");
  g.fillStyle = beach; g.fillRect(0, yb, W, ys - yb + 2);
  const wet = g.createLinearGradient(0, yw, 0, ys);
  wet.addColorStop(0, "rgba(96,84,82,0)"); wet.addColorStop(1, "rgba(88,80,84,0.95)");
  g.fillStyle = wet; g.fillRect(0, yw, W, ys - yw + 2);

  // queue ropes and posts along the nearer lanes
  g.lineCap = "round";
  for (const L of lanes.filter((l) => l.z < 90)) {
    for (const side of [-0.75, 0.75]) {
      const z = L.z + side, w = Math.max(0.5, (f * 0.03) / z);
      const [x0, y0] = P(-L.a, z, 0.8), [x1] = P(L.a, z, 0.8);
      g.strokeStyle = "rgba(58,40,32,0.75)"; g.lineWidth = w;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.stroke();
      for (let x = -L.a; x <= L.a + 0.01; x += Math.max(3, L.z * 0.12)) {
        const [px, py] = P(x, z, 0), [, pt] = P(x, z, 0.85);
        g.strokeStyle = "rgba(48,34,28,0.9)"; g.lineWidth = Math.max(0.6, (f * 0.05) / z);
        g.beginPath(); g.moveTo(px, py); g.lineTo(px, pt); g.stroke();
        g.fillStyle = "#d9b26a"; g.fillRect(px - w, pt - w, w * 2, w * 2);
      }
    }
  }

  // water from the shoreline to the bottom of the frame
  g.beginPath();
  for (let xs = 0; xs <= W + 8; xs += 8) {
    const xw = ((xs - W / 2) * SHORE) / f;
    const zz = SHORE + 0.25 * Math.sin(xw * 0.35) + 0.15 * Math.sin(xw * 1.1);
    const [, y] = P(xw, zz, -0.05);
    xs === 0 ? g.moveTo(xs, y) : g.lineTo(xs, y);
  }
  g.lineTo(W + 8, H); g.lineTo(0, H); g.closePath();
  const water = g.createLinearGradient(0, ys, 0, H);
  water.addColorStop(0, "#2d4a57"); water.addColorStop(1, "#0f2029");
  g.fillStyle = water; g.fill();
  for (let i = 0; i < 40; i++) { // moon glitter on the water
    const y = ys + rng() * (H - ys), w = 6 + rng() * 24 * ((y - ys) / (H - ys) + 0.3);
    g.fillStyle = `rgba(255,236,210,${0.05 + rng() * 0.12})`;
    g.fillRect(mx - w / 2 + (rng() - 0.5) * 40, y, w, 1.2);
  }
  bg = c;
}

function renderPier() {
  const c = document.createElement("canvas");
  c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
  const g = c.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.lineCap = "round";
  // pilings just outside the deck, down into the water
  for (let z = 3; z <= PIER_END; z += 1.5) for (const x of [-1.38, 1.38]) {
    const [px, top] = P(x, z, DECK), [, bot] = P(x, z, -0.9), w = (f * 0.18) / z;
    g.fillStyle = "#2b1f18"; g.fillRect(px - w / 2, top, w, Math.min(H, bot) - top);
    const [, wl] = P(x, z, -0.2);
    g.fillStyle = "rgba(225,240,245,0.35)"; g.beginPath(); g.ellipse(px, wl, w * 1.1, w * 0.25, 0, 0, Math.PI * 2); g.fill();
  }
  // deck and planks
  const a = P(-1.3, 2.2, DECK), b = P(1.3, 2.2, DECK), cc = P(1.3, PIER_END, DECK), d = P(-1.3, PIER_END, DECK);
  const deck = g.createLinearGradient(0, d[1], 0, H);
  deck.addColorStop(0, "#80624a"); deck.addColorStop(1, "#4d3929");
  g.fillStyle = deck; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(cc[0], cc[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill();
  for (let z = 2.3; z < PIER_END; z += 0.3) {
    const [x0, y] = P(-1.3, z, DECK), [x1] = P(1.3, z, DECK);
    g.strokeStyle = "rgba(34,23,16,0.55)"; g.lineWidth = Math.max(0.5, (f * 0.018) / z);
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
  }
  // steps down to the sand
  for (let i = 0; i < 3; i++) {
    const z0 = PIER_END + i * 0.4, e = DECK * (1 - (i + 1) / 4);
    const p0 = P(-1.1, z0, e), p1 = P(1.1, z0, e), p2 = P(1.1, z0 + 0.4, e), p3 = P(-1.1, z0 + 0.4, e);
    g.fillStyle = i % 2 ? "#6f5440" : "#7c5f48";
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.closePath(); g.fill();
  }
  // railings, handrail, and lanterns lighting the way to the boat
  for (const x of [-1.3, 1.3]) {
    g.strokeStyle = "#3a2a1f";
    g.beginPath();
    for (let z = 2.2; z <= PIER_END; z += 0.25) { const [px, py] = P(x, z, DECK + 1.0); z === 2.2 ? g.moveTo(px, py) : g.lineTo(px, py); }
    g.lineWidth = Math.max(1, (f * 0.05) / 6); g.stroke();
    let n = 0;
    for (let z = 2.6; z <= PIER_END; z += 1.8, n++) {
      const [px, py] = P(x, z, DECK), [, pt] = P(x, z, DECK + 1.0);
      g.lineWidth = Math.max(1, (f * 0.08) / z); g.beginPath(); g.moveTo(px, py); g.lineTo(px, pt); g.stroke();
      if (n % 2 === 0) {
        const [lx, ly] = P(x, z, DECK + 1.2), r = (f * 0.55) / z;
        const lg = g.createRadialGradient(lx, ly, 0, lx, ly, r);
        lg.addColorStop(0, "rgba(255,200,120,0.55)"); lg.addColorStop(1, "rgba(255,200,120,0)");
        g.fillStyle = lg; g.fillRect(lx - r, ly - r, r * 2, r * 2);
        const s = (f * 0.08) / z;
        g.fillStyle = "#ffe0a8"; g.fillRect(lx - s / 2, ly - s * 0.7, s, s * 1.3);
      }
    }
  }
  pier = c;
}

// ---- moving parts ----
function drawSurf(t) {
  ctx.lineCap = "round";
  for (let k = 0; k < 6; k++) {
    const ph = (t * 0.07 + k / 6) % 1;
    const z = 3 + ph * (SHORE - 2.6);
    const brk = smooth((z - 6.5) / 3.2), fade = 1 - smooth((z - SHORE + 0.5) / 0.6);
    const alpha = (0.12 + 0.6 * brk) * fade;
    if (alpha < 0.02) continue;
    ctx.strokeStyle = `rgba(232,244,248,${alpha})`;
    ctx.lineWidth = Math.max(1, (f * (0.05 + 0.22 * brk)) / z);
    ctx.beginPath();
    for (let xs = -10; xs <= W + 10; xs += 10) {
      const xw = ((xs - W / 2) * z) / f;
      const zz = z + 0.12 * Math.sin(xw * 0.9 + k * 2.1 + t * 0.4) + 0.06 * Math.sin(xw * 2.3 + k);
      const [, y] = P(xw, zz, -0.2);
      xs === -10 ? ctx.moveTo(xs, y) : ctx.lineTo(xs, y);
    }
    ctx.stroke();
  }
  // lace of foam at the waterline
  ctx.strokeStyle = `rgba(240,248,250,${0.35 + 0.15 * Math.sin(t * 0.9)})`;
  ctx.lineWidth = Math.max(1, (f * 0.06) / SHORE);
  ctx.beginPath();
  for (let xs = 0; xs <= W + 8; xs += 8) {
    const xw = ((xs - W / 2) * SHORE) / f;
    const zz = SHORE - 0.15 + 0.25 * Math.sin(xw * 0.35) + 0.15 * Math.sin(xw * 1.1) + 0.08 * Math.sin(xw * 3 + t);
    const [, y] = P(xw, zz, -0.05);
    xs === 0 ? ctx.moveTo(xs, y) : ctx.lineTo(xs, y);
  }
  ctx.stroke();
}

function soulTraits(id) {
  const amount = hash(id, 1);
  return {
    lantern: amount > 0.35 ? (amount - 0.35) / 0.65 : 0,
    bags: Math.min(3, Math.floor(Math.pow(hash(id, 2), 2.2) * 5)),
    nft: hash(id, 3) < 0.05, ft: hash(id, 4) < 0.09, memo: hash(id, 5) < 0.07, whale: hash(id, 6) < 0.012,
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

function drawSoul(x, y, S, s, t, called) {
  const tr = s.tr, id = s.id;
  if (tr.whale) S *= 1.3;
  const sw = Math.sin(t * 2.1 + id * 0.9) * 0.08;
  ctx.setTransform(DPR * S, 0, 0, DPR * S, DPR * x, DPR * y);
  if (S < 16) { // mid distance: body and the brightest hint of what it carries
    if (called) { ctx.fillStyle = "rgba(255,200,110,0.6)"; ctx.beginPath(); ctx.arc(0, -0.6, 0.66, 0, Math.PI * 2); ctx.fill(); }
    wisp(sw); ctx.fillStyle = "rgba(212,245,255,0.88)"; ctx.fill();
    if (tr.nft || tr.whale) { ctx.fillStyle = "#f0cd84"; ctx.fillRect(-0.12, -1.06, 0.24, 0.1); }
    if (tr.lantern > 0.5) { ctx.fillStyle = "rgba(255,206,130,0.95)"; ctx.fillRect(0.36, -0.8, 0.14, 0.16); }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return;
  }
  const glow = ctx.createRadialGradient(0, -0.6, 0.05, 0, -0.6, 0.9);
  if (called) { glow.addColorStop(0, "rgba(255,205,115,0.85)"); glow.addColorStop(1, "rgba(255,205,115,0)"); }
  else { glow.addColorStop(0, "rgba(160,235,255,0.32)"); glow.addColorStop(1, "rgba(160,235,255,0)"); }
  ctx.fillStyle = glow; ctx.fillRect(-0.95, -1.55, 1.9, 1.9);
  if (tr.lantern > 0) {
    const b = tr.lantern, lg = ctx.createRadialGradient(0.47, -0.72, 0, 0.47, -0.72, 0.18 + 0.32 * b);
    lg.addColorStop(0, `rgba(255,200,120,${0.25 + 0.5 * b})`); lg.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = lg; ctx.fillRect(-0.1, -1.3, 1.2, 1.2);
  }
  if (tr.whale) {
    ctx.strokeStyle = "rgba(255,236,170,0.95)"; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.ellipse(0, -1.1, 0.21, 0.055, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // luggage, one bag per extra output, floating along behind the tail
  const bagCols = ["#8c5a3c", "#5d6b8a", "#7a4a5f"];
  for (let i = 0; i < tr.bags; i++) {
    const bx = 0.16 + i * 0.15, by = -0.16 - (i % 2) * 0.03 + Math.sin(t * 2 + id + i) * 0.01;
    ctx.fillStyle = bagCols[i]; ctx.strokeStyle = "#2b1d14"; ctx.lineWidth = 0.012;
    ctx.fillRect(bx, by, 0.13, 0.11); ctx.strokeRect(bx, by, 0.13, 0.11);
    ctx.beginPath(); ctx.arc(bx + 0.065, by, 0.03, Math.PI, 0); ctx.stroke();
  }
  // body
  wisp(sw);
  const body = ctx.createLinearGradient(0, -1, 0, 0);
  body.addColorStop(0, "rgba(242,252,255,0.98)"); body.addColorStop(0.55, "rgba(204,241,255,0.92)"); body.addColorStop(1, "rgba(160,225,255,0)");
  ctx.fillStyle = body; ctx.fill();
  // arms
  ctx.fillStyle = "rgba(226,248,255,0.95)";
  ctx.beginPath(); ctx.ellipse(-0.31, -0.48, 0.065, 0.042, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0.31, -0.48, 0.065, 0.042, 0.5, 0, Math.PI * 2); ctx.fill();
  // face
  ctx.fillStyle = "#20264a";
  for (const ex of [-0.1, 0.1]) { ctx.beginPath(); ctx.ellipse(ex, -0.69, 0.034, 0.05, 0, 0, Math.PI * 2); ctx.fill(); }
  if (S > 40) {
    ctx.fillStyle = "#ffffff";
    for (const ex of [-0.088, 0.112]) { ctx.beginPath(); ctx.arc(ex, -0.705, 0.011, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "rgba(255,150,180,0.45)";
    for (const ex of [-0.18, 0.18]) { ctx.beginPath(); ctx.arc(ex, -0.61, 0.04, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = "#20264a"; ctx.lineWidth = 0.014;
    ctx.beginPath(); ctx.arc(0, -0.645, 0.045, 0.35, Math.PI - 0.35); ctx.stroke();
  }
  // lantern on a pole in the right hand
  if (tr.lantern > 0) {
    ctx.strokeStyle = "#5a3b22"; ctx.lineWidth = 0.02;
    ctx.beginPath(); ctx.moveTo(0.33, -0.47); ctx.lineTo(0.47, -0.86); ctx.stroke();
    ctx.fillStyle = "#ffe0a8"; ctx.fillRect(0.42, -0.8, 0.1, 0.13);
    ctx.strokeStyle = "#5a3b22"; ctx.lineWidth = 0.012; ctx.strokeRect(0.42, -0.8, 0.1, 0.13);
  }
  // coin in the left hand, scroll under the left arm
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
  // crown on top of the head
  if (tr.nft) {
    ctx.fillStyle = "#e9c27a"; ctx.strokeStyle = "#8a6420"; ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.moveTo(-0.14, -0.94); ctx.lineTo(-0.14, -1.07); ctx.lineTo(-0.07, -1.0); ctx.lineTo(0, -1.1);
    ctx.lineTo(0.07, -1.0); ctx.lineTo(0.14, -1.07); ctx.lineTo(0.14, -0.94); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#c2475a"; ctx.beginPath(); ctx.arc(0, -0.985, 0.022, 0, Math.PI * 2); ctx.fill();
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// ---- the line: who stands where ----
// line[] is front first: highest fee per byte first, equal fees in arrival order.
// s.p is where a soul is now (in places from the front); its index in line[] is where it belongs.
// s.st: 0 waiting, 1 dropping in, 2 called by the ferry, 3 flying to it, 4 aboard
const line = [], arrivals = [], flyers = [];
const rnd = mulberry(7);
let nextId = 1, now = 0, block = null, lastTook = 0, arrivalAcc = 0, nextBlockAt = FIRST_BLOCK;

const ground = (z) => (z < PIER_END ? DECK : z < PIER_END + 1.2 ? DECK * (1 - (z - PIER_END) / 1.2) : 0);
function locate(p) { // -> gx, gz
  if (p <= 0) { gx = slots[0]; gz = slots[1]; return; }
  if (p >= cap - 1) { gx = slots[cap * 2 - 2]; gz = slots[cap * 2 - 1]; return; }
  const i = p | 0, u = p - i, a = i * 2;
  gx = slots[a] + (slots[a + 2] - slots[a]) * u; gz = slots[a + 1] + (slots[a + 3] - slots[a + 1]) * u;
}
function project(x, z, e) { sx = W / 2 + (f * x) / z; sy = yh + (f * (CAM - e)) / z; sS = (0.9 * f) / z; } // -> sx, sy, sS

function randomFee() { // sats per byte: most pay the 1 sat/B minimum
  const r = rnd();
  return r < 0.88 ? 1 : r < 0.97 ? 1 + rnd() : 2 + 48 * rnd() * rnd();
}
function addSoul(fee, delay) { // delay < 0: appear in place with no drop
  const s = { id: nextId++, fee, tr: null, p: 0, st: 0, u: 0, t0: 0, dx: 0, launch: 0, dur: 0, ox: 0, oz: 0, oe: 0, k: 0 };
  s.tr = soulTraits(s.id);
  let lo = 0, hi = line.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (line[m].fee >= fee) lo = m + 1; else hi = m; }
  line.splice(lo, 0, s);
  s.p = lo;
  if (delay >= 0 && !reduce && lo < cap) { s.st = 1; s.t0 = now + delay; s.u = -1; s.dx = (hash(s.id, 7) - 0.5) * 0.12; arrivals.push(s); }
  else farDirty = true;
  return s;
}

function compact() { // drop everyone who boarded; the rest then close up
  let w = 0;
  for (let i = 0; i < line.length; i++) if (line[i].st < 3) line[w++] = line[i];
  line.length = w; farDirty = true;
}

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
  const n = chosen.length;
  block = { t0: now, phase: "load", chosen, next: 0, aboard: 0, flash: 0, leaveT: 0, tally: null };
  if (reduce) { // no flights: they are simply aboard, and the ferry shows for a moment
    for (const s of chosen) s.st = 4;
    compact();
    Object.assign(block, { phase: "leave", next: n, aboard: n, leaveT: now + 2.5 });
  } else chosen.forEach((s, r) => { s.st = 2; s.launch = now + CALL_AT + CALL_SPREAD * (r / n); });
  farDirty = true;
  return true;
}

function ferryOffset() { // metres along z: 0 docked, negative out to sea behind the camera
  const b = block;
  if (b.phase === "leave") { const u = clamp((now - b.leaveT) / FERRY_OUT, 0, 1); return -10 * u * u; }
  return -10 * Math.pow(1 - clamp((now - b.t0) / FERRY_IN, 0, 1), 3);
}

function step(dt) {
  now += dt;
  arrivalAcc += dt * ARRIVALS_PER_S;
  while (arrivalAcc >= 1) { arrivalAcc -= 1; addSoul(randomFee(), 0); }
  if (now >= nextBlockAt && mineBlock()) nextBlockAt = now + BLOCK_EVERY;

  // everyone not in their place moves toward it
  const k = 1 - Math.exp(-dt * CATCHUP);
  for (let i = 0; i < line.length; i++) {
    const s = line[i];
    if (s.p !== i) {
      const d = i - s.p;
      s.p = reduce || Math.abs(d) < 0.02 ? i : s.p + d * k;
      farDirty = true;
    }
  }
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
      locate(s.p);
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
    if (b.aboard === b.chosen.length) { compact(); b.phase = "leave"; b.leaveT = now + 0.25; }
  } else if (now >= b.leaveT + FERRY_OUT) { lastTook = b.chosen.length; block = null; }
}

// where a soul is partway through its drop (u 0..1) -> wx, wz, we
function arrivalPos(s, u) {
  locate(s.p);
  const left = Math.pow(1 - u, 2.2), stand = ground(gz) + 0.2, top = CAM + ((yh + 40) * gz) / f; // top: just above the frame
  wx = gx + s.dx * gz * left; wz = gz; we = stand + (top - stand) * left;
}
// where a soul is partway through its flight to the ferry's lantern -> wx, wz, we
function flightPos(s, u) {
  const uu = u * u * (3 - 2 * u), lz = LANTERN[1] + ferryOffset();
  wz = s.oz * Math.pow(lz / s.oz, uu); // even steps in apparent size, so far souls don't hang at the horizon
  const w = Math.abs(lz - s.oz) > 0.05 ? (wz - s.oz) / (lz - s.oz) : uu;
  wx = s.ox + (LANTERN[0] - s.ox) * w;
  we = s.oe + (LANTERN[2] - s.oe) * w + s.k * wz * Math.sin(Math.PI * uu);
}
const arrivalWisp = (s) => (s.u > 0.6 ? sS * ((s.u - 0.6) / 0.4) : 0);              // grows from a spark as it lands
const flightWisp = (s) => (s.u < 0.35 ? ((0.9 * f) / s.oz) * (1 - s.u / 0.35) : 0); // shrinks to a spark as it leaves

// souls in the air: a streak of light each, plus the wisp itself while close to the ground
const thin = [], thick = [], wisps = [];
function streaks(list, pos, lag, col, wispSize, t) {
  thin.length = thick.length = wisps.length = 0;
  ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(${col},0.5)`; ctx.lineWidth = 1; ctx.beginPath();
  for (const s of list) {
    if (s.u < 0) continue;
    pos(s, Math.max(0, s.u - lag)); project(wx, wz, we);
    const tx = sx, ty = sy;
    pos(s, s.u); project(wx, wz, we);
    if (sS >= 6) thick.push(tx, ty, sx, sy); else { ctx.moveTo(tx, ty); ctx.lineTo(sx, sy); thin.push(sx, sy, sS); }
    const ws = wispSize(s);
    if (ws >= FAR_S) wisps.push(s, sx, sy, ws);
  }
  ctx.stroke();
  ctx.lineWidth = 1.7; ctx.beginPath();
  for (let i = 0; i < thick.length; i += 4) { ctx.moveTo(thick[i], thick[i + 1]); ctx.lineTo(thick[i + 2], thick[i + 3]); }
  ctx.stroke();
  ctx.fillStyle = `rgb(${col})`;
  for (let i = 0; i < thin.length; i += 3) { const w = clamp(thin[i + 2] * 0.5, 1.2, 2.4); ctx.fillRect(thin[i] - w / 2, thin[i + 1] - w / 2, w, w); }
  ctx.beginPath();
  for (let i = 0; i < thick.length; i += 4) { ctx.moveTo(thick[i + 2] + 2.2, thick[i + 3]); ctx.arc(thick[i + 2], thick[i + 3], 2.2, 0, Math.PI * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < wisps.length; i += 4) drawSoul(wisps[i + 1], wisps[i + 2], wisps[i + 3], wisps[i], t, false);
}

// ---- the ferry: a long boat alongside the pier, its lantern on a hooked post at the bow ----
function drawFerry(t) {
  const b = block, off = ferryOffset(), bob = 0.05 * Math.sin(t * 1.3);
  const Q = (x, z, e) => P(x, Math.max(0.9, z + off), e + bob);
  const N = 16, port = [], star = [], water = [], floorP = [], floorS = [];
  const beam = (u) => 0.95 * (1 - u * u * u) * (0.7 + 0.3 * Math.min(1, u * 5));
  for (let i = 0; i <= N; i++) {
    const u = i / N, z = FERRY_STERN + FERRY_LEN * u, hb = beam(u);
    const g = 0.75 + 0.55 * Math.pow(u, 4) + 0.12 * Math.pow(1 - u, 3);
    port.push(Q(FERRY_X - hb, z, g)); star.push(Q(FERRY_X + hb, z, g));
    water.push(Q(FERRY_X - hb * 0.8, z, -0.1));
    floorP.push(Q(FERRY_X - hb * 0.7, z, 0.2)); floorS.push(Q(FERRY_X + hb * 0.7, z, 0.2));
  }
  const poly = (a, c) => {
    ctx.beginPath();
    a.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    for (let i = c.length - 1; i >= 0; i--) ctx.lineTo(c[i][0], c[i][1]);
    ctx.closePath();
  };
  const zMid = Math.max(0.9, FERRY_STERN + FERRY_LEN * 0.6 + off);
  poly(port, water); ctx.fillStyle = "#2c2019"; ctx.fill();          // outside of the near side
  ctx.save();
  poly(port, star); ctx.fillStyle = "#1c1512"; ctx.fill(); ctx.clip(); // looking down into the hull
  poly(floorP, floorS); ctx.fillStyle = "#3d2d22"; ctx.fill();
  poly(star, floorS); ctx.fillStyle = "#5e4735"; ctx.fill();
  ctx.fillStyle = "#7a5d45";
  for (const u of [0.25, 0.45, 0.62, 0.78]) { // benches
    const z = FERRY_STERN + FERRY_LEN * u, h0 = beam(u) * 0.85, h1 = beam(u + 0.05) * 0.85;
    const q = [Q(FERRY_X - h0, z, 0.45), Q(FERRY_X + h0, z, 0.45), Q(FERRY_X + h1, z + 0.27, 0.45), Q(FERRY_X - h1, z + 0.27, 0.45)];
    ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = "#6e523d"; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = Math.max(1.5, (f * 0.06) / zMid);
  for (const side of [port, star]) { ctx.beginPath(); side.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); }

  // the ferryman: a small hooded figure with a pole, halfway up the boat
  const fz = Math.max(0.9, FERRY_STERN + FERRY_LEN * 0.52 + off), [fx, fy] = P(FERRY_X + 0.15, fz, 0.2 + bob), FS = (f * 1.3) / fz;
  ctx.setTransform(DPR * FS, 0, 0, DPR * FS, DPR * fx, DPR * fy);
  ctx.strokeStyle = "#5a3b22"; ctx.lineWidth = 0.025; ctx.beginPath(); ctx.moveTo(0.3, 0.05); ctx.lineTo(0.37, -1.3); ctx.stroke();
  ctx.fillStyle = "#1b1830"; ctx.beginPath();
  ctx.moveTo(-0.24, 0); ctx.quadraticCurveTo(-0.26, -0.5, -0.17, -0.8); ctx.arc(0, -0.82, 0.17, Math.PI, 0);
  ctx.quadraticCurveTo(0.26, -0.5, 0.26, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#0b0918"; ctx.beginPath(); ctx.ellipse(0, -0.8, 0.105, 0.125, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#c8f2ff";
  for (const ex of [-0.042, 0.042]) { ctx.beginPath(); ctx.arc(ex, -0.81, 0.02, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#1b1830"; ctx.beginPath(); ctx.ellipse(0.31, -0.5, 0.05, 0.04, 0, 0, Math.PI * 2); ctx.fill();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // bow post, hooked toward the pier, and the lantern that gathers the souls
  const bz = FERRY_STERN + FERRY_LEN, lz = Math.max(0.9, bz + off);
  const p0 = Q(FERRY_X, bz, 1.25), p1 = Q(FERRY_X, bz, 2.95), c1 = Q(FERRY_X - 0.1, bz, 3.3), p2 = Q(LANTERN[0], bz, 3.02), p3 = Q(LANTERN[0], bz, LANTERN[2] + 0.12);
  ctx.strokeStyle = "#3a2a1f"; ctx.lineWidth = Math.max(1.5, (f * 0.09) / lz);
  ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.quadraticCurveTo(c1[0], c1[1], p2[0], p2[1]); ctx.stroke();
  ctx.lineWidth = Math.max(1, (f * 0.025) / lz); ctx.beginPath(); ctx.moveTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.stroke();
  const [lx, ly] = Q(LANTERN[0], bz, LANTERN[2]);
  const level = Math.min(1, Math.log10(1 + b.aboard) / 3.6), r = (f / lz) * (0.5 + 1.5 * level + 0.5 * b.flash);
  ctx.globalCompositeOperation = "lighter";
  const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
  lg.addColorStop(0, `rgba(255,214,140,${0.55 + 0.35 * level})`); lg.addColorStop(0.35, `rgba(255,196,120,${0.2 + 0.2 * level})`); lg.addColorStop(1, "rgba(255,190,110,0)");
  ctx.fillStyle = lg; ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
  ctx.globalCompositeOperation = "source-over";
  const lw = (f * 0.26) / lz, lh = (f * 0.36) / lz;
  ctx.fillStyle = "#fff0c8"; ctx.fillRect(lx - lw / 2, ly - lh / 2, lw, lh);
  ctx.strokeStyle = "#3a2a1f"; ctx.lineWidth = Math.max(1, lw * 0.14); ctx.strokeRect(lx - lw / 2, ly - lh / 2, lw, lh);
  b.tally = off > -3 ? [lx + lw / 2 + 10, ly] : null;
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
  g.fillStyle = "rgb(170,235,255)";
  const gold = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = line[i];
    if (s.p < farSlot || s.st === 1 || s.st >= 3) continue;
    locate(s.p); project(gx, gz, 0.2);
    if (s.st === 2) { gold.push(sx, sy - sS * 0.65, sS); continue; }
    g.globalAlpha = sS < 0.6 ? 0.07 : sS < 1.2 ? 0.14 : sS < 2.5 ? 0.3 : 0.5;
    const w = Math.max(0.7, sS * 0.5); g.fillRect(sx - w / 2, sy - sS * 0.65 - w / 2, w, w);
  }
  g.fillStyle = "rgb(255,205,115)"; g.globalAlpha = pulse;
  for (let i = 0; i < gold.length; i += 3) { const w = Math.max(1.6, gold[i + 2] * 0.8); g.fillRect(gold[i] - w / 2, gold[i + 1] - w / 2, w, w); }
  g.globalAlpha = 1;
}

const mids = [], nears = [];
function draw() {
  const t = reduce ? 20 : now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  ctx.drawImage(bg, 0, 0, W, H);
  drawSurf(t);
  const n = Math.min(line.length, cap); // anyone past the last place is over the horizon
  if (farDirty) { drawFar(n); farDirty = !!block; } // called souls pulse, so keep redrawing during a block
  ctx.globalCompositeOperation = "lighter"; ctx.drawImage(farCv, 0, 0, W, H); ctx.globalCompositeOperation = "source-over";
  mids.length = nears.length = 0;
  for (let i = n - 1; i >= 0; i--) {
    const s = line[i];
    if (s.p >= farSlot || s.st === 1 || s.st >= 3) continue;
    (s.p >= pierSlot ? mids : nears).push(s);
  }
  const soul = (s) => {
    locate(s.p); project(gx, gz, ground(gz) + 0.2 + 0.05 * Math.sin(t * 1.7 + s.id * 1.3));
    drawSoul(sx, sy, sS, s, t, s.st === 2);
  };
  mids.forEach(soul);
  ctx.drawImage(pier, 0, 0, W, H);
  nears.forEach(soul);
  if (block) drawFerry(t);
  if (arrivals.length) streaks(arrivals, arrivalPos, 0.08, "190,240,255", arrivalWisp, t);
  if (flyers.length) streaks(flyers, flightPos, 0.05, "255,214,140", flightWisp, t);
  if (block && block.tally) drawTally();
  const v = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.4, W / 2, H * 0.55, Math.max(W, H) * 0.8);
  v.addColorStop(0, "rgba(10,8,24,0)"); v.addColorStop(1, "rgba(10,8,24,0.45)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  if (showLabels) drawLabels();
  if (frameNo++ % 6 === 0) {
    const num = (v) => v.toLocaleString("en-US");
    const inLine = line.length - (block ? block.next : 0), over = Math.max(0, line.length - cap);
    let text = `${num(inLine)} souls in line`;
    if (over) text += ` (${num(over)} past the horizon)`;
    if (block) text += ` · ferry loading: ${num(block.aboard)} of ${num(block.chosen.length)}`;
    else if (lastTook) text += ` · the last ferry took ${num(lastTook)}`;
    if (text !== lastText) countEl.textContent = lastText = text;
  }
}

let lastTs = 0;
function frame(ts) {
  step(Math.min(0.05, lastTs ? (ts - lastTs) / 1000 : 0));
  lastTs = ts;
  draw();
  requestAnimationFrame(frame);
}

function resize() {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  W = r.width; H = r.height; DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  yh = H * (W < H ? 0.26 : 0.3); f = H * 1.2;
  farCv = document.createElement("canvas"); farCv.width = cv.width; farCv.height = cv.height;
  farCtx = farCv.getContext("2d"); farCtx.setTransform(DPR, 0, 0, DPR, 0, 0); farCtx.globalCompositeOperation = "lighter";
  farDirty = true;
  buildPath(); renderBg(); renderPier();
  if (frozen) draw();
}

labelsBtn.onclick = () => {
  showLabels = !showLabels;
  labelsBtn.textContent = showLabels ? "Hide labels" : "Show labels";
  labelsBtn.setAttribute("aria-pressed", String(showLabels));
};
document.getElementById("mine").onclick = () => { if (mineBlock()) nextBlockAt = now + BLOCK_EVERY; };
document.getElementById("add").onclick = () => { for (let i = 0; i < 1000; i++) addSoul(randomFee(), rnd() * 1.5); };
document.getElementById("cut").onclick = () => addSoul(5 + 45 * rnd(), 0);

for (let i = 0; i < START_SOULS; i++) addSoul(randomFee(), -1);
new ResizeObserver(resize).observe(cv);
resize();
// #shot=12.5 freezes the sketch that many seconds in (for checking a moment); &add=3 drops 1,000 souls at 3 s
const shot = /shot=([\d.]+)/.exec(location.hash), shotAdd = /add=([\d.]+)/.exec(location.hash);
if (shot) {
  frozen = true;
  for (let t = 0; t < +shot[1]; t += 1 / 30) {
    if (shotAdd && Math.abs(t - +shotAdd[1]) < 1 / 60) document.getElementById("add").onclick();
    step(1 / 30);
  }
  draw();
} else requestAnimationFrame(frame);
