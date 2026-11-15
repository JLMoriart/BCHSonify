#!/usr/bin/env bash
# Run the engine locally; it starts its Surge instance itself. Ctrl-C stops everything.
# Examples:
#   ./run_local.sh --tx-rate 1
#   ./run_local.sh --pad-patch "Pads/Distant"
#   ./run_local.sh --help
cd "$(dirname "$0")"
exec python3 engine.py "$@"
