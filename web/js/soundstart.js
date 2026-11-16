// Starting, muting and volume for a page that plays the sonification
// (index.html and visualizer.html).

import { migrateBlockParams } from "./blocksound.js";
import { volumeControl } from "./volume.js";

/** Wire `sonifier` to a Mute button (the volume slider goes next to it) and a
 *  "click for sound" hint element. Sound starts on its own when the browser
 *  allows it; otherwise on the visitor's first click, tap or key press. Either
 *  way it fades in. Uses the sound settings chosen in the workbench
 *  (sound.json, "Use on main page"); built-in defaults if absent. */
export function soundControls(s, muteBtn, hint) {
  let muted = false;
  const ctx = s.context();
  volumeControl(s, muteBtn);
  const sound = fetch("sound.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((p) => s.setBlockParams(migrateBlockParams(p)));
  const begin = () => sound.then(() => { if (!muted && ctx.state === "running" && !s.playing) { s.start(); hint.hidden = true; } });
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
}
