// Ocean waves from filtered noise, all native Web Audio nodes.
//
// Each wave is four layers on one stereo position, scheduled once (no JS per
// audio frame), and its nodes exist only while it sounds:
//
//   approach  brown noise, low-pass opening      swell rising toward the break (rumble -> rush)
//   crash     pink noise, low-pass bright->dark   the break (rise of breakAttack), then the wash
//   fizz      white noise, high-pass              foam bubbles, lingering after the crash
//   backwash  pink noise, band-pass sliding down  water retreating
//
// Under them, a constant distant surf bed (low-passed brown noise with a slow
// random swell). Everything goes through a distance low-pass and the waves
// level, with a send to the shared reverb.
//
// Far waves (down the beach) and further waves are the main waves again, as
// extra streams: identical settings, except their own level and interval
// (x main), and each wave through a 24 dB/octave low-pass at a random cutoff
// between the stream's low-pass lower and upper limits. Same distance, level
// and reverb after that.
//
// Timing: waves every waveInterval s (+- waveIrregularity), each a random size
// (up to waveSizeVariation dB smaller, and darker when smaller); every
// ~setSpacing waves, a set of 3 waves setBoost dB bigger.
// Waves are scheduled a few seconds ahead (75 s when the tab is hidden, since
// browsers throttle timers there); a settings change reschedules waves that
// haven't started yet.

import { dbToAmp } from "./mapping.js";

// Distant wave streams: copies of the main waves, each with its own on/off,
// level, interval (x main: bigger = less often) and a 24 dB/octave low-pass
// per wave, its cutoff picked log-uniformly between <prefix>LowpassMin and
// <prefix>Lowpass (distance soaks up the highs). Keys are <prefix>On,
// <prefix>Level, <prefix>IntervalScale, <prefix>Lowpass, <prefix>LowpassMin.
const DISTANT = [
  { prefix: "far", box: "Far waves (down the beach)" },
  { prefix: "further", box: "Further waves" },
];
const distantParams = ({ prefix: x, box }) => [
  { group: box, k: `${x}On`, label: "On", type: "checkbox", def: true },
  { group: box, k: `${x}Level`, label: "Level (−60 = off)", min: -60, max: 6, step: 0.5, def: -12, unit: "dB" },
  { group: box, k: `${x}IntervalScale`, label: "Wave interval (× main)", min: 0.1, max: 10, def: 0.3, log: true },
  { group: box, k: `${x}Lowpass`, label: "Low-pass (upper)", min: 150, max: 8000, def: 800, unit: "Hz", log: true },
  { group: box, k: `${x}LowpassMin`, label: "Low-pass (lower)", min: 150, max: 8000, def: 800, unit: "Hz", log: true },
];
export const DISTANT_PREFIXES = DISTANT.map((d) => d.prefix);
export const DISTANT_BOXES = DISTANT.map((d) => ({ box: d.box, keys: distantParams(d).map((q) => q.k) }));

