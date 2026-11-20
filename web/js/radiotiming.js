// The studio's lyric timing tool for BCH Radio: play a song and tap along, one tap as each line starts, and
// the lyrics show in the sky as they will for visitors. Saved to web/radio/radio.json (through the dev
// server's PUT /api/radio), which the published page reads.
//
// The song's title and each line's words can be edited here too (saved with the times).
//
// Keys (while this section is open, and not typing in a box):
//   Space   the line marked ▶ starts now; on to the next
//   E       the singing stops now (the end of the line before ▶, for a gap with no words)
//   Z       undo: back one line, and clear its time
//   ↑ ↓     move ▶ (clicking a line also moves ▶ there, and plays from just before it)
//   [ ]     the line before ▶ 0.05 s earlier / later
//   P       play / pause

const LEAD = 3; // s: clicking a line plays from this long before it

export function radioTiming(radio, ensure, box) {
  box.hidden = false;
  radio.synced = false; // (here: any song, from anywhere, not where every visitor is)
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const songSel = el("select");
  radio.songs.forEach((s, k) => songSel.append(el("option", { value: k, textContent: s.title })));
  const title = el("input", { type: "text", style: "width:22em", title: "The song's title, shown in the sky as it starts" });
  const lag = el("input", { type: "number", value: "0.15", step: "0.01", min: "0", max: "1", style: "width:5em" });
  const save = el("button", { type: "button", textContent: "Save" }), state = el("span", { className: "dim" });
  const audio = radio.audio;
  audio.controls = true; audio.style.width = "100%"; audio.style.marginTop = "8px";
  const help = el("p", { className: "dim", style: "margin:8px 0" },
    "Space: the ▶ line starts now · E: the singing stops (ends the line before ▶) · Z: undo · ↑↓: move ▶ · [ ]: the line before ▶ 0.05 s earlier/later · P: play/pause. Click a line's time to play from just before it; click its words to edit them (Enter when done).");
  const list = el("ol", { style: "margin:8px 0 0; padding:0; list-style:none; font-variant-numeric:tabular-nums; max-height:50vh; overflow:auto; position:relative; border:1px solid var(--rule); border-radius:8px" });
  box.append(
    el("div", { className: "bar" }, el("label", { className: "dim" }, "Song ", songSel), el("label", { className: "dim" }, "Title ", title),
      el("label", { className: "dim", title: "Taps land this much earlier than pressed, for reaction time" }, "Tap lag ", lag, " s"), save, state),
    audio, help, list);

  let cursor = 0, dirty = false, rows = [], lastSung = -1;
  // scroll the list (only the list, never the page) to show li: in its middle, or just into view ("nearest")
  const scrollList = (li, how) => {
    if (!li) return;
    const top = li.offsetTop, h = li.offsetHeight, view = list.clientHeight;
    const want = how === "center" ? top - (view - h) / 2 : top < list.scrollTop ? top : top + h > list.scrollTop + view ? top + h - view : list.scrollTop;
    list.scrollTo({ top: Math.max(0, want), behavior: "smooth" });
  };
  const lines = () => radio.song.lines;
  const fmt = (t) => (t == null ? "–" : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`);
  const mark = (d) => { dirty = d; state.textContent = d ? "unsaved changes" : "saved"; };
  // an input that edits a text in place; Enter or Escape finishes (and hands the keys back to tapping)
  const editor = (input, set) => {
    input.oninput = () => { set(input.value); mark(true); };
    input.onkeydown = (e) => { if (e.key === "Enter" || e.key === "Escape") input.blur(); };
    input.onclick = (e) => e.stopPropagation(); // not a click on its line (that plays from there)
    return input;
  };
  editor(title, (v) => { radio.song.title = v; songSel.options[radio.at].textContent = v || "(untitled)"; });
  const render = () => {
    title.value = radio.song.title;
    list.replaceChildren();
    rows = lines().map((l, i) => {
      const words = editor(el("input", { type: "text", value: l.text, style: "width:100%; box-sizing:border-box; background:transparent; border:1px solid transparent; color:inherit; font:inherit; padding:1px 4px; border-radius:4px" }), (v) => { l.text = v; });
      words.onfocus = () => { words.style.borderColor = "var(--rule)"; };
      words.onblur = () => { words.style.borderColor = "transparent"; };
      const li = el("li", { style: "display:grid; grid-template-columns: 1.4em 5.5em 5.5em 1fr; gap:8px; align-items:center; padding:2px 10px; cursor:pointer" },
        el("span"), el("span"), el("span", { className: "dim" }), words);
      li.onclick = () => { cursor = i; const t = l.t ?? lines().slice(0, i).reverse().find((p) => p.t != null)?.t ?? 0; play(Math.max(0, t - LEAD)); show(); };
      list.append(li);
      return li;
    });
    show();
  };
  const show = () => {
    const now = audio.currentTime;
    let sung = -1;
    lines().forEach((l, i) => { if (l.t != null && l.t <= now) sung = i; });
    rows.forEach((li, i) => {
      const l = lines()[i], [arrow, t, end] = li.children;
      arrow.textContent = i === cursor ? "▶" : "";
      t.textContent = fmt(l.t);
      end.textContent = l.end != null ? `ends ${fmt(l.end)}` : "";
      li.style.background = i === sung && !audio.paused ? "rgba(140,225,205,0.12)" : "";
    });
    // while it plays, the line being sung keeps to the middle of the list (as near as the list's ends allow),
    // moved only when that line changes, so the list can be scrolled by hand in between
    if (!audio.paused && sung >= 0 && sung !== lastSung) scrollList(rows[sung], "center");
    lastSung = audio.paused ? -1 : sung;
  };
  const play = (t) => { radio.choose(+songSel.value, t); ensure.setRadio(true).then(() => ensure()).then(() => radio.start()); };
  const now = () => Math.max(0, +(audio.currentTime - (+lag.value || 0)).toFixed(2));

  songSel.value = radio.at;
  songSel.onchange = () => { radio.choose(+songSel.value, 0); cursor = 0; render(); };
  radio.onsong = (k) => { songSel.value = k; cursor = 0; render(); };
  audio.addEventListener("play", () => ensure.setRadio(true));
  audio.addEventListener("timeupdate", show);
  save.onclick = async () => {
    try {
      const r = await fetch("/api/radio", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs: radio.songs }) });
      if (!r.ok) throw new Error(`${r.status}: ${(await r.json().catch(() => ({}))).error || r.statusText}`);
      mark(false);
    } catch (e) { // (a dev server started before /api/radio existed answers "bad preset path": restart it)
      state.textContent = `not saved (${e.message}). Is tools/dev_server.py serving this page, restarted since it last changed? Your taps are kept here until you reload.`;
    }
  };
  window.addEventListener("keydown", (e) => {
    if (!box.open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    const L = lines(), prev = L[cursor - 1];
    if (e.key === " ") { if (L[cursor]) { L[cursor].t = now(); cursor = Math.min(L.length, cursor + 1); mark(true); } }
    else if (e.key === "e" || e.key === "E") { if (prev && prev.t != null) { prev.end = now(); mark(true); } }
    else if (e.key === "z" || e.key === "Z") { if (cursor > 0) { cursor--; L[cursor].t = null; delete L[cursor].end; mark(true); } }
    else if (e.key === "ArrowUp") cursor = Math.max(0, cursor - 1);
    else if (e.key === "ArrowDown") cursor = Math.min(L.length - 1, cursor + 1);
    else if ((e.key === "[" || e.key === "]") && prev && prev.t != null) { prev.t = Math.max(0, +(prev.t + (e.key === "[" ? -0.05 : 0.05)).toFixed(2)); mark(true); }
    else if (e.key === "p" || e.key === "P") { if (audio.paused) play(); else audio.pause(); }
    else return;
    e.preventDefault(); // (Space would also press whatever button has focus)
    show();
    if (audio.paused) scrollList(rows[cursor], "nearest"); // (playing, the sung line leads the scrolling)
  });
  window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
  render();
}
