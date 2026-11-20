// The music page: the tracks (music.json) to play, and to download free as mp3s; their .wavs for sale, bought
// one at a time ("Buy now") or several in one payment (the cart). A purchase is an order made by the shop on
// the server (server/shop.py): its own address in the seller's wallet and an amount, paid from any BCH wallet
// (the QR code, or "Open in a wallet"), and a key, which only this browser gets, that downloads its .wavs.
//
// Kept in this browser (localStorage): the cart, and the orders (paid or waiting), so purchases stay
// downloadable here.

const $ = (id) => document.getElementById(id);
const CART_KEY = "bchsonify.cart", ORDERS_KEY = "bchsonify.orders";
const POLL_MS = 2000;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } },
};
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const fmtTime = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "–:––");
const fmtSats = (n) => `${n.toLocaleString("en-US")} sats`;
const fmtBch = (n) => `${(n / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} BCH`;
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>',
};

let catalog = { price: 0, tracks: [] };
let byId = new Map();
let cart = store.get(CART_KEY, []);
let orders = store.get(ORDERS_KEY, []); // [{ id, key, tracks, amount, status, created }]
const rows = new Map(); // track id -> its row's parts

// ---- playing: one audio element, so starting a track stops whichever was playing
const player = $("player");
let current = null; // the track id loaded in the player
function playTrack(id) {
  const t = byId.get(id);
  if (current === id) { if (player.paused) player.play().catch(() => {}); else player.pause(); return; }
  current = id;
  player.src = t.mp3;
  player.play().catch(() => {});
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: "Spirits of Bitcoin" });
  showPlaying();
}
function showPlaying() {
  for (const [id, r] of rows) {
    const on = id === current && !player.paused;
    r.li.classList.toggle("playing", id === current);
    r.play.innerHTML = on ? ICON.pause : ICON.play;
    r.play.setAttribute("aria-label", `${on ? "Pause" : "Play"} ${byId.get(id).title}`);
    if (id !== current) { r.seek.value = 0; r.at.textContent = "0:00"; }
  }
}
player.addEventListener("play", showPlaying);
player.addEventListener("pause", showPlaying);
player.addEventListener("ended", () => { // on to the next track
  const i = catalog.tracks.findIndex((t) => t.id === current);
  if (i >= 0 && i + 1 < catalog.tracks.length) playTrack(catalog.tracks[i + 1].id); else showPlaying();
});
player.addEventListener("timeupdate", () => {
  const r = rows.get(current);
  if (!r || r.dragging) return;
  const d = player.duration || byId.get(current).seconds;
  r.seek.value = d ? (player.currentTime / d) * 1000 : 0;
  r.at.textContent = fmtTime(player.currentTime);
});

// ---- the track list
function owns(id) { return orders.some((o) => o.status === "paid" && o.tracks.includes(id)); }
function paidOrderFor(id) { return orders.find((o) => o.status === "paid" && o.tracks.includes(id)); }
const wavUrl = (o, id) => `dl/${o.id}/${o.key}/${id}.wav`;
const wavName = (id) => `${byId.get(id).title} - Spirits of Bitcoin.wav`;

function buildTracks() {
  const list = $("tracks");
  list.replaceChildren();
  for (const t of catalog.tracks) {
    const play = el("button", { type: "button", className: "play", innerHTML: ICON.play });
    play.onclick = () => playTrack(t.id);
    const seek = el("input", { type: "range", min: 0, max: 1000, value: 0, step: 1 });
    seek.setAttribute("aria-label", `Position in ${t.title}`);
    const at = el("span", { textContent: "0:00" });
    const r = { li: null, play, seek, at, dragging: false, actions: el("div", { className: "actions" }) };
    seek.addEventListener("pointerdown", () => { r.dragging = true; });
    seek.addEventListener("input", () => {
      if (current !== t.id) playTrack(t.id);
      const d = player.duration || t.seconds;
      at.textContent = fmtTime((seek.value / 1000) * d);
    });
    seek.addEventListener("change", () => {
      r.dragging = false;
      const d = player.duration || t.seconds;
      const go = () => { player.currentTime = (seek.value / 1000) * d; };
      if (player.readyState >= 1) go(); else player.addEventListener("loadedmetadata", go, { once: true });
    });
    r.li = el("li", { className: "track" }, play,
      el("div", { className: "info" }, el("div", { className: "title", textContent: t.title }),
        el("div", { className: "seek" }, at, seek, el("span", { textContent: fmtTime(t.seconds) }))),
      r.actions);
    rows.set(t.id, r);
    list.append(r.li);
  }
  showActions();
  showPlaying();
}

