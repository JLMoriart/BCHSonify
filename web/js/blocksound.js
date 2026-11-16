// The block note: a breathy, percussive pad built from Web Audio's native nodes.
//
//   osc A ─────────┐
//   osc B ─ gain ──┴─ drive ─ low-pass ─ amp env ─┐
//   noise ─ band-pass ─ breath env ───────────────┴─ chorus ─ hold fade ─┬─ out
//                                                                        ├─ reverb send ─ shared reverb
//                                                                        └─ echo send ─ shared echo
//
// The reverb and echo are shared with the sine harmonics (space.js), so
// there's only ever one of each, however many notes sound.
//
// The hold fade is the same as every other note's: from its start level down
// (linearly in dB) to CONFIG.floorDb over the hold, then the voice ends.
// A new block while the voice sounds re-strikes it (envelopes restart) and
// restarts the hold.

import { CONFIG, dbToAmp } from "./mapping.js";
import { HoldFade } from "./fade.js";
import { DISTANT_PREFIXES, WAVE_PARAMS } from "./waves.js";

// Every tweakable parameter, for the workbench. Defaults are a starting point
// for tuning by ear, not a finished sound.
export const BLOCK_PARAMS = [
  // octave of the whole block note relative to harmonic 1 (the fundamental, CONFIG.f0).
  // Below 0 its overtones include pitches between the transaction harmonics.
  { group: "Oscillators", k: "blockOctave", label: `Block octave (0 = ${CONFIG.f0} Hz)`, min: -2, max: 1, step: 1, def: 0 },
  // same harmonics, each at a random (fixed) phase: removes the waveform's sharp
  // once-per-cycle jolt, which at 20 Hz is heard as a fast tremolo (measured on a
  // 20 Hz saw: loudness pulsing 80% -> 32%, spectrum unchanged)
  { group: "Oscillators", k: "phaseScramble", label: "Scramble harmonic phases", type: "checkbox", def: false },
  { group: "Oscillators", k: "oscAType", label: "Osc A wave", options: ["sawtooth", "square", "triangle", "sine"], def: "sawtooth" },
  { group: "Oscillators", k: "oscBType", label: "Osc B wave", options: ["sawtooth", "square", "triangle", "sine"], def: "square" },
  // osc B starts an octave up: at the same pitch, a detuned square at -6 dB has exactly the
  // saw's fundamental amplitude and periodically cancels it (measured: h1 12 dB below h2)
  { group: "Oscillators", k: "oscBOctave", label: "Osc B octaves up", min: 0, max: 3, step: 1, def: 1 },
  { group: "Oscillators", k: "oscBDetune", label: "Osc B detune", min: -50, max: 50, step: 1, def: 8, unit: "cents" },
  { group: "Oscillators", k: "oscBLevel", label: "Osc B level", min: -48, max: 0, step: 0.5, def: -6, unit: "dB" },
  { group: "Oscillators", k: "drive", label: "Drive", min: 0, max: 1, step: 0.01, def: 0 },
  { group: "Filter (low-pass)", k: "cutoff", label: "Settled cutoff", min: 40, max: 12000, def: 500, unit: "Hz", log: true },
  { group: "Filter (low-pass)", k: "strikeCutoff", label: "Strike cutoff", min: 40, max: 12000, def: 3000, unit: "Hz", log: true },
  { group: "Filter (low-pass)", k: "filterDecay", label: "Strike → settled", min: 0.01, max: 8, def: 0.6, unit: "s", log: true },
  { group: "Filter (low-pass)", k: "q", label: "Resonance (Q)", min: 0.1, max: 20, def: 2, log: true },
  // Pulse: the filter re-opens in pulses toward the strike cutoff. The strike is
  // pulse 0 (the filter is brightest at the strike); pulse 1 (at its brightest)
  // comes twice the pulse-1-to-pulse-2 gap after it. From the start of pulse 1
  // the rate sweeps from pulseStartRate to pulseEndRate at the end of the note,
  // so the pulse speed shows how far through its hold the note is:
  //   rate = start * (end/start)^(x^pulseCurve), x = fraction of that sweep gone
  // The sweep ends pulseSweepLength x the hold after the strike (1 = the end of
  // the note); after that the rate stays at the end rate.
  // (curve 1: equal time per octave of rate; higher: slow for longer, then a rush
  // at the end). Pulse depth fades in over "Strike -> settled" from the strike.
  { group: "Pulse (filter sweep)", k: "pulseAmount", label: "Brightness (0 = off, 1 = up to strike cutoff)", min: 0, max: 1, step: 0.01, def: 0.5 },
  // ping: snaps bright, then darkens until the next pulse (like a small re-strike);
  // sine: smooth wah, always moving; sine top half: a smooth bump for half of each
  // cycle, then the filter rests at the settled cutoff for the other half
  { group: "Pulse (filter sweep)", k: "pulseShape", label: "Shape", options: ["ping", "sine", "sine top half"], def: "ping" },
  { group: "Pulse (filter sweep)", k: "pulseStartRate", label: "Rate at first pulse", min: 0.2, max: 10, def: 1, unit: "Hz", log: true },
  { group: "Pulse (filter sweep)", k: "pulseEndRate", label: "Rate at end of note", min: 1, max: 50, def: 25, unit: "Hz", log: true },
  // fade out: full pulse brightness at pulse 1, then down to 0 when the rate reaches
  // the end rate (the end of the sweep), linearly in octaves of filter opening
  { group: "Pulse (filter sweep)", k: "pulseFadeOut", label: "Fade pulses out (from the first pulse to the end of the sweep)", type: "checkbox", def: false },
  // brightness = full * (fraction of the fade left)^pulseFadeCurve: 1 = straight
  // line, 2 = drops fast at first and eases into 0, higher = more so
  { group: "Pulse (filter sweep)", k: "pulseFadeCurve", label: "Fade curve (1 = straight, higher = drops faster at first)", min: 1, max: 6, step: 0.1, def: 2 },
  // how much of the hold (from the strike) the sweep takes: 1 = it reaches the end
  // rate at the end of the note; 0.1 = 10% into the hold, then stays at the end rate
  { group: "Pulse (filter sweep)", k: "pulseSweepLength", label: "Sweep length (× hold; 1 = until the end of the note)", min: 0.1, max: 1, step: 0.01, def: 1 },
  { group: "Pulse (filter sweep)", k: "pulseCurve", label: "Sweep curve (1 = even, higher = speeds up later)", min: 0.1, max: 6, step: 0.1, def: 3 },
  { group: "Amp envelope", k: "attack", label: "Attack", min: 0.001, max: 2, def: 0.005, unit: "s", log: true },
  { group: "Amp envelope", k: "decay", label: "Decay", min: 0.01, max: 10, def: 1.5, unit: "s", log: true },
  { group: "Amp envelope", k: "sustain", label: "Sustain", min: -48, max: 0, step: 0.5, def: -9, unit: "dB" },
  { group: "Breath (noise)", k: "breathLevel", label: "Strike level", min: -72, max: 0, step: 0.5, def: -18, unit: "dB" },
  { group: "Breath (noise)", k: "breathFreq", label: "Band centre", min: 100, max: 12000, def: 2500, unit: "Hz", log: true },
  { group: "Breath (noise)", k: "breathQ", label: "Band Q", min: 0.1, max: 10, def: 0.8, log: true },
  { group: "Breath (noise)", k: "breathAttack", label: "Attack", min: 0.001, max: 1, def: 0.02, unit: "s", log: true },
  { group: "Breath (noise)", k: "breathDecay", label: "Decay", min: 0.01, max: 5, def: 0.4, unit: "s", log: true },
  { group: "Breath (noise)", k: "breathSustainLevel", label: "Sustain level", min: -72, max: 0, step: 0.5, def: -48, unit: "dB" },
  { group: "Chorus", k: "chorusMix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.5 },
  { group: "Chorus", k: "chorusRate", label: "Rate", min: 0.05, max: 5, def: 0.6, unit: "Hz", log: true },
  { group: "Chorus", k: "chorusDepth", label: "Depth", min: 0, max: 10, step: 0.1, def: 3, unit: "ms" },
  { group: "Vibrato", k: "vibratoDepth", label: "Depth", min: 0, max: 50, step: 0.5, def: 0, unit: "cents" },
  { group: "Vibrato", k: "vibratoRate", label: "Rate", min: 0.1, max: 10, def: 5, unit: "Hz", log: true },
  // Partials for the transaction notes (not the block note): each note adds
  // sines on the harmonics of f0 nearest to note * ratio (mapping.js). Level is
  // relative loudness: 0 dB = as loud as the note's own pitch (each partial
  // gets the same equal-loudness compensation as a note at its pitch).
  // Off (-60) by default: plain sines.
  { group: "Chime partials (transaction notes)", k: "partial2", label: "Partial 2 (×2.7565)", min: -60, max: 0, step: 0.5, def: -60, unit: "dB" },
  { group: "Chime partials (transaction notes)", k: "partial3", label: "Partial 3 (×5.4039)", min: -60, max: 0, step: 0.5, def: -60, unit: "dB" },
  { group: "Chime partials (transaction notes)", k: "partial4", label: "Partial 4 (×8.9330)", min: -60, max: 0, step: 0.5, def: -60, unit: "dB" },
  { group: "Chime partials (transaction notes)", k: "partial5", label: "Partial 5 (×13.3443)", min: -60, max: 0, step: 0.5, def: -60, unit: "dB" },
  { group: "Chime partials (transaction notes)", k: "partial6", label: "Partial 6 (×18.6379)", min: -60, max: 0, step: 0.5, def: -60, unit: "dB" },
  // Decay: how long each partial takes to fade, as a fraction of the note's hold
  // (1 = with the note). Real bars and tubes lose their upper partials first.
  { group: "Chime partials (transaction notes)", k: "partial2Decay", label: "Partial 2 decay (× hold)", min: 0.01, max: 1, def: 1, log: true },
  { group: "Chime partials (transaction notes)", k: "partial3Decay", label: "Partial 3 decay (× hold)", min: 0.01, max: 1, def: 1, log: true },
  { group: "Chime partials (transaction notes)", k: "partial4Decay", label: "Partial 4 decay (× hold)", min: 0.01, max: 1, def: 1, log: true },
  { group: "Chime partials (transaction notes)", k: "partial5Decay", label: "Partial 5 decay (× hold)", min: 0.01, max: 1, def: 1, log: true },
  { group: "Chime partials (transaction notes)", k: "partial6Decay", label: "Partial 6 decay (× hold)", min: 0.01, max: 1, def: 1, log: true },
  // Pitch movement for the transaction notes (not the block note): each note
  // drifts slowly and randomly, independently of the others, plus a light
  // vibrato whose rate varies a little per note. Breaks the exact 40 Hz
  // periodicity of the whole mix. Partials move with their note.
  { group: "Note movement (transaction notes)", k: "driftDepth", label: "Drift depth", min: 0, max: 20, step: 0.1, def: 1, unit: "cents" },
  { group: "Note movement (transaction notes)", k: "driftRate", label: "Drift speed", min: 0.02, max: 4, def: 0.2, unit: "Hz", log: true },
  { group: "Note movement (transaction notes)", k: "noteVibratoDepth", label: "Vibrato depth", min: 0, max: 20, step: 0.1, def: 1, unit: "cents" },
  { group: "Note movement (transaction notes)", k: "noteVibratoRate", label: "Vibrato rate", min: 0.5, max: 10, def: 4.5, unit: "Hz", log: true },
  // Reverb and echo are shared by the block voice and the harmonics (space.js).
  // Defaults reproduce the earlier plain reverb, with the echo off.
  { group: "Reverb (shared)", k: "reverbMix", label: "Block send", min: 0, max: 1, step: 0.01, def: 0.25 },
  { group: "Reverb (shared)", k: "harmonicsSend", label: "Harmonics send", min: 0, max: 1, step: 0.01, def: 0.25 },
  { group: "Reverb (shared)", k: "reverbSize", label: "Room size", min: 2, max: 300, def: 5, unit: "m", log: true },
  { group: "Reverb (shared)", k: "reverbPreDelay", label: "Pre-delay", min: 0, max: 250, step: 1, def: 0, unit: "ms" },
  { group: "Reverb (shared)", k: "reverbDecay", label: "Decay (RT60)", min: 0.2, max: 15, def: 2.5, unit: "s", log: true },
  { group: "Reverb (shared)", k: "reverbDampFreq", label: "Damping above", min: 200, max: 16000, def: 8000, unit: "Hz", log: true },
  { group: "Reverb (shared)", k: "reverbHfRatio", label: "High decay ratio", min: 0.1, max: 1, step: 0.01, def: 1 },
  { group: "Reverb (shared)", k: "reverbDiffusion", label: "Diffusion", min: 0, max: 1, step: 0.01, def: 1 },
  { group: "Reverb (shared)", k: "reverbEarly", label: "Early reflections", min: -60, max: 0, step: 0.5, def: -60, unit: "dB" },
  { group: "Reverb (shared)", k: "reverbWidth", label: "Width", min: 0, max: 1, step: 0.01, def: 1 },
  { group: "Echo (shared)", k: "echoSend", label: "Block send", min: 0, max: 1, step: 0.01, def: 0 },
  { group: "Echo (shared)", k: "harmonicsEchoSend", label: "Harmonics send", min: 0, max: 1, step: 0.01, def: 0 },
  { group: "Echo (shared)", k: "echoTime", label: "Time", min: 10, max: 1000, def: 120, unit: "ms", log: true },
  { group: "Echo (shared)", k: "echoFeedback", label: "Feedback", min: 0, max: 0.95, step: 0.01, def: 0.3 },
  { group: "Echo (shared)", k: "echoDamping", label: "Damping above", min: 200, max: 16000, def: 4000, unit: "Hz", log: true },
  { group: "Echo (shared)", k: "echoToReverb", label: "Into reverb", min: 0, max: 1, step: 0.01, def: 0.5 },
  { group: "Output", k: "level", label: "Start level", min: -48, max: 12, step: 0.5, def: -6, unit: "dB" },
];

BLOCK_PARAMS.push(...WAVE_PARAMS); // ocean waves (waves.js) share the same settings, presets and sound.json

export const BLOCK_DEFAULTS = Object.fromEntries(BLOCK_PARAMS.map((p) => [p.k, p.def]));

/** A starting point for a cave: big, dark, long, with distinct rock-wall
 *  reflections and a short slap echo that blooms into the reverb. Sets only
 *  reverb and echo settings. */
export const CAVE_SPACE = {
  reverbMix: 0.35, harmonicsSend: 0.3, reverbSize: 40, reverbPreDelay: 60, reverbDecay: 7,
  reverbDampFreq: 1800, reverbHfRatio: 0.35, reverbDiffusion: 0.35, reverbEarly: -6, reverbWidth: 1,
  echoSend: 0.25, harmonicsEchoSend: 0.15, echoTime: 140, echoFeedback: 0.35, echoDamping: 2500, echoToReverb: 0.6,
};

/** Settings saved before the breath sustain became its own level (it was
 *  relative to the strike level): convert, drop unknown keys. */
export function migrateBlockParams(saved) {
  const p = { ...saved };
  if ("breathSustain" in p && !("breathSustainLevel" in p)) {
    p.breathSustainLevel = (p.breathLevel ?? BLOCK_DEFAULTS.breathLevel) + p.breathSustain;
  }
  // distant low-pass became a range: a saved single value becomes both ends (no variation)
  for (const x of DISTANT_PREFIXES) {
    if (`${x}Lowpass` in p && !(`${x}LowpassMin` in p)) p[`${x}LowpassMin`] = p[`${x}Lowpass`];
  }
  return Object.fromEntries(Object.entries(p).filter(([k]) => k in BLOCK_DEFAULTS));
}

const noiseCache = new WeakMap();

function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

const scrambleCache = new WeakMap();

/** The built-in waveform's harmonic amplitudes, each harmonic at a random phase
 *  (seeded, so it's the same every time and for every visitor). 2048 harmonics:
 *  the browser drops whatever is above Nyquist. */
function scrambledWave(ctx, type) {
  let m = scrambleCache.get(ctx);
  if (!m) scrambleCache.set(ctx, (m = new Map()));
  if (!m.has(type)) {
    const N = 2048, real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
    let seed = 12345;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 1; n <= N; n++) {
      const a = type === "sawtooth" ? 2 / (Math.PI * n)
        : type === "square" ? (n % 2 ? 4 / (Math.PI * n) : 0)
        : type === "triangle" ? (n % 2 ? 8 / (Math.PI * Math.PI * n * n) : 0)
        : n === 1 ? 1 : 0; // sine
      const ph = rnd() * 2 * Math.PI;
      real[n] = a * Math.cos(ph);
      imag[n] = a * Math.sin(ph);
    }
    m.set(type, new PeriodicWave(ctx, { real, imag, disableNormalization: true }));
  }
  return m.get(type);
}

