// BCH Radio: instead of the sonification, songs on repeat (radio/radio.json, built by tools/make_radio.py),
// with their lyrics shown a line at a time in the sky (the visualizer draws lyric()). It plays through the
// sonification's audio context, so the Volume slider sets its level too.
//
// Everyone hears the same thing: the playlist has been playing on repeat, in order, since EPOCH, so the time
// (the server's, from the relay, when there is one) says which song is on and how far in. Turning the radio on
// (or unmuting) joins it there, and it keeps there: a song ends into the one now on, and a stall that leaves it
// behind (a slow connection) is caught up. Needs every song's length ("seconds"); the studio's timing tool
// turns this off (synced = false), to play any song from anywhere.

const FADE = 0.6;                    // s: the music fading in and out as the radio is turned on and off
const LINE_IN = 0.35, LINE_OUT = 0.6; // s: a lyric line fading in as it's sung, and out at its end
const LINE_MAX = 7;                  // s: a line stays up at most this long, if nothing ends it sooner
const TITLE_AT = 0.8, TITLE_FOR = 5; // s: the song's title shows this far in, this long (before the first line)
const EPOCH = Date.UTC(2026, 10, 1) / 1000; // s: when the radio's playlist started (on repeat ever since)
const DRIFT = 1.5;                   // s: further than this from where everyone is, and it jumps back there
const CHECK = 5;                     // s: how often, while playing, it checks

export class Radio {
  // songs: radio.json's list; ctx, out: the audio context, and the node to play into (the master volume);
  // clock: the time now, in s (the server's, if known)
  constructor(songs, ctx, out, clock = () => Date.now() / 1000) {
    this.songs = songs;
    this.ctx = ctx;
    this.clock = clock;
    this.on = false;
    this.live = false;
    this.synced = songs.every((s) => s.seconds > 0); // playing where everyone is (see the top)
    this.at = this.synced ? this.where().k : Math.floor(Math.random() * songs.length); // (unsynced: a random song first, then the rest in order, round)
    this.joining = null; // a join waiting for its song's length to load
    this.audio = new Audio();
    this.audio.preload = "none";
    this.gain = new GainNode(ctx, { gain: 0 });
    new MediaElementAudioSourceNode(ctx, { mediaElement: this.audio }).connect(this.gain).connect(out);
    this.audio.onended = () => {
      if (this.synced) { this.join(); return; } // (the next song, from its start, as for everyone)
      this.at = (this.at + 1) % this.songs.length; this.load(); this.play();
    };
    let checked = 0;
    this.audio.addEventListener("timeupdate", () => { // still where everyone is?
      if (!this.synced || !this.live || this.joining || this.audio.seeking) return;
      const now = performance.now() / 1000;
      if (now - checked < CHECK) return;
      checked = now;
      const w = this.where();
      if (w.k !== this.at || Math.abs(this.audio.currentTime - w.t) > DRIFT) this.join();
    });
    this.onsong = null; // hook: the song changed (the studio's timing tool)
    this.load();
  }
  get song() { return this.songs[this.at]; }
  // where everyone is now: song k, t s in
  where(now = this.clock()) {
    const total = this.songs.reduce((s, x) => s + x.seconds, 0);
    let t = (((now - EPOCH) % total) + total) % total, k = 0;
    while (k < this.songs.length - 1 && t >= this.songs[k].seconds) t -= this.songs[k++].seconds;
    return { k, t };
  }
  // go to where everyone is, and play from there (once the song's loaded enough to jump into)
  join() {
    const w = this.where();
    if (w.k !== this.at) { this.at = w.k; this.load(); }
    if (this.audio.readyState >= 1) { this.joining = null; this.audio.currentTime = w.t; return this.play(); }
    const token = (this.joining = {});
    return new Promise((done) => {
      this.audio.addEventListener("loadedmetadata", () => {
        if (this.joining !== token) return done();
        this.joining = null;
        if (!this.live) return done();
        done(this.join()); // (the time again: loading took a while)
      }, { once: true });
      this.audio.preload = "metadata";
      this.audio.load();
    });
  }
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
  // start or stop the music, with a short fade. live: started and not stopped since. Starting joins everyone
  // (synced); otherwise it carries on from where it stopped
  start() {
    this.live = true;
    clearTimeout(this.pausing);
    this.fadeTo(1, FADE);
    return this.synced ? this.join() : this.play();
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
