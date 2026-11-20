#!/usr/bin/env python3
"""BCH transaction sonification engine (prototype).

Maps each transaction output to a harmonic of F0 (defaults shown):
    each new block                  -> harmonic 1 (the fundamental)
    amount >= 2,100 BCH             -> harmonic 2
    each half below that            -> the next harmonic (1,050-2,100 -> h3, ...)

Two Surge XT instances (started by this script): one holds every distinct
transaction harmonic currently triggered (new outputs on a held harmonic
re-sound it), the other plays the block note (a saw by default).

Notes go to Surge over MIDI (a virtual ALSA port). Surge is loaded with a
harmonic-series tuning in which MIDI note k sounds harmonic k of F0, so a
note number *is* a harmonic number. (Surge's OSC note input segfaults under
load in 1.3.4; OSC is only used for two tuning messages at startup.)

Needs: surge-xt-cli, python3-rtmidi, and python3-zmq for --zmq.
Transactions come from a node's ZMQ feed (--zmq) or, without it, a synthetic source.
"""
import argparse
import atexit
from fractions import Fraction
import math
import os
import queue
import random
import re
import socket
import struct
import subprocess
import threading
import time

SATS_PER_BCH = 100_000_000
HERE = os.path.dirname(os.path.abspath(__file__))
FACTORY = "/usr/share/surge-xt/patches_factory"
MAX_NOTE = 127


TOP_SATS = 2_100 * SATS_PER_BCH  # outputs >= this sound the lowest amount harmonic
STEP = 1 / 2  # each harmonic below that covers amounts half the size of the last
FIRST_HARMONIC = 2  # harmonic for outputs >= TOP_SATS (h1 is the block note)
BLOCK_HARMONIC = 1


def harmonic_for(sats: int, top_sats: int = TOP_SATS, step: float = STEP) -> int:
    """Rank of an amount, 1 for sats >= top; then [top*(1-step), top) -> 2, the next
    step down -> 3, ... (0 for zero-value outputs). The engine adds
    FIRST_HARMONIC - 1 to get the harmonic."""
    if sats <= 0:
        return 0
    if sats >= top_sats:
        return 1
    # ranges are [lower, upper); compare against each lower edge directly so
    # boundaries are exact (float log() or 2/3 round wrongly right at an edge)
    keep = 1 - Fraction(step).limit_denominator(10**6)  # 1/3 -> exactly 2/3
    lower = lambda h: top_sats * keep ** (h - 1)  # exact lower edge of harmonic h
    h = max(2, 1 + math.ceil(math.log(top_sats / sats) / -math.log(keep)))  # float guess
    while h > 2 and sats >= lower(h - 1):  # then correct it exactly
        h -= 1
    while sats < lower(h):
        h += 1
    return h


# ------------------------------------------------------------- tuning ----

def write_tuning(f0):
    """Scale: degree k-1 = k/1, so with note 1 = F0, note k = k * F0."""
    d = os.path.join(HERE, "tuning")
    os.makedirs(d, exist_ok=True)
    scl = os.path.join(d, "harmonics")
    kbm = os.path.join(d, f"harmonics_{f0:g}Hz")
    with open(scl + ".scl", "w") as f:
        f.write("! harmonics.scl\nHarmonic series: MIDI note k = harmonic k of f0\n")
        f.write(f" {MAX_NOTE}\n!\n" + "".join(f" {k}/1\n" for k in range(2, MAX_NOTE + 2)))
    with open(kbm + ".kbm", "w") as f:
        # map size 0 (linear), notes 0-127, middle note 1, ref note 1 = f0
        f.write(f"! harmonics_{f0:g}Hz.kbm\n0\n0\n127\n1\n1\n{f0:.6f}\n{MAX_NOTE}\n")
    return scl, kbm  # Surge wants paths without extensions


# ---------------------------------------------------------------- OSC ----

def _osc_str(s: str) -> bytes:
    b = s.encode() + b"\0"
    return b + b"\0" * (-len(b) % 4)


