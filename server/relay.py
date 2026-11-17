#!/usr/bin/env python3
"""BCHSonify relay: a BCH node's ZMQ feed -> WebSocket clients.

Sends raw events only; all sonification and visualization logic lives in the
browser.

  {"type": "tx", "t": <unix s>, "txid": "...", "outputs": [sats, ...], "size": bytes,
   "fee": sats, "nft": true, "ft": true, "memo": true, "donation": sats, "confirmed": true}
  {"type": "block", "t": <unix s>, "hash": "...", "size": bytes, "limit": bytes,
   "txids": [...], "dropped": [...]}

tx: "fee" is missing when the node couldn't be asked. "nft" / "ft" / "memo"
appear only when true: an output holds a CashTokens NFT, holds fungible
CashTokens, or is an OP_RETURN. "donation" (with --donate) is how many sats it
pays to the site's donation address, when that is any. "confirmed" appears (true) when the transaction
was not in the mempool by the time its fee was looked up: it arrived inside a
block, or was mined within that moment.

block: "size" and "limit" (the node's adaptive block size limit, ABLA) are
missing if the node couldn't be asked. "txids" are the waiting transactions
this block confirmed; "dropped" (only when not empty) are waiting transactions
that left the mempool without being in the block.

The relay keeps the set of waiting transactions: everything it has announced
that the node still has in its mempool. A new client first gets
  {"type": "hello", "now": <unix s>, "history_s": N, "events": [...], "mempool": [...]}
"events": every event from the last --history seconds (blocks without their
txids), so a page can rebuild which notes are still sounding. "mempool": the
waiting transactions as tx events (at most MEMPOOL_HELLO, highest fee rate
first). Ones already waiting when the relay started have no "outputs".

Everything is published in the order the node sent it. Transactions wait for
their fee lookup (one `getrawmempool true` per burst), so they go out a
fraction of a second late, still stamped with their arrival time.

The node publishes each transaction twice: when it enters the mempool, and
again when a block includes it. Only the first counts.

Node lookups go through --cli (a bitcoin-cli command prefix): getrawmempool
true, getrawmempool, getblock <hash> 1. Without --cli there are no fees, block
sizes or block contents, and "mempool" stays empty.

Needs python3-zmq and python3-websockets.
"""
import argparse
import asyncio
import collections
import hashlib
import json
import shlex
import subprocess
import time

import websockets
import zmq
import zmq.asyncio

MEMPOOL_HELLO = 20000  # most waiting transactions sent to a new client
SLOW_LOOKUP = 0.5      # s; after a mempool lookup slower than this (a huge mempool), rest twice as long as it took


def _varint(b, i):
    n = b[i]
    if n < 0xfd:
        return n, i + 1
    w = {0xfd: 2, 0xfe: 4, 0xff: 8}[n]
    return int.from_bytes(b[i + 1:i + 1 + w], "little"), i + 1 + w


def cashaddr_script(addr):
    """The locking script (bytes) a CashAddress pays to: P2PKH, or P2SH (20- or 32-byte), token-aware or not."""
    charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    prefix, _, payload = addr.lower().rpartition(":")
    prefix = prefix or "bitcoincash"
    data = [charset.index(c) for c in payload]
    c = 1  # checksum (BCH polymod over the prefix's low bits, a 0, then the payload)
    for d in [ord(ch) & 31 for ch in prefix] + [0] + data:
        c0, c = c >> 35, ((c & 0x07ffffffff) << 5) ^ d
        for k, g in enumerate((0x98f2bc8e61, 0x79b76d99e2, 0xf33e5fb3c4, 0xae2eabe2a8, 0x1e4f43e470)):
            if c0 >> k & 1:
                c ^= g
    if c ^ 1:
        raise ValueError(f"bad CashAddress checksum: {addr}")
    acc, bits, out = 0, 0, []
    for d in data[:-8]:  # 5-bit groups -> bytes
        acc, bits = acc << 5 | d, bits + 5
        if bits >= 8:
            bits -= 8
            out.append(acc >> bits & 0xff)
    version, h = out[0], bytes(out[1:])
    kind = version >> 3  # 0 P2PKH, 1 P2SH, 2 P2PKH token-aware, 3 P2SH token-aware
    if kind in (0, 2) and len(h) == 20:
        return b"\x76\xa9\x14" + h + b"\x88\xac"
    if kind in (1, 3) and len(h) == 20:
        return b"\xa9\x14" + h + b"\x87"
    if kind in (1, 3) and len(h) == 32:
        return b"\xaa\x20" + h + b"\x87"
    raise ValueError(f"unsupported CashAddress: {addr}")


