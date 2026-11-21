// Starting, muting and volume for the pages that play the sonification (index.html, studio.html), and the
// BCH Radio button that swaps the sonification for songs (radio.js).

import { volumeControl } from "./volume.js";

const RADIO_KEY = "bchsonify.radio"; // this browser's choice: "1" radio, else the sonification

/** Wire `sonifier` to a Mute button (the volume slider goes next to it) and a "click for sound" hint
 *  element. Sound starts on its own when the browser allows it; otherwise on the visitor's first click,
 *  tap or key press. Either way it fades in, once `ready` (the sound settings) has resolved.
 *  radio: a promise of the Radio (or null: none), and radioBtn its button (hidden if there's no radio);
 *  Returns ensure(): a promise that sound is running (unless muted or the browser still blocks it), with
 *  ensure.setRadio(on) to switch between the sonification and the radio. */
export function soundControls(s, muteBtn, hint, ready, radioP = Promise.resolve(null), radioBtn = null) {
  let muted = false, radio = null;
  const ctx = s.context();
  volumeControl(s, muteBtn);
  const playing = () => (radio && radio.on ? radio.sounding : s.playing);
  const begin = () => Promise.all([ready, radioP]).then(async () => {
    if (muted || ctx.state !== "running") return;
    if (radio && radio.on) { if (!radio.live) await radio.start(); }
    else if (!s.playing) s.start();
    if (playing()) hint.hidden = true;
  });
  // A press that lets the browser start sound: the first that does (the context then runs) ends the waiting.
  // Not just the first press: on a touchscreen, pointerdown comes before the browser counts the touch as one
  // (a finger going down may be a scroll), so it can't start sound; the touchend or click after it can.
  const presses = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  const press = () => { ctx.resume().then(begin, () => {}); };
  ctx.onstatechange = () => {
    if (ctx.state === "running") for (const e of presses) window.removeEventListener(e, press, true);
    begin();
  };
  if (radioBtn) radioBtn.hidden = true;
  radioP.then((r) => {
    radio = r;
    if (!r || !radioBtn) return;
    try { r.on = localStorage.getItem(RADIO_KEY) === "1"; } catch { /* no storage: the sonification */ }
    radioBtn.hidden = false;
    const showOn = () => { radioBtn.setAttribute("aria-pressed", String(r.on)); };
    showOn();
    radioBtn.onclick = () => {
      r.on = !r.on;
      showOn();
      try { localStorage.setItem(RADIO_KEY, r.on ? "1" : "0"); } catch { /* not remembered */ }
      if (r.on) s.stop(); else r.stop();
      if (!muted) ctx.resume().then(begin);
    };
  });
  ctx.resume().catch(() => {});
  setTimeout(() => { if (!playing() && !muted) hint.hidden = false; }, 500);
  for (const e of presses) window.addEventListener(e, press, true);

  muteBtn.onclick = () => {
    muted = !muted;
    muteBtn.textContent = muted ? "Unmute" : "Mute";
    if (muted) { hint.hidden = true; s.stop(); if (radio) radio.stop(); setTimeout(() => { if (muted) ctx.suspend(); }, 300); }  // suspended: no audio CPU
    else ctx.resume().then(begin);
  };
  const ensure = () => (muted ? Promise.resolve() : ctx.resume().then(begin));
  ensure.setRadio = (on) => radioP.then((r) => { if (r && r.on !== on && radioBtn) radioBtn.onclick(); });
  return ensure;
}
