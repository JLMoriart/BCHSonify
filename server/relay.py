#!/usr/bin/env python3
"""BCHSonify relay: a BCH node's ZMQ feed -> WebSocket clients.

Sends raw events only; all sonification (and later visualization) logic lives
in the browser.

  {"type": "tx",    "t": <unix s>, "txid": "...", "outputs": [sats, ...]}
  {"type": "block", "t": <unix s>, "hash": "...", "size": bytes, "limit": bytes}

A block's size and the block size limit it was mined under (the node's
adaptive limit, ABLA) come from `getblockheader` via --cli; if that fails the
block is sent without them.

A new client first gets {"type": "hello", "now": <unix s>, "history_s": N,
"events": [...]}: every event from the last --history seconds, so the page can
rebuild which notes are still sounding (and how far each has faded).

The node publishes each transaction twice: when it enters the mempool, and
again when a block includes it. Only the first counts. Txids already in the
mempool at startup (getrawmempool via --cli) count as seen, so the first block
doesn't replay them.

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


def _varint(b, i):
    n = b[i]
    if n < 0xfd:
        return n, i + 1
    w = {0xfd: 2, 0xfe: 4, 0xff: 8}[n]
    return int.from_bytes(b[i + 1:i + 1 + w], "little"), i + 1 + w


def tx_outputs(raw):
    """Output values (sats) of a serialized BCH transaction, in order.
    Token (CashTokens) outputs count by the BCH they hold; OP_RETURN outputs are 0."""
    i = 4  # version
    n_in, i = _varint(raw, i)
    for _ in range(n_in):
        i += 36  # prevout txid + index
        script_len, i = _varint(raw, i)
        i += script_len + 4  # script + sequence
    n_out, i = _varint(raw, i)
    values = []
    for _ in range(n_out):
        values.append(int.from_bytes(raw[i:i + 8], "little"))
        script_len, i = _varint(raw, i + 8)
        i += script_len
    return values


def txid_of(raw):
    return hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1].hex()


class Relay:
    def __init__(self, history_s, seen, cli):
        self.history_s = history_s
        self.cli = cli  # bitcoin-cli command prefix (list), or None
        self.tasks = set()  # running block lookups (kept so they aren't garbage-collected)
        self.history = collections.deque()  # events, oldest first
        self.clients = set()  # one outgoing queue per client
        self.seen = seen

    def prune(self, now):
        while self.history and self.history[0]["t"] < now - self.history_s:
            self.history.popleft()

    def publish(self, ev):
        self.history.append(ev)
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
        q = asyncio.Queue(maxsize=5000)
        # hello first, then live events, through one queue so nothing is lost
        # or reordered between building the hello and going live
        q.put_nowait(json.dumps({"type": "hello", "now": now, "history_s": self.history_s,
                                 "events": list(self.history)}, separators=(",", ":")))
        self.clients.add(q)
        try:
            while q in self.clients or not q.empty():
                await ws.send(await q.get())
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(q)

    async def block(self, now, hash_):
        """Publish a block event, with its size and size limit when the node gives them."""
        ev = {"type": "block", "t": now, "hash": hash_}
        if self.cli:
            try:
                proc = await asyncio.create_subprocess_exec(
                    *self.cli, "getblockheader", hash_,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                out, err = await asyncio.wait_for(proc.communicate(), 10)
                abla = json.loads(out)["ablastate"]
                ev["size"], ev["limit"] = int(abla["blocksize"]), int(abla["blocksizelimit"])
            except Exception as e:  # noqa: BLE001 -- the block still gets sent
                print(f"block {hash_[:16]}: no size from the node ({e!r})", flush=True)
        self.publish(ev)
        print(f"block {hash_[:16]}  size={ev.get('size')} limit={ev.get('limit')}  clients={len(self.clients)}", flush=True)

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
                task = asyncio.create_task(self.block(now, body.hex()))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)
                continue
            if topic != b"rawtx":
                continue
            txid = txid_of(body)
            if txid in self.seen:  # block-time resend
                self.seen.discard(txid)
                continue
            self.seen.add(txid)
            try:
                outs = tx_outputs(body)
            except (IndexError, KeyError):
                print(f"couldn't parse tx {txid}; skipped", flush=True)
                continue
            self.publish({"type": "tx", "t": now, "txid": txid, "outputs": outs})


async def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--zmq", default="tcp://127.0.0.1:28332", help="node ZMQ endpoint")
    p.add_argument("--host", default="127.0.0.1", help="WebSocket listen address")
    p.add_argument("--port", type=int, default=8765, help="WebSocket listen port")
    p.add_argument("--history", type=float, default=1200,
                   help="seconds of events sent to new clients; keep >= the longest note hold (default 1200)")
    p.add_argument("--cli", help="bitcoin-cli command prefix, e.g. 'sudo -n -u bitcoin bitcoin-cli -conf=...'; "
                                 "used for getrawmempool (startup) and getblockheader (each block)")
    a = p.parse_args()

    seen = set()
    cli = shlex.split(a.cli) if a.cli else None
    if cli:
        out = subprocess.run([*cli, "getrawmempool"], capture_output=True, text=True, check=True).stdout
        seen.update(json.loads(out))
        print(f"relay: {len(seen)} txs already in the mempool marked as seen", flush=True)
    relay = Relay(a.history, seen, cli)
    async with websockets.serve(relay.handler, a.host, a.port):
        print(f"relay: serving ws://{a.host}:{a.port}", flush=True)
        await relay.zmq_loop(a.zmq)


if __name__ == "__main__":
    asyncio.run(main())
