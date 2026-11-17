// The sound workbench, under the visualizer: every sound setting, presets, and a test strike of the block
// note. Settings change the sound live and are remembered in this browser.

import { BLOCK_PARAMS, BLOCK_DEFAULTS, CAVE_SPACE, migrateBlockParams } from "./blocksound.js";
import { CONFIG, blockHold } from "./mapping.js";
import { LAYOUT } from "./layout.js";

const $ = (id) => document.getElementById(id);
const KEY = "bchsonify.blockParams";
const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };

// The default sound: web/sound.json (saved by "Use as default sound"; the dev server writes it), or the
// built-in defaults without it.
async function fetchDefaultSound() {
  try { const r = await fetch("sound.json", { cache: "no-store" }); return r.ok ? { ...BLOCK_DEFAULTS, ...migrateBlockParams(await r.json()) } : null; }
  catch { return null; }
}

/** The sound to start with: this browser's last workbench settings if it has any (and `kept`), else the
 *  default sound. */
export async function startingSound(kept = true) {
  if (kept) try {
    const kept = localStorage.getItem(KEY);
    if (kept) return { ...BLOCK_DEFAULTS, ...migrateBlockParams(JSON.parse(kept)) };
  } catch {}
  return (await fetchDefaultSound()) || { ...BLOCK_DEFAULTS };
}

/** Build the workbench for Sonifier `s`, already playing `start` (from startingSound). ensure(): a promise
 *  that sound is running, if the visitor allows it. onStrike(ev): also told of each test strike (the page
 *  sends a ferry for it). */
