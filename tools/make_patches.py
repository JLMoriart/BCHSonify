#!/usr/bin/env python3
"""Derive project patches from Surge factory patches.

Surge .fxp layout: 60-byte FXP header (chunk size big-endian at offset 56),
then a 32-byte 'sub3' header (XML size little-endian at offset 64), then the
patch XML, then any wavetable data. We edit the XML and fix both sizes.

Every derived patch gets Surge's maximum polyphony (64 voices).

"AT Fade" patches also get: the factory patch's own poly AT
routings removed, then a_vca_level (per-voice gain) base -> -48 dB with a poly
aftertouch routing of +48 dB, so poly AT 127 = 0 dB and poly AT 0 = -48 dB,
and velocity sensitivity of -48 dB, so velocity 127 = 0 dB and velocity 0 =
-48 dB. The engine uses AT as a per-note volume fade and velocity as a fixed
per-pitch gain (equal-loudness compensation).
"""
import os
import re
import struct

SURGE_DATA = "/usr/share/surge-xt"
FACTORY = f"{SURGE_DATA}/patches_factory"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "patches")
MS_POLYAFTERTOUCH = 3  # Surge modsources enum index
MAX_POLY = 64  # Surge's polylimit range is 2..64

# output file -> (source patch under the Surge data dir, add AT volume fade?, {param: new value})
SOURCES = {
    # osc 2 (sine) moved from -1 octave to 0
    "Square Metallophone AT Fade.fxp": ("patches_3rdparty/Jacky Ligon/Mallets/Square Metallophone ", True,
                                        {"a_osc2_octave": "0"}),
    "Init Sine AT Fade.fxp": ("patches_factory/Templates/Init Sine", True, {}),
    "Init Saw AT Fade.fxp": ("patches_factory/Templates/Init Saw", True, {}),
    "Elephant AT Fade.fxp": ("patches_factory/MPE/The Elephant Told You", True, {}),
}
TARGETS = list(SOURCES)  # files main() produces


def load(path):
    d = open(path, "rb").read()
    assert d[:4] == b"CcnK" and d[60:64] == b"sub3", "not a Surge patch"
    xml_size = struct.unpack("<I", d[64:68])[0]
    return d[:92], d[92:92 + xml_size].decode("utf-8"), d[92 + xml_size:]


def save(path, header, xml, tail):
    xb = xml.encode("utf-8")
    h = bytearray(header)
    h[64:68] = struct.pack("<I", len(xb))
    h[56:60] = struct.pack(">I", 32 + len(xb) + len(tail))  # sub3 header + xml + wavetables
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(bytes(h) + xb + tail)


def at_fade(xml, scene="a", floor_db=-48.0):
    tag = f"{scene}_vca_level"
    m = re.search(rf'<{tag} type="2" value="[^"]*"\s*/>', xml)
    assert m, f"{tag} not found (or already has modulation)"
    new = (f'<{tag} type="2" value="{floor_db:.6f}">'
           f'<modrouting source="{MS_POLYAFTERTOUCH}" depth="{-floor_db:.6f}" /></{tag}>')
    xml = xml[:m.start()] + new + xml[m.end():]
    # velocity -> gain: vel 127 = 0 dB down to vel 0 = -48 dB, linear in dB
    # (measured: Surge applies velsense * (1 - vel/127) dB; negative = quieter)
    return set_params(xml, {f"{scene}_vca_velsense": f"{floor_db:.6f}"})


def strip_source(xml, source):
    """Remove every modulation routing from `source`, then drop now-empty param wrappers."""
    xml = re.sub(rf'<modrouting source="{source}" depth="[^"]*"\s*/>', "", xml)
    return re.sub(r'<(\w+) (type="\d+" value="[^"]*")></\1>', r"<\1 \2 />", xml)


def set_polylimit(xml, n=MAX_POLY):
    xml, count = re.subn(r'<polylimit type="0" value="\d+"', f'<polylimit type="0" value="{n}"', xml)
    assert count == 1, "polylimit not found"
    return xml


def set_params(xml, values):
    for name, value in values.items():
        xml, count = re.subn(rf'(<{name} type="\d+" value=")[^"]*(")', rf"\g<1>{value}\g<2>", xml)
        assert count == 1, f"{name} not found"
    return xml


def rename(xml, name):
    return re.sub(r'(<meta name=")[^"]*(")', rf"\g<1>{name}\g<2>", xml, count=1)


def main():
    for out_name, (src, fade, params) in SOURCES.items():
        h, x, t = load(f"{SURGE_DATA}/{src}.fxp")
        x = set_params(x, params)
        if fade:
            # e.g. The Elephant routes poly AT to osc sync + filter cutoff (a ~4 kHz
            # screech at high AT); strip any such routings so AT is volume only.
            x = at_fade(strip_source(x, MS_POLYAFTERTOUCH))
        x = rename(set_polylimit(x), out_name[:-4])
        out = os.path.join(OUT, out_name)
        save(out, h, x, t)
        print("wrote", out)


if __name__ == "__main__":
    main()
