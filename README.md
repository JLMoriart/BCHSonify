# Spirits of Bitcoin

**See and hear the Bitcoin Cash network.** A live mempool visualizer and sonifier: every transaction is a spirit
waiting on a pier for the ferry, every block is the boat that takes them, and every output rings its own chime.

- **Live:** https://spiritsofbitcoin.cash/
- **Slides:** https://spiritsofbitcoin.cash/slides.pdf
- **Music:** https://spiritsofbitcoin.cash/music.html

Built for [BCH BLAZE 2026](https://dorahacks.io/hackathon/bchblaze2026/detail). The code was all written
during the hackathon; only the BCH Radio songs existed before it.

## What you see

Each unconfirmed transaction is a spirit, and the line is the mempool, ordered by fee rate:

- **Lantern colour:** fee rate (satoshis per byte)
- **Size:** transaction size in bytes (not the amount sent)
- **Luggage:** one piece for each output after the first
- **Certificate:** carries CashTokens NFTs
- **Coin:** carries fungible CashTokens
- **Scroll:** has an OP_RETURN output
- **Sparkler instead of a lantern:** a donation to the site

When a block is mined, a lantern-lit boat comes in and the spirits it confirmed fly aboard. Click a spirit to
see its transaction's details.

## What you hear

Every pitch is a harmonic of one 30 Hz fundamental.

- **Each output sounds a chime.** Bigger amounts play lower harmonics, one step per halving: from the 2nd
  harmonic (2,100 BCH or more) up to the 31st (dust). The chime's other partials are the harmonics of 30 Hz
  closest to the overtones of an ideal metal bar.
- **A note fades over a hold time set by its amount:** 1200 s × (amount / 2100 BCH)^(1/5). So 1 BCH rings
  for about 4 minutes, 10,000 sats for about 40 s, and dust for about 20 s. The rules are in
  [web/js/mapping.js](web/js/mapping.js).
- **Each block strikes the fundamental.** It holds longer the fuller the block is.
- **BCH Radio** swaps the sonification for songs about Bitcoin Cash, with their lyrics in the sky. Everyone
  hears the same song at the same moment.

All of the sound is made in the browser with Web Audio. Nothing is streamed except the radio's songs.

## Using BCH on the site

- **Fireworks!** Donate to set off fireworks over the scene, and bigger amounts get fancier fireworks. Pay by
  QR code, or connect a wallet with **WizardConnect** and sign there.
- **Music shop** ([music.html](https://spiritsofbitcoin.cash/music.html)):
  - every song streams and downloads free as an mp3
  - the full-quality .wav costs 10,000 sats per track
  - each order gets a fresh address derived from the shop's xpub, so there's no wallet on the server
  - payments are seen in the mempool at 0-conf, and the download unlocks straight away

## How it works

```
BCHN node ──ZMQ (rawtx, hashblock)──▶ server/relay.py ──WebSocket /ws──▶ browser
             read-only bitcoin-cli ─▶   ├─ shop.py: orders, payments ──▶ /shop/*
             (fees, block sizes)        └─ hdkey.py: an address per order
                                                     Caddy: https, /dl/ for paid .wavs
```

- **[server/relay.py](server/relay.py)** reads the node's ZMQ feed and sends each client a compact event per
  transaction (outputs, size, fee, token and OP_RETURN flags) and per block. A newcomer first gets the
  current mempool and the last 20 minutes of events, so the scene and the sound are already full when the
  page opens. It also watches for donations and shop payments.
- **[server/shop.py](server/shop.py)** creates orders and checks payments. Each order has its own receive
  address, derived from the xpub by [server/hdkey.py](server/hdkey.py) (pure Python BIP32 and CashAddress).
  Unpaid addresses are reused, lowest first, so the wallet never sees a gap of more than 20 unused addresses.
  Caddy asks the shop before serving any paid .wav.
- **The browser** does everything else:
  - [web/js/visualizer.js](web/js/visualizer.js): the scene, drawn on a canvas
  - [web/js/sonifier.js](web/js/sonifier.js) and [web/js/blocksound.js](web/js/blocksound.js): the synthesis
  - [web/js/radio.js](web/js/radio.js): BCH Radio
  - [web/js/donate.js](web/js/donate.js) and [web/js/wizard.js](web/js/wizard.js): donations and WizardConnect
  - [web/js/music.js](web/js/music.js): the shop page

There's no build step and no framework. One vendored bundle,
[web/vendor/wizardconnect.js](web/vendor/wizardconnect.js), holds WizardConnect, libauth and a QR code
generator. It's built from [tools/vendor](tools/vendor).

## Run it locally

Needs Python 3.

```sh
./run_web.sh
```

Then open one of these:

| Page | What it is |
|---|---|
| `http://localhost:8000/studio.html?source=synthetic` | The scene and sound on made-up traffic. No server needed. |
| `http://localhost:8000/studio.html` | Live data, tunnelled from a relay over SSH. Set `BCHSONIFY_VPS=user@host` in `run_node.env`. |
| `http://localhost:8000/` | The visitors' page. |

The studio adds test controls and the sound workbench, where every synthesis parameter can be tuned and saved
as the site's default (`web/sound.json`).

## Deploy your own

You need:
- a Bitcoin Cash Node with ZMQ: `zmqpubrawtx` and `zmqpubhashblock` on `tcp://127.0.0.1:28332`. A pruned node
  is fine.
- an Ubuntu server you can SSH into as root
- a domain pointing at that server

Settings go in `run_node.env`, which is untracked:

```sh
BCHSONIFY_VPS=root@your.server
BCHSONIFY_SITE=example.com
BCHSONIFY_REDIRECTS="www.example.com"   # optional: other addresses that redirect to the site
BCHSONIFY_XPUB=xpub…                    # optional: the music shop's account xpub
```

```sh
server/deploy.sh       # the relay (systemd, its own user, read-only bitcoin-cli via sudoers)
server/deploy_web.sh   # the site (Caddy, with https certificates handled automatically)
```

Both are safe to run again. The music is built from `.wav` files in `songs/`, which isn't in the repo:
- `tools/make_radio.py` makes BCH Radio's playlist
- `tools/make_music.py` makes the shop's catalog

The mp3s are encoded on the server, so only the .wavs are uploaded.

## The Python prototype

[engine.py](engine.py) is where the sonification started: the same mapping, played through
[Surge XT](https://surge-synthesizer.github.io/) over MIDI with a harmonic-series tuning. Run it with
`./run_local.sh` on synthetic traffic, or with `./run_node.sh` on live traffic. It's now the reference for the
browser's mapping, and [tools/check_mapping.py](tools/check_mapping.py) checks that the two agree.

## Credits

- Made by John Moriarty.
- [web/vendor/wizardconnect.js](web/vendor/wizardconnect.js) bundles:
  - [@wizardconnect/core and @wizardconnect/dapp](https://gitlab.com/riftenlabs/lib/wizardconnect)
    (LGPL-3.0-or-later)
  - @bitauth/libauth, @noble/\*, @scure/\*, eventemitter3, lossless-json and qrcode-generator (MIT)
  - nostr-tools (Unlicense)

## License

The code is public domain, under [the Unlicense](LICENSE): use it for anything, no credit needed.

Two things are not covered:
- **[web/vendor/wizardconnect.js](web/vendor/wizardconnect.js)** keeps its own licences (listed above).
- **The songs, their lyrics** (in [web/radio/radio.json](web/radio/radio.json)) **and the slides**
  ([web/slides.pdf](web/slides.pdf)) are © John Moriarty, all rights reserved.