def parse_tx(raw, donate=None):
    """(output values in sats, flags) of a serialized BCH transaction.
    Token (CashTokens) outputs count by the BCH they hold; OP_RETURN outputs are 0.
    flags: {"nft": True} / {"ft": True} if any output holds an NFT / fungible
    tokens, {"memo": True} if any output is an OP_RETURN, {"donation": sats} for
    what it pays to the locking script `donate` (bytes), if any."""
    i = 4  # version
    n_in, i = _varint(raw, i)
    for _ in range(n_in):
        i += 36  # prevout txid + index
        script_len, i = _varint(raw, i)
        i += script_len + 4  # script + sequence
    n_out, i = _varint(raw, i)
    values, flags = [], {}
    for _ in range(n_out):
        values.append(int.from_bytes(raw[i:i + 8], "little"))
        script_len, i = _varint(raw, i + 8)
        j, end = i, i + script_len  # j: where the locking script proper starts
        if script_len > 33 and raw[i] == 0xef:  # token prefix: 32-byte category, a bitfield, then what it announces
            bits, j = raw[i + 33], i + 34
            if bits & 0x20:
                flags["nft"] = True
            if bits & 0x40:  # NFT commitment
                n, j = _varint(raw, j)
                j += n
            if bits & 0x10:  # fungible amount
                flags["ft"] = True
                _, j = _varint(raw, j)
        if j < end and raw[j] == 0x6a:  # OP_RETURN (possibly burning tokens)
            flags["memo"] = True
        if donate and raw[j:end] == donate and values[-1] > 0:
            flags["donation"] = flags.get("donation", 0) + values[-1]
        i = end
    return values, flags


def txid_of(raw):
    return hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1].hex()


def fee_rate(ev):
    return ev.get("fee", 0) / max(1, ev.get("size", 1))


