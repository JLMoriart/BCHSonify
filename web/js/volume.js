// Master volume slider, shared by every page: a listener setting, not part of
// the sound (not in presets or sound.json). Remembered in this browser, the
// same value on every page.

export const VOLUME = { min: -40, max: 6, step: 0.5, def: 0 }; // dB
const KEY = "bchsonify.volumeDb";

function saved() {
  try {
    const v = parseFloat(localStorage.getItem(KEY));
    return Number.isFinite(v) ? Math.min(VOLUME.max, Math.max(VOLUME.min, v)) : VOLUME.def;
  } catch { return VOLUME.def; }
}

const style = document.createElement("style");
style.textContent = `
  label.volume { display: inline-flex; gap: 8px; align-items: center; color: var(--dim); }
  label.volume input { width: 140px; accent-color: var(--accent); margin: 0; }
  /* the slider, with a mark under the track where 0 dB is (--at: its place along the track, 0..1; the
     thumb's centre only travels between half a thumb from each end) */
  label.volume .track { position: relative; display: inline-flex; --thumb: 16px; }
  label.volume .zero { position: absolute; top: calc(100% + 1px); width: 2px; height: 5px; margin-left: -1px; border-radius: 1px;
    left: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--at)); background: var(--accent); opacity: 0.75; pointer-events: none; }
  label.volume output { font-variant-numeric: tabular-nums; min-width: 4.5em; color: var(--fg); }
`;
document.head.append(style);

/** A "Volume" slider for `sonifier`, inserted after `after` (an element). */
export function volumeControl(sonifier, after) {
  const label = document.createElement("label");
  label.className = "volume";
  label.textContent = "Volume";
  const input = Object.assign(document.createElement("input"), { type: "range", min: VOLUME.min, max: VOLUME.max, step: VOLUME.step });
  const out = document.createElement("output");
  const track = Object.assign(document.createElement("span"), { className: "track" });
  const zero = Object.assign(document.createElement("span"), { className: "zero", title: "0 dB" });
  zero.style.setProperty("--at", (VOLUME.def - VOLUME.min) / (VOLUME.max - VOLUME.min));
  track.append(input, zero);
  label.append(track, out);
  const show = (db) => { out.textContent = `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`; };
  const db = saved();
  input.value = db; show(db);
  sonifier.setVolume(db);
  input.oninput = () => {
    const v = +input.value;
    show(v);
    sonifier.setVolume(v);
    try { localStorage.setItem(KEY, String(v)); } catch {}
  };
  // double-click (or, on a touchscreen, double-tap): back to 0 dB
  const reset = () => { input.value = VOLUME.def; input.oninput(); };
  input.ondblclick = reset;
  let lastTap = 0;
  input.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch") return;
    // (after the slider has taken the tap's own value, which would otherwise land on top of the reset)
    if (e.timeStamp - lastTap < 350) { setTimeout(reset, 0); lastTap = 0; } else lastTap = e.timeStamp;
  });
  after.after(label);
  return input;
}