export const WAVE_PARAMS = [
  // the near (main) waves only; far waves and the surf bed keep playing
  { group: "Ocean waves", k: "nearOn", label: "Main waves on", type: "checkbox", def: true },
  { group: "Ocean waves", k: "nearLevel", label: "Main waves level", min: -40, max: 6, step: 0.5, def: 0, unit: "dB" },
  { group: "Ocean waves", k: "wavesLevel", label: "Waves level (−60 = off)", min: -60, max: 0, step: 0.5, def: -30, unit: "dB" },
  { group: "Ocean waves", k: "waveInterval", label: "Wave interval", min: 3, max: 30, def: 11, unit: "s", log: true },
  { group: "Ocean waves", k: "waveIrregularity", label: "Interval irregularity", min: 0, max: 0.9, step: 0.01, def: 0.35 },
  { group: "Ocean waves", k: "waveSizeVariation", label: "Size variation", min: 0, max: 18, step: 0.5, def: 6, unit: "dB" },
  // surf comes in sets: every setSpacing waves, 3 bigger waves in a row
  { group: "Ocean waves", k: "setSpacing", label: "Big-wave set (3 waves) every", min: 4, max: 20, step: 1, def: 7, unit: "waves" },
  { group: "Ocean waves", k: "setBoost", label: "Big-wave set boost", min: 0, max: 12, step: 0.5, def: 4, unit: "dB" },
  { group: "Ocean waves", k: "swellTime", label: "Swell time (upper)", min: 0.3, max: 8, def: 2.8, unit: "s", log: true },
  { group: "Ocean waves", k: "swellTimeMin", label: "Swell time (lower)", min: 0.3, max: 8, def: 2.8, unit: "s", log: true },
  { group: "Ocean waves", k: "swellLevel", label: "Swell level", min: -40, max: 0, step: 0.5, def: -8, unit: "dB" },
  { group: "Ocean waves", k: "breakAttack", label: "Break attack (upper)", min: 0.03, max: 2, def: 0.35, unit: "s", log: true },
  { group: "Ocean waves", k: "breakAttackMin", label: "Break attack (lower)", min: 0.03, max: 2, def: 0.35, unit: "s", log: true },
  { group: "Ocean waves", k: "crashLevel", label: "Crash level", min: -40, max: 0, step: 0.5, def: 0, unit: "dB" },
  // "(upper)"/"(lower)" pairs vary per wave: each wave picks a random value
  // (log-uniform) between the lower limit and the upper one (here and in far waves)
  { group: "Ocean waves", k: "crashBrightness", label: "Crash brightness (upper)", min: 500, max: 16000, def: 5500, unit: "Hz", log: true },
  { group: "Ocean waves", k: "crashBrightnessMin", label: "Crash brightness (lower)", min: 500, max: 16000, def: 5500, unit: "Hz", log: true },
  { group: "Ocean waves", k: "washTime", label: "Wash time (upper)", min: 1, max: 15, def: 6, unit: "s", log: true },
  { group: "Ocean waves", k: "washTimeMin", label: "Wash time (lower)", min: 1, max: 15, def: 6, unit: "s", log: true },
  { group: "Ocean waves", k: "washBrightness", label: "Wash settles at (upper)", min: 150, max: 8000, def: 1100, unit: "Hz", log: true },
  { group: "Ocean waves", k: "washBrightnessMin", label: "Wash settles at (lower)", min: 150, max: 8000, def: 1100, unit: "Hz", log: true },
  // how long the crash's filter takes to slide from crash brightness to where the
  // wash settles (~95% of the way); short enough to hear while the wash is loud
  { group: "Ocean waves", k: "washDarkening", label: "Wash darkening time", min: 0.1, max: 8, def: 1.2, unit: "s", log: true },
  { group: "Ocean waves", k: "fizzLevel", label: "Foam fizz level (upper)", min: -40, max: 0, step: 0.5, def: -11, unit: "dB" },
  { group: "Ocean waves", k: "fizzLevelMin", label: "Foam fizz level (lower)", min: -40, max: 0, step: 0.5, def: -11, unit: "dB" },
  { group: "Ocean waves", k: "fizzFreq", label: "Foam fizz above (upper)", min: 1000, max: 12000, def: 4500, unit: "Hz", log: true },
  { group: "Ocean waves", k: "fizzFreqMin", label: "Foam fizz above (lower)", min: 1000, max: 12000, def: 4500, unit: "Hz", log: true },
  { group: "Ocean waves", k: "backwashLevel", label: "Backwash level (upper)", min: -40, max: 0, step: 0.5, def: -15, unit: "dB" },
  { group: "Ocean waves", k: "backwashLevelMin", label: "Backwash level (lower)", min: -40, max: 0, step: 0.5, def: -15, unit: "dB" },
  { group: "Ocean waves", k: "backwashTime", label: "Backwash time (upper)", min: 0.5, max: 8, def: 3, unit: "s", log: true },
  { group: "Ocean waves", k: "backwashTimeMin", label: "Backwash time (lower)", min: 0.5, max: 8, def: 3, unit: "s", log: true },
  ...DISTANT.flatMap(distantParams),
  { group: "Ocean waves", k: "bedLevel", label: "Distant surf bed", min: -60, max: 6, step: 0.5, def: -20, unit: "dB" },
  { group: "Ocean waves", k: "bedCutoff", label: "Bed low-pass", min: 60, max: 3000, def: 350, unit: "Hz", log: true },
  { group: "Ocean waves", k: "waveDistance", label: "Distance", min: 0, max: 1, step: 0.01, def: 0.3 },
  { group: "Ocean waves", k: "wavePanSpread", label: "Stereo spread", min: 0, max: 1, step: 0.01, def: 0.7 },
  { group: "Ocean waves", k: "wavesReverb", label: "Reverb send", min: 0, max: 1, step: 0.01, def: 0.15 },
];