const priceNote = () => `Higher quality, ${catalog.price.toLocaleString("en-US")} satoshis (${fmtBch(catalog.price)})`;

function showActions() {
  for (const t of catalog.tracks) {
    const r = rows.get(t.id);
    const free = el("div", { className: "offer" },
      el("a", { className: "button", href: t.mp3, download: `${t.title} - Spirits of Bitcoin.mp3`, textContent: "Download mp3" }),
      el("span", { className: "note", textContent: "lower quality, free" }));
    const paid = el("div", { className: "offer paid" });
    const o = paidOrderFor(t.id);
    if (o) {
      paid.append(el("a", { className: "button primary", href: wavUrl(o, t.id), download: wavName(t.id), textContent: "Download wav" }),
        el("span", { className: "note", textContent: `Higher quality, purchased (${(t.wavBytes / 1e6).toFixed(0)} MB)` }));
    } else {
      const inCart = cart.includes(t.id);
      const buy = el("button", { type: "button", className: "primary", textContent: "Purchase wav" });
      buy.onclick = () => checkout([t.id]);
      const add = el("button", { type: "button", className: inCart ? "incart" : "", textContent: inCart ? "In cart ✓" : "Add to cart" });
      add.title = inCart ? "Take it out of the cart" : "Add the .wav to the cart";
      add.onclick = () => (inCart ? removeFromCart(t.id) : addToCart(t.id));
      paid.append(buy, add, el("span", { className: "note", textContent: priceNote() }));
    }
    r.actions.replaceChildren(free, paid);
  }
  showBulk();
}

// the top: every mp3 in one download, and every .wav not yet bought in one purchase (or, all bought, all downloaded)
function showBulk() {
  const left = catalog.tracks.filter((t) => !owns(t.id)), btn = $("allWav"), total = left.length * catalog.price;
  const each = `Higher quality, ${catalog.price.toLocaleString("en-US")} sats or ${fmtBch(catalog.price)} per track.`;
  if (!left.length) {
    btn.textContent = "Download all wavs";
    $("allWavNote").textContent = "Higher quality, all purchased";
    btn.onclick = () => catalog.tracks.forEach((t, i) => setTimeout(() => {
      const a = el("a", { href: wavUrl(paidOrderFor(t.id), t.id), download: wavName(t.id) });
      document.body.append(a); a.click(); a.remove();
    }, i * 800));
    return;
  }
  btn.textContent = "Purchase all wavs";
  const some = left.length < catalog.tracks.length ? ` (the ${left.length} you don't have yet)` : "";
  $("allWavNote").replaceChildren(el("span", { className: "line", textContent: each }),
    el("span", { className: "line", textContent: `Total: ${fmtSats(total)}, ${fmtBch(total)}${some}` }));
  btn.onclick = () => checkout(left.map((t) => t.id));
}

