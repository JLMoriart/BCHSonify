#!/usr/bin/env python3
"""Every track's mp3 in one zip, for the music page's "Download all mp3s": <site>/radio/spirits-of-bitcoin-mp3s.zip.

Made from the site's own files (music.json's tracks, in order, and their mp3s), so it's built where the site
is: by tools/make_music.py for web/, and on the server by deploy_web.sh, from the mp3s already uploaded
(not uploaded itself). Stored, not compressed: mp3s barely compress.

  python3 zip_mp3s.py <site folder>
"""
import json
import os
import sys
import zipfile

NAME = os.path.join("radio", "spirits-of-bitcoin-mp3s.zip")


def build(site):
    with open(os.path.join(site, "music.json")) as f:
        tracks = json.load(f)["tracks"]
    out = os.path.join(site, NAME)
    with zipfile.ZipFile(out + ".tmp", "w", zipfile.ZIP_STORED) as z:
        for k, t in enumerate(tracks, 1):
            z.write(os.path.join(site, t["mp3"]), f"Spirits of Bitcoin/{k:02d} {t['title']}.mp3")
    os.chmod(out + ".tmp", 0o644)
    os.replace(out + ".tmp", out)
    return out


if __name__ == "__main__":
    out = build(sys.argv[1])
    print(f"{out}: {os.path.getsize(out) / 1e6:.1f} MB")