def osc_message(address: str, *args) -> bytes:
    tags, payload = ",", b""
    for a in args:
        if isinstance(a, str):
            tags += "s"
            payload += _osc_str(a)
        else:  # Surge wants every numeric arg as float32
            tags += "f"
            payload += struct.pack(">f", float(a))
    return _osc_str(address) + _osc_str(tags) + payload


# ---------------------------------------------------- equal loudness ----
# ISO 226:2003 equal-loudness contours: the sound pressure level (dB SPL) a
# pure tone at frequency f needs to sound as loud as a 1 kHz tone at `phon`.
_ISO_F = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
          1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500]
_ISO_AF = [0.532, 0.506, 0.480, 0.455, 0.432, 0.409, 0.387, 0.367, 0.349, 0.330, 0.315, 0.301,
           0.288, 0.276, 0.267, 0.259, 0.253, 0.250, 0.246, 0.244, 0.243, 0.243, 0.243, 0.242,
           0.242, 0.245, 0.254, 0.271, 0.301]
_ISO_LU = [-31.6, -27.2, -23.0, -19.1, -15.9, -13.0, -10.3, -8.1, -6.2, -4.5, -3.1, -2.0, -1.1,
           -0.4, 0.0, 0.3, 0.5, 0.0, -2.7, -4.1, -1.0, 1.7, 2.5, 1.2, -2.1, -7.1, -11.2, -10.7, -3.1]
_ISO_TF = [78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6, 6.2,
           4.4, 3.0, 2.2, 2.4, 3.5, 1.7, -1.3, -4.2, -6.0, -5.4, -1.5, 6.0, 12.6, 13.9, 12.3]


def equal_loudness_spl(freq, phon):
    """dB SPL for `freq` on the `phon` contour (ISO 226:2003; valid 20-90 phon).
    Between the standard's frequencies, interpolates on a log-frequency axis;
    outside 20 Hz-12.5 kHz, uses the nearest end."""
    def at(i):
        af, lu, tf = _ISO_AF[i], _ISO_LU[i], _ISO_TF[i]
        a = 4.47e-3 * (10 ** (0.025 * phon) - 1.15) + (0.4 * 10 ** ((tf + lu) / 10 - 9)) ** af
        return 10 / af * math.log10(a) - lu + 94
    if freq <= _ISO_F[0]:
        return at(0)
    if freq >= _ISO_F[-1]:
        return at(len(_ISO_F) - 1)
    for i in range(len(_ISO_F) - 1):
        if _ISO_F[i] <= freq <= _ISO_F[i + 1]:
            t = math.log(freq / _ISO_F[i]) / math.log(_ISO_F[i + 1] / _ISO_F[i])
            return at(i) * (1 - t) + at(i + 1) * t


VELSENSE_DB = 48  # the pad patch's velocity -> gain range: vel 127 = 0 dB, vel 0 = -48 dB


def loudness_velocity(h, f0, phon):
    """MIDI velocity that makes harmonic h sound as loud as harmonic 1 (the
    lowest, which needs the most level) on the `phon` contour."""
    gain_db = min(0.0, equal_loudness_spl(h * f0, phon) - equal_loudness_spl(f0, phon))
    return max(1, min(127, round(127 * (1 + gain_db / VELSENSE_DB))))


# -------------------------------------------------------------- Surge ----

def patch_path(name):
    """Project patch (patches/<name>.fxp, built on demand) or factory patch."""
    local = os.path.join(HERE, "patches", f"{name}.fxp")
    if not os.path.exists(local):
        import tools.make_patches as mp
        if f"{name}.fxp" in mp.TARGETS:
            mp.main()
    if os.path.exists(local):
        return local
    factory = os.path.join(FACTORY, f"{name}.fxp")
    if not os.path.exists(factory):
        raise FileNotFoundError(f"no patch {name!r} in patches/ or the factory library")
    return factory


