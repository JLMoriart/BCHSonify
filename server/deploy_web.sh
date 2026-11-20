#!/usr/bin/env bash
# Publish the visitors' site on the server (idempotent; run server/deploy.sh first for the relay).
#   - Caddy (from Caddy's own apt repository) serves it over https, with a certificate it gets and
#     renews by itself, and passes /ws through to the relay on 127.0.0.1:8765
#   - the firewall opens 80 (certificates, and redirecting http to https) and 443
#   - the visitors' files from web/ go to /var/www/bchsonify, swapped in all at once. Not the studio
#     (studio.html and the old addresses that forward to it) or the test pages (web/_*).
#   - the music shop's .wav files (shop/wav/, from tools/make_music.py) go to /var/lib/bchsonify-wav, off the
#     public site: Caddy serves one only when the shop says it's a paid order's (see Caddyfile)
# Only what changed is uploaded: the server keeps a copy of the site (/var/www/bchsonify.stage) that rsync
# brings up to date, and the live site is made from it (hard links: no copying) and swapped in. So the
# songs (megabytes) go up once, not on every deploy.
# Server login from BCHSONIFY_VPS and the site's address from BCHSONIFY_SITE (env or ../run_node.env),
# e.g. BCHSONIFY_SITE=example.com. Its DNS must already point at the server, for the certificate.
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../run_node.env ] && . ../run_node.env
VPS=${BCHSONIFY_VPS:?set BCHSONIFY_VPS=user@host (env or run_node.env)}
SITE=${BCHSONIFY_SITE:?set BCHSONIFY_SITE=the site address, e.g. example.com (env or run_node.env)}
[[ $SITE =~ ^[a-z0-9.-]+$ ]] || { echo "BCHSONIFY_SITE should be a plain host name, like example.com"; exit 1; }

FILES=(index.html music.html css js vendor donate donate.json sound.json radio music.json) # in web/: what visitors get
WAV=/var/lib/bchsonify-wav
LIVE=/var/www/bchsonify STAGE=/var/www/bchsonify.stage

# 1. the server ready: Caddy, the firewall, and the copy to update (the first time: from the live site)
ssh "$VPS" "set -e
if ! command -v caddy >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gpg >/dev/null
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy >/dev/null
fi
command -v rsync >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rsync >/dev/null
ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
if [ ! -d $STAGE ]; then if [ -d $LIVE ]; then cp -a $LIVE $STAGE; else install -d -m 755 $STAGE; fi; fi
install -d -m 755 $WAV"

# 2. the copy made exactly the listed files (what changed is sent; anything else there is removed)
filters=(--exclude='_*')
for f in "${FILES[@]}"; do filters+=(--include="/$f" --include="/$f/***"); done
filters+=(--exclude='*')
rsync -rlptz --delete --delete-excluded --chmod=D755,F644 "${filters[@]}" --out-format='  sent %n' ../web/ "$VPS:$STAGE/"
if [ -d ../shop/wav ]; then # the .wavs for sale (uploaded once each, then only when changed)
  rsync -rlpt --delete --chmod=D755,F644 --info=progress2 --out-format='  sent %n' ../shop/wav/ "$VPS:$WAV/"
fi

# 3. the live site swapped for a hard-linked copy of it, and Caddy's configuration
sed "s|{SITE}|$SITE|" Caddyfile | ssh "$VPS" "set -e
cat > /tmp/Caddyfile
rm -rf $LIVE.new && cp -al $STAGE $LIVE.new
[ -d $LIVE ] && mv $LIVE $LIVE.old
mv $LIVE.new $LIVE && rm -rf $LIVE.old
caddy validate --adapter caddyfile --config /tmp/Caddyfile >/dev/null 2>&1 || { caddy validate --adapter caddyfile --config /tmp/Caddyfile; exit 1; }
install -m 644 /tmp/Caddyfile /etc/caddy/Caddyfile && rm -f /tmp/Caddyfile
systemctl enable --now caddy >/dev/null 2>&1
systemctl reload caddy
systemctl is-active caddy"
echo "https://$SITE/"
