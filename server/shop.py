"""The music shop, inside the relay: orders, each paid to its own address in the seller's wallet, and the check
that lets a paid order download its .wav files.

An order is made at checkout: the tracks, their price (the catalog's, web/music.json), and the next receiving
address from the seller's account xpub (hdkey.py: .../0/i). The relay sees every new transaction (relay.py), so
a payment to an order's address shows up within a second of being sent; it counts unconfirmed. Once what's
been paid reaches the price, the order is paid, for good: its key unlocks its tracks' .wav files.

The key is a random secret only the buyer's browser gets (with the order). Downloads are /dl/<id>/<key>/<track>.wav,
served by Caddy from the .wav folder after asking this shop (GET /shop/auth, Caddy's forward_auth) whether that
path is a paid order's track.

Addresses, and the wallet's 20-address lookahead: a wallet only finds payments to its addresses up to 20 unused
ones past the last used one. So an unpaid order's address is given to a new order once it's sat unpaid a while
(ORDER_TTL to pay, then REUSE_AFTER for a late payment to still count), the lowest such address first, and at
most MAX_UNPAID addresses are held by unpaid orders at once: the gap of unused addresses below a paid one stays
under 20. A paid order's address is never given out again (a second payment to it still counts for it).

HTTP (on 127.0.0.1, behind Caddy at the same paths):
  POST /shop/order  {"tracks": [id, ...]}  -> the order, with its key: {id, key, address, amount, uri, ...}
  GET  /shop/order/<id>?key=<key>          -> the order (status open / partial / paid / expired)
  GET  /shop/auth   (X-Forwarded-Uri: /dl/<id>/<key>/<track>.wav)  -> 200 if that may be downloaded, else 403
Orders are kept in a JSON file (--shop-state), rewritten whole (to a temporary file, then renamed) on each change.
"""
import asyncio
import hmac
import json
import os
import re
import secrets
import time
from urllib.parse import parse_qs, urlsplit

from hdkey import XPub, cashaddr, p2pkh_script

ORDER_TTL = 3600         # s an order waits for payment
REUSE_AFTER = 2 * 3600   # s more, after that, before its address may go to another order (a late payment still counts)
MAX_UNPAID = 15          # addresses held by unpaid orders at once (wallets look 20 unused addresses ahead)
MAX_PER_CLIENT = 3       # unpaid, unexpired orders from one IP address at once
BODY_MAX, HEAD_MAX = 4096, 8192


