// The "Celebrate! / Donate" button in the corner of the scene, and its dialog: donate from a wallet connected
// with WizardConnect (pick an amount, then sign in the wallet), or with a QR code any BCH wallet can scan.
// Every donation sends up a firework; the amount picks the sea animal it becomes (fireworks.js).
import { ANIMALS, FIRST_ANIMAL_SATS, fireworkTier } from "./fireworks.js";

const AMOUNTS = ANIMALS.map((name, k) => ({ sats: FIRST_ANIMAL_SATS * 2 ** k, name }));
const btc = (sats) => (sats / 1e8).toFixed(8).replace(/\.?0+$/, "");
const title = (s) => s[0].toUpperCase() + s.slice(1);

export async function setupDonate(button, dialog) {
  let address = "";
  try { address = ((await (await fetch("donate.json", { cache: "no-cache" })).json()).address || "").trim(); } catch { /* none */ }
  const $ = (sel) => dialog.querySelector(sel);
  button.onclick = () => { dialog.showModal(); };
  $(".close").onclick = () => dialog.close();
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // a click outside it

  // two ways to give, one shown at a time
  const tabs = dialog.querySelectorAll("[data-tab]");
  const show = (name) => {
    for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.tab === name));
    for (const p of dialog.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== name;
  };
  for (const t of tabs) t.onclick = () => show(t.dataset.tab);
  show(/give=qr/.test(location.hash) ? "qr" : "wallet");
  if (/(^|[#&])give\b/.test(location.hash)) dialog.showModal(); // a link straight to it: …/#give

  if (!address) { // not set up yet: say so rather than show a broken QR code
    for (const p of dialog.querySelectorAll("[data-pane]")) p.innerHTML = '<p class="dim">Donations aren\'t set up yet: there\'s no donation address.</p>';
    return;
  }

  // ---- QR code: a choice of firework, and the code for that amount (or for any amount)
  const qrChips = $("[data-pane=qr] .amounts"), qrImg = $("#donateQr"), qrLink = $("#donateOpen"), qrAmt = $("#donateQrAmount");
  const pickQr = (sats) => {
    for (const c of qrChips.children) c.setAttribute("aria-pressed", String(+c.dataset.sats === sats));
    qrImg.src = `donate/${sats || "any"}.svg`;
    qrLink.href = sats ? `${address}?amount=${btc(sats)}` : address;
    qrAmt.textContent = sats ? `${btc(sats)} BCH` : "any amount (your wallet asks)";
  };
  chips(qrChips, true, pickQr);
  $("#donateAddr").textContent = address.replace(/^bitcoincash:/, "");
  $("#donateCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(address); $("#donateCopy").textContent = "Copied"; } catch { $("#donateCopy").textContent = "Copy failed"; }
    setTimeout(() => { $("#donateCopy").textContent = "Copy address"; }, 1500);
  };
  pickQr(AMOUNTS[0].sats);

  // ---- WizardConnect: connect, then choose an amount and send it to the wallet to sign
  const status = $("#wizStatus"), connectBtn = $("#wizConnect"), pairing = $("#wizPairing"), step2 = $("#wizDonate");
  let session = null, wantSats = AMOUNTS[0].sats;
  const custom = $("#wizCustom");
  // light up the firework an amount gets: from its animal's amount up to the next one's (none under 0.001 BCH)
  const showTier = () => {
    const k = fireworkTier(wantSats);
    [...$("#wizDonate .amounts").children].forEach((c, i) => c.setAttribute("aria-pressed", String(i === k)));
  };
  const pickWiz = (sats) => { wantSats = sats; custom.value = btc(sats); showTier(); };
  chips($("#wizDonate .amounts"), false, pickWiz);
  custom.oninput = () => { wantSats = Math.round(parseFloat(custom.value) * 1e8) || 0; showTier(); };
  pickWiz(wantSats);
  connectBtn.onclick = async () => {
    connectBtn.disabled = true; status.textContent = "Starting…";
    let wizard;
    try { wizard = await import("./wizard.js"); } catch {
      status.textContent = "Connecting a wallet isn't available here yet. The QR code works with any BCH wallet.";
      connectBtn.disabled = false; return;
    }
    try {
      session = await wizard.connect({
        name: "Spirits of Bitcoin",
        pairing: (uri, qrSvg) => { pairing.hidden = false; $("#wizQr").innerHTML = qrSvg; $("#wizOpen").href = uri; status.textContent = "Scan this with your wallet, or open it on this device."; },
        status: (text) => { status.textContent = text; },
      });
      pairing.hidden = true; step2.hidden = false; connectBtn.hidden = true;
      status.textContent = `Connected to ${session.walletName || "your wallet"}.`;
    } catch (e) { status.textContent = `Couldn't connect: ${e.message || e}`; connectBtn.disabled = false; }
  };
  $("#wizSend").onclick = async () => {
    if (!session || !(wantSats >= 546)) { status.textContent = "Pick an amount of at least 0.00000546 BCH."; return; }
    $("#wizSend").disabled = true; status.textContent = "Building the transaction…";
    try {
      const txid = await session.donate(address, wantSats, (text) => { status.textContent = text; });
      status.textContent = `Sent, thank you! Watch the sky. (${txid.slice(0, 12)}…)`;
    } catch (e) { status.textContent = `Not sent: ${e.message || e}`; }
    $("#wizSend").disabled = false;
  };
}

// the amount buttons: one per firework animal (and "Any amount" for the QR code)
function chips(box, withAny, pick) {
  box.textContent = "";
  for (const a of withAny ? [{ sats: 0, name: "" }, ...AMOUNTS] : AMOUNTS) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.sats = a.sats;
    b.innerHTML = a.sats ? `<b>${title(a.name)}</b><span>${btc(a.sats)} BCH</span>` : "<b>Any amount</b><span>you choose</span>";
    b.onclick = () => pick(a.sats);
    box.append(b);
  }
}
