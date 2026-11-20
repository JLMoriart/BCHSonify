// Sonification rules: which harmonic an output plays, how long it holds, how
// loud each pitch is. Same rules and defaults as engine.py (the Python
// reference); tools/check_mapping.py compares the two.

export const SATS_PER_BCH = 1e8;

export const CONFIG = {
  f0: 30,              // Hz, the fundamental (harmonic 1; was 40 until 2026-11-15)
  topBch: 2100,        // outputs >= this play harmonic `firstHarmonic`
  step: [1, 2],        // each harmonic below covers amounts this fraction smaller (num, den)
  firstHarmonic: 2,    // harmonic for outputs >= topBch
  blockHarmonic: 1,    // the block note
  maxHold: 1200,       // s, hold for outputs >= topBch: maxHold * (amount/top)^skew
  skew: 0.2,           // fifth root
  blockTarget: 600,    // s, BCH's block interval target; a block holds blockTarget * (size / size limit)^blockSkew
  blockSkew: 1 / 3,    // cube root: small blocks (the usual case) hold much longer than in proportion
  blockHoldUnknown: 300, // s, the hold for a block that arrives without its size or limit
  levelDb: -6,         // every note starts this far below full level
  floorDb: -48,        // ...and fades (linearly in dB) to this over its hold, then ends
  phon: 80,            // equal-loudness contour for evening out pitches (ISO 226)
  fullScaleDb: -18.7,  // output level of one note at 0 dB (matches the Surge sine patch)
  attack: 0.0039,      // s, note attack (Surge Init Sine: 2^-8 s)
  release: 0.031,      // s, note release after the fade (Surge Init Sine: 2^-5 s)
};

/** Hold of a block event: blockTarget * (size / limit)^blockSkew (the limit the block was mined under). */
export function blockHold(ev, cfg = CONFIG) {
  if (!(ev.size >= 0 && ev.limit > 0)) return cfg.blockHoldUnknown;
  return cfg.blockTarget * Math.pow(Math.min(1, ev.size / ev.limit), cfg.blockSkew);
}

export const dbToAmp = (db) => Math.pow(10, db / 20);

/** Rank of an amount: 1 for sats >= top, then each step down +1; 0 for zero-value outputs.
 *  Exact at range edges (BigInt), like engine.harmonic_for(). */
export function amountRank(sats, cfg = CONFIG) {
  if (!(sats > 0)) return 0;
  const top = BigInt(Math.round(cfg.topBch * SATS_PER_BCH));
  const s = BigInt(Math.round(sats));
  if (s >= top) return 1;
  const [num, den] = cfg.step;
  const keepN = BigInt(den - num), keepD = BigInt(den);
  // lower edge of rank r = top * (keepN/keepD)^(r-1)
  const atLeast = (r) => s * keepD ** BigInt(r - 1) >= top * keepN ** BigInt(r - 1);
  let r = Math.max(2, 1 + Math.ceil(Math.log(Number(top) / Number(s)) / -Math.log((den - num) / den)));
  while (r > 2 && atLeast(r - 1)) r--;
  while (!atLeast(r)) r++;
  return r;
}

/** Harmonic an output plays (0 = silent: zero-value output). */
export function harmonicFor(sats, cfg = CONFIG) {
  const rank = amountRank(sats, cfg);
  return rank ? rank + cfg.firstHarmonic - 1 : 0;
}

/** Seconds an output holds its note: maxHold * min(1, amount/top)^skew. */
export function holdTime(sats, cfg = CONFIG) {
  const ratio = Math.min(1, sats / (cfg.topBch * SATS_PER_BCH));
  return Math.max(1e-6, cfg.maxHold * Math.pow(ratio, cfg.skew));
}

// ---- chime partials ----
// Free-free bar/tube mode ratios to the lowest mode (Euler-Bernoulli beam):
// (beta_n / beta_1)^2, beta = roots of cos(b) cosh(b) = 1.
const BEAM_ROOTS = [4.730040745, 7.853204624, 10.995607838, 14.137165491, 17.278759657, 20.420352245];
export const PARTIAL_RATIOS = BEAM_ROOTS.slice(1).map((b) => (b / BEAM_ROOTS[0]) ** 2); // 2.7565, 5.4039, 8.9330, 13.3443, 18.6379

/** Harmonics (of f0) a note on harmonic h uses for its partials: nearest to h * ratio. */
export function partialHarmonics(h) {
  return PARTIAL_RATIOS.map((r) => Math.round(h * r));
}

// ---- equal loudness (ISO 226:2003) ----
const ISO_F = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];
const ISO_AF = [0.532, 0.506, 0.480, 0.455, 0.432, 0.409, 0.387, 0.367, 0.349, 0.330, 0.315, 0.301,
  0.288, 0.276, 0.267, 0.259, 0.253, 0.250, 0.246, 0.244, 0.243, 0.243, 0.243, 0.242,
  0.242, 0.245, 0.254, 0.271, 0.301];
const ISO_LU = [-31.6, -27.2, -23.0, -19.1, -15.9, -13.0, -10.3, -8.1, -6.2, -4.5, -3.1, -2.0, -1.1,
  -0.4, 0.0, 0.3, 0.5, 0.0, -2.7, -4.1, -1.0, 1.7, 2.5, 1.2, -2.1, -7.1, -11.2, -10.7, -3.1];
const ISO_TF = [78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6, 6.2,
  4.4, 3.0, 2.2, 2.4, 3.5, 1.7, -1.3, -4.2, -6.0, -5.4, -1.5, 6.0, 12.6, 13.9, 12.3];

/** dB SPL a pure tone at `freq` needs to sound as loud as 1 kHz at `phon`.
 *  Log-frequency interpolation between the standard's points; clamped outside 20 Hz-12.5 kHz. */
export function equalLoudnessSpl(freq, phon) {
  const at = (i) => {
    const af = ISO_AF[i], lu = ISO_LU[i], tf = ISO_TF[i];
    const a = 4.47e-3 * (Math.pow(10, 0.025 * phon) - 1.15) + Math.pow(0.4 * Math.pow(10, (tf + lu) / 10 - 9), af);
    return 10 / af * Math.log10(a) - lu + 94;
  };
  if (freq <= ISO_F[0]) return at(0);
  if (freq >= ISO_F[ISO_F.length - 1]) return at(ISO_F.length - 1);
  for (let i = 0; i < ISO_F.length - 1; i++) {
    if (ISO_F[i] <= freq && freq <= ISO_F[i + 1]) {
      const t = Math.log(freq / ISO_F[i]) / Math.log(ISO_F[i + 1] / ISO_F[i]);
      return at(i) * (1 - t) + at(i + 1) * t;
    }
  }
}

/** Gain (dB, <= 0) that makes harmonic h sound as loud as harmonic 1. */
export function loudnessGainDb(h, cfg = CONFIG) {
  return Math.min(0, equalLoudnessSpl(h * cfg.f0, cfg.phon) - equalLoudnessSpl(cfg.f0, cfg.phon));
}
