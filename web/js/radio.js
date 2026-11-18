// BCH Radio: instead of the sonification, songs on repeat (radio/radio.json, built by tools/make_radio.py),
// with their lyrics shown a line at a time in the sky (the visualizer draws lyric()). It plays through the
// sonification's audio context, so the Volume slider sets its level too.

const FADE = 0.6;                    // s: the music fading in and out as the radio is turned on and off
const LINE_IN = 0.35, LINE_OUT = 0.6; // s: a lyric line fading in as it's sung, and out at its end
const LINE_MAX = 7;                  // s: a line stays up at most this long, if nothing ends it sooner
const TITLE_AT = 0.8, TITLE_FOR = 5; // s: the song's title shows this far in, this long (before the first line)

export class Radio {
  // songs: radio.json's list; ctx, out: the audio context, and the node to play into (the master volume)
  constructor(songs, ctx, out) {
    this.songs = songs;
    this.ctx = ctx;
    this.on = false;
    this.live = false;
    this.at = Math.floor(Math.random() * songs.length); // a random song first, then the rest in order, round
    this.audio = new Audio();
    this.audio.preload = "none";
    this.gain = new GainNode(ctx, { gain: 0 });
    new MediaElementAudioSourceNode(ctx, { mediaElement: this.audio }).connect(this.gain).connect(out);
    this.audio.onended = () => { this.at = (this.at + 1) % this.songs.length; this.load(); this.play(); };
    this.onsong = null; // hook: the song changed (the studio's timing tool)
    this.load();
  }
  get song() { return this.songs[this.at]; }
  load() {
    this.audio.src = `radio/${this.song.file}`;
    if (this.onsong) this.onsong(this.at);
  }
  // pick song k (and, if given, a time in it)
  choose(k, t) {
    if (k !== this.at) { this.at = k; this.load(); }
    if (t == null) return;
    if (this.audio.readyState >= 1) this.audio.currentTime = t;
    else { this.audio.preload = "auto"; this.audio.addEventListener("loadedmetadata", () => { this.audio.currentTime = t; }, { once: true }); this.audio.load(); }
  }
  play() { return this.audio.play().catch(() => {}); }
  // start or stop the music, with a short fade (stopping keeps its place). live: started and not stopped since
  start() {
    this.live = true;
    clearTimeout(this.pausing);
    this.fadeTo(1, FADE);
    return this.play();
  }
  stop() {
    this.live = false;
    this.fadeTo(0, FADE / 3);
    clearTimeout(this.pausing);
    this.pausing = setTimeout(() => this.audio.pause(), (FADE / 3) * 1000 + 50);
  }
  fadeTo(v, s) {
    const g = this.gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + s);
  }

  // What to show in the sky now: { text, a } (a: 0..1, how visible), or null. The line being sung, from its
  // time to its end (the next line's time, or its own end, set where the singing stops), fading in and out;
  // before the first line, the song's title.
  lyric() {
    if (!this.on || this.audio.paused) return null;
    const lines = this.song.lines, now = this.audio.currentTime;
    let i = -1;
    for (let k = 0; k < lines.length; k++) if (lines[k].t != null && lines[k].t - LINE_IN / 2 <= now) i = k;
    if (i < 0) { // the title, until the singing starts
      const first = lines.find((l) => l.t != null), until = Math.min(TITLE_AT + TITLE_FOR, first ? first.t - 0.5 : Infinity);
      return fade(`♪ ${this.song.title}`, now, TITLE_AT, until);
    }
    const l = lines[i], next = lines.slice(i + 1).find((n) => n.t != null);
    const end = Math.min(l.end ?? Infinity, next ? next.t - LINE_IN / 2 : Infinity, l.t + LINE_MAX);
    return fade(l.text, now, l.t - LINE_IN / 2, end);
  }
}
const fade = (text, now, from, to) => {
  const a = Math.min(1, (now - from) / LINE_IN, (to - now) / LINE_OUT);
  return a > 0 ? { text, a } : null;
};

// radio/radio.json's songs, or [] if there are none
export async function radioSongs() {
  try {
    const r = await fetch("radio/radio.json", { cache: "no-cache" });
    return r.ok ? (await r.json()).songs || [] : [];
  } catch { return []; }
}
