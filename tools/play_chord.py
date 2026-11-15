#!/usr/bin/env python3
"""Audition a held chord on the pad synth, using the engine's own levels.

Holds harmonics LO..HI at once (default: every harmonic real outputs can reach,
1 = block note, 2 = 2,100+ BCH, up to the dust limit), all at the same level
(with the engine's equal-loudness velocities), then fades out.

  python3 tools/play_chord.py                 # all of them, through the default output
  python3 tools/play_chord.py --lo 20 --hi 40
  PIPEWIRE_NODE=<sink> python3 tools/play_chord.py   # send somewhere else
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import engine as e  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--lo", type=int, default=1)
    p.add_argument("--hi", type=int, default=e.harmonic_for(546) + e.FIRST_HARMONIC - 1)  # dust limit
    p.add_argument("--seconds", type=float, default=10)
    p.add_argument("--f0", type=float, default=40.0)
    p.add_argument("--patch", default="Init Sine AT Fade")
    p.add_argument("--level-db", type=float, default=-6.0, help="every note's level, dB (0 = full poly AT)")
    p.add_argument("--phon", type=float, default=80, help="equal-loudness contour, as in engine.py")
    p.add_argument("--stagger", type=float, default=0.0, help="seconds between note entrances")
    a = p.parse_args()

    pad = e.SurgeInstance("audition", a.patch, 53480, "0.0", e.write_tuning(a.f0))
    pad.start()
    pad.wait_ready()
    pad.load_tuning()
    notes = list(range(a.lo, a.hi + 1))
    peak = 127 * (1 + a.level_db / 48)  # poly AT 0..127 = -48..0 dB in the pad patch
    print(f"holding harmonics {a.lo}-{a.hi} ({len(notes)} notes, {a.f0 * a.lo:g}-{a.f0 * a.hi:g} Hz)")
    try:
        for h in notes:
            pad.note_on(h, e.loudness_velocity(h, a.f0, a.phon))
            pad.poly_at(h, peak)
            if a.stagger:
                time.sleep(a.stagger)
        time.sleep(a.seconds)
        for step in range(40):  # 2 s fade
            for h in notes:
                pad.poly_at(h, peak * (1 - step / 39))
            time.sleep(0.05)
    finally:
        pad.stop()


if __name__ == "__main__":
    main()
