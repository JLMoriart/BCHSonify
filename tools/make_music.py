#!/usr/bin/env python3
"""Build the music page's track list (web/music.json) and gather the full-quality .wav files for sale (shop/wav/).

The tracks are BCH Radio's songs (web/radio/radio.json, from tools/make_radio.py), in its order: each streams
and downloads free as its mp3 (radio/<file>.mp3), and sells as a .wav: the .wav in songs/ (not its
subfolders) whose name matches the song's title, ignoring case. The .wavs go to shop/wav/<id>.wav, out of git
and off the public site; deploy_web.sh copies them to the server, where only paid orders can download them.
Also web/radio/spirits-of-bitcoin-mp3s.zip: every mp3, for "Download all mp3s" (server/make_mp3s.py; out of git,
and not uploaded: the server makes its own).

  python3 tools/make_music.py [--price SATS]   (default: the price already in music.json, else 10000)
"""
import argparse
import json
import os
import shutil
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SONGS = os.path.join(ROOT, "songs")
RADIO = os.path.join(ROOT, "web", "radio", "radio.json")
OUT = os.path.join(ROOT, "web", "music.json")
WAV = os.path.join(ROOT, "shop", "wav")
sys.path.insert(0, os.path.join(ROOT, "server"))
import make_mp3s  # noqa: E402


def wav_seconds(path):
    """A .wav's length in seconds, from its header (format chunk's byte rate, data chunk's size)."""
    with open(path, "rb") as f:
        if f.read(12)[8:] != b"WAVE":
            raise SystemExit(f"{path}: not a .wav")
        rate = None
        while True:
            head = f.read(8)
            if len(head) < 8:
                raise SystemExit(f"{path}: no audio data found")
            kind, size = head[:4], struct.unpack("<I", head[4:])[0]
            if kind == b"fmt ":
                rate = struct.unpack("<I", f.read(16)[8:12])[0]  # bytes per second
                f.seek(size - 16 + (size & 1), 1)
            elif kind == b"data":
                return round(size / rate, 1)
            else:
                f.seek(size + (size & 1), 1)


def main():
    ap = argparse.ArgumentParser(description="Build web/music.json and shop/wav/ from BCH Radio's songs and songs/*.wav.")
    ap.add_argument("--price", type=int, help="sats per track")
    a = ap.parse_args()
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    price = a.price or old.get("price") or 10000
    wavs = {n[:-4].lower(): n for n in os.listdir(SONGS) if n.lower().endswith(".wav") and os.path.isfile(os.path.join(SONGS, n))}
    os.makedirs(WAV, exist_ok=True)
    tracks = []
    for song in json.load(open(RADIO))["songs"]:
        name = wavs.get(song["title"].lower())
        if not name:
            raise SystemExit(f"{song['title']}: no songs/{song['title']}.wav (the name must match the title, ignoring case)")
        id_ = song["file"][:-4]
        src, dst = os.path.join(SONGS, name), os.path.join(WAV, id_ + ".wav")
        if not (os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src) and os.path.getmtime(dst) >= os.path.getmtime(src)):
            shutil.copy2(src, dst)
        tracks.append({"id": id_, "title": song["title"], "mp3": f"radio/{song['file']}", "seconds": wav_seconds(src),
                       "wavBytes": os.path.getsize(src)})
        print(f"{song['title']}: {tracks[-1]['seconds']} s, wav {tracks[-1]['wavBytes'] / 1e6:.1f} MB -> shop/wav/{id_}.wav")
    for n in os.listdir(WAV):  # no longer for sale
        if n[:-4] not in {t["id"] for t in tracks}:
            os.remove(os.path.join(WAV, n))
    with open(OUT, "w") as f:
        json.dump({"price": price, "tracks": tracks}, f, indent=2)
        f.write("\n")
    zip_path = make_mp3s.build_zip(os.path.join(ROOT, "web"))  # every mp3 in one download ("Download all mp3s")
    print(f"web/radio/{os.path.basename(zip_path)}: {os.path.getsize(zip_path) / 1e6:.1f} MB")
    print(f"web/music.json: {len(tracks)} tracks at {price} sats each")


if __name__ == "__main__":
    main()