// ---- the cart
function saveCart() { store.set(CART_KEY, cart); showCart(); showActions(); }
function addToCart(id) { if (!cart.includes(id)) cart.push(id); saveCart(); }
function removeFromCart(id) { cart = cart.filter((c) => c !== id); saveCart(); }
function showCart() {
  cart = cart.filter((id) => byId.has(id) && !owns(id));
  const list = $("cartList");
  list.replaceChildren(...cart.map((id) => {
    const x = el("button", { type: "button", textContent: "×" });
    x.setAttribute("aria-label", `Remove ${byId.get(id).title}`);
    x.onclick = () => removeFromCart(id);
    return el("li", {}, el("span", { className: "name", textContent: byId.get(id).title }), el("span", { className: "sats", textContent: fmtSats(catalog.price) }), x);
  }));
  const total = cart.length * catalog.price;
  $("cartEmpty").hidden = cart.length > 0;
  $("cartFoot").hidden = !cart.length;
  $("cartTotal").textContent = fmtSats(total);
  $("cartCount").textContent = cart.length;
  $("cartCount").dataset.n = cart.length;
  $("cartBarTotal").textContent = cart.length ? fmtSats(total) : "";
}
$("cartToggle").onclick = () => {
  const open = $("cart").classList.toggle("open");
  $("cartToggle").setAttribute("aria-expanded", String(open));
};
$("checkout").onclick = () => { if (cart.length) checkout([...cart]); };

// ---- orders: made by the shop, kept here
function keepOrder(v, key) {
  const o = { id: v.id, key, tracks: v.tracks, amount: v.amount, status: v.status, created: Date.now() };
  orders = [o, ...orders.filter((x) => x.id !== v.id)];
  saveOrders();
  return o;
}
function saveOrders() {
  // unpaid ones are dropped once they can't be paid any more (the shop forgets them too)
  orders = orders.filter((o) => o.status === "paid" || o.status === "partial" || Date.now() - o.created < 4 * 3600e3);
  store.set(ORDERS_KEY, orders);
  showBought();
}
async function api(path, opts) {
  let r;
  try { r = await fetch(path, { cache: "no-store", ...opts }); } catch { throw new Error("The shop can't be reached. Check your connection and try again."); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `The shop isn't available right now (${r.status}).`), { status: r.status });
  return body;
}

// the tracks' buttons and the cart, after an order changes (a track bought shows "Download wav")
function showBought() { if (byId.size) { showActions(); showCart(); } }

// ---- paying
const dialog = $("pay");
let shown = null, poll = 0;
dialog.querySelector(".close").onclick = () => dialog.close();
dialog.addEventListener("close", () => { clearTimeout(poll); shown = null; });

