// The browser sonifier: turns tx/block events into held notes on Web Audio.
//
// All timing runs on the audio thread: each note's whole fade is scheduled
// once when it's triggered (a fade that's linear in dB is an exponential gain
// ramp), so no JavaScript runs per audio frame. Per held note: one oscillator
// and one gain node per decay group (one, unless chime partials have their own
// decays; see SineVoice).
//
// The event log (last CONFIG.maxHold s, from the relay's hello + live events)
// is the source of truth. Starting audio -- on arrival, on first interaction,
// or on unmute -- rebuilds every still-sounding note at its current point in
// its fade, under a master fade-in.

import { CONFIG, blockHold, dbToAmp, harmonicFor, holdTime, loudnessGainDb, partialHarmonics } from "./mapping.js";
import { BlockVoice, BLOCK_DEFAULTS } from "./blocksound.js";
import { Space } from "./space.js";
import { Waves } from "./waves.js";
import { HoldFade } from "./fade.js";

export const FADE_IN = 2.0; // s, master fade-in whenever audio starts

export const PARTIAL_KEYS = ["partial2", "partial3", "partial4", "partial5", "partial6"];
export const PARTIAL_DECAY_KEYS = PARTIAL_KEYS.map((k) => k + "Decay");
const MOVEMENT_KEYS = ["driftDepth", "driftRate", "noteVibratoDepth", "noteVibratoRate"];
const waveCache = new WeakMap();
const driftCache = new WeakMap();

/** 64 s of smooth random wander in [-1, 1]: a new random point every second,
 *  cosine-interpolated. Played (looped) at playbackRate = drift speed. Low
 *  sample rate keeps it small; it only drives detune. */
function driftBuffer(ctx) {
  let b = driftCache.get(ctx);
  if (!b) {
    const sr = 3000, secs = 64, pts = Array.from({ length: secs }, () => Math.random() * 2 - 1);
    b = ctx.createBuffer(1, sr * secs, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const x = i / sr, k = Math.floor(x), f = (1 - Math.cos(Math.PI * (x - k))) / 2;
      d[i] = pts[k] * (1 - f) + pts[(k + 1) % secs] * f;
    }
    driftCache.set(ctx, b);
  }
  return b;
}

/** A note's components grouped by decay: [{ factor, wave }]. Components that
 *  fade over the same fraction of the hold share one periodic wave (one
 *  oscillator at f0 whose harmonics are the components; the browser drops
 *  anything above Nyquist). Amplitudes are relative to the note's own pitch (1),
 *  each partial with the equal-loudness gain of its own pitch. */
function noteGroups(ctx, h, p) {
  const levels = PARTIAL_KEYS.map((k) => p[k]);
  const decays = PARTIAL_DECAY_KEYS.map((k) => Math.min(1, p[k]));
  const key = `${h}|${levels.join(",")}|${decays.join(",")}`;
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  if (!m.has(key)) {
    const parts = partialHarmonics(h), size = Math.max(h, ...parts) + 1;
    const byFactor = new Map([[1, new Float32Array(size)]]);
    byFactor.get(1)[h] = 1;
    parts.forEach((n, i) => {
      if (levels[i] <= -59.5) return;
      if (!byFactor.has(decays[i])) byFactor.set(decays[i], new Float32Array(size));
      byFactor.get(decays[i])[n] += dbToAmp(levels[i] + loudnessGainDb(n) - loudnessGainDb(h));
    });
    m.set(key, [...byFactor].map(([factor, imag]) => ({
      factor,
      wave: new PeriodicWave(ctx, { real: new Float32Array(size), imag, disableNormalization: true }),
    })));
  }
  return m.get(key);
}

/** A transaction note: its pitch plus chime partials. Each decay group is an
 *  oscillator + gain that fades over (hold x its factor), created when the note
 *  (re-)sounds and stopped when its own fade ends, so a fast-decaying partial
 *  costs nothing once it's gone. With every decay at 1: one oscillator. */
