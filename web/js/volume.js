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
  /* the slider, drawn here (not the browser's own: thumbs differ in size between browsers, and the 0 dB mark
     has to sit under the thumb's centre). The thumb's centre travels from half a thumb (--thumb) in from one
     end to half a thumb from the other; --frac: the value's place along the track, 0..1, for the filled part */
  label.volume .track { position: relative; display: inline-flex; --thumb: 16px; }
  label.volume input { -webkit-appearance: none; appearance: none; width: 140px; height: 18px; margin: 0; background: transparent; cursor: pointer; }
  label.volume input::-webkit-slider-runnable-track { height: 6px; border-radius: 3px;
    background: linear-gradient(to right, var(--accent) calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--frac, 0)), rgba(230,235,243,0.3) 0); }
  label.volume input::-webkit-slider-thumb { -webkit-appearance: none; width: var(--thumb); height: var(--thumb); margin-top: -5px; border: 0; border-radius: 50%; background: var(--accent); }
  label.volume input::-moz-range-track { height: 6px; border-radius: 3px; background: rgba(230,235,243,0.3); }
  label.volume input::-moz-range-progress { height: 6px; border-radius: 3px; background: var(--accent); }
  label.volume input::-moz-range-thumb { width: var(--thumb); height: var(--thumb); border: 0; border-radius: 50%; background: var(--accent); }
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
  const show = (db) => {
    input.style.setProperty("--frac", (db - VOLUME.min) / (VOLUME.max - VOLUME.min)); // (the filled part, in Chrome and Safari)
    out.textContent = `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`;
  };
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