// ---- noise ----
const NOISE_SECONDS = 6;
const noiseCache = new WeakMap();

/** Stereo white, pink and brown noise buffers, each normalized to the same RMS. */
function noises(ctx) {
  let n = noiseCache.get(ctx);
  if (n) return n;
  const len = NOISE_SECONDS * ctx.sampleRate;
  const make = (fill) => {
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      fill(d);
      let e = 0;
      for (let i = 0; i < len; i++) e += d[i] * d[i];
      const k = 0.25 / Math.sqrt(e / len);
      for (let i = 0; i < len; i++) d[i] *= k;
    }
    return b;
  };
  n = {
    white: make((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }),
    pink: make((d) => { // Paul Kellet's refined pink filter
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      }
    }),
    brown: make((d) => {
      // leaky integrator of white noise: flat below ~150 Hz, -6 dB/octave above.
      // (A 0.998 leak put the corner at ~15 Hz: nearly all the energy was
      // subsonic and the swell and bed were inaudible.)
      const leak = Math.exp(-2 * Math.PI * 150 / ctx.sampleRate);
      let y = 0;
      for (let i = 0; i < d.length; i++) { y = leak * y + (Math.random() * 2 - 1); d[i] = y; }
    }),
  };
  noiseCache.set(ctx, n);
  return n;
}

/** 40 s of smooth random wander in [-1, 1] (a point per second, cosine-interpolated). */
function wanderBuffer(ctx) {
  const sr = 3000, secs = 40, pts = Array.from({ length: secs }, () => Math.random() * 2 - 1);
  const b = ctx.createBuffer(1, sr * secs, sr), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const x = i / sr, k = Math.floor(x), f = (1 - Math.cos(Math.PI * (x - k))) / 2;
    d[i] = pts[k] * (1 - f) + pts[(k + 1) % secs] * f;
  }
  return b;
}

const distanceCutoff = (d) => 16000 * Math.pow(800 / 16000, d); // 16 kHz near .. 800 Hz far
const distanceDb = (d) => -12 * d;
const isOff = (p) => p.wavesLevel <= -59.5; // off: no waves scheduled, bed silent
const levelGain = (p) => (isOff(p) ? 0 : dbToAmp(p.wavesLevel + distanceDb(p.waveDistance)));
const distantOff = (p, x) => p[`${x}On`] === false || p[`${x}Level`] <= -59.5;
const nearOff = (p) => p.nearOn === false;
const nearGain = (p) => (nearOff(p) ? 0 : dbToAmp(p.nearLevel));
const dbRange = (lo, hi) => ({ db: [lo, hi] }); // a level range, picked evenly in dB (times and frequencies: evenly in ratio)
const distantGain = (p, x) => (distantOff(p, x) ? 0 : dbToAmp(p[`${x}Level`]));