def udp_port_free(port):
    """True if `port` can be bound on both IPv4 and IPv6 right now.

    Used two ways: to pick a port before starting Surge, and afterwards to
    confirm Surge really holds it. surge-xt-cli 1.3.4 sometimes logs 'Starting
    OSC input on N' without opening a listener at all (reproducibly for 53281
    on the dev machine, for no reason we found), and then silently ignores OSC,
    so the tuning never loads and notes play at standard 12-TET pitch."""
    for fam, addr in ((socket.AF_INET, "0.0.0.0"), (socket.AF_INET6, "::")):
        s = socket.socket(fam, socket.SOCK_DGRAM)
        try:
            s.bind((addr, port))
        except OSError:
            return False
        finally:
            s.close()
    return True


_claimed_ports = set()
_live_procs = set()  # every Surge we started; killed at exit even after a crash


@atexit.register
def _kill_all_synths():
    for p in list(_live_procs):
        if p.poll() is None:
            p.terminate()


def pick_osc_port(preferred):
    """First port >= preferred that is free (and whose +10 OSC-out port is too)."""
    p = preferred
    while p in _claimed_ports or (p + 10) in _claimed_ports or not (udp_port_free(p) and udp_port_free(p + 10)):
        p += 1
    _claimed_ports.update({p, p + 10})
    return p


class SurgeInstance:
    """A surge-xt-cli process fed by its own virtual MIDI port."""

    def __init__(self, name, patch, osc_port, audio_if, tuning, dry_run=False):
        if not dry_run:
            chosen = pick_osc_port(osc_port)
            if chosen != osc_port:
                print(f"note: OSC port {osc_port} is in use; {name} synth uses {chosen}")
            osc_port = chosen
        self.name, self.patch, self.osc_port = name, patch, osc_port
        self.audio_if, self.tuning, self.dry = audio_if, tuning, dry_run
        self.proc = None
        self.port_name = f"BCHSonify {name}"
        if not dry_run:
            import rtmidi
            self.midi = rtmidi.MidiOut(name="BCHSonify")
            self.midi.open_virtual_port(self.port_name)

    def _midi_index(self):
        out = subprocess.run(["surge-xt-cli", "-l"], capture_output=True, text=True).stdout
        for line in out.splitlines():
            m = re.search(r"MIDI Device: \[(\d+)\] : (.*)$", line)
            if m and m.group(2).strip() == self.port_name:
                return m.group(1)
        raise RuntimeError(f"Surge can't see MIDI port {self.port_name!r}")

    def start(self):
        if self.dry:
            print(f"  [{self.name}] start with {self.patch}")
            return
        os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
        self.log_path = os.path.join(HERE, "logs", f"surge-{self.name}.log")
        log = open(self.log_path, "w")
        self.proc = subprocess.Popen(
            ["surge-xt-cli", "--no-stdin", f"--audio-interface={self.audio_if}",
             "--sample-rate=48000", "--buffer-size=512", f"--midi-input={self._midi_index()}",
             f"--osc-in-port={self.osc_port}", f"--osc-out-port={self.osc_port + 10}",
             f"--init-patch={patch_path(self.patch)}"],
            stdout=log, stderr=subprocess.STDOUT)
        _live_procs.add(self.proc)

    def wait_ready(self, timeout=15, attempts=5):
        """Block until Surge has started audio AND really holds its OSC port.
        If it didn't open the port, restart it on the next free port."""
        if self.dry:
            return
        for _ in range(attempts):
            self._wait_audio(timeout)
            time.sleep(2.0)  # settle margin
            if not udp_port_free(self.osc_port):  # bound -> Surge is listening
                return
            old = self.osc_port
            self._kill()
            self.osc_port = pick_osc_port(old + 1)
            print(f"note: {self.name} synth didn't open OSC port {old}; retrying on {self.osc_port}")
            self.start()
        raise RuntimeError(f"{self.name} synth never opened an OSC port; tuning can't be loaded")

    def _wait_audio(self, timeout):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if not self.alive():
                raise RuntimeError(f"{self.name} synth exited during startup; see {self.log_path}")
            with open(self.log_path) as f:
                if "Audio Starting" in f.read():
                    return
            time.sleep(0.1)
        self._kill()
        raise RuntimeError(f"{self.name} synth audio didn't start (device busy? e.g. a DAW "
                           f"holding the interface); see {self.log_path}")

    def _kill(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        _live_procs.discard(self.proc)

    def load_tuning(self):
        if self.dry:
            return
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        scl, kbm = self.tuning
        for _ in range(2):  # idempotent; sent twice since OSC gives no confirmation
            sock.sendto(osc_message("/tuning/scl", scl), ("127.0.0.1", self.osc_port))
            time.sleep(0.2)
            sock.sendto(osc_message("/tuning/kbm", kbm), ("127.0.0.1", self.osc_port))
            time.sleep(0.5)

    def alive(self):
        return self.dry or (self.proc is not None and self.proc.poll() is None)

    def note_on(self, note, vel):
        note, vel = int(note), max(1, min(127, int(round(vel))))
        if self.dry:
            print(f"  [{self.name}] on  {note} vel {vel}")
        else:
            self.midi.send_message([0x90, note, vel])

    def note_off(self, note):
        if self.dry:
            print(f"  [{self.name}] off {int(note)}")
        else:
            self.midi.send_message([0x80, int(note), 0])

    def poly_at(self, note, value):
        value = max(0, min(127, int(value)))
        if self.dry:
            print(f"  [{self.name}] polyAT {int(note)} = {value}")
        else:
            self.midi.send_message([0xA0, int(note), value])

    def stop(self):
        if not self.dry:
            self.midi.send_message([0xB0, 123, 0])  # all notes off
            self._kill()


# ------------------------------------------------------------ sources ----

class SyntheticSource(threading.Thread):
    """Fake mempool: Poisson tx arrivals, log-normal amounts, payment+change."""

    def __init__(self, out_q, tx_rate):
        super().__init__(daemon=True)
        self.q, self.rate = out_q, tx_rate

    @staticmethod
    def fake_tx():
        n_out = random.choices([1, 2, 3, 5], weights=[2, 8, 2, 0.5])[0]
        outs = []
        for _ in range(n_out):
            bch = math.exp(random.gauss(math.log(0.05), 2.2))  # median 0.05 BCH
            outs.append(max(546, int(bch * SATS_PER_BCH)))
        return {"type": "tx", "outputs": outs}

    def run(self):
        next_tx = time.monotonic() + random.expovariate(self.rate)
        while True:
            now = time.monotonic()
            if now >= next_tx:
                self.q.put(self.fake_tx())
                next_tx = now + random.expovariate(self.rate)
            time.sleep(0.01)


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
    import hashlib
    return hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1].hex()


