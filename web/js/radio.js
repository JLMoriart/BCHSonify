// BCH Radio: instead of the sonification, songs on repeat (radio/radio.json, built by tools/make_radio.py),
// with their lyrics shown a line at a time in the sky (the visualizer draws lyric()). It plays through the
// sonification's audio context, so the Volume slider sets its level too.
//
// Everyone hears the same thing: the playlist has been playing on repeat, in order, with GAP s of silence
// after each song, since EPOCH, so the time (the server's, from the relay, when there is one) says which song
// is on and how far in: where(), the one place that decides what's on when. Turning the radio on (or
// unmuting) joins it there. After that each song ends into GAP s of silence and the next from its start, so
// a listener a little behind (a slow connection's stall) stays that little behind; one more than DRIFT s
// from everyone (lag(), measured in time, across songs) jumps back to where everyone is. Needs every song's
// length ("seconds"); the studio's timing tool turns this off (synced = false), to play any song from anywhere.

const FADE = 0.6;                    // s: the music fading in (once it's playing) and out (turned off)
const LINE_IN = 0.35, LINE_OUT = 0.6; // s: a lyric line fading in as it's sung, and out at its end
const LINE_MAX = 7;                  // s: a line stays up at most this long, if nothing ends it sooner
const TITLE_AT = 0.8, TITLE_FOR = 5; // s: the song's title shows this far in, this long (before the first line)
const EPOCH = Date.UTC(2026, 10, 1) / 1000; // s: when the radio's playlist started (on repeat ever since)
const GAP = 1;                       // s: silence between songs
const DRIFT = 15;                    // s: further than this from where everyone is, and it jumps back there
const CHECK = 5;                     // s: how often, while playing, it checks
const AHEAD = 20;                    // s: this long before a song ends, the next one starts loading (synced)

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
    this.gain = new GainNode(ctx, { gain: 0 });
    this.gain.connect(out);
    // two players: the song on now (this.audio), and, synced, the next song loading in the other one (AHEAD s
    // before this one ends), so it starts at once when this one ends, even on a slow connection. (Unsynced, in
    // the studio, one player: its timing tool shows that one on the page.)
    this.players = (this.synced ? [0, 1] : [0]).map(() => {
      const a = new Audio();
      a.preload = "none";
      new MediaElementAudioSourceNode(ctx, { mediaElement: a }).connect(this.gain);
      a.addEventListener("ended", () => { if (a === this.audio) this.next(); });
      // the music fades in when it's really playing: after it's loaded, or caught up after a stall (on a slow
      // connection that can be a second or more after the button), not when it's asked to play
      a.addEventListener("waiting", () => { if (a === this.audio && this.live) this.hush(); });
      a.addEventListener("playing", () => { if (a === this.audio && this.live) this.fadeTo(1, FADE); });
      a.addEventListener("timeupdate", () => { if (a === this.audio) this.tick(); });
      return a;
    });
    this.audio = this.players[0];
    this.ahead = null; // the song loading in the other player (its index), if any
    this.checked = 0;
    this.onsong = null; // hook: the song changed (the studio's timing tool)
    this.load();
  }
  get song() { return this.songs[this.at]; }
  // on and making sound (or in the moment of silence between songs)
  get sounding() { return this.live && (!this.audio.paused || performance.now() < (this.silentUntil || 0)); }
  get spare() { return this.players.find((a) => a !== this.audio); }
  // the song after this one: (synced) the one on when this one ends
  following() {
    const a = this.audio, left = a.duration - a.currentTime;
    return this.synced && left >= 0 ? this.where(this.clock() + left + 0.5).k : (this.at + 1) % this.songs.length;
  }
  // while playing: the next song loading near this one's end, and (synced) still where everyone is?
  tick() {
    const a = this.audio;
    if (!this.live) return;
    if (this.spare && a.duration - a.currentTime < AHEAD) {
      const n = this.following();
      if (n !== this.at && this.ahead !== n) {
        this.ahead = n;
        const s = this.spare;
        s.src = `radio/${this.songs[n].file}`; s.preload = "auto"; s.load();
      }
    }
    if (!this.synced || this.joining || a.seeking || a.paused) return;
    const now = performance.now() / 1000;
    if (now - this.checked < CHECK) return;
    this.checked = now;
    if (Math.abs(this.lag()) > DRIFT) this.join();
  }
  // a song ended: GAP s of silence, then the next from its start (or, more than DRIFT s from everyone, a
  // jump back to where everyone is)
  next() {
    if (this.synced && Math.abs(this.lag()) > DRIFT) return this.join();
    this.cue((this.at + 1) % this.songs.length);
    const a = this.audio;
    if (a.readyState >= 1 && a.currentTime > 0.25) a.currentTime = 0;
    return this.after(GAP);
  }
  // play this.audio s seconds from now (unless the radio's turned off, or another song cued, meanwhile)
  after(s) {
    const a = this.audio;
    clearTimeout(this.starting);
    this.silentUntil = performance.now() + s * 1000;
    return new Promise((done) => {
      this.starting = setTimeout(() => done(this.live && this.audio === a ? this.play() : undefined), s * 1000);
    });
  }
  // make song k the one on: the other player, if that's where it's been loading, else loaded here
  cue(k) {
    if (k === this.at) return;
    const old = this.audio, ready = this.ahead === k;
    this.at = k;
    this.ahead = null;
    if (!ready) return this.load();
    this.audio = this.spare;
    old.pause();
    if (this.onsong) this.onsong(k);
  }
  // the playlist's timeline: one round of it (each song and the silence after it), where song k starts in
  // it, and where everyone is in it now
  cycle() { return this.songs.reduce((s, x) => s + x.seconds + GAP, 0); }
  startOf(k) { let s = 0; for (let i = 0; i < k; i++) s += this.songs[i].seconds + GAP; return s; }
  pos(now = this.clock()) { const T = this.cycle(); return (((now - EPOCH) % T) + T) % T; }
  // where everyone is now: song k, t s in (t < 0: in the silence before it, which ends in -t s)
  where(now = this.clock()) {
    let t = this.pos(now);
    for (let k = 0; k < this.songs.length; k++) {
      const s = this.songs[k].seconds;
      if (t < s) return { k, t };
      if (t < s + GAP) return { k: (k + 1) % this.songs.length, t: t - s - GAP };
      t -= s + GAP;
    }
    return { k: 0, t: 0 };
  }
  // how far this listener is behind everyone, in s (ahead: negative), across songs
  lag() {
    const T = this.cycle(), d = this.pos() - (this.startOf(this.at) + this.audio.currentTime);
    return (((d % T) + T + T / 2) % T) - T / 2;
  }
  // go to where everyone is, and play from there (once the song's loaded enough to jump into)
  join(w = this.where()) {
    this.cue(w.k);
    const a = this.audio;
    clearTimeout(this.starting);
    if (a.readyState >= 1) { // (not a jump of a moment: a song just begun, already there, plays straight on)
      this.joining = null;
      const t = Math.max(0, w.t);
      if (Math.abs(a.currentTime - t) > 0.25) a.currentTime = t;
      return w.t < 0 ? this.after(-w.t) : this.play(); // (in the silence between songs: the next when it ends)
    }
    const token = (this.joining = {});
    return new Promise((done) => {
      a.addEventListener("loadedmetadata", () => {
        if (this.joining !== token) return done();
        this.joining = null;
        if (!this.live) return done();
        done(this.join()); // (the time again: loading took a while)
      }, { once: true });
      a.preload = "metadata";
      a.load();
    });
  }
  load() {
    this.audio.src = `radio/${this.song.file}`;
    if (this.onsong) this.onsong(this.at);
  }
  // pick song k (and, if given, a time in it)
  choose(k, t) {
    this.cue(k);
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
    if (this.audio.paused) this.hush(); // (it fades in once it's playing: the "playing" listener)
    else this.fadeTo(1, FADE);          // (still playing: turned back on during the fade out)
    return this.synced ? this.join() : this.play();
  }
  stop() {
    this.live = false;
    clearTimeout(this.starting);
    this.fadeTo(0, FADE / 3);
    clearTimeout(this.pausing);
    this.pausing = setTimeout(() => this.audio.pause(), (FADE / 3) * 1000 + 50);
  }
  hush() { this.fadeTo(0, 0.01); }
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
