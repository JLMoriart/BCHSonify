#!/usr/bin/env bash
# Install or update the relay on the server (idempotent).
#   - system user `bchsonify`, allowed via sudoers to run three read-only
#     bitcoin-cli commands as `bitcoin`: getrawmempool, getrawmempool true
#     (waiting transactions and their fees) and getblock (a block's size, size
#     limit and transaction ids)
#   - /opt/bchsonify/relay.py + systemd bchsonify-relay.service
#   - listens on 127.0.0.1:8765 only (not reachable from outside)
#   - watches for donations to web/donate.json's address (--donate), when it has one
# Server login comes from BCHSONIFY_VPS (env or ../run_node.env).
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../run_node.env ] && . ../run_node.env
VPS=${BCHSONIFY_VPS:?set BCHSONIFY_VPS=user@host (env or run_node.env)}

# the service, with --donate added when there's a donation address
DONATE=$(python3 -c 'import json; print(json.load(open("../web/donate.json"))["address"].strip())')
python3 -c 'import sys; sys.path.insert(0, "."); import relay; relay.cashaddr_script(sys.argv[1]) if sys.argv[1] else None' "$DONATE" # a typo stops here
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
sed "s|^ExecStart=.*|&${DONATE:+ --donate $DONATE}|" bchsonify-relay.service > "$TMP/bchsonify-relay.service"
scp -q relay.py "$TMP/bchsonify-relay.service" "$VPS":/tmp/
ssh "$VPS" 'set -e
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-zmq python3-websockets >/dev/null
id bchsonify >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin bchsonify
cat > /tmp/bchsonify.sudoers <<EOF
bchsonify ALL=(bitcoin) NOPASSWD: /usr/local/bin/bitcoin-cli -conf=/etc/bchn/bitcoin.conf -datadir=/var/lib/bchn getrawmempool
bchsonify ALL=(bitcoin) NOPASSWD: /usr/local/bin/bitcoin-cli -conf=/etc/bchn/bitcoin.conf -datadir=/var/lib/bchn getrawmempool true
bchsonify ALL=(bitcoin) NOPASSWD: /usr/local/bin/bitcoin-cli -conf=/etc/bchn/bitcoin.conf -datadir=/var/lib/bchn getblock *
EOF
visudo -cf /tmp/bchsonify.sudoers >/dev/null
install -m 440 /tmp/bchsonify.sudoers /etc/sudoers.d/bchsonify
install -d -m 755 /opt/bchsonify
install -m 644 /tmp/relay.py /opt/bchsonify/relay.py
install -m 644 /tmp/bchsonify-relay.service /etc/systemd/system/bchsonify-relay.service
rm -f /tmp/relay.py /tmp/bchsonify-relay.service /tmp/bchsonify.sudoers
systemctl daemon-reload
systemctl enable --now bchsonify-relay >/dev/null 2>&1
systemctl restart bchsonify-relay
sleep 2
systemctl is-active bchsonify-relay
journalctl -u bchsonify-relay -n 5 --no-pager -o cat'