class NodeSource(threading.Thread):
    """Live transactions from a node's ZMQ rawtx feed.

    The node publishes each transaction twice: when it enters the mempool, and
    again when a block includes it. Only the first counts; a transaction already
    seen is skipped (and forgotten, since it won't come a third time). Txids in
    the mempool at startup (from --mempool-cmd) count as seen, so the first
    block doesn't replay them."""

    def __init__(self, out_q, url, mempool_cmd=None):
        super().__init__(daemon=True)
        self.q, self.url = out_q, url
        self.seen = set()
        if mempool_cmd:
            import json
            out = subprocess.run(mempool_cmd, shell=True, capture_output=True, text=True, check=True).stdout
            self.seen.update(json.loads(out))
            print(f"node: {len(self.seen)} txs already in the mempool marked as seen")

    def run(self):
        import zmq
        sock = zmq.Context.instance().socket(zmq.SUB)
        sock.connect(self.url)
        sock.setsockopt(zmq.SUBSCRIBE, b"rawtx")
        sock.setsockopt(zmq.SUBSCRIBE, b"hashblock")
        print(f"node: listening on {self.url}")
        while True:
            topic, raw, _seq = sock.recv_multipart()
            if topic == b"hashblock":
                self.q.put({"type": "block", "hash": raw.hex()})
                continue
            if topic != b"rawtx":
                continue
            txid = txid_of(raw)
            if txid in self.seen:  # block-time resend
                self.seen.discard(txid)
                continue
            self.seen.add(txid)
            try:
                outs = tx_outputs(raw)
            except (IndexError, KeyError):
                print(f"node: couldn't parse tx {txid}; skipped")
                continue
            self.q.put({"type": "tx", "txid": txid, "outputs": outs})


