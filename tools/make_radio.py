#!/usr/bin/env python3
"""Build BCH Radio's song list from songs/: web/radio/radio.json, and the songs copied to web/radio/.

Each song is an .mp3 in songs/ with a lyrics file beside it, matched by name: "<title> lyrics.txt", where
<title> is the start of the mp3's name, ignoring case (so "DeFi Cup of Tea (Use It As Money).mp3" goes with
"DeFi Cup of Tea lyrics.txt"). The song's title is the mp3's name.

Lyrics: one line of text per lyric line. Section headings on a line of their own ("[Chorus]") and notes in
brackets ("[instrumental fill]") are left out, and so are blank lines.

Run it again after adding a song: new songs are added, and the mp3s copied again. A song already in
radio.json keeps its title, words and times from there (the studio's Radio timing tool edits them), unless
it's named after --relyric: then its words are read again from its lyrics file, and lines keep their times
as long as their text is unchanged (new or changed lines start untimed); its title stays.

The mp3s are kept out of git (web/radio/*.mp3 is ignored); deploy_web.sh copies them to the server.

  python3 tools/make_radio.py [--relyric "Song title" ...]
"""
import argparse
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SONGS = os.path.join(ROOT, "songs")
OUT = os.path.join(ROOT, "web", "radio")
LIST = os.path.join(OUT, "radio.json")


def slug(title):
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def lyric_lines(path):
    with open(path, encoding="utf-8-sig") as f:
        text = f.read()
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", re.sub(r"\[[^\]]*\]", "", raw)).strip()
        if line:
            lines.append(line)
    return lines


def main():
    ap = argparse.ArgumentParser(description="Build BCH Radio's song list (web/radio/radio.json) from songs/.")
    ap.add_argument("--relyric", nargs="+", default=[], metavar="TITLE", help="read these songs' words again from their lyrics files")
    relyric = {t.lower() for t in ap.parse_args().relyric}
    old = {}
    if os.path.exists(LIST):
        with open(LIST) as f:
            for song in json.load(f).get("songs", []):
                old[song["file"]] = song
    os.makedirs(OUT, exist_ok=True)
    names = sorted(os.listdir(SONGS))
    lyrics = [n for n in names if n.lower().endswith(" lyrics.txt")]
    songs = []
    for mp3 in [n for n in names if n.lower().endswith(".mp3")]:
        title = mp3[:-4]
        match = [n for n in lyrics if title.lower().startswith(n[: -len(" lyrics.txt")].lower())]
        if len(match) != 1:
            raise SystemExit(f"{mp3}: expected one lyrics file named like '<title> lyrics.txt', found {match or 'none'}")
        file = slug(title) + ".mp3"
        shutil.copyfile(os.path.join(SONGS, mp3), os.path.join(OUT, file))
        was = old.get(file)
        if was and title.lower() not in relyric and was["title"].lower() not in relyric:
            songs.append(was)  # as edited in the studio
            print(f"{was['title']}: kept as it was ({sum(l['t'] is not None for l in was['lines'])} of {len(was['lines'])} lines timed)")
            continue
        # keep the times of lines whose text is unchanged: each takes the first old line with its text not yet
        # taken, so a chorus's repeats keep their own times, in order
        before = list(was["lines"]) if was else []
        lines = []
        for text in lyric_lines(os.path.join(SONGS, match[0])):
            i = next((k for k, l in enumerate(before) if l["text"] == text), None)
            kept = before.pop(i) if i is not None else {}
            line = {"text": text, "t": kept.get("t")}
            if kept.get("end") is not None:
                line["end"] = kept["end"]
            lines.append(line)
        songs.append({"title": was["title"] if was else title, "file": file, "lines": lines})
        timed = sum(l["t"] is not None for l in lines)
        print(f"{title}: {len(lines)} lines, {timed} timed -> radio/{file}")
    with open(LIST, "w") as f:
        json.dump({"songs": songs}, f, indent=2)  # as the dev server saves it
        f.write("\n")


if __name__ == "__main__":
    main()