export function workbench(s, start, ensure, onStrike = () => {}) {
  let params = { ...start };

  // ---- controls ----
  const fmt = (p, v) => typeof v === "boolean" ? (v ? "on" : "off") : (typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3).replace(/\.?0+$/, "")) : v) + (p.unit ? " " + p.unit : "");
  const toSlider = (p, v) => (p.log ? 1000 * Math.log(v / p.min) / Math.log(p.max / p.min) : v);
  const fromSlider = (p, x) => (p.log ? +(p.min * Math.pow(p.max / p.min, x / 1000)).toPrecision(3) : +x);
  const inputs = {};
  const boxes = {};
  const PARAM = Object.fromEntries(BLOCK_PARAMS.map((p) => [p.k, p]));
  const LS_OPEN = "bchsonify.openSections";
  const openSections = (() => { try { return JSON.parse(localStorage.getItem(LS_OPEN) || "null"); } catch { return null; } })();
  // sections (collapsible, open/closed remembered) > boxes > settings, per layout.js;
  // any setting the layout doesn't list goes in an "Other" box so nothing is ever hidden
  const listed = new Set(LAYOUT.flatMap((sec) => sec.boxes.flatMap((b) => b.keys)));
  const unlisted = BLOCK_PARAMS.map((p) => p.k).filter((k) => !listed.has(k));
  const layout = unlisted.length ? [...LAYOUT, { section: "Other", boxes: [{ box: "Other", keys: unlisted }] }] : LAYOUT;
  const placement = [];
  for (const sec of layout) {
    const det = document.createElement("details");
    det.className = "sec";
    det.open = !openSections || openSections.includes(sec.section);
    det.innerHTML = `<summary>${sec.section}</summary><div class="groups"></div>`;
    det.ontoggle = () => {
      const open = [...document.querySelectorAll("details.sec")].filter((d) => d.open).map((d) => d.querySelector("summary").textContent);
      try { localStorage.setItem(LS_OPEN, JSON.stringify(open)); } catch {}
    };
    $("sections").appendChild(det);
    for (const b of sec.boxes) {
      const fs = document.createElement("fieldset");
      fs.innerHTML = `<legend>${b.box}</legend>`;
      det.querySelector(".groups").appendChild(fs);
      boxes[b.box] = fs;
      for (const k of b.keys) if (PARAM[k]) placement.push({ p: PARAM[k], box: b.box, label: (b.labels && b.labels[k]) || PARAM[k].label });
    }
  }
  for (const { p, box, label: labelText } of placement) {
    const row = document.createElement("div");
    row.className = "p";
    const label = document.createElement("label");
    label.textContent = labelText;
    const val = document.createElement("span");
    val.className = "val";
    let input;
    if (p.type === "checkbox") {
      input = document.createElement("input");
      input.type = "checkbox";
    } else if (p.options) {
      input = document.createElement("select");
      for (const o of p.options) input.add(new Option(o, o));
    } else {
      input = document.createElement("input");
      input.type = "range";
      input.min = p.log ? 0 : p.min;
      input.max = p.log ? 1000 : p.max;
      input.step = p.log ? 1 : (p.step || 0.01);
    }
    input.oninput = () => {
      const v = p.type === "checkbox" ? input.checked : p.options ? input.value : fromSlider(p, input.value);
      params[p.k] = v;
      val.textContent = fmt(p, v);
      s.setBlockParams({ [p.k]: v });
      save(params);
      showJson();
      showPresetState();
    };
    row.append(label, val, input);
    boxes[box].appendChild(row);
    inputs[p.k] = { input, val, p };
  }
  { // one-click starting point for a cave (reverb + echo only; the block sound is untouched)
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Cave starting point";
    b.style.marginTop = "10px";
    b.onclick = () => applyParams({ ...params, ...CAVE_SPACE });
    boxes["Reverb"].appendChild(b);
  }
  function syncControls() {
    for (const { input, val, p } of Object.values(inputs)) {
      if (p.type === "checkbox") input.checked = !!params[p.k];
      else input.value = p.options ? params[p.k] : toSlider(p, params[p.k]);
      val.textContent = fmt(p, params[p.k]);
    }
    showJson();
  }
  function showJson() { $("json").value = JSON.stringify(params, null, 2); }
  syncControls();

  // ---- test strike: the block note (and, on the page, a ferry) for a block of the size typed in ----
  let n = 0;
  // a test block of the size typed in, under BCH's current 32 MB limit
  const STRIKE_LIMIT = 32e6;
  const strikeSize = () => ({ size: Math.round(Math.min(32, Math.max(0, +$("strikeMB").value || 0)) * 1e6), limit: STRIKE_LIMIT });
  const strikeEvent = () => ({ type: "block", t: s.serverNow(), hash: `workbench-${++n}`, ...strikeSize() });
  const showStrikeHold = () => { $("strikeHold").textContent = `${blockHold(strikeSize()).toFixed(2)} s`; };
  $("strikeMB").oninput = showStrikeHold;
  showStrikeHold();
  $("strike").onclick = () => { const ev = strikeEvent(); onStrike(ev); ensure().then(() => s.event(ev)); };
  $("stopBlock").onclick = () => {
    const v = s.voices.get(CONFIG.blockHarmonic);
    if (v) { s.voices.delete(CONFIG.blockHarmonic); v.onended = null; v.release(0.3); s.changed(); }
  };
  $("copy").onclick = () => navigator.clipboard.writeText($("json").value).then(() => { $("copy").textContent = "Copied"; setTimeout(() => ($("copy").textContent = "Copy"), 1500); });

  // ---- presets ----
  // Saved as files in presets/block/ via tools/dev_server.py (run_web.sh); if the
  // page is served without it, in this browser's storage instead.
  // "Default" is the built-in starting point and can't be overwritten.
  const API = "/api/presets/block", LS_PRESETS = "bchsonify.blockPresets", LS_CURRENT = "bchsonify.blockPreset";
  const DEFAULT = "Default";
  let presets = {}, remote = false;
  let current = (() => { try { return localStorage.getItem(LS_CURRENT) || DEFAULT; } catch { return DEFAULT; } })();
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS_PRESETS) || "{}"); } catch { return {}; } };
  const lsSet = (o) => { try { localStorage.setItem(LS_PRESETS, JSON.stringify(o)); } catch {} };
  const presetParams = (name) => (name === DEFAULT ? { ...BLOCK_DEFAULTS } : { ...BLOCK_DEFAULTS, ...migrateBlockParams(presets[name] || {}) });
  const same = (a, b) => BLOCK_PARAMS.every((p) => a[p.k] === b[p.k]);

  async function fetchPresets() {
    try {
      const r = await fetch(API, { cache: "no-store" });
      if (r.ok) { presets = await r.json(); remote = true; return; }
    } catch {}
    presets = lsGet(); remote = false;
  }
  async function storePreset(name, p) {
    if (remote) {
      const r = await fetch(`${API}/${encodeURIComponent(name)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      if (!r.ok) throw new Error((await r.json()).error || r.status);
    } else { const o = lsGet(); o[name] = p; lsSet(o); }
    presets[name] = { ...p };
  }
  async function removePreset(name) {
    if (remote) await fetch(`${API}/${encodeURIComponent(name)}`, { method: "DELETE" });
    else { const o = lsGet(); delete o[name]; lsSet(o); }
    delete presets[name];
  }
  function setCurrent(name) { current = name; try { localStorage.setItem(LS_CURRENT, name); } catch {} }
  function fillPresetList() {
    const sel = $("preset");
    sel.innerHTML = "";
    for (const name of [DEFAULT, ...Object.keys(presets).sort((a, b) => a.localeCompare(b))]) sel.add(new Option(name, name));
    sel.value = current in presets || current === DEFAULT ? current : DEFAULT;
  }
  let mainSound = null; // the default sound (sound.json), for "this is the default sound"
  async function fetchMainSound() { mainSound = await fetchDefaultSound(); }
  $("useDefault").onclick = async () => {
    try {
      const r = await fetch("/api/sound", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
      // 400/404/405/501: the page was served by an older dev server or a plain one
      if (!r.ok) throw new Error(`the server doesn't support this (${r.status}). Restart ./run_web.sh`);
      mainSound = { ...params };
      showPresetState();
    } catch (e) { $("presetState").textContent = "Couldn't update the default sound: " + e.message; }
  };
  function showPresetState() {
    const modified = !same(params, presetParams(current));
    const onMain = mainSound ? same(params, mainSound) : same(params, BLOCK_DEFAULTS);
    $("presetState").textContent = (modified ? "modified · " : "") + (remote ? "saved in presets/block/" : "saved in this browser") +
      (onMain ? " · this is the default sound" : " · the default sound is different");
    $("save").disabled = current === DEFAULT;
    $("del").disabled = current === DEFAULT;
  }
  function applyParams(p) { params = p; save(params); s.setBlockParams(params); syncControls(); showPresetState(); }

  $("preset").onchange = () => {
    const name = $("preset").value;
    if (!same(params, presetParams(current)) && !confirm(`Discard unsaved changes to "${current}"?`)) { $("preset").value = current; return; }
    setCurrent(name);
    applyParams(presetParams(name));
  };
  $("save").onclick = async () => {
    try { await storePreset(current, params); showPresetState(); } catch (e) { alert("Save failed: " + e.message); }
  };
  $("saveAs").onclick = async () => {
    const name = (prompt("Preset name (letters, numbers, spaces, - _ . ' ( ) )", current === DEFAULT ? "" : current) || "").trim();
    if (!name) return;
    if (name === DEFAULT || !/^[A-Za-z0-9][A-Za-z0-9 _.'()-]{0,63}$/.test(name)) { alert("Pick another name (letters, numbers, spaces, - _ . ' ( ) ; not \"Default\")."); return; }
    if (name in presets && !confirm(`Overwrite "${name}"?`)) return;
    try { await storePreset(name, params); setCurrent(name); fillPresetList(); showPresetState(); } catch (e) { alert("Save failed: " + e.message); }
  };
  $("del").onclick = async () => {
    if (current === DEFAULT || !confirm(`Delete preset "${current}"?`)) return;
    await removePreset(current);
    setCurrent(DEFAULT);
    fillPresetList();
    showPresetState();
  };
  Promise.all([fetchPresets(), fetchMainSound()]).then(() => { fillPresetList(); showPresetState(); });

  // test hook: ?autostrike strikes once audio is allowed (headless checks)
  if (new URLSearchParams(location.search).has("autostrike")) $("strike").onclick();
}
