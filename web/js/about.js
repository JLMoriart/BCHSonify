// The "About" button beside "Fireworks!": a window saying what the scene and the sound show. A link straight
// to it: …/#about.
export function setupAbout(button, dialog) {
  button.onclick = () => dialog.showModal();
  dialog.querySelector(".close").onclick = () => dialog.close();
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // a click outside it
  if (/(^|[#&])about\b/.test(location.hash)) dialog.showModal();
}