class SineVoice {
  constructor(ctx, out, h, p) {
    const c = CONFIG;
    this.ctx = ctx;
    this.out = out;
    this.h = h;
    this.peak = dbToAmp(c.fullScaleDb + c.levelDb + loudnessGainDb(h));
    this.floor = this.peak * dbToAmp(c.floorDb - c.levelDb);
    this.groups = noteGroups(ctx, h, p).map((g) => ({ ...g, osc: null }));
    this.onended = null;
    this.mods = null;
    this.p = p;
  }

  /** Pitch movement (drift + vibrato), shared by the note's groups; created
   *  while the note sounds. Each note gets its own random drift position and
   *  speed (x0.8-1.25) and vibrato rate (x0.85-1.15), so notes move independently. */
  startMods() {
    const ctx = this.ctx, p = this.p, m = (this.mods = {});
    this.driftScale = 0.8 + Math.random() * 0.45;
    this.vibScale = 0.85 + Math.random() * 0.3;
    m.drift = new AudioBufferSourceNode(ctx, { buffer: driftBuffer(ctx), loop: true, playbackRate: p.driftRate * this.driftScale });
    m.driftDepth = new GainNode(ctx, { gain: p.driftDepth });
    m.vib = new OscillatorNode(ctx, { frequency: p.noteVibratoRate * this.vibScale });
    m.vibDepth = new GainNode(ctx, { gain: p.noteVibratoDepth });
    m.out = new GainNode(ctx); // sum of both, in cents
    m.drift.connect(m.driftDepth).connect(m.out);
    m.vib.connect(m.vibDepth).connect(m.out);
    m.drift.start(0, Math.random() * 64);
    m.vib.start();
  }

  stopMods() {
    if (!this.mods) return;
    const m = this.mods;
    this.mods = null;
    m.drift.stop(); m.vib.stop();
    for (const n of Object.values(m)) n.disconnect();
  }

  setMovement(p) {
    this.p = p;
    if (!this.mods) return;
    const t = this.ctx.currentTime, m = this.mods;
    m.drift.playbackRate.setValueAtTime(p.driftRate * this.driftScale, t);
    m.driftDepth.gain.setValueAtTime(p.driftDepth, t);
    m.vib.frequency.setValueAtTime(p.noteVibratoRate * this.vibScale, t);
    m.vibDepth.gain.setValueAtTime(p.noteVibratoDepth, t);
  }

  startGroup(g) { // initial values via constructors; levels never read back (see fade.js)
    g.osc = new OscillatorNode(this.ctx, { frequency: CONFIG.f0, periodicWave: g.wave });
    g.gain = new GainNode(this.ctx, { gain: 0 });
    g.fade = new HoldFade(g.gain.gain);
    g.osc.connect(g.gain).connect(this.out);
    // pitch movement only when there is some: connected, it re-pitches the oscillator every sample (much of
    // the sound's CPU), even at depth 0. (A note started with none stays still if movement is turned up.)
    if (this.p.driftDepth > 0 || this.p.noteVibratoDepth > 0) {
      if (!this.mods) this.startMods();
      this.mods.out.connect(g.osc.detune);
    }
    g.osc.start();
    const osc = g.osc;
    osc.onended = () => {
      g.gain.disconnect();
      if (g.osc === osc) g.osc = null;
      if (this.groups.every((x) => !x.osc)) this.ended();
    };
  }

  /** (Re-)sound: every component back to the start level, each fade restarted,
   *  as if triggered `age` s ago. */
  trigger(life, age = 0) {
    const c = CONFIG, t = this.ctx.currentTime;
    this.life = life;
    this.t0 = t - age;
    for (const g of this.groups) {
      const glife = life * g.factor;
      if (age >= glife) continue; // this group has already faded out
      if (!g.osc) this.startGroup(g);
      const level = this.peak * Math.pow(this.floor / this.peak, age / glife);
      g.end = g.fade.schedule(t, level, this.floor, Math.max(c.attack + 0.001, glife - age), c.attack, c.release);
      g.osc.stop(g.end + 0.01);
    }
    if (this.groups.every((g) => !g.osc)) this.ended();
  }

