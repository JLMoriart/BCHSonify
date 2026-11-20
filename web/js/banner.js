// The BCH BLAZE 2026 banner (index.html): the EMBER2026 address's Copy and Show QR Code.
const $ = (id) => document.getElementById(id);
const address = $("ember").textContent.trim();

async function copy(btn, label) {
  try { await navigator.clipboard.writeText(address); btn.textContent = "Copied"; }
  catch { getSelection().selectAllChildren($("ember")); btn.textContent = "Selected: copy it"; } // (no clipboard: selected, to copy by hand)
  clearTimeout(btn.reset);
  btn.reset = setTimeout(() => { btn.textContent = label; }, 2000);
}
$("emberCopy").onclick = () => copy($("emberCopy"), "Copy");
$("voteCopy").onclick = () => copy($("voteCopy"), "Copy address");

// the QR code window (the QR library loads the first time it opens)
const dialog = $("vote");
$("emberQr").onclick = async () => {
  if (!$("voteQr").firstChild) {
    $("voteAddr").textContent = address;
    try {
      const { qrcode } = await import("../vendor/wizardconnect.js"), qr = qrcode(0, "M");
      qr.addData(address); qr.make();
      $("voteQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch { $("voteQr").hidden = true; }
  }
  dialog.showModal();
};
dialog.querySelector("[data-close]").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // (a click outside it)
