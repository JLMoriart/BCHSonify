#!/usr/bin/env python3
"""The site's mp3s, made from the songs' .wav files: one constant-bitrate mp3 per song (KBPS), used everywhere an
mp3 is: BCH Radio, the music page's player, its "Download mp3" and "Download all mp3s" (the zip).

Constant bitrate because the radio joins songs part way through (everyone hears the same point: radio.js), and a
browser only lands exactly where it's asked to in a constant-bitrate mp3 (in a variable-bitrate one, Chrome was
up to 0.6 s off, and the lyrics with it).

Made where the site is: on this computer by tools/make_radio.py (into web/radio/), and on the server by
deploy_web.sh, from the .wavs already there for the shop, so the mp3s are never uploaded. An mp3 is made again
only when its .wav changes (or KBPS does): radio/_mp3s.json notes what each was made from.

  python3 make_mp3s.py <site folder> <folder of the .wavs, named <track id>.wav>
      every music.json track's mp3 (radio/<id>.mp3), then the zip (radio/spirits-of-bitcoin-mp3s.zip)
"""
import json
import os
import shutil
import subprocess
import sys
import zipfile

KBPS = 192
ZIP = os.path.join("radio", "spirits-of-bitcoin-mp3s.zip")
MADE = os.path.join("radio", "_mp3s.json")  # mp3 name -> what it was made from


def encode(wav, mp3):
    """wav -> constant-bitrate mp3 (with lame if it's there, else ffmpeg's lame)."""
    tmp = mp3 + ".tmp.mp3"
    if shutil.which("lame"):
        cmd = ["lame", "--quiet", "--cbr", "-b", str(KBPS), wav, tmp]
    else:
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", f"{KBPS}k", tmp]
    subprocess.run(cmd, check=True)
    os.chmod(tmp, 0o644)
    os.replace(tmp, mp3)


def ensure(site, wav, name):
    """radio/<name> made from wav, unless it already was (same .wav, same bitrate). True if it was made now."""
    path, made = os.path.join(site, "radio", name), os.path.join(site, MADE)
    st = os.stat(wav)
    source = {"wav": [st.st_size, int(st.st_mtime)], "kbps": KBPS}
    notes = json.load(open(made)) if os.path.exists(made) else {}
    if os.path.exists(path) and notes.get(name) == source:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    encode(wav, path)
    notes[name] = source
    with open(made + ".tmp", "w") as f:
        json.dump(notes, f, indent=2)
    os.chmod(made + ".tmp", 0o644)
    os.replace(made + ".tmp", made)
    return True


def build_zip(site):
    """Every music.json track's mp3 in one zip (stored: mp3s barely compress)."""
    with open(os.path.join(site, "music.json")) as f:
        tracks = json.load(f)["tracks"]
    out = os.path.join(site, ZIP)
    with zipfile.ZipFile(out + ".tmp", "w", zipfile.ZIP_STORED) as z:
        for k, t in enumerate(tracks, 1):
            z.write(os.path.join(site, t["mp3"]), f"Spirits of Bitcoin/{k:02d} {t['title']}.mp3")
    os.chmod(out + ".tmp", 0o644)
    os.replace(out + ".tmp", out)
    return out


def main(site, wavs):
    with open(os.path.join(site, "music.json")) as f:
        tracks = json.load(f)["tracks"]
    made = [t["id"] for t in tracks if ensure(site, os.path.join(wavs, t["id"] + ".wav"), os.path.basename(t["mp3"]))]
    for t in made:
        print(f"  made radio/{t}.mp3 ({KBPS} kbps, from its .wav)")
    zip_path = os.path.join(site, ZIP)
    if made or not os.path.exists(zip_path) or os.path.getmtime(zip_path) < os.path.getmtime(os.path.join(site, "music.json")):
        build_zip(site)
        print(f"  made {ZIP} ({os.path.getsize(zip_path) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