# ------------------------------------------------------------- engine ----

class Engine:
    def __init__(self, args, pad: SurgeInstance, block: SurgeInstance):
        # pad plays transaction notes, block plays the block note (either may be
        # None in tools that only need one)
        self.a, self.pad, self.block = args, pad, block
        self.synths = [x for x in (pad, block) if x is not None]
        self.held = {}  # harmonic -> {"synth", "note", "refreshed", "at", "life"}
        # every note starts at the same level, whatever its amount; its velocity
        # (= a fixed gain in the patch) evens out loudness across pitches
        self.peak = 127 * (1 + args.level_db / 48)  # AT 0..127 = -48..0 dB in both patches

    def freq(self, note):
        return self.a.f0 * note

    def voice(self, h):
        """MIDI note for harmonic h: with the harmonic tuning, note k = harmonic k."""
        return h if 1 <= h <= MAX_NOTE else None

    def harmonic(self, sats):
        rank = harmonic_for(sats, int(self.a.top_bch * SATS_PER_BCH), self.a.step)
        return rank + FIRST_HARMONIC - 1 if rank else 0  # 0 = zero-value output, silent

    def hold_time(self, sats):
        """hold = maxTime * (amount / amountForFirstHarmonic) ^ skew
        (--max-hold, --top-bch, --skew). Amounts at or above --top-bch get maxTime."""
        ratio = min(1.0, sats / (self.a.top_bch * SATS_PER_BCH))
        return max(1e-6, self.a.max_hold * ratio ** self.a.skew)  # >0: fade() divides by it

    # -- events --------------------------------------------------------
    def on_tx(self, tx, now):
        parts = []
        for sats in tx["outputs"]:
            h = self.harmonic(sats)
            note = self.hold(self.pad, h, now, self.hold_time(sats))
            if note is None:
                continue
            parts.append(f"{sats / SATS_PER_BCH:.8g} BCH->h{h}@{self.freq(note):.0f}Hz")
        tag = f" {tx['txid'][:12]}" if "txid" in tx else ""
        print(f"tx{tag}  {', '.join(parts)}   held={len(self.held)}")

    def on_block(self, ev, now):
        note = self.hold(self.block, BLOCK_HARMONIC, now, self.a.block_hold)
        print(f"BLOCK {ev['hash'][:16]}  ->h{BLOCK_HARMONIC}@{self.freq(note):.0f}Hz   held={len(self.held)}")

    # -- notes ---------------------------------------------------------
    # Volume is per-note polyphonic aftertouch (both patches map poly AT
    # 0..127 to -48..0 dB). A held note's AT falls linearly (= linearly in dB)
    # from its peak (--level-db) to 0 over its lifetime (hold_time), then the
    # note ends; a re-sound jumps it straight back to peak.
    def hold(self, synth, h, now, life):
        if h in self.held:
            v = self.held[h]  # re-sound: back to peak, with this trigger's hold time
            v["refreshed"], v["life"] = now, life
            return v["note"]
        note = self.voice(h)
        if note is None:
            return None
        synth.note_on(note, loudness_velocity(note, self.a.f0, self.a.phon))
        synth.poly_at(note, self.peak)  # patch is silent (-48 dB) until AT arrives
        self.held[h] = {"synth": synth, "note": note, "refreshed": now, "at": self.peak, "life": life}
        return note

    def expire(self, now):
        for h in [h for h, v in self.held.items() if now - v["refreshed"] > v["life"]]:
            v = self.held.pop(h)
            v["synth"].note_off(v["note"])  # already faded to AT 0

    def fade(self, now):
        for v in self.held.values():
            new = self.peak * max(0.0, 1 - (now - v["refreshed"]) / v["life"])
            if int(new) != int(v["at"]):
                v["synth"].poly_at(v["note"], new)
            v["at"] = new

    # -- supervision ---------------------------------------------------
    def start_synths(self):
        for s in self.synths:
            s.start()
        for s in self.synths:
            s.wait_ready()
            s.load_tuning()

    def check_synths(self):
        for s in self.synths:
            if s.alive():
                continue
            print(f"!! {s.name} synth died (see logs/surge-{s.name}.log); restarting")
            s.start()
            s.wait_ready()
            s.load_tuning()
            for v in self.held.values():
                if v["synth"] is s:
                    s.note_on(v["note"], loudness_velocity(v["note"], self.a.f0, self.a.phon))
                    s.poly_at(v["note"], v["at"])

    # -- main ----------------------------------------------------------
    def run(self, q, duration):
        self.start_synths()
        now = time.monotonic()
        end = now + duration if duration else None
        next_check = now + 1
        next_fade = now
        try:
            while end is None or time.monotonic() < end:
                now = time.monotonic()
                try:
                    while True:
                        ev = q.get_nowait()
                        if ev["type"] == "tx":
                            self.on_tx(ev, now)
                        elif ev["type"] == "block":
                            self.on_block(ev, now)
                except queue.Empty:
                    pass
                self.expire(now)
                if now >= next_fade:
                    self.fade(now)
                    next_fade = now + 0.05
                if now >= next_check:
                    self.check_synths()
                    next_check = now + 1
                time.sleep(0.005)
        except KeyboardInterrupt:
            pass
        finally:
            for s in self.synths:
                s.stop()