class Relay:
    def __init__(self, history_s, cli):
        self.history_s = history_s
        self.cli = cli  # bitcoin-cli command prefix (list), or None
        self.history = collections.deque()  # events, oldest first
        self.clients = set()  # one outgoing queue per client
        self.seen = set()  # txids announced once (the next sighting is the block-time resend)
        self.pending = {}  # txid -> tx event: the waiting transactions
        self.queue = asyncio.Queue()  # events from the node, in order, awaiting their lookups
        self.rest_until = 0.0
        self.donate = None  # the donation address's locking script (bytes), if watching for donations

    def seed(self, mempool):
        """Start from the node's mempool (`getrawmempool true`): already waiting, never announced."""
        for txid, entry in mempool.items():
            self.seen.add(txid)
            self.pending[txid] = {"type": "tx", "t": entry["time"], "txid": txid, "size": entry["size"],
                                  "fee": round(entry["fees"]["base"] * 1e8)}

    def prune(self, now):
        while self.history and self.history[0]["t"] < now - self.history_s:
            self.history.popleft()

    def publish(self, ev):
        slim = ev if ev["type"] != "block" else {k: v for k, v in ev.items() if k not in ("txids", "dropped")}
        self.history.append(slim)
        self.prune(ev["t"])
        msg = json.dumps(ev, separators=(",", ":"))
        for q in list(self.clients):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:  # client stopped reading: stop feeding it
                self.clients.discard(q)

    async def handler(self, ws, path=None):
        now = time.time()
        self.prune(now)
        waiting = list(self.pending.values())
        if len(waiting) > MEMPOOL_HELLO:
            waiting = sorted(waiting, key=fee_rate, reverse=True)[:MEMPOOL_HELLO]
        q = asyncio.Queue(maxsize=5000)
        # hello first, then live events, through one queue so nothing is lost
        # or reordered between building the hello and going live
        q.put_nowait(json.dumps({"type": "hello", "now": now, "history_s": self.history_s,
                                 "events": list(self.history), "mempool": waiting}, separators=(",", ":")))
        self.clients.add(q)
        try:
            while q in self.clients or not q.empty():
                await ws.send(await q.get())
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(q)

    async def rpc(self, *args, timeout=10):
        proc = await asyncio.create_subprocess_exec(
            *self.cli, *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise
        if proc.returncode:
            raise RuntimeError(err.decode(errors="replace").strip()[:200])
        return json.loads(out)

    async def txs(self, evs):
        """Publish a burst of new transactions, each with its fee from one mempool lookup."""
        mempool = None
        if self.cli:
            start = time.monotonic()
            try:
                mempool = await self.rpc("getrawmempool", "true", timeout=5)
            except Exception as e:  # noqa: BLE001 -- the transactions still get sent
                print(f"{len(evs)} txs: no fees from the node ({e!r})", flush=True)
            took = time.monotonic() - start
            if took > SLOW_LOOKUP:
                self.rest_until = time.monotonic() + 2 * took
        for ev in evs:
            entry = mempool.get(ev["txid"]) if mempool is not None else None
            if entry:
                ev["fee"] = round(entry["fees"]["base"] * 1e8)
            if mempool is not None and entry is None:
                ev["confirmed"] = True
            elif self.cli:  # without a node to ask, nothing would ever clear them
                self.pending[ev["txid"]] = ev
            self.publish(ev)

    async def block(self, ev):
        """Publish a block: its size and limit, which waiting transactions it took, and which just left."""
        hash_ = ev["hash"]
        if self.cli:
            try:
                info = await self.rpc("getblock", hash_, "1", timeout=20)
                ev["size"], ev["limit"] = int(info["ablastate"]["blocksize"]), int(info["ablastate"]["blocksizelimit"])
                ev["txids"] = [t for t in info["tx"] if self.pending.pop(t, None) is not None]
            except Exception as e:  # noqa: BLE001 -- the block still gets sent
                print(f"block {hash_[:16]}: no details from the node ({e!r})", flush=True)
            try:
                mempool = set(await self.rpc("getrawmempool"))
                gone = [t for t in self.pending if t not in mempool]
                for t in gone:
                    del self.pending[t]
                if "txids" not in ev:  # couldn't read the block: whatever left, most likely left in it
                    ev["txids"] = gone
                elif gone:
                    ev["dropped"] = gone
            except Exception as e:  # noqa: BLE001
                print(f"block {hash_[:16]}: couldn't check the mempool ({e!r})", flush=True)
        self.publish(ev)
        print(f"block {hash_[:16]}  size={ev.get('size')} limit={ev.get('limit')}  took={len(ev.get('txids', []))} "
              f"dropped={len(ev.get('dropped', []))} waiting={len(self.pending)}  clients={len(self.clients)}", flush=True)

    async def worker(self):
        """Look up and publish queued events in the order they arrived."""
        while True:
            batch = [await self.queue.get()]
            rest = self.rest_until - time.monotonic()
            if rest > 0 and batch[0]["type"] == "tx":
                await asyncio.sleep(rest)
            while not self.queue.empty():
                batch.append(self.queue.get_nowait())
            i = 0
            while i < len(batch):
                j = i + 1
                try:
                    if batch[i]["type"] == "block":
                        await self.block(batch[i])
                    else:
                        while j < len(batch) and batch[j]["type"] == "tx":
                            j += 1
                        await self.txs(batch[i:j])
                except Exception as e:  # noqa: BLE001 -- keep relaying
                    print(f"relay: lost {j - i} event(s) ({e!r})", flush=True)
                i = j

    async def zmq_loop(self, url):
        sock = zmq.asyncio.Context.instance().socket(zmq.SUB)
        sock.connect(url)
        sock.setsockopt(zmq.SUBSCRIBE, b"rawtx")
        sock.setsockopt(zmq.SUBSCRIBE, b"hashblock")
        print(f"relay: listening to {url}", flush=True)
        while True:
            topic, body, _seq = await sock.recv_multipart()
            now = time.time()
            if topic == b"hashblock":
                self.queue.put_nowait({"type": "block", "t": now, "hash": body.hex()})
                continue
            if topic != b"rawtx":
                continue
            txid = txid_of(body)
            if txid in self.seen:  # block-time resend
                self.seen.discard(txid)
                continue
            self.seen.add(txid)
            try:
                outs, flags = parse_tx(body, self.donate)
            except (IndexError, KeyError):
                print(f"couldn't parse tx {txid}; skipped", flush=True)
                continue
            self.queue.put_nowait({"type": "tx", "t": now, "txid": txid, "outputs": outs, "size": len(body), **flags})


async def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--zmq", default="tcp://127.0.0.1:28332", help="node ZMQ endpoint")
    p.add_argument("--host", default="127.0.0.1", help="WebSocket listen address")
    p.add_argument("--port", type=int, default=8765, help="WebSocket listen port")
    p.add_argument("--history", type=float, default=1200,
                   help="seconds of events sent to new clients; keep >= the longest note hold (default 1200)")
    p.add_argument("--cli", help="bitcoin-cli command prefix, e.g. 'sudo -n -u bitcoin bitcoin-cli -conf=...'; "
                                 "used for getrawmempool [true] and getblock <hash> 1")
    p.add_argument("--donate", help="the site's donation CashAddress: transactions paying it are marked \"donation\"")
    a = p.parse_args()

    cli = shlex.split(a.cli) if a.cli else None
    relay = Relay(a.history, cli)
    if a.donate:
        relay.donate = cashaddr_script(a.donate)
        print(f"relay: watching for donations to {a.donate}", flush=True)
    if cli:
        out = subprocess.run([*cli, "getrawmempool", "true"], capture_output=True, text=True, check=True).stdout
        relay.seed(json.loads(out))
        print(f"relay: {len(relay.pending)} txs already waiting in the mempool", flush=True)
    async with websockets.serve(relay.handler, a.host, a.port):
        print(f"relay: serving ws://{a.host}:{a.port}", flush=True)
        worker = asyncio.create_task(relay.worker())  # noqa: F841 -- held so it isn't garbage-collected
        await relay.zmq_loop(a.zmq)


if __name__ == "__main__":
    asyncio.run(main())
