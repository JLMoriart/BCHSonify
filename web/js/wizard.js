// Donating from a wallet connected with WizardConnect (https://wizardconnect-456f57.gitlab.io). The wallet only
// shares its extended public keys and signs; this page finds its coins (on public Fulcrum servers), builds the
// donation transaction, and asks the wallet to sign and broadcast it. Libraries: web/vendor/wizardconnect.js,
// built in tools/vendor.
import {
  DappConnectionManager, binToHex, cashAddressToLockingBytecode, encodeLockingBytecodeP2pkh, encodeTransaction,
  hash160, hashTransaction, hexToBin, initiateDappRelay, qrcode, sha256,
} from "../vendor/wizardconnect.js";

// public BCH Fulcrum servers (Electrum protocol over WebSocket), tried in a random order
const FULCRUM = [
  "wss://bch.imaginary.cash:50004", "wss://electrum.imaginary.cash:50004", "wss://fulcrum.greyh.at:50004",
  "wss://bch.soul-dev.com:50004", "wss://blackie.c3-soft.com:50004", "wss://electroncash.dk:50004", "wss://bch.loping.net:50004",
];
const PATHS = [["receive", 0], ["change", 1]]; // the wallet's paths we spend from: name, child index
const GAP = 20, MAX_SCAN = 400;                // stop a path after this many unused addresses in a row; and at most this many
const FEE_RATE = 1, DUST = 546;                // sats per byte; smallest output worth making
const IN_BYTES = 148, OUT_BYTES = 34, TX_BYTES = 10; // P2PKH sizes, at most