// What shapes one wave. Near waves use the main settings; distant waves the
// same, at their own interval and through their own low-pass range.
const nearProfile = (p) => ({
  interval: p.waveInterval, irregularity: p.waveIrregularity, sizeVariation: p.waveSizeVariation,
  setSpacing: p.setSpacing, setBoost: p.setBoost, swellTime: [p.swellTimeMin, p.swellTime], swellLevel: p.swellLevel, swellTop: 1400,
  breakAttack: [p.breakAttackMin, p.breakAttack], crashLevel: p.crashLevel,
  crashBrightness: [p.crashBrightnessMin, p.crashBrightness], washTime: [p.washTimeMin, p.washTime],
  washBrightness: [p.washBrightnessMin, p.washBrightness], washDarkening: p.washDarkening,
  fizzLevel: dbRange(p.fizzLevelMin, p.fizzLevel), fizzFreq: [p.fizzFreqMin, p.fizzFreq],
  backwashLevel: dbRange(p.backwashLevelMin, p.backwashLevel),
  backwashTime: [p.backwashTimeMin, p.backwashTime], panSpread: p.wavePanSpread,
});
const distantProfile = (x) => (p) => ({ ...nearProfile(p), interval: p.waveInterval * p[`${x}IntervalScale`],
  lowpass: [p[`${x}LowpassMin`], p[`${x}Lowpass`]] });

