#!/usr/bin/env python3
"""Make the donation QR codes from web/donate.json's address: web/donate/any.svg (no amount: the donor's
wallet asks), and one per firework, web/donate/<sats>.svg, for 0.001 BCH and each doubling up to 0.128 BCH.
Run again whenever the address changes. Needs python3-qrcode.

  python3 tools/make_donate_qr.py
"""
import json
import os

import qrcode
import qrcode.image.svg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIRST, ANIMALS = 100000, 8  # sats for the first firework animal; how many animals (one per doubling)


def main():
    addr = json.load(open(os.path.join(ROOT, "web", "donate.json")))["address"].strip()
    if not addr:
        raise SystemExit("web/donate.json has no address yet")
    if not addr.startswith("bitcoincash:"):
        addr = "bitcoincash:" + addr
    out = os.path.join(ROOT, "web", "donate")
    os.makedirs(out, exist_ok=True)
    for name in os.listdir(out):
        if name.endswith(".svg"):
            os.remove(os.path.join(out, name))
    targets = [("any", addr)] + [(str(FIRST << k), f"{addr}?amount={(FIRST << k) / 1e8:.8f}".rstrip("0")) for k in range(ANIMALS)]
    for name, uri in targets:
        img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, border=2,
                          error_correction=qrcode.constants.ERROR_CORRECT_M)
        img.save(os.path.join(out, f"{name}.svg"))
        print(f"web/donate/{name}.svg  {uri}")


if __name__ == "__main__":
    main()