async function checkout(tracks) {
  // an order already waiting for exactly these tracks (or part paid) is shown again, not made twice: so a
  // payment window closed before paying in full comes back, with what's still to pay
  const same = orders.find((o) => (o.status === "open" || o.status === "partial") && o.tracks.length === tracks.length && o.tracks.every((t) => tracks.includes(t)));
  if (same) { openOrder(same); return; }
  showDialog({ tracks, busy: true });
  try {
    const v = await api("shop/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tracks }) });
    const o = keepOrder(v, v.key);
    if (tracks.length > 1 || cart.includes(tracks[0])) { cart = cart.filter((c) => !tracks.includes(c)); saveCart(); }
    openOrder(o, v);
  } catch (e) { showError(e.message); }
}

async function openOrder(o, v) {
  shown = o;
  showDialog({ tracks: o.tracks, busy: !v });
  if (!dialog.open) dialog.showModal();
  if (!v) {
    try { v = await api(`shop/order/${o.id}?key=${encodeURIComponent(o.key)}`); } catch (e) { showError(e.message); return; }
  }
  if (shown !== o) return;
  await showOrder(o, v);
}

function showDialog({ tracks, busy }) {
  $("payTracks").replaceChildren(...tracks.filter((id) => byId.has(id)).map((id) => el("li", { textContent: byId.get(id).title })));
  $("payWait").hidden = false; $("payDone").hidden = true; $("payError").hidden = true;
  $("payQr").replaceChildren(); $("payAmount").textContent = ""; $("payBch").textContent = ""; $("payAddress").textContent = "";
  $("payStatus").textContent = busy ? "Making your order…" : ""; $("payStatus").className = "status";
  for (const b of ["payOpen", "payCopy", "payCopyAmount"]) $(b).hidden = busy;
  if (!dialog.open) dialog.showModal();
}
function showError(msg) {
  $("payStatus").textContent = "";
  $("payError").textContent = msg;
  $("payError").hidden = false;
}

let qrLib = null;
async function qrSvg(text) {
  qrLib ||= import("../vendor/wizardconnect.js").then((m) => m.qrcode);
  const qrcode = await qrLib, qr = qrcode(0, "M");
  qr.addData(text); qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

async function showOrder(o, v) {
  o.status = v.status; o.amount = v.amount;
  saveOrders();
  if (v.status === "paid") {
    $("payWait").hidden = true; $("payDone").hidden = false;
    $("payDownloads").replaceChildren(...o.tracks.filter((id) => byId.has(id)).map((id) =>
      el("li", {}, el("a", { className: "button primary", href: wavUrl(o, id), download: wavName(id), textContent: `${byId.get(id).title}.wav ↓  (${(byId.get(id).wavBytes / 1e6).toFixed(0)} MB)` }))));
    return;
  }
  const left = v.amount - v.received;
  $("payAmount").textContent = fmtSats(left);
  $("payBch").textContent = `(${fmtBch(left)})`;
  $("payAddress").textContent = v.address;
  const uri = left === v.amount ? v.uri : `${v.address}?amount=${(left / 1e8).toFixed(8).replace(/0+$/, "")}`;
  $("payOpen").href = uri;
  $("payCopy").onclick = () => copy($("payCopy"), v.address, "Copy address");
  $("payCopyAmount").onclick = () => copy($("payCopyAmount"), (left / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, ""), "Copy amount");
  for (const b of ["payOpen", "payCopy", "payCopyAmount"]) $(b).hidden = false;
  if ($("payQr").dataset.uri !== uri) {
    $("payQr").dataset.uri = uri;
    $("payQr").innerHTML = await qrSvg(uri).catch(() => "");
  }
  const st = $("payStatus");
  if (v.status === "partial") { st.textContent = `Received ${fmtSats(v.received)} of ${fmtSats(v.amount)}. Send the rest to the same address.`; st.className = "status got"; }
  else if (v.status === "expired") st.textContent = "This order has expired, but a payment to it still counts for a while. To start again, close this and check out again.";
  else st.textContent = `Waiting for your payment… (scan with any Bitcoin Cash wallet; pay within ${fmtTime((v.expires - Date.now() / 1000))})`;
  clearTimeout(poll);
  poll = setTimeout(async () => {
    if (shown !== o) return;
    try { const nv = await api(`shop/order/${o.id}?key=${encodeURIComponent(o.key)}`); if (shown === o) await showOrder(o, nv); }
    catch (e) { if (shown === o) { showError(e.message); poll = setTimeout(() => showOrder(o, v), POLL_MS * 3); } }
  }, document.hidden ? POLL_MS * 5 : POLL_MS);
}

async function copy(btn, text, label) {
  try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; } catch { btn.textContent = "Couldn't copy"; }
  setTimeout(() => { btn.textContent = label; }, 1500);
}

// ---- start: the track list, then the latest status of orders still waiting
(async () => {
  try {
    const r = await fetch("music.json"); // (as the page's preload asks for it, so that one download serves both)
    catalog = await r.json();
  } catch { $("tracks").replaceChildren(); $("loadError").hidden = false; return; }
  byId = new Map(catalog.tracks.map((t) => [t.id, t]));
  buildTracks();
  showCart();
  for (const o of orders.filter((x) => x.status !== "paid")) { // paid while this page was closed?
    api(`shop/order/${o.id}?key=${encodeURIComponent(o.key)}`).then((v) => { o.status = v.status; saveOrders(); }).catch((e) => {
      if (e.status === 404) { orders = orders.filter((x) => x !== o); saveOrders(); }
    });
  }
})();