export class Waves {
  constructor(ctx, out, reverbIn, p) {
    this.ctx = ctx;
    this.p = { ...p };
    this.noise = noises(ctx);
    const t = ctx.currentTime;
    this.bus = new GainNode(ctx);
    this.distance = new BiquadFilterNode(ctx, { type: "lowpass", frequency: distanceCutoff(p.waveDistance), Q: 0.6 });
    this.level = new GainNode(ctx, { gain: levelGain(p) });
    this.send = new GainNode(ctx, { gain: p.wavesReverb });
    this.bus.connect(this.distance).connect(this.level).connect(out);
    this.level.connect(this.send).connect(reverbIn);

    // distant surf bed: constant, with a slow random swell (+-50%)
    this.bed = new AudioBufferSourceNode(ctx, { buffer: this.noise.brown, loop: true });
    this.bedFilter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: p.bedCutoff, Q: 0.5 });
    this.bedGain = new GainNode(ctx, { gain: dbToAmp(p.bedLevel) });
    this.bedSwell = new AudioBufferSourceNode(ctx, { buffer: wanderBuffer(ctx), loop: true, playbackRate: 0.12 });
    this.bedSwellDepth = new GainNode(ctx, { gain: dbToAmp(p.bedLevel) * 0.5 });
    this.bed.connect(this.bedFilter).connect(this.bedGain).connect(this.bus);
    this.bedSwell.connect(this.bedSwellDepth).connect(this.bedGain.gain);
    this.bed.start(t, Math.random() * NOISE_SECONDS);
    this.bedSwell.start(t, Math.random() * 40);

    // distant streams (far, further): their own level, then into the same bus
    // (each wave has its own low-pass, see scheduleWave)
    this.distant = DISTANT.map(({ prefix: x }) => {
      const gain = new GainNode(ctx, { gain: distantGain(p, x) });
      gain.connect(this.bus);
      return { x, gain };
    });
    // main waves: their level (and on/off), so switching off also fades waves already sounding
    this.nearGain = new GainNode(ctx, { gain: nearGain(p) });
    this.nearGain.connect(this.bus);

    this.waves = []; // scheduled/sounding waves: { stream, t0, end, sources, nodes }
    this.streams = [
      { name: "near", out: this.nearGain, next: t + 0.5, count: 0, off: (q) => isOff(q) || nearOff(q), profile: nearProfile },
      ...this.distant.map((d, i) => ({ name: d.x, out: d.gain, next: t + 0.2 + 0.15 * i, count: 0,
        off: (q) => isOff(q) || distantOff(q, d.x), profile: distantProfile(d.x) })),
    ];
    this.timer = setInterval(() => this.pump(), 1000);
    this.pump();
  }

  pump() {
    const now = this.ctx.currentTime;
    const ahead = typeof document !== "undefined" && document.hidden ? 75 : 4;
    for (const st of this.streams) {
      if (st.off(this.p)) { st.next = Math.max(st.next, now + 0.5); continue; } // nothing scheduled while off
      try {
        while (st.next < now + ahead) {
          const pr = st.profile(this.p);
          this.scheduleWave(st, st.next, pr);
          st.next += pr.interval * (1 + pr.irregularity * (Math.random() * 2 - 1));
        }
      } catch (e) { // one bad stream must not stop the other, or anything else
        console.error(`waves (${st.name}):`, e);
        st.next = now + 5;
      }
    }
    this.waves = this.waves.filter((w) => w.end > now);
  }

  /** One wave of stream `st` from profile `pr` (see nearProfile / distantProfile). */
  scheduleWave(st, t0, prof) {
    // ranged settings ([lower, upper]) pick a value for this wave, log-uniform;
    // a lower limit above its upper counts as equal (no variation)
    const pick = (v) => {
      if (v && v.db) { const hi = v.db[1], lo = Math.min(v.db[0], hi); return lo + (hi - lo) * Math.random(); } // dB: even in dB
      if (!Array.isArray(v)) return v;
      const hi = v[1], lo = Math.min(v[0], hi);
      return lo * Math.pow(hi / lo, Math.random());
    };
    const pr = Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, pick(v)]));
    const ctx = this.ctx, n = this.noise;
    const i = st.count++;
    const inSet = pr.setSpacing && i >= 3 && i % Math.max(4, Math.round(pr.setSpacing)) < 3; // 3 bigger waves every setSpacing
    const sizeDb = -Math.random() * pr.sizeVariation + (inSet ? pr.setBoost : 0);
    const size = dbToAmp(sizeDb), dark = Math.pow(2, sizeDb / 12); // smaller waves are also darker
    const tb = t0 + pr.swellTime;                                    // the break
    const end = tb + Math.max(pr.washTime * 1.6, pr.washTime * 0.5 + pr.backwashTime * 2) + 1;
    const pan = new StereoPannerNode(ctx, { pan: (Math.random() * 2 - 1) * pr.panSpread });
    const sources = [], nodes = [pan];
    if (pr.lowpass) {
      // distant waves: 24 dB/octave low-pass (two Butterworth sections) at this wave's cutoff
      const lp1 = new BiquadFilterNode(ctx, { type: "lowpass", frequency: pr.lowpass, Q: 0.541 });
      const lp2 = new BiquadFilterNode(ctx, { type: "lowpass", frequency: pr.lowpass, Q: 1.307 });
      pan.connect(lp1).connect(lp2).connect(st.out);
      nodes.push(lp1, lp2);
    } else {
      pan.connect(st.out);
    }
    const on = (db) => db > -39.5; // a layer at its minimum isn't created at all
    const layer = (buffer, filter, gainParam) => {
      const src = new AudioBufferSourceNode(ctx, { buffer, loop: true });
      const g = new GainNode(ctx, { gain: 0 });
      src.connect(filter).connect(g).connect(pan);
      src.start(t0, Math.random() * NOISE_SECONDS);
      src.stop(end);
      sources.push(src);
      nodes.push(filter, g);
      gainParam(g.gain);
      return filter;
    };

    // approach: rumble rising to the break, then sinking under the crash
    if (on(pr.swellLevel)) {
      const ap = layer(n.brown, new BiquadFilterNode(ctx, { type: "lowpass", frequency: 250, Q: 0.7 }), (g) => {
        const peak = dbToAmp(pr.swellLevel) * size;
        g.setValueAtTime(0, t0);
        g.linearRampToValueAtTime(peak * 0.3, t0 + pr.swellTime * 0.6);
        g.linearRampToValueAtTime(peak, tb);
        g.setTargetAtTime(0, tb + 0.1, 0.6);
      });
      ap.frequency.setValueAtTime(250, t0);                                          // dark rumble far out...
      ap.frequency.exponentialRampToValueAtTime(Math.max(260, pr.swellTop * dark), tb); // ...to a rush as the face rises
    }

    // crash: the break rises over breakAttack, then washes out (bright -> dark)
    if (on(pr.crashLevel)) {
      const cr = layer(n.pink, new BiquadFilterNode(ctx, { type: "lowpass", frequency: pr.crashBrightness * dark, Q: 0.5 }), (g) => {
        const peak = dbToAmp(pr.crashLevel) * size;
        g.setValueAtTime(0, tb - pr.breakAttack * 0.3);
        g.linearRampToValueAtTime(peak, tb + pr.breakAttack * 0.7);
        g.setTargetAtTime(0, tb + pr.breakAttack * 0.7, pr.washTime / 3.5);
      });
      cr.frequency.setValueAtTime(pr.crashBrightness * dark, tb);
      cr.frequency.setTargetAtTime(pr.washBrightness * dark, tb + pr.breakAttack, pr.washDarkening / 3);
    }

    // fizz: foam hiss, rising just after the crash and lingering longest
    if (on(pr.fizzLevel)) {
      layer(n.white, new BiquadFilterNode(ctx, { type: "highpass", frequency: pr.fizzFreq, Q: 0.5 }), (g) => {
        const peak = dbToAmp(pr.fizzLevel) * size;
        g.setValueAtTime(0, tb);
        g.linearRampToValueAtTime(peak, tb + pr.breakAttack + 0.4);
        g.setTargetAtTime(0, tb + pr.breakAttack + 0.4, pr.washTime / 2.5);
      });
    }

    // backwash: the water retreating, a hiss sliding down
    if (on(pr.backwashLevel)) {
      const bwStart = tb + pr.washTime * 0.5;
      const bw = layer(n.pink, new BiquadFilterNode(ctx, { type: "bandpass", frequency: 2600, Q: 0.8 }), (g) => {
        const peak = dbToAmp(pr.backwashLevel) * size;
        g.setValueAtTime(0, bwStart);
        g.linearRampToValueAtTime(peak, bwStart + pr.backwashTime * 0.4);
        g.setTargetAtTime(0, bwStart + pr.backwashTime * 0.4, pr.backwashTime / 3);
      });
      bw.frequency.setValueAtTime(2600 * dark, bwStart);
      bw.frequency.exponentialRampToValueAtTime(700 * dark, bwStart + pr.backwashTime * 1.5);
    }

    if (!sources.length) { nodes.forEach((x) => x.disconnect()); return; }
    sources[0].onended = () => nodes.forEach((x) => x.disconnect());
    this.waves.push({ stream: st, t0, end, sources, nodes });
  }

  update(p) {
    const prev = this.p, t = this.ctx.currentTime;
    this.p = { ...p };
    this.level.gain.setTargetAtTime(levelGain(p), t, 0.05);
    for (const d of this.distant) d.gain.gain.setTargetAtTime(distantGain(p, d.x), t, 0.05);
    this.nearGain.gain.setTargetAtTime(nearGain(p), t, 0.08);
    this.distance.frequency.setTargetAtTime(distanceCutoff(p.waveDistance), t, 0.05);
    this.send.gain.setTargetAtTime(p.wavesReverb, t, 0.05);
    this.bedGain.gain.setTargetAtTime(dbToAmp(p.bedLevel), t, 0.05);
    this.bedSwellDepth.gain.setTargetAtTime(dbToAmp(p.bedLevel) * 0.5, t, 0.05);
    this.bedFilter.frequency.setTargetAtTime(p.bedCutoff, t, 0.05);
    for (const st of this.streams) {
      const changed = st.off(p) !== st.off(prev) ||
        JSON.stringify(st.profile(p)) !== JSON.stringify(st.profile(prev));
      if (!changed) continue;
      // reschedule this stream's waves that haven't started, so the change is heard on the next wave
      const pending = this.waves.filter((w) => w.stream === st && w.t0 > t + 0.05);
      if (pending.length) {
        st.next = Math.min(...pending.map((w) => w.t0));
        for (const w of pending) for (const s of w.sources) s.stop();
        this.waves = this.waves.filter((w) => !pending.includes(w));
      }
    }
    this.pump();
  }

  stop() {
    clearInterval(this.timer);
    for (const w of this.waves) for (const s of w.sources) { try { s.stop(); } catch {} }
    this.bed.stop();
    this.bedSwell.stop();
    setTimeout(() => {
      for (const x of [this.bus, this.distance, this.level, this.send, this.bed, this.bedFilter, this.bedGain,
        this.bedSwell, this.bedSwellDepth, this.nearGain, ...this.distant.map((d) => d.gain)]) x.disconnect();
    }, 100);
  }
}
