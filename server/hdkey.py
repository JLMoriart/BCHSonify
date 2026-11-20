"""Receiving addresses from a wallet's extended public key (xpub): BIP32 public derivation, CashAddress.

Only public keys: an xpub can make addresses and see their payments, never spend. Pure Python (no
libraries), used by the shop (shop.py) to give every order its own address in the seller's wallet.

  python3 server/hdkey.py <xpub> [count]   prints the first receiving addresses (path .../0/i)
"""
import hashlib
import hmac
import sys

# secp256k1
P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0:
        return None
    if a == b:
        m = 3 * a[0] * a[0] * pow(2 * a[1], -1, P) % P
    else:
        m = (b[1] - a[1]) * pow(b[0] - a[0], -1, P) % P
    x = (m * m - a[0] - b[0]) % P
    return x, (m * (a[0] - x) - a[1]) % P


def _mul(k, pt=G):
    out = None
    while k:
        if k & 1:
            out = _add(out, pt)
        pt, k = _add(pt, pt), k >> 1
    return out


def _decompress(b):
    x = int.from_bytes(b[1:], "big")
    y = pow((x * x * x + 7) % P, (P + 1) // 4, P)
    if y & 1 != b[0] & 1:
        y = P - y
    if (y * y - x * x * x - 7) % P:
        raise ValueError("not a point on the curve")
    return x, y


def _compress(pt):
    return bytes([2 + (pt[1] & 1)]) + pt[0].to_bytes(32, "big")


def _b58check(s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    raw = b"\0" * (len(s) - len(s.lstrip("1"))) + raw
    body, check = raw[:-4], raw[-4:]
    if hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4] != check:
        raise ValueError("bad xpub checksum")
    return body


class XPub:
    """An extended public key: .depth, .key (33 bytes, compressed), .chain; .child(i) for non-hardened i."""

    def __init__(self, key, chain, depth=0):
        self.key, self.chain, self.depth = key, chain, depth

    @classmethod
    def parse(cls, text):
        b = _b58check(text.strip())
        if len(b) != 78 or b[:4] != bytes.fromhex("0488b21e"):
            raise ValueError("not a mainnet xpub (it should start with 'xpub')")
        key = b[45:78]
        _decompress(key)  # a real point, or this raises
        return cls(key, b[13:45], b[4])

    def child(self, i):
        if not 0 <= i < 2**31:
            raise ValueError("only non-hardened children can come from a public key")
        h = hmac.new(self.chain, self.key + i.to_bytes(4, "big"), hashlib.sha512).digest()
        t = int.from_bytes(h[:32], "big")
        if t >= N:
            raise ValueError("invalid child (skip this index)")
        pt = _add(_mul(t), _decompress(self.key))
        if pt is None:
            raise ValueError("invalid child (skip this index)")
        return XPub(_compress(pt), h[32:], self.depth + 1)

    def hash160(self):
        return hashlib.new("ripemd160", hashlib.sha256(self.key).digest()).digest()


def p2pkh_script(h160):
    return b"\x76\xa9\x14" + h160 + b"\x88\xac"


def cashaddr(h160, prefix="bitcoincash"):
    """The CashAddress (P2PKH) for a 20-byte public key hash."""
    charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    data, acc, bits = [], 0, 0
    for b in b"\x00" + h160:  # version byte 0: P2PKH, 160-bit hash
        acc, bits = acc << 8 | b, bits + 8
        while bits >= 5:
            bits -= 5
            data.append(acc >> bits & 31)
    if bits:
        data.append(acc << (5 - bits) & 31)
    c = 1
    for d in [ord(ch) & 31 for ch in prefix] + [0] + data + [0] * 8:
        c0, c = c >> 35, ((c & 0x07ffffffff) << 5) ^ d
        for k, g in enumerate((0x98f2bc8e61, 0x79b76d99e2, 0xf33e5fb3c4, 0xae2eabe2a8, 0x1e4f43e470)):
            if c0 >> k & 1:
                c ^= g
    c ^= 1
    return prefix + ":" + "".join(charset[d] for d in data) + "".join(charset[c >> 5 * (7 - k) & 31] for k in range(8))


if __name__ == "__main__":
    x = XPub.parse(sys.argv[1])
    print(f"depth {x.depth}", "(an account key, as wallets export: m/44'/145'/0')" if x.depth == 3 else "")
    receive = x.child(0)
    for i in range(int(sys.argv[2]) if len(sys.argv) > 2 else 3):
        print(f"0/{i}  {cashaddr(receive.child(i).hash160())}")
