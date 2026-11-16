#!/usr/bin/env bash
# Serve the browser sonifier locally, with live data from the server's relay.
# Forwards the relay (127.0.0.1:8765 on the server) over SSH and serves web/ on
# http://localhost:8000 (plus the workbench's presets, saved in presets/).
# Ctrl-C stops everything.
#
#   http://localhost:8000/                       live transactions
#   http://localhost:8000/?source=synthetic      synthetic transactions (no server needed)
#   http://localhost:8000/workbench.html         block sound workbench
#   http://localhost:8000/visualizer.html        the mempool as a line of souls (live, with sound)
#
# Server login from BCHSONIFY_VPS (env or run_node.env); without it, only the
# synthetic source works.
set -euo pipefail
cd "$(dirname "$0")"
[ -f run_node.env ] && . ./run_node.env
if [ -n "${BCHSONIFY_VPS:-}" ]; then
  ssh -N -o ExitOnForwardFailure=yes -L 8765:127.0.0.1:8765 "$BCHSONIFY_VPS" &
  TUNNEL=$!
  trap 'kill $TUNNEL 2>/dev/null' EXIT
  sleep 2
  kill -0 $TUNNEL || { echo "SSH tunnel to the relay failed"; exit 1; }
else
  echo "BCHSONIFY_VPS not set: live data unavailable, use ?source=synthetic"
fi
echo "http://localhost:8000/   http://localhost:8000/workbench.html"
python3 tools/dev_server.py --port 8000