def make_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--f0", type=float, default=30.0, help="fundamental in Hz (default 30)")
    p.add_argument("--max-hold", type=float, default=1200,
                   help="maxTime: seconds held by outputs >= --top-bch (hold = maxTime*(amount/top)^skew)")
    p.add_argument("--block-hold", type=float, default=300,
                   help="seconds the block note holds (default 300: half the 10-minute block target)")
    p.add_argument("--skew", type=float, default=1 / 5, help="skewFactor in the hold formula (default 1/5: fifth root)")
    p.add_argument("--top-bch", type=float, default=TOP_SATS / SATS_PER_BCH,
                   help=f"outputs >= this play harmonic {FIRST_HARMONIC} (default 2100)")
    p.add_argument("--step", type=float, default=STEP,
                   help="each harmonic's amounts are this fraction smaller than the previous one's (default 1/2)")
    p.add_argument("--level-db", type=float, default=-6.0,
                   help="starting level of every pad note, dB relative to the patch (0 = full poly AT)")
    p.add_argument("--phon", type=float, default=80,
                   help="equal-loudness contour (ISO 226, 20-90 phon) used to even out loudness "
                        "across pitches; lower = quieter listening, more low-end boost (default 80)")
    p.add_argument("--zmq", help="node ZMQ endpoint, e.g. tcp://127.0.0.1:28332 (default: synthetic txs)")
    p.add_argument("--mempool-cmd", help="shell command printing the node's getrawmempool JSON (marks those as seen)")
    p.add_argument("--tx-rate", type=float, default=0.3, help="synthetic tx per second (without --zmq)")
    p.add_argument("--duration", type=float, default=0, help="stop after N seconds (0 = forever)")
    p.add_argument("--pad-patch", default="Init Sine AT Fade",
                   help="transaction-note patch in patches/ or factory path, no .fxp; must map "
                        "poly AT to volume and velocity to gain over 48 dB")
    p.add_argument("--block-patch", default="Init Saw AT Fade",
                   help="block-note patch, same requirements as --pad-patch")
    p.add_argument("--audio-if", default="0.0", help="audio device index from `surge-xt-cli -l`")
    p.add_argument("--dry-run", action="store_true", help="print notes instead of playing")
    return p


def main():
    a = make_parser().parse_args()

    tuning = write_tuning(a.f0)
    pad = SurgeInstance("pad", a.pad_patch, 53280, a.audio_if, tuning, a.dry_run)
    block = SurgeInstance("block", a.block_patch, 53282, a.audio_if, tuning, a.dry_run)
    q = queue.Queue()
    if a.zmq:
        NodeSource(q, a.zmq, a.mempool_cmd).start()
    else:
        SyntheticSource(q, a.tx_rate).start()
    Engine(a, pad, block).run(q, a.duration)


if __name__ == "__main__":
    main()
