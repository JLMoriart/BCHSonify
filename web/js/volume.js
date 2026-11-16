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
  label.volume input { width: 140px; accent-color: var(--accent); }
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
  label.append(input, out);
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
  input.ondblclick = () => { input.value = VOLUME.def; input.oninput(); }; // double-click: back to 0 dB
  after.after(label);
  return input;
}
