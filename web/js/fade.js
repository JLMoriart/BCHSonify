// A note's hold fade on a gain AudioParam, with its current value computed
// from our own schedule.
//
// Never schedule from AudioParam.value: after cancelScheduledValues(), Firefox
// reports the param's *default* (gain 1) there, so "cancel, then
// setValueAtTime(param.value)" jumps a note to full scale (measured: 0.89
// peaks from notes meant to peak at 0.01).

export class HoldFade {
  constructor(param) {
    this.param = param;
    this.segs = []; // [t0, v0, t1, v1, kind] with kind "lin" | "exp"; 0 before/after
  }

  valueAt(t) {
    let v = 0;
    for (const [t0, v0, t1, v1, kind] of this.segs) {
      if (t < t0) return v;
      if (t <= t1) {
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
        return kind === "exp" ? v0 * Math.pow(v1 / v0, f) : v0 + (v1 - v0) * f;
      }
      v = v1;
    }
    return v;
  }

  /** From now: ramp to `start` over `attack`, fall (linearly in dB) to `floor`
   *  by `remaining` s from now, then to 0 over `release`. */
  schedule(t, start, floor, remaining, attack, release) {
    const g = this.param, cur = this.valueAt(t), a = t + attack, f = t + remaining, r = f + release;
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.linearRampToValueAtTime(start, a);
    g.exponentialRampToValueAtTime(floor, f);
    g.linearRampToValueAtTime(0, r);
    this.segs = [[t, cur, a, start, "lin"], [a, start, f, floor, "exp"], [f, floor, r, 0, "lin"]];
    return r;
  }

  /** From now: to 0 over `seconds`. */
  release(t, seconds) {
    const g = this.param, cur = this.valueAt(t);
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.linearRampToValueAtTime(0, t + seconds);
    this.segs = [[t, cur, t + seconds, 0, "lin"]];
    return t + seconds;
  }
}
