#!/usr/bin/env python3
"""Check that the browser's mapping (web/js/mapping.js) matches engine.py.

Compares harmonic, hold time and loudness gain for random amounts plus every
range edge (and one sat either side). Needs node.

  python3 tools/check_mapping.py
"""
import base64
import json
import math
import os
import random
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import engine as e  # noqa: E402

TOP_BCH, STEP, MAX_HOLD, SKEW, F0, PHON = 2100, 1 / 2, 1200, 0.25, 30, 80


def py_values(amounts):
    import argparse
    eng = e.Engine.__new__(e.Engine)
    eng.a = argparse.Namespace(top_bch=TOP_BCH, step=STEP, max_hold=MAX_HOLD, skew=SKEW)
    return [[eng.harmonic(s), eng.hold_time(s) if s > 0 else None] for s in amounts]


def js_values(amounts):
    src = open(os.path.join(ROOT, "web", "js", "mapping.js"), "rb").read()
    url = "data:text/javascript;base64," + base64.b64encode(src).decode()
    script = f"""
const m = await import({json.dumps(url)});
const amounts = {json.dumps(amounts)};
const out = amounts.map(s => [m.harmonicFor(s), s > 0 ? m.holdTime(s) : null]);
const gains = []; for (let h = 1; h <= 40; h++) gains.push(m.loudnessGainDb(h));
console.log(JSON.stringify({{out, gains}}));
"""
    r = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def main():
    top = TOP_BCH * e.SATS_PER_BCH
    amounts = [0, 1, 546, 1000, top, top + 1, top - 1, 21_000_000 * e.SATS_PER_BCH]
    for k in range(1, 45):  # every range edge, and one sat either side
        edge = math.ceil(top / 2 ** k)
        amounts += [edge - 1, edge, edge + 1]
    rng = random.Random(1)
    amounts += [max(1, int(math.exp(rng.uniform(math.log(546), math.log(top * 10))))) for _ in range(5000)]

    py = py_values(amounts)
    js = js_values(amounts)
    bad = 0
    for s, (ph, pt), (jh, jt) in zip(amounts, py, js["out"]):
        if ph != jh or (pt is None) != (jt is None) or (pt is not None and abs(pt - jt) > 1e-9 * max(1, pt)):
            bad += 1
            if bad <= 10:
                print(f"MISMATCH {s} sats: python h{ph} hold {pt}, js h{jh} hold {jt}")
    gbad = 0
    for h, jg in enumerate(js["gains"], start=1):
        pg = min(0.0, e.equal_loudness_spl(h * F0, PHON) - e.equal_loudness_spl(F0, PHON))
        if abs(pg - jg) > 1e-9:
            gbad += 1
            print(f"GAIN MISMATCH h{h}: python {pg}, js {jg}")
    print(f"{len(amounts)} amounts: {bad} harmonic/hold mismatches; h1-h40 loudness: {gbad} mismatches")
    sys.exit(1 if bad or gbad else 0)


if __name__ == "__main__":
    main()
