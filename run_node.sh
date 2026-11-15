#!/usr/bin/env bash
# Run the engine locally on live transactions from a remote BCH node.
# Forwards the node's ZMQ feed (127.0.0.1:28332 on the server) over SSH, then
# runs engine.py --zmq. Extra arguments go to engine.py. Ctrl-C stops everything.
#
# Needs the server's SSH login in BCHSONIFY_VPS (e.g. user@host), set in the
# environment or in run_node.env next to this script (untracked), e.g.:
#   echo 'BCHSONIFY_VPS=user@host' > run_node.env
set -euo pipefail
cd "$(dirname "$0")"
[ -f run_node.env ] && . ./run_node.env
VPS=${BCHSONIFY_VPS:?set BCHSONIFY_VPS=user@host (env or run_node.env)}
CLI="sudo -u bitcoin bitcoin-cli -conf=/etc/bchn/bitcoin.conf -datadir=/var/lib/bchn"
ssh -N -o ExitOnForwardFailure=yes -L 28332:127.0.0.1:28332 "$VPS" &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null' EXIT
sleep 2
kill -0 $TUNNEL || { echo "SSH tunnel failed"; exit 1; }
python3 engine.py --zmq tcp://127.0.0.1:28332 --mempool-cmd "ssh $VPS $CLI getrawmempool" "$@"