  ended() {
    this.stopMods();
    if (this.onended) this.onended();
  }

  /** Partial levels or decays changed (workbench): rebuild the groups at the
   *  note's current point (a 20 ms crossfade). */
  setPartials(p) {
    this.p = p;
    const old = this.groups;
    this.groups = noteGroups(this.ctx, this.h, p).map((g) => ({ ...g, osc: null }));
    for (const g of old) if (g.osc) g.osc.stop(g.fade.release(this.ctx.currentTime, 0.02) + 0.01);
    if (this.life) this.trigger(this.life, this.ctx.currentTime - this.t0);
  }

  release(seconds = 0.05) {
    for (const g of this.groups) if (g.osc) g.osc.stop(g.fade.release(this.ctx.currentTime, seconds) + 0.01);
  }
}

export class Sonifier {
  constructor() {
    this.log = [];            // events, oldest first
    this.keys = new Set();    // event keys already logged (reconnects resend history)
    this.offset = 0;          // server clock - local clock, s
    this.ctx = null;
    this.master = null;
    this.volume = null;       // master volume (listener setting), after everything else
    this.volumeDb = 0;
    this.voices = new Map();  // harmonic -> SineVoice | BlockVoice
    this.playing = false;
    this.blockParams = { ...BLOCK_DEFAULTS };
    this.onchange = null;     // UI hook: called when held notes change
  }

  /** Master volume in dB (0 = as designed). Smoothed over ~30 ms. */
  setVolume(db) {
    this.volumeDb = db;
    if (this.volume) this.volume.gain.setTargetAtTime(dbToAmp(db), this.ctx.currentTime, 0.01);
  }

  serverNow() { return Date.now() / 1000 + this.offset; }

  // ---- events ----
  hello(msg) {
    this.offset = msg.now - Date.now() / 1000;
    for (const ev of msg.events) this.event(ev);
  }

