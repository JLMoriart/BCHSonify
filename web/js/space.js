// The shared acoustic space: one reverb and one echo, fed by sends from the
// block voice and the sine harmonics.
//
//   echo in ─ delay ─ low-pass ─┬─ out ─────────────┐
//              ↑                ├─ feedback ─┘      ├─ master
//              └────────────────┘                   │
//                               └─ into reverb ─┐   │
//   reverb in ──────────────────────────────────┴─ convolver ─ master
//
// The reverb is a ConvolverNode with an impulse response synthesized from
// room-like parameters (size, pre-delay, RT60, high-frequency damping,
// diffusion, early reflections, width). Its cost doesn't grow with the number
// of notes; it does grow (gently) with the decay time.

const C = 343; // m/s, speed of sound

/** Impulse response parameters; changing any of them rebuilds the IR. */
export const IR_KEYS = ["reverbSize", "reverbPreDelay", "reverbDecay", "reverbDampFreq", "reverbHfRatio",
  "reverbDiffusion", "reverbEarly", "reverbWidth"];

function mulberry32(seed) { // small seeded PRNG: the same settings always give the same IR
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stereo impulse response.
 *  - Late tail: random reflections whose density grows like a real room's
 *    (4*pi*c^3*t^2/V, V = size^3), multiplied by 10^(4*diffusion): diffusion 0
 *    gives the room's own sparse echoes, 1 a smooth wash from the start.
 *  - Decay: lows fall 60 dB in `reverbDecay` s, highs (above `reverbDampFreq`)
 *    in `reverbDecay * reverbHfRatio` s.
 *  - Early reflections: 12 discrete wall bounces within ~`reverbSize`/c;
 *    `reverbEarly` is their total energy relative to the tail's (0 dB = equal).
 *  - Width: 0 = identical channels (mono), 1 = independent channels.
 * The ConvolverNode normalizes the IR's loudness, so the sends set the level.
 */
export function buildIR(ctx, p) {
  const sr = ctx.sampleRate;
  const pre = Math.round((p.reverbPreDelay / 1000) * sr);
  const len = pre + Math.ceil(p.reverbDecay * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const V = Math.pow(p.reverbSize, 3);
  const densityBoost = Math.pow(10, 4 * p.reverbDiffusion);
  const mLow = Math.exp(-3 * Math.LN10 / (p.reverbDecay * sr));                     // per-sample decay
  const mHigh = Math.exp(-3 * Math.LN10 / (p.reverbDecay * p.reverbHfRatio * sr));
  const a = 1 - Math.exp(-2 * Math.PI * p.reverbDampFreq / sr);             // one-pole low-pass coefficient
  const shared = mulberry32(1), rngs = [mulberry32(2), mulberry32(3)];
  const early = Math.pow(10, p.reverbEarly / 20);
  const w = p.reverbWidth;
  const raw = [new Float32Array(len), new Float32Array(len)];
  for (let i = pre; i < len; i++) {
    const t = (i - pre) / sr + 1 / sr;
    const q = Math.min(1, (4 * Math.PI * C * C * C * t * t / V) * densityBoost / sr); // chance of a reflection this sample
    const amp = 1 / Math.sqrt(q);
    const sHit = shared() < q, sSign = shared() < 0.5 ? -1 : 1;
    for (let ch = 0; ch < 2; ch++) {
      const r = rngs[ch], own = r() < q, oSign = r() < 0.5 ? -1 : 1;
      // width: blend the shared reflection pattern with each channel's own
      raw[ch][i] = amp * ((1 - w) * (sHit ? sSign : 0) + w * (own ? oSign : 0));
    }
  }
  for (let ch = 0; ch < 2; ch++) {
    const x = raw[ch], d = buf.getChannelData(ch);
    let lp = 0, eLow = 1, eHigh = 1, energy = 0;
    for (let i = pre; i < len; i++) {
      lp += a * (x[i] - lp);
      d[i] = lp * eLow + (x[i] - lp) * eHigh;
      eLow *= mLow;
      eHigh *= mHigh;
      energy += d[i] * d[i];
    }
    if (early > 0.0011) { // > -59 dB: add the early reflections, louder from nearer walls
      const r = mulberry32(10 + ch), dists = [];
      for (let k = 0; k < 12; k++) dists.push(p.reverbSize * (0.15 + 0.85 * r()));
      const norm = Math.sqrt(dists.reduce((acc, dd) => acc + 1 / (dd * dd), 0));
      for (const dist of dists) {
        const i = pre + Math.round((dist / C) * sr);
        if (i < len) d[i] += early * Math.sqrt(energy) * (1 / dist / norm) * (r() < 0.5 ? -1 : 1);
      }
    }
  }
  return buf;
}

export class Space {
  constructor(ctx, out, p) {
    this.ctx = ctx;
    this.p = { ...p };
    this.reverbIn = new GainNode(ctx);
    this.convolver = new ConvolverNode(ctx, { buffer: buildIR(ctx, p) });
    this.reverbIn.connect(this.convolver).connect(out);
    this.echoIn = new GainNode(ctx);
    this.echoDelay = new DelayNode(ctx, { maxDelayTime: 2, delayTime: p.echoTime / 1000 });
    this.echoFilter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: p.echoDamping, Q: 0.5 });
    this.echoFeedback = new GainNode(ctx, { gain: p.echoFeedback });
    this.echoOut = new GainNode(ctx);
    this.echoToReverb = new GainNode(ctx, { gain: p.echoToReverb });
    this.echoIn.connect(this.echoDelay).connect(this.echoFilter);
    this.echoFilter.connect(this.echoFeedback).connect(this.echoDelay);
    this.echoFilter.connect(this.echoOut).connect(out);
    this.echoFilter.connect(this.echoToReverb).connect(this.reverbIn);
    this.irTimer = null;
  }

  update(p) {
    const t = this.ctx.currentTime, irChanged = IR_KEYS.some((k) => p[k] !== this.p[k]);
    this.p = { ...p };
    this.echoDelay.delayTime.setTargetAtTime(p.echoTime / 1000, t, 0.02);
    this.echoFilter.frequency.setValueAtTime(p.echoDamping, t);
    this.echoFeedback.gain.setValueAtTime(p.echoFeedback, t);
    this.echoToReverb.gain.setValueAtTime(p.echoToReverb, t);
    if (irChanged) { // rebuilding a long IR takes a moment: wait until the slider settles
      clearTimeout(this.irTimer);
      this.irTimer = setTimeout(() => { this.convolver.buffer = buildIR(this.ctx, this.p); }, 150);
    }
  }

  disconnect() {
    clearTimeout(this.irTimer);
    for (const n of [this.reverbIn, this.convolver, this.echoIn, this.echoDelay, this.echoFilter,
      this.echoFeedback, this.echoOut, this.echoToReverb]) n.disconnect();
  }
}