// Pair with a wallet. pairing(uri, qrSvg): show the pairing link and its QR code; status(text): progress.
// Resolves once the wallet is connected, with { walletName, donate(address, sats, status) -> txid, close() }.
export function connect({ name, pairing, status }) {
  return new Promise((resolve, reject) => {
    const mgr = new DappConnectionManager(name, undefined, { session: false });
    const relay = initiateDappRelay((p) => mgr.updateConnection(p.client, p.status));
    mgr.attachRelay(relay);
    const qr = qrcode(0, "M");
    qr.addData(relay.qrUri || relay.uri); qr.make();
    pairing(relay.uri, qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
    const close = () => { mgr.sendDisconnect("closed").catch(() => {}).finally(() => relay.cleanup()); };
    mgr.on("walletready", () => resolve({ walletName: mgr.walletName, donate: (a, s, st) => donate(mgr, a, s, st), close }));
    mgr.on("disconnect", (_reason, message) => { relay.cleanup(); reject(new Error(message || "the wallet disconnected")); });
    mgr.on("reconnecting", () => status("Reconnecting to the relay…"));
  });
}

async function donate(mgr, address, sats, status) {
  const to = cashAddressToLockingBytecode(address);
  if (typeof to === "string") throw new Error(to);
  status("Looking up your wallet's coins…");
  const fulcrum = await Fulcrum.open();
  try {
    const { coins, changeIndex } = await findCoins(mgr, fulcrum);
    // biggest coins first, until they cover the donation and the fee (with change back, if it's worth having)
    coins.sort((a, b) => b.value - a.value);
    const fee = (nIn, nOut) => Math.ceil((TX_BYTES + IN_BYTES * nIn + OUT_BYTES * nOut) * FEE_RATE);
    const use = [];
    let total = 0;
    for (const c of coins) {
      use.push(c); total += c.value;
      if (total >= sats + fee(use.length, 1)) break;
    }
    if (total < sats + fee(use.length, 1)) {
      throw new Error(`not enough BCH: the wallet has ${(coins.reduce((a, c) => a + c.value, 0) / 1e8).toFixed(8)} BCH to spend (tokens are left alone)`);
    }
    const change = total - sats - fee(use.length, 2);
    const inputs = use.map((c) => ({ outpointTransactionHash: hexToBin(c.tx_hash), outpointIndex: c.tx_pos, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array() }));
    const outputs = [{ lockingBytecode: to.bytecode, valueSatoshis: BigInt(sats) }];
    if (change >= DUST) outputs.push({ lockingBytecode: lockOf(mgr, 1, changeIndex), valueSatoshis: BigInt(change) });
    const tx = { version: 2, inputs, outputs, locktime: 0 };
    status("Approve the donation in your wallet…");
    const resp = await mgr.signTransaction({
      transaction: {
        transaction: binToHex(encodeTransaction(tx)),
        sourceOutputs: use.map((c, i) => relayJson({ ...inputs[i], lockingBytecode: c.lock, valueSatoshis: BigInt(c.value) })),
        broadcast: true,
        userPrompt: `Donate ${(sats / 1e8).toFixed(8).replace(/\.?0+$/, "")} BCH to Spirits of Bitcoin`,
      },
      inputPaths: use.map((c, i) => [i, c.path, c.index]),
    });
    if (resp.error) throw new Error(resp.error);
    const signed = resp.signedTransaction, txid = hashTransaction(hexToBin(signed));
    status("Sending…");
    try { await fulcrum.call("blockchain.transaction.broadcast", [signed]); } catch (e) { // the wallet may have sent it already
      if (!/already|known|in block|mempool/i.test(e.message)) throw e;
    }
    return txid;
  } finally { fulcrum.close(); }
}

// the locking bytecode of the wallet's address `index` on child path `child`
function lockOf(mgr, child, index) {
  const pub = mgr.getPubkey(child, BigInt(index));
  if (!pub) throw new Error("the wallet didn't share that address");
  return encodeLockingBytecodeP2pkh(hash160(pub));
}
const scripthash = (lock) => binToHex(sha256.hash(lock).reverse()); // Electrum's address key

// Walk each path in batches until GAP unused addresses in a row: its plain BCH coins, and the first unused
// change address (for the change).
async function findCoins(mgr, fulcrum) {
  const coins = [];
  let changeIndex = 0;
  for (const [path, child] of PATHS) {
    if (!mgr.hasPath(child)) continue;
    let lastUsed = -1;
    for (let start = 0; start < MAX_SCAN && start <= lastUsed + GAP; start += GAP) {
      const batch = [];
      for (let i = start; i < start + GAP; i++) { const lock = lockOf(mgr, child, i); batch.push({ i, lock, sh: scripthash(lock) }); }
      const res = await Promise.all(batch.flatMap((b) => [fulcrum.call("blockchain.scripthash.get_history", [b.sh]), fulcrum.call("blockchain.scripthash.listunspent", [b.sh])]));
      batch.forEach((b, k) => {
        if (res[2 * k].length) lastUsed = b.i;
        for (const u of res[2 * k + 1]) if (!u.token_data) coins.push({ ...u, path, index: b.i, lock: b.lock });
      });
    }
    if (child === 1) changeIndex = lastUsed + 1;
  }
  return { coins, changeIndex };
}

// a source output in the relay's JSON: bytes as hex, amounts as "<bigint: Nn>"
function relayJson(so) {
  return {
    outpointTransactionHash: binToHex(so.outpointTransactionHash), outpointIndex: so.outpointIndex,
    unlockingBytecode: binToHex(so.unlockingBytecode), sequenceNumber: so.sequenceNumber,
    valueSatoshis: `<bigint: ${so.valueSatoshis}n>`, lockingBytecode: binToHex(so.lockingBytecode),
  };
}

// A minimal Electrum-protocol client over WebSocket.
class Fulcrum {
  static async open() {
    const order = [...FULCRUM].sort(() => Math.random() - 0.5);
    for (const url of order) {
      try { const f = new Fulcrum(); await f.connect(url); return f; } catch { /* next one */ }
    }
    throw new Error("couldn't reach any BCH server to look up the wallet's coins");
  }
  connect(url) {
    this.id = 0; this.wait = new Map();
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(url)), timer = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 6000);
      ws.onerror = () => { clearTimeout(timer); reject(new Error("unreachable")); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data), w = this.wait.get(m.id);
        if (!w) return;
        this.wait.delete(m.id);
        m.error ? w.reject(new Error(m.error.message || String(m.error))) : w.resolve(m.result);
      };
      ws.onopen = () => this.call("server.version", ["BCHSonify", "1.5"]).then(() => { clearTimeout(timer); resolve(); }, reject);
      ws.onclose = () => { for (const w of this.wait.values()) w.reject(new Error("the server closed the connection")); this.wait.clear(); };
    });
  }
  call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.wait.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch { /* gone */ } }
}
