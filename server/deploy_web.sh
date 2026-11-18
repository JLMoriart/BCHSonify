#!/usr/bin/env bash
# Publish the visitors' site on the server (idempotent; run server/deploy.sh first for the relay).
#   - Caddy (from Caddy's own apt repository) serves it over https, with a certificate it gets and
#     renews by itself, and passes /ws through to the relay on 127.0.0.1:8765
#   - the firewall opens 80 (certificates, and redirecting http to https) and 443
#   - copies the visitors' files from web/ to /var/www/bchsonify, swapped in all at once. Not the studio
#     (studio.html and the old addresses that forward to it) or the test pages.
# Server login from BCHSONIFY_VPS and the site's address from BCHSONIFY_SITE (env or ../run_node.env),
# e.g. BCHSONIFY_SITE=example.com. Its DNS must already point at the server, for the certificate.
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../run_node.env ] && . ../run_node.env
VPS=${BCHSONIFY_VPS:?set BCHSONIFY_VPS=user@host (env or run_node.env)}
SITE=${BCHSONIFY_SITE:?set BCHSONIFY_SITE=the site address, e.g. example.com (env or run_node.env)}
[[ $SITE =~ ^[a-z0-9.-]+$ ]] || { echo "BCHSONIFY_SITE should be a plain host name, like example.com"; exit 1; }

FILES=(index.html css js vendor donate donate.json sound.json radio)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
sed "s|{SITE}|$SITE|" Caddyfile > "$TMP/Caddyfile"
tar -C ../web -czf "$TMP/site.tgz" "${FILES[@]}"
scp -q "$TMP/Caddyfile" "$TMP/site.tgz" "$VPS":/tmp/
ssh "$VPS" 'set -e
if ! command -v caddy >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gpg >/dev/null
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy >/dev/null
fi
ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
rm -rf /var/www/bchsonify.new && install -d -m 755 /var/www/bchsonify.new
tar -xzf /tmp/site.tgz -C /var/www/bchsonify.new --no-same-owner && chmod -R a+rX,go-w /var/www/bchsonify.new
[ -d /var/www/bchsonify ] && mv /var/www/bchsonify /var/www/bchsonify.old
mv /var/www/bchsonify.new /var/www/bchsonify && rm -rf /var/www/bchsonify.old /tmp/site.tgz
caddy validate --adapter caddyfile --config /tmp/Caddyfile >/dev/null 2>&1 || { caddy validate --adapter caddyfile --config /tmp/Caddyfile; exit 1; }
install -m 644 /tmp/Caddyfile /etc/caddy/Caddyfile && rm -f /tmp/Caddyfile
systemctl enable --now caddy >/dev/null 2>&1
systemctl reload caddy
systemctl is-active caddy'
echo "https://$SITE/"
