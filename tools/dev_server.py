#!/usr/bin/env python3
"""Local dev server: serves web/ plus a presets API for the workbench.

  GET    /api/presets/<kind>          -> {"name": {...params}, ...}
  PUT    /api/presets/<kind>/<name>   (JSON body) -> saves presets/<kind>/<name>.json
  DELETE /api/presets/<kind>/<name>
  PUT    /api/sound                   (JSON body) -> saves web/sound.json, the
                                       default sound the visualizer loads
  PUT    /api/radio                   (JSON body) -> saves web/radio/radio.json, BCH
                                       Radio's songs and their lyric timings

Presets live in presets/<kind>/ in the project (outside web/, so they're never
deployed). Binds 127.0.0.1 only.

  python3 tools/dev_server.py [--port 8000]
"""
import argparse
import functools
import http.server
import json
import os
import re
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
PRESETS = os.path.join(ROOT, "presets")
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.'()-]{0,63}$")  # also blocks path tricks
KIND = re.compile(r"^[a-z]{1,32}$")


class Handler(http.server.SimpleHTTPRequestHandler):
    def _route(self):
        parts = urllib.parse.unquote(urllib.parse.urlparse(self.path).path).strip("/").split("/")
        if len(parts) < 3 or parts[:2] != ["api", "presets"] or not KIND.match(parts[2]):
            return None
        name = parts[3] if len(parts) == 4 else None
        if len(parts) > 4 or (name is not None and not NAME.match(name)):
            return "bad"
        return os.path.join(PRESETS, parts[2]), name

    def _json(self, code, obj):
        body = json.dumps(obj, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        r = self._route()
        if r is None:
            return super().do_GET()
        if r == "bad" or r[1] is not None:
            return self._json(400, {"error": "bad preset path"})
        out = {}
        if os.path.isdir(r[0]):
            for f in sorted(os.listdir(r[0])):
                if f.endswith(".json"):
                    try:
                        out[f[:-5]] = json.load(open(os.path.join(r[0], f)))
                    except ValueError:
                        pass
        self._json(200, out)

    def do_PUT(self):
        if urllib.parse.urlparse(self.path).path == "/api/sound":
            return self._put_json(os.path.join(WEB, "sound.json"), "sound.json")
        if urllib.parse.urlparse(self.path).path == "/api/radio":
            return self._put_json(os.path.join(WEB, "radio", "radio.json"), "radio.json")
        r = self._route()
        if r in (None, "bad") or r[1] is None:
            return self._json(400, {"error": "bad preset path"})
        os.makedirs(r[0], exist_ok=True)
        self._put_json(os.path.join(r[0], r[1] + ".json"), r[1])

    def _put_json(self, path, label):
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            assert isinstance(data, dict)
        except (ValueError, AssertionError):
            return self._json(400, {"error": "body must be a JSON object"})
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        self._json(200, {"saved": label})

    def do_DELETE(self):
        r = self._route()
        if r in (None, "bad") or r[1] is None:
            return self._json(400, {"error": "bad preset path"})
        path = os.path.join(r[0], r[1] + ".json")
        if os.path.exists(path):
            os.remove(path)
        self._json(200, {"deleted": r[1]})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always serve the latest JS while developing
        super().end_headers()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8000)
    a = p.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(Handler, directory=WEB))
    print(f"serving web/ and presets/ on http://localhost:{a.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