  event(ev) {
    const key = ev.type === "tx" ? ev.txid : `${ev.type}:${ev.hash}:${ev.t}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.log.push(ev);
    this.prune();
    if (this.playing) this.apply(ev, Math.max(0, this.serverNow() - ev.t));
  }

  prune() {
    const cutoff = this.serverNow() - Math.max(CONFIG.maxHold, CONFIG.blockTarget, CONFIG.blockHoldUnknown);
    while (this.log.length && this.log[0].t < cutoff) {
      const ev = this.log.shift();
      this.keys.delete(ev.type === "tx" ? ev.txid : `${ev.type}:${ev.hash}:${ev.t}`);
    }
  }

  /** Sound one event that happened `age` s ago. */
  apply(ev, age) {
    if (ev.type === "block") {
      this.trigger(CONFIG.blockHarmonic, blockHold(ev), age, true);
    } else if (ev.type === "tx") {
      for (const sats of ev.outputs) {
        const h = harmonicFor(sats);
        if (h) this.trigger(h, holdTime(sats), age, false);
      }
    }
  }

  trigger(h, life, age, isBlock) {
    if (age >= life) return;
    let v = this.voices.get(h);
    if (!v) {
      v = isBlock ? new BlockVoice(this.ctx, { out: this.master, reverb: this.space.reverbIn, echo: this.space.echoIn },
                                   h * CONFIG.f0, this.blockParams)
                  : new SineVoice(this.ctx, this.sines, h, this.blockParams);
      v.onended = () => { if (this.voices.get(h) === v) { this.voices.delete(h); this.changed(); } };
      this.voices.set(h, v);
    }
    if (isBlock) {
      v.strike(age);
      v.setHold(life, age);
    } else {
      v.trigger(life, age);
    }
    this.changed();
  }

  changed() { if (this.onchange) this.onchange(); }

  // ---- audio ----
  /** Create the AudioContext (suspended until the browser allows sound). */
  context() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: "playback" }); // bigger buffers: less CPU, latency doesn't matter here
      this.volume = new GainNode(this.ctx, { gain: dbToAmp(this.volumeDb) });
      this.volume.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Start sound (context must be running): rebuild current notes, fade in. */
  start() {
    if (this.playing) return;
    const ctx = this.context(), t = ctx.currentTime;
    // master (fade-in, mute) <- block voice, sine bus, shared space (reverb + echo)
    // sine bus -> master, and -> harmonics sends -> space
    const p = this.blockParams;
    this.master = new GainNode(ctx, { gain: 0 });
    this.masterFade = new HoldFade(this.master.gain);
    this.masterFade.segs = [[t, 0, t + FADE_IN, 1, "lin"]];
    this.master.gain.setValueAtTime(0, t);
    this.master.gain.linearRampToValueAtTime(1, t + FADE_IN);
    this.master.connect(this.volume);
    this.space = new Space(ctx, this.master, p);
    this.sines = new GainNode(ctx);
    this.sines.connect(this.master);
    this.sineSend = new GainNode(ctx, { gain: p.harmonicsSend });
    this.sines.connect(this.sineSend).connect(this.space.reverbIn);
    this.sineEcho = new GainNode(ctx, { gain: p.harmonicsEchoSend });
    this.sines.connect(this.sineEcho).connect(this.space.echoIn);
    try { // the waves are an extra layer: a failure there must not silence the notes
      this.waves = new Waves(ctx, this.master, this.space.reverbIn, p);
    } catch (e) {
      console.error("waves failed to start:", e);
      this.waves = null;
    }
    this.playing = true;
    // latest trigger per harmonic decides what's sounding now
    const now = this.serverNow(), latest = new Map();
    for (const ev of this.log) {
      if (ev.type === "block") latest.set(CONFIG.blockHarmonic, { t: ev.t, life: blockHold(ev), block: true });
      else for (const sats of ev.outputs) {
        const h = harmonicFor(sats);
        if (h) latest.set(h, { t: ev.t, life: holdTime(sats), block: false });
      }
    }
    for (const [h, s] of latest) this.trigger(h, s.life, now - s.t, s.block);
  }

  /** Stop sound (mute): quick fade, drop every voice. Events keep being logged. */
  stop() {
    if (!this.playing) return;
    this.playing = false;
    for (const v of this.voices.values()) { v.onended = null; v.release(0.05); }
    this.voices.clear();
    this.masterFade.release(this.ctx.currentTime, 0.05); // also cuts the reverb/echo tails smoothly
    const waves = this.waves;
    if (waves) setTimeout(() => waves.stop(), 100);
    const nodes = [this.master, this.sines, this.sineSend, this.sineEcho], space = this.space;
    setTimeout(() => { nodes.forEach((n) => n.disconnect()); space.disconnect(); }, 200);
    this.master = this.space = this.sines = this.sineSend = this.sineEcho = this.waves = null;
    this.changed();
  }

  /** Block voice + shared reverb parameters (workbench). Apply live. */
  setBlockParams(params) {
    const prev = this.blockParams;
    const p = (this.blockParams = { ...this.blockParams, ...params });
    if ([...PARTIAL_KEYS, ...PARTIAL_DECAY_KEYS].some((k) => p[k] !== prev[k])) {
      for (const v of this.voices.values()) if (v.setPartials) v.setPartials(p);
    }
    if (MOVEMENT_KEYS.some((k) => p[k] !== prev[k])) {
      for (const v of this.voices.values()) if (v.setMovement) v.setMovement(p);
    }
    const v = this.voices.get(CONFIG.blockHarmonic);
    if (v && v.update) v.update(p);
    if (!this.playing) return;
    const t = this.ctx.currentTime;
    this.sineSend.gain.setValueAtTime(p.harmonicsSend, t);
    this.sineEcho.gain.setValueAtTime(p.harmonicsEchoSend, t);
    this.space.update(p);
    if (this.waves) this.waves.update(p);
  }

  heldNotes() { return [...this.voices.keys()].sort((a, b) => a - b); }
}