class ShopError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Shop:
    def __init__(self, xpub, catalog_path, state_path):
        self.receive = XPub.parse(xpub).child(0)  # the account's receiving addresses: .../0/i
        self.catalog_path, self.state_path = catalog_path, state_path
        self.orders = {}       # id -> order
        self.next_index = 0    # the lowest address index never given out
        self.scripts = {}      # locking script (bytes) -> id of the order holding that address
        self._catalog = (None, None)
        if os.path.exists(state_path):
            with open(state_path) as f:
                s = json.load(f)
            self.next_index = s["next_index"]
            self.orders = {o["id"]: o for o in s["orders"]}
        self._index()

    # ---- the catalog (web/music.json, as deployed): read again when it changes
    def catalog(self):
        mtime = os.path.getmtime(self.catalog_path)
        if self._catalog[0] != mtime:
            with open(self.catalog_path) as f:
                c = json.load(f)
            self._catalog = (mtime, {"price": int(c["price"]), "tracks": {t["id"] for t in c["tracks"]}})
        return self._catalog[1]

    # ---- orders
    def address(self, i):
        h = self.receive.child(i).hash160()
        return cashaddr(h), p2pkh_script(h)

    def _index(self):
        self.scripts = {bytes.fromhex(o["script"]): o["id"] for o in self.orders.values()}

    def _save(self):
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"next_index": self.next_index, "orders": list(self.orders.values())}, f, separators=(",", ":"))
        os.replace(tmp, self.state_path)

    @staticmethod
    def status(o, now):
        if o.get("paid_at"):
            return "paid"
        if o["received"]:
            return "partial"
        return "expired" if now > o["expires"] else "open"

    def create(self, tracks, client):
        now = time.time()
        cat = self.catalog()
        if not isinstance(tracks, list) or not tracks or len(tracks) != len(set(tracks)) or not set(tracks) <= cat["tracks"]:
            raise ShopError(400, "tracks: a list of the catalog's track ids, each once")
        unpaid = [o for o in self.orders.values() if not o.get("paid_at") and not o["received"]]
        if sum(o["client"] == client and now <= o["expires"] for o in unpaid) >= MAX_PER_CLIENT:
            raise ShopError(429, "too many unpaid checkouts from here at once: pay or wait for one to expire")
        free = sorted((o for o in unpaid if now > o["expires"] + REUSE_AFTER), key=lambda o: o["index"])
        if free:  # the lowest address an unpaid order has given up
            index = free[0]["index"]
            del self.orders[free[0]["id"]]
        elif len(unpaid) >= MAX_UNPAID:
            raise ShopError(503, "the shop is busy: too many checkouts waiting for payment. Try again in a little while")
        else:
            index = self.next_index
            self.next_index += 1
        address, script = self.address(index)
        o = {"id": secrets.token_urlsafe(9), "key": secrets.token_urlsafe(18), "tracks": tracks,
             "amount": cat["price"] * len(tracks), "index": index, "address": address, "script": script.hex(),
             "created": now, "expires": now + ORDER_TTL, "received": 0, "txids": [], "client": client}
        self.orders[o["id"]] = o
        self._index()
        self._save()
        print(f"shop: order {o['id']} for {len(tracks)} track(s), {o['amount']} sats to address 0/{index}", flush=True)
        return self.view(o, now, with_key=True)

    def view(self, o, now=None, with_key=False):
        now = now or time.time()
        bch = f"{o['amount'] / 1e8:.8f}".rstrip("0").rstrip(".")
        v = {"id": o["id"], "tracks": o["tracks"], "amount": o["amount"], "address": o["address"],
             "uri": f"{o['address']}?amount={bch}", "expires": o["expires"], "received": o["received"],
             "status": self.status(o, now), "txids": o["txids"]}
        if with_key:
            v["key"] = o["key"]
        return v

    def find(self, id_, key):
        o = self.orders.get(id_)
        if not o or not isinstance(key, str) or not hmac.compare_digest(o["key"], key):
            raise ShopError(404, "no such order (an unpaid one is forgotten a few hours after it expires)")
        return o

    def may_download(self, uri):
        m = re.fullmatch(r"/dl/([\w-]+)/([\w-]+)/([a-z0-9-]+)\.wav", urlsplit(uri).path)
        if not m:
            return False
        o = self.orders.get(m[1])
        return bool(o and hmac.compare_digest(o["key"], m[2]) and o.get("paid_at") and m[3] in o["tracks"])

    # ---- payments (from the relay: every new transaction's payments to self.scripts)
    def paid(self, txid, pays):
        changed = False
        for script, sats in pays.items():
            o = self.orders.get(self.scripts.get(script))
            if not o or txid in o["txids"]:
                continue
            o["txids"].append(txid)
            o["received"] += sats
            if o["received"] >= o["amount"] and not o.get("paid_at"):
                o["paid_at"] = time.time()
            changed = True
            print(f"shop: order {o['id']} got {sats} sats ({o['received']} of {o['amount']}) in {txid}", flush=True)
        if changed:
            self._save()

    async def catch_up(self, rpc):
        """Payments to unpaid orders' addresses that are already in blocks (made while the relay was down):
        the node's UTXO set, scanned for those addresses. (One still unconfirmed is found once it's mined.)"""
        waiting = [o for o in self.orders.values() if not o.get("paid_at")]
        if not waiting:
            return
        try:
            r = await rpc("scantxoutset", "start", json.dumps([f"raw({o['script']})" for o in waiting], separators=(",", ":")), timeout=600)
        except Exception as e:  # noqa: BLE001
            print(f"shop: couldn't scan for payments made while away ({e!r})", flush=True)
            return
        for u in r.get("unspents", []):
            self.paid(u["txid"], {bytes.fromhex(u["scriptPubKey"]): round(u["amount"] * 1e8)})
        print(f"shop: scanned {len(waiting)} unpaid order address(es): {len(r.get('unspents', []))} payment(s)", flush=True)

    # ---- HTTP
    async def http(self, reader, writer):
        status, body = 500, {"error": "server error"}
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
            if len(head) > HEAD_MAX:
                raise ShopError(431, "headers too large")
            lines = head.decode("latin-1").split("\r\n")
            method, target, _ = lines[0].split(" ", 2)
            headers = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in lines[1:] if l)}
            n = int(headers.get("content-length", 0))
            if n > BODY_MAX:
                raise ShopError(413, "request too large")
            data = await asyncio.wait_for(reader.readexactly(n), 10) if n else b""
            status, body = 200, self.route(method, target, headers, data)
        except ShopError as e:
            status, body = e.status, {"error": str(e)}
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ValueError):
            status, body = 400, {"error": "bad request"}
        except Exception as e:  # noqa: BLE001
            print(f"shop: {e!r}", flush=True)
        out = json.dumps(body).encode()
        reason = {200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 413: "Too Large",
                  429: "Too Many Requests", 431: "Too Large", 500: "Server Error", 503: "Busy"}.get(status, "")
        writer.write(f"HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {len(out)}\r\n"
                     f"Cache-Control: no-store\r\nConnection: close\r\n\r\n".encode() + out)
        try:
            await writer.drain()
        finally:
            writer.close()

    def route(self, method, target, headers, data):
        url = urlsplit(target)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/shop/auth":
            if not self.may_download(headers.get("x-forwarded-uri", "")):
                raise ShopError(403, "not a paid order's track")
            return {}
        if url.path == "/shop/order" and method == "POST":
            client = headers.get("x-forwarded-for", "").split(",")[-1].strip() or "?"
            return self.create(json.loads(data or b"{}").get("tracks"), client)
        m = re.fullmatch(r"/shop/order/([\w-]+)", url.path)
        if m and method == "GET":
            return self.view(self.find(m[1], q.get("key")))
        raise ShopError(404 if method in ("GET", "POST") else 405, "not found")
