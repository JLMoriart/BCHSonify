#!/usr/bin/env python3
"""Trigger only the block note, exactly as the engine does on a new block.

Starts the block synth with the engine's defaults, calls Engine.on_block(), and
runs the engine's fade for --seconds (the note's level falls from --level-db
toward -48 dB over --block-hold, so over a short test it stays near its start).

  python3 tools/test_block.py                  # 15 s of the block note
  python3 tools/test_block.py --seconds 30 --level-db 0
  python3 tools/test_block.py --repeat 5       # re-trigger every 5 s, like a block arriving
  PIPEWIRE_NODE=<sink> python3 tools/test_block.py   # send somewhere else

Any engine.py option (--f0, --level-db, --block-hold, --block-patch, ...) works.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import engine as e  # noqa: E402


def main():
    p = e.make_parser()
    p.add_argument("--seconds", type=float, default=15, help="how long to listen")
    p.add_argument("--repeat", type=float, default=0, help="re-trigger the block every N seconds (0 = once)")
    a = p.parse_args()

    block = e.SurgeInstance("block", a.block_patch, 53282, a.audio_if, e.write_tuning(a.f0), a.dry_run)
    eng = e.Engine(a, None, block)
    eng.start_synths()
    try:
        start = now = time.monotonic()
        next_block, n = start, 0
        while now - start < a.seconds:
            if now >= next_block:
                n += 1
                eng.on_block({"hash": f"{n:064x}"}, now)
                next_block = now + a.repeat if a.repeat else float("inf")
            eng.fade(now)
            time.sleep(0.05)
            now = time.monotonic()
    except KeyboardInterrupt:
        pass
    finally:
        block.stop()


if __name__ == "__main__":
    main()
