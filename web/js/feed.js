// Event sources: the relay (live node data over WebSocket) or a synthetic
// stand-in (same model as engine.py's SyntheticSource, for working offline).

/** Default relay URL: the dev tunnel on localhost, else /ws on this site. ?relay=URL overrides. */
export function relayUrl() {
  const q = new URLSearchParams(location.search).get("relay");
  if (q) return q;
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return "ws://localhost:8765";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

export class RelayFeed {
  constructor(url, sonifier, onstatus) {
    this.url = url;
    this.s = sonifier;
    this.onstatus = onstatus || (() => {});
    this.retry = 1;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    this.onstatus("connecting");
    const ws = (this.ws = new WebSocket(this.url));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === "hello") {
        this.retry = 1;
        this.s.hello(msg);
        this.onstatus("live");
      } else {
        this.s.event(msg);
      }
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.onstatus(`disconnected; retrying in ${this.retry} s`);
      setTimeout(() => this.connect(), this.retry * 1000);
      this.retry = Math.min(30, this.retry * 2);
    };
  }

  stop() { this.closed = true; if (this.ws) this.ws.close(); }
}

export class SyntheticFeed {
  /** Poisson tx arrivals (`rate` per s); 1/2/3/5 outputs weighted 2:8:2:0.5;
   *  amounts log-normal around 0.05 BCH (sigma 2.2), at least 546 sats. No blocks. */
  constructor(sonifier, rate = 0.3) {
    this.s = sonifier;
    this.rate = rate;
    this.n = 0;
    this.s.hello({ now: Date.now() / 1000, events: [] });
    this.schedule();
  }

  schedule() {
    const wait = -Math.log(1 - Math.random()) / this.rate;
    this.timer = setTimeout(() => { this.emit(); this.schedule(); }, wait * 1000);
  }

  emit() {
    const r = Math.random() * 12.5;
    const nOut = r < 2 ? 1 : r < 10 ? 2 : r < 12 ? 3 : 5;
    const outputs = [];
    for (let i = 0; i < nOut; i++) {
      const g = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
      const bch = Math.exp(Math.log(0.05) + 2.2 * g);
      outputs.push(Math.max(546, Math.floor(bch * 1e8)));
    }
    this.s.event({ type: "tx", t: this.s.serverNow(), txid: `synthetic-${++this.n}`, outputs });
  }

  stop() { clearTimeout(this.timer); }
}
