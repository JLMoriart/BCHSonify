// Starting, muting and volume for the pages that play the sonification (index.html, studio.html).

import { volumeControl } from "./volume.js";

/** Wire `sonifier` to a Mute button (the volume slider goes next to it) and a "click for sound" hint
 *  element. Sound starts on its own when the browser allows it; otherwise on the visitor's first click,
 *  tap or key press. Either way it fades in, once `ready` (the sound settings) has resolved.
 *  Returns ensure(): a promise that sound is running (unless muted or the browser still blocks it). */
export function soundControls(s, muteBtn, hint, ready) {
  let muted = false;
  const ctx = s.context();
  volumeControl(s, muteBtn);
  const begin = () => ready.then(() => { if (!muted && ctx.state === "running" && !s.playing) { s.start(); hint.hidden = true; } });
  ctx.onstatechange = begin;
  ctx.resume().catch(() => {});
  setTimeout(() => { if (!s.playing && !muted) hint.hidden = false; }, 500);
  const gesture = () => {
    for (const e of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(e, gesture, true);
    ctx.resume().then(begin);
  };
  for (const e of ["pointerdown", "keydown", "touchend"]) window.addEventListener(e, gesture, true);

  muteBtn.onclick = () => {
    muted = !muted;
    muteBtn.textContent = muted ? "Unmute" : "Mute";
    if (muted) { s.stop(); setTimeout(() => { if (muted) ctx.suspend(); }, 100); }  // suspended: no audio CPU
    else ctx.resume().then(begin);
  };
  return () => (muted ? Promise.resolve() : ctx.resume().then(begin));
}