/** Oscillator constructor options for a waveform type, scrambled or not. */
function waveOptions(ctx, type, scramble) {
  return scramble ? { periodicWave: scrambledWave(ctx, type) } : { type };
}

function setWave(osc, ctx, type, scramble) {
  if (scramble) osc.setPeriodicWave(scrambledWave(ctx, type));
  else osc.type = type;
}

function driveCurve(drive) {
  if (drive <= 0) return null;
  const k = 1 + drive * 20, n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

// value of an attack-then-exponential-decay envelope `age` s after its start
const pulseCache = new WeakMap();

/** A pulse shape s(x) in 0..1 (0 = settled cutoff, 1 = full pulse), as
 *  { wave, offset, peak }: an oscillator can't carry a constant part, so
 *  wave = 2 * (s minus its average) and offset = 2 * average, and
 *  (wave + offset) * depth/2 = s * depth. Each shape is 0 at phase 0 (so a
 *  pulse oscillator starting there pops in smoothly from rest); `peak` is the
 *  fraction of a cycle at which it is brightest.
 *  ping: a falling ramp (jump up, fall back), Lanczos-smoothed so the jump
 *  doesn't ring, peak at the jump; sine: (1 - cos x)/2, peak half-way;
 *  sine top half: max(0, sin x), peak a quarter in. 32 harmonics. */
function pulseWave(ctx, shape) {
  let c = pulseCache.get(ctx);
  if (!c) pulseCache.set(ctx, (c = {}));
  if (!c[shape]) {
    const N = 32, real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
    let offset = 1, peak = 0; // average 1/2
    if (shape === "sine") { real[1] = -1; peak = 0.5; }
    else if (shape === "sine top half") {
      // max(0, sin x) = 1/pi + sin(x)/2 - (2/pi) * sum over even k of cos(kx)/(k^2 - 1)
      offset = 2 / Math.PI;
      peak = 0.25;
      imag[1] = 1;
      for (let k = 2; k <= N; k += 2) real[k] = (-4 / Math.PI) / (k * k - 1);
    } else for (let k = 1; k <= N; k++) {
      const sigma = k === N ? 0 : Math.sin(Math.PI * k / N) / (Math.PI * k / N);
      imag[k] = (2 / Math.PI) * (1 / k) * sigma; // sum of sin(kx)/k: falls from +1 to -1 each cycle
    }
    c[shape] = { wave: new PeriodicWave(ctx, { real, imag, disableNormalization: true }), offset, peak };
  }
  return c[shape];
}

function envAt(age, attack, peak, target, tau) {
  if (age <= 0) return 0;
  if (age < attack) return peak * (age / attack);
  return target + (peak - target) * Math.exp(-(age - attack) / tau);
}

export class BlockVoice {
  constructor(ctx, buses, baseFreq, params) { // buses: { out, reverb, echo }
    this.ctx = ctx;
    this.p = { ...BLOCK_DEFAULTS, ...params };
    const p = this.p;
    this.baseFreq = baseFreq;
    const freq = (this.freq = baseFreq * 2 ** p.blockOctave);
    const n = (this.nodes = {});
    // initial values via constructors; levels are scheduled from our own
    // bookkeeping, never read back from the browser (see fade.js)
    n.oscA = new OscillatorNode(ctx, { ...waveOptions(ctx, p.oscAType, p.phaseScramble), frequency: freq });
    n.oscB = new OscillatorNode(ctx, { ...waveOptions(ctx, p.oscBType, p.phaseScramble), frequency: freq * 2 ** p.oscBOctave, detune: p.oscBDetune });
    n.oscBGain = new GainNode(ctx, { gain: dbToAmp(p.oscBLevel) });
    n.sum = new GainNode(ctx);
    n.shaper = new WaveShaperNode(ctx);
    n.filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: p.strikeCutoff, Q: p.q });
    // pulse: (LFO + offset) -> 0..2, x half the depth in cents -> the filter's detune.
    // The LFO and offset are made per strike (schedulePulse), started at pulse 1.
    n.pulseDepth = new GainNode(ctx, { gain: 0 });
    this.pulse = null;
    n.amp = new GainNode(ctx, { gain: 0 });
    n.noise = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx), loop: true });
    n.breathBand = new BiquadFilterNode(ctx, { type: "bandpass", frequency: p.breathFreq, Q: p.breathQ });
    n.breath = new GainNode(ctx, { gain: 0 });
    n.chorusIn = new GainNode(ctx);
    n.dry = new GainNode(ctx, { gain: 1 - p.chorusMix });
    // chorus delay = one period of the note: the delayed copy lines up with every
    // harmonic instead of cancelling some (a 12 ms delay cancelled 40 Hz almost
    // completely: half its period); the LFO sweeps around it for the shimmer
    this.chorusDelay = 1 / this.freq;
    n.delay = new DelayNode(ctx, { maxDelayTime: 0.1, delayTime: this.chorusDelay });
    n.wet = new GainNode(ctx, { gain: p.chorusMix });
    n.chorusLfo = new OscillatorNode(ctx, { frequency: p.chorusRate });
    n.chorusDepth = new GainNode(ctx, { gain: p.chorusDepth / 1000 });
    n.vibLfo = new OscillatorNode(ctx, { frequency: p.vibratoRate });
    n.vibDepth = new GainNode(ctx, { gain: p.vibratoDepth });
    n.hold = new GainNode(ctx, { gain: 0 });
    n.send = new GainNode(ctx, { gain: p.reverbMix });
    n.echoSend = new GainNode(ctx, { gain: p.echoSend });
    this.fade = new HoldFade(n.hold.gain);

    n.oscA.connect(n.sum);
    n.oscB.connect(n.oscBGain).connect(n.sum);
    n.sum.connect(n.shaper).connect(n.filter).connect(n.amp).connect(n.chorusIn);
    n.noise.connect(n.breathBand).connect(n.breath).connect(n.chorusIn);
    n.chorusIn.connect(n.dry).connect(n.hold);
    n.chorusIn.connect(n.delay).connect(n.wet).connect(n.hold);
    n.chorusLfo.connect(n.chorusDepth).connect(n.delay.delayTime);
    n.pulseDepth.connect(n.filter.detune);
    n.vibLfo.connect(n.vibDepth);
    n.vibDepth.connect(n.oscA.detune);
    n.vibDepth.connect(n.oscB.detune);
    n.hold.connect(buses.out);
    n.hold.connect(n.send).connect(buses.reverb);
    n.hold.connect(n.echoSend).connect(buses.echo);

    this.update(p);
    this.sources = [n.oscA, n.oscB, n.noise, n.chorusLfo, n.vibLfo];
    const t = ctx.currentTime;
    for (const s of this.sources) s.start(t);
    this.onended = null;
    n.oscA.onended = () => {
      for (const node of Object.values(n)) node.disconnect();
      if (this.pulse) { this.pulse.osc.disconnect(); this.pulse.off.disconnect(); }
      if (this.onended) this.onended();
    };
  }

  /** Apply the static (non-envelope) parameters now; envelope ones apply on the next strike. */
  update(params) {
    const p = (this.p = { ...this.p, ...params });
    const n = this.nodes, t = this.ctx.currentTime;
    const freq = this.baseFreq * 2 ** p.blockOctave;
    if (freq !== this.freq) { // octave changed (workbench)
      this.freq = freq;
      this.chorusDelay = 1 / freq;
      n.oscA.frequency.setValueAtTime(freq, t);
    }
    setWave(n.oscA, this.ctx, p.oscAType, p.phaseScramble);
    setWave(n.oscB, this.ctx, p.oscBType, p.phaseScramble);
    n.oscB.frequency.setValueAtTime(this.freq * 2 ** p.oscBOctave, t);
    n.oscB.detune.setValueAtTime(p.oscBDetune, t);
    n.oscBGain.gain.setValueAtTime(dbToAmp(p.oscBLevel), t);
    n.shaper.curve = driveCurve(p.drive);
    n.filter.Q.setValueAtTime(p.q, t);
    n.breathBand.frequency.setValueAtTime(p.breathFreq, t);
    n.breathBand.Q.setValueAtTime(p.breathQ, t);
    n.dry.gain.setValueAtTime(1 - p.chorusMix, t);
    n.wet.gain.setValueAtTime(p.chorusMix, t);
    n.delay.delayTime.setValueAtTime(this.chorusDelay, t);
    n.chorusLfo.frequency.setValueAtTime(p.chorusRate, t);
    n.chorusDepth.gain.setValueAtTime(p.chorusDepth / 1000, t);
    n.vibLfo.frequency.setValueAtTime(p.vibratoRate, t);
    n.vibDepth.gain.setValueAtTime(p.vibratoDepth, t);
    n.send.gain.setValueAtTime(p.reverbMix, t);
    n.echoSend.gain.setValueAtTime(p.echoSend, t);
    if (this.struck) this.schedulePulseDepth(t);
    if (this.life) this.setHold(this.life, this.ctx.currentTime - this.start); // level may have changed
  }

  /** (Re)start the strike envelopes as if struck `age` s ago (0 = now). */
  strike(age = 0) {
    const p = this.p, n = this.nodes, t = this.ctx.currentTime, t0 = t - age;
    const envs = {
      amp: [n.amp.gain, 1, dbToAmp(p.sustain), p.attack, p.decay / 4],
      breath: [n.breath.gain, dbToAmp(p.breathLevel), dbToAmp(p.breathSustainLevel), p.breathAttack, p.breathDecay / 4],
    };
    // each envelope continues from where it is now (computed from the last
    // strike, never read from the browser: see fade.js)
    for (const [k, [param, peak, target, attack, tau]] of Object.entries(envs)) {
      const cur = this.envNow(k, t);
      param.cancelScheduledValues(t);
      param.setValueAtTime(age > 0 ? envAt(age, attack, peak, target, tau) : cur, t);
      if (age < attack) param.linearRampToValueAtTime(peak, t0 + attack);
      param.setTargetAtTime(target, Math.max(t, t0 + attack), tau);
    }
    // filter: starts at the strike cutoff, settles exponentially to the settled cutoff
    const f = n.filter.frequency, tau = p.filterDecay / 4;
    f.cancelScheduledValues(t);
    f.setValueAtTime(p.cutoff + (p.strikeCutoff - p.cutoff) * Math.exp(-age / tau), t);
    f.setTargetAtTime(p.cutoff, t, tau);
    this.struck = { t0, envs: Object.fromEntries(Object.entries(envs).map(([k, e]) => [k, e.slice(1)])) };
    this.schedulePulseDepth(t);
  }

  /** Pulse depth: 0 at the strike, rising linearly to full over "Strike -> settled";
   *  with "Fade pulses out", falling from pulse 1 (at its brightest) to 0 at the end
   *  of the sweep (where the rate reaches the end rate) along (fraction left)^pulseFadeCurve
   *  (as 32 straight segments), 0 after that. */
  schedulePulseDepth(t) {
    const p = this.p, g = this.nodes.pulseDepth.gain;
    const full = 0.5 * p.pulseAmount * 1200 * Math.log2(p.strikeCutoff / p.cutoff); // (LFO + offset) spans 0..2
    const t0 = this.struck.t0, ramp = Math.max(0.001, p.filterDecay), end = this.holdEnd;
    const fading = p.pulseFadeOut && this.pulse && end > t0;
    const fadeFrom = fading ? Math.min(this.pulse.fadeFrom, end) : Infinity;
    const fadeEnd = fading ? Math.min(end, Math.max(this.pulse.sweepEnd, fadeFrom)) : Infinity;
    const at = (x) => {
      const fin = Math.min(1, Math.max(0, (x - t0) / ramp));
      const fout = x <= fadeFrom ? 1 : Math.pow(Math.max(0, (fadeEnd - x) / Math.max(1e-6, fadeEnd - fadeFrom)), p.pulseFadeCurve);
      return full * fin * fout;
    };
    const pts = [t0 + ramp, fadeFrom, fadeEnd, end];
    if (fading) for (let i = 1; i < 32; i++) pts.push(fadeFrom + ((fadeEnd - fadeFrom) * i) / 32);
    g.cancelScheduledValues(t);
    g.setValueAtTime(at(t), t);
    for (const x of pts.filter((x) => x > t && x < Infinity).sort((m, n) => m - n)) {
      g.linearRampToValueAtTime(at(x), x);
    }
  }

  envNow(k, t) {
    if (!this.struck) return 0;
    const [peak, target, attack, tau] = this.struck.envs[k];
    return envAt(t - this.struck.t0, attack, peak, target, tau);
  }

  /** Hold fade: start level -> floor over `life` s, positioned `age` s in; then the voice ends. */
  setHold(life, age = 0) {
    const c = CONFIG, t = this.ctx.currentTime;
    const peak = dbToAmp(c.fullScaleDb + this.p.level);
    const floor = peak * dbToAmp(c.floorDb - c.levelDb);
    const now = peak * Math.pow(floor / peak, Math.min(1, age / life));
    const remaining = Math.max(c.attack + 0.001, life - age);
    this.end = this.fade.schedule(t, now, floor, remaining, c.attack, c.release);
    this.start = t - age;
    this.life = life;
    this.holdEnd = t + remaining;
    for (const s of this.sources) s.stop(this.end + 0.01); // the shared reverb keeps its own tail
    this.schedulePulse(t);
    if (this.struck) this.schedulePulseDepth(t); // its fade-out depends on the hold and the sweep
  }

  /** Pulse LFO for the current strike and hold (see the Pulse settings). Rebuilt
   *  only when its timing or shape changes, so other live tweaks don't restart it. */
  schedulePulse(t) {
    const p = this.p, ctx = this.ctx, t0 = this.start, end = this.holdEnd;
    const key = [p.pulseShape, p.pulseStartRate, p.pulseEndRate, p.pulseCurve, p.pulseSweepLength, t0.toFixed(4), end.toFixed(4)].join();
    const sweepEnd = t0 + p.pulseSweepLength * (end - t0); // the rate reaches the end rate here
    if (this.pulse && this.pulse.key === key) { this.pulse.osc.stop(this.end + 0.01); this.pulse.off.stop(this.end + 0.01); return; }
    if (this.pulse) { this.pulse.osc.stop(t); this.pulse.off.stop(t); }
    this.pulse = null;
    const pw = pulseWave(ctx, p.pulseShape), { pulseStartRate: r0, pulseEndRate: r1, pulseCurve: k } = p;
    // a sweep whose LFO starts (phase 0) at s: rate at time x, and the time it reaches `cycles` cycles
    // (if pulse 1 comes after sweepEnd, the rate is the end rate from the start)
    const rateAt = (s, x) => r0 * Math.pow(r1 / r0, Math.pow(Math.min(1, Math.max(0, (x - s) / Math.max(1e-6, sweepEnd - s))), k));
    const timeAt = (s, cycles) => {
      const dt = 0.0005;
      let x = s, ph = 0;
      while (x < end) {
        const step = rateAt(s, x + dt / 2) * dt; // midpoint rule
        if (ph + step >= cycles) return x + (dt * (cycles - ph)) / step;
        ph += step; x += dt;
      }
      return Infinity;
    };
    // pulse 1 (brightest at `peak` cycles) must come 2 x (pulse 2 - pulse 1) after the strike:
    // find the LFO start s where (pulse1 - t0) = 2 (pulse2 - pulse1); later s only makes the left side bigger
    const gap = (x) => { const a = timeAt(x, pw.peak), b = timeAt(x, pw.peak + 1); return b === Infinity ? Infinity : (a - t0) - 2 * (b - a); };
    let lo = t0, hi = end;
    if (gap(lo) >= 0) hi = lo;
    else for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (gap(m) < 0) lo = m; else hi = m; }
    const s = hi;
    if (gap(s) === Infinity) return; // too short a note for two pulses after the strike: no pulses
    // joining mid-note (page load, or a settings change): the LFO can't start at a
    // past phase, so it starts at the next whole cycle of the same sweep
    let start = s;
    if (s < t) {
      let x = s, ph = 0;
      for (const dt = 0.0005; x < t; x += dt) ph += rateAt(s, x + dt / 2) * dt;
      start = timeAt(s, Math.ceil(ph));
    }
    if (!(start < end)) return;
    const osc = new OscillatorNode(ctx, { periodicWave: pw.wave, frequency: rateAt(s, start) });
    const off = new ConstantSourceNode(ctx, { offset: pw.offset });
    // rate: along the sweep from `start` to sweepEnd (then held), as exponential
    // segments: 64 points evenly in time plus 64 evenly in rate (equal ratio each).
    // At low curves nearly all the speed-up is right at the start (time-even points
    // alone would blur it); at high curves it's at the end after a long flat
    // stretch (rate-even points alone would bend that stretch)
    const f = osc.frequency, from = Math.max(start, t);
    const pts = [];
    const span = Math.max(1e-6, sweepEnd - s);
    for (let i = 1; i <= 64; i++) pts.push(s + (span * i) / 64, s + span * Math.pow(i / 64, 1 / k)); // 2nd: x^k = i/64
    f.setValueAtTime(rateAt(s, from), from);
    let last = from;
    for (const x of pts.sort((m, n) => m - n)) {
      if (x > last + 1e-6) { f.exponentialRampToValueAtTime(rateAt(s, x), x); last = x; }
    }
    osc.connect(this.nodes.pulseDepth);
    off.connect(this.nodes.pulseDepth);
    osc.start(start); off.start(start);
    osc.stop(this.end + 0.01); off.stop(this.end + 0.01);
    osc.onended = () => { osc.disconnect(); off.disconnect(); };
    const first = timeAt(s, pw.peak); // pulse 1 at its brightest ("Fade pulses out" starts here)
    this.pulse = { key, osc, off, s, first, fadeFrom: first, sweepEnd };
  }

  /** Fade out over `seconds` and end (used when muting). */
  release(seconds = 0.05) {
    const end = this.fade.release(this.ctx.currentTime, seconds);
    for (const s of this.sources) s.stop(end + 0.01);
    if (this.pulse) { this.pulse.osc.stop(end + 0.01); this.pulse.off.stop(end + 0.01); }
  }
}
