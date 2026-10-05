/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */
"use strict";
/* Éditeur d'extrait : téléchargement → analyse (spectrogramme) → guides début/fin → export. */

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SRC_URL = params.get("src");
const BASE = params.get("name") || "extrait";

// ---- dimensions / réglages d'analyse ----
const RULER = 24, WAVE = 72, SPEC = 168, H = RULER + WAVE + SPEC;
const ANA_SR = 8000, HOP = 160, FFT = 256, BINS = FFT / 2, HOP_SEC = HOP / ANA_SR;
const CHUNK = 120;            // secondes décodées à la fois (garde la mémoire basse)
const MIN_SEL = 0.05, MAX_PPS = 400;

// ---- état ----
let src = null, bytes = null, duration = 0;
const spec = { mag: null, level: null, cols: 0 };
const view = { start: 0, pps: 1 };
const sel = { start: 0, end: 0 };
let playhead = 0, W = 800, playingSel = false, drag = null;
let imgData = null, img32 = null;

const baseCv = $("base"), overCv = $("over"), ovCv = $("ov"), audio = $("player");
const bg = baseCv.getContext("2d"), og = overCv.getContext("2d"), ovg = ovCv.getContext("2d");

// ---- utilitaires ----
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sanitize = (s) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "extrait";
const tToX = (t) => (t - view.start) * view.pps;
const xToT = (x) => view.start + x / view.pps;
const minPps = () => W / Math.max(duration, 1);
const tick = () => new Promise((r) => setTimeout(r, 0));

function fmt(t, d = 0, forceH = false) {
  const f = Math.pow(10, d); const u = Math.round(Math.max(0, t) * f);
  const frac = u % f; let s = Math.floor(u / f);
  const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); s %= 60;
  const ss = String(s).padStart(2, "0") + (d ? "." + String(frac).padStart(d, "0") : "");
  return (h || forceH ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + ss;
}
function parseTime(str) {
  str = String(str).trim().replace(",", ".");
  if (!str) return NaN;
  const p = str.split(":");
  if (p.length > 3 || p.some((x) => x === "" || isNaN(+x))) return NaN;
  return p.reduce((a, x) => a * 60 + +x, 0);
}
function fileT(t) {
  const s = Math.round(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + "h" : "") + String(m).padStart(2, "0") + "m" + String(ss).padStart(2, "0") + "s";
}
function setStatus(msg, err) { const s = $("status"); s.textContent = msg; s.className = err ? "error" : ""; }
function setProgress(p) { $("barfill").style.width = Math.round(clamp(p, 0, 1) * 100) + "%"; }

// ---- palette « magma » ----
const LUT32 = (() => {
  const stops = [[0, 11, 13, 18], [0.18, 40, 12, 90], [0.4, 120, 28, 109], [0.62, 215, 69, 91], [0.82, 251, 152, 90], [1, 252, 253, 191]];
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255; let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const a = stops[k], b = stops[k + 1], f = (v - a[0]) / (b[0] - a[0]);
    const c = [1, 2, 3].map((j) => Math.round(a[j] + (b[j] - a[j]) * f));
    lut[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  return lut;
})();
const binOfY = new Uint16Array(SPEC);
for (let y = 0; y < SPEC; y++) binOfY[y] = Math.min(BINS - 1, Math.floor(((SPEC - 1 - y) / SPEC) * BINS));

// ---- dessin : fond (spectro + forme d'onde + règle) ----
function drawBase() {
  const w = W; bg.fillStyle = "#0b0d12"; bg.fillRect(0, 0, w, H);
  if (spec.mag) {
    if (!imgData || imgData.width !== w) { imgData = bg.createImageData(w, SPEC); img32 = new Uint32Array(imgData.data.buffer); }
    const colList = new Int32Array(8), cy = RULER + WAVE / 2, amp = WAVE / 2 - 3;
    bg.fillStyle = "#4ea1ff";
    for (let x = 0; x < w; x++) {
      const ta = view.start + x / view.pps, tb = ta + 1 / view.pps;
      const c0 = Math.floor(ta / HOP_SEC), c1 = Math.max(c0 + 1, Math.ceil(tb / HOP_SEC));
      const step = Math.max(1, Math.floor((c1 - c0) / 6));
      let nc = 0, lv = 0;
      for (let c = c0; c < c1 && nc < 8; c += step) if (c >= 0 && c < spec.cols) { colList[nc++] = c * BINS; if (spec.level[c] > lv) lv = spec.level[c]; }
      for (let y = 0; y < SPEC; y++) {
        let v = 0; const b = binOfY[y];
        for (let k = 0; k < nc; k++) { const m = spec.mag[colList[k] + b]; if (m > v) v = m; }
        img32[y * w + x] = LUT32[v];
      }
      if (lv > 0) { const a = Math.max(1, (lv / 255) * amp); bg.fillRect(x, cy - a, 1, a * 2); }
    }
    bg.putImageData(imgData, 0, RULER + WAVE);
  }
  // séparateurs
  bg.fillStyle = "#262c3a"; bg.fillRect(0, RULER, w, 1); bg.fillRect(0, RULER + WAVE, w, 1);
  // règle (échelle de temps)
  bg.fillStyle = "#141821"; bg.fillRect(0, 0, w, RULER);
  const STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = STEPS.find((s) => s * view.pps >= 95) || 3600;
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0, forceH = duration >= 3600;
  const tEnd = view.start + w / view.pps;
  bg.strokeStyle = "#566077"; bg.fillStyle = "#c4cada"; bg.font = "11px ui-monospace, Menlo, Consolas, monospace"; bg.textBaseline = "top"; bg.lineWidth = 1;
  const minor = step / 5;
  if (minor * view.pps >= 10) {
    bg.beginPath();
    for (let k = Math.ceil(view.start / minor); k * minor <= tEnd; k++) { const x = Math.round(tToX(k * minor)) + 0.5; bg.moveTo(x, RULER - 4); bg.lineTo(x, RULER); }
    bg.stroke();
  }
  bg.beginPath();
  for (let k = Math.ceil(view.start / step); k * step <= tEnd; k++) {
    const x = Math.round(tToX(k * step)) + 0.5; bg.moveTo(x, RULER - 11); bg.lineTo(x, RULER);
  }
  bg.stroke();
  for (let k = Math.ceil(view.start / step); k * step <= tEnd; k++) bg.fillText(fmt(k * step, decimals, forceH), Math.round(tToX(k * step)) + 4, 3);
}

// ---- dessin : calque (sélection, guides, curseur) ----
function flag(x, color, dir) {
  og.fillStyle = color; og.beginPath();
  og.moveTo(x, RULER); og.lineTo(x + dir * 16, RULER + 8); og.lineTo(x, RULER + 16); og.closePath(); og.fill();
}
function drawOver() {
  og.clearRect(0, 0, W, H);
  const xs = tToX(sel.start), xe = tToX(sel.end);
  og.fillStyle = "rgba(0,0,0,.58)";
  if (xs > 0) og.fillRect(0, RULER, Math.min(W, xs), H - RULER);
  if (xe < W) og.fillRect(Math.max(0, xe), RULER, W - Math.max(0, xe), H - RULER);
  const a = clamp(xs, 0, W), b = clamp(xe, 0, W);
  og.fillStyle = "rgba(78,161,255,.38)"; og.fillRect(a, 0, Math.max(0, b - a), RULER);
  og.lineWidth = 2;
  if (xs > -20 && xs < W + 20) { og.strokeStyle = "#35d07f"; og.beginPath(); og.moveTo(xs, 0); og.lineTo(xs, H); og.stroke(); flag(xs, "#35d07f", 1); }
  if (xe > -20 && xe < W + 20) { og.strokeStyle = "#ff5c5c"; og.beginPath(); og.moveTo(xe, 0); og.lineTo(xe, H); og.stroke(); flag(xe, "#ff5c5c", -1); }
  const xp = tToX(playhead);
  if (xp >= 0 && xp <= W) {
    og.strokeStyle = "#ffffff"; og.lineWidth = 1; og.beginPath(); og.moveTo(Math.round(xp) + 0.5, 0); og.lineTo(Math.round(xp) + 0.5, H); og.stroke();
    og.fillStyle = "#fff"; og.beginPath(); og.moveTo(xp - 5, 0); og.lineTo(xp + 5, 0); og.lineTo(xp, 8); og.closePath(); og.fill();
  }
}

// ---- vue d'ensemble ----
function drawOverview() {
  const w = ovCv.width, h = ovCv.height;
  ovg.fillStyle = "#0b0d12"; ovg.fillRect(0, 0, w, h);
  if (spec.level && duration) {
    ovg.fillStyle = "#3b6fb0";
    for (let x = 0; x < w; x++) {
      const c0 = Math.floor(((x / w) * duration) / HOP_SEC), c1 = Math.max(c0 + 1, Math.floor((((x + 1) / w) * duration) / HOP_SEC));
      let m = 0; const st = Math.max(1, Math.floor((c1 - c0) / 24));
      for (let c = c0; c < c1 && c < spec.cols; c += st) if (spec.level[c] > m) m = spec.level[c];
      const a = (m / 255) * (h / 2 - 3); if (a > 0) ovg.fillRect(x, h / 2 - a, 1, a * 2);
    }
    const sx = (sel.start / duration) * w, ex = (sel.end / duration) * w;
    ovg.fillStyle = "rgba(53,208,127,.25)"; ovg.fillRect(sx, 0, Math.max(1, ex - sx), h);
    ovg.fillStyle = "#35d07f"; ovg.fillRect(sx, 0, 2, h); ovg.fillStyle = "#ff5c5c"; ovg.fillRect(ex - 1, 0, 2, h);
    const vx = (view.start / duration) * w, vw = (Math.min(W / view.pps, duration) / duration) * w;
    ovg.strokeStyle = "#fff"; ovg.lineWidth = 1; ovg.strokeRect(vx + 0.5, 0.5, Math.max(2, vw) - 1, h - 1);
    const px = (playhead / duration) * w; ovg.fillStyle = "#fff"; ovg.fillRect(px, 0, 1, h);
  }
}

// ---- vue / sélection ----
function redrawAll() { drawBase(); drawOver(); drawOverview(); }
function setView(start, pps) {
  pps = clamp(pps, minPps(), MAX_PPS);
  start = clamp(start, 0, Math.max(0, duration - W / pps));
  const zoomed = pps !== view.pps; view.start = start; view.pps = pps;
  drawBase(); drawOver(); drawOverview();
  return zoomed;
}
function updateInputs() {
  $("inStart").value = fmt(sel.start, 2, true); $("inEnd").value = fmt(sel.end, 2, true);
  $("inStart").classList.remove("bad"); $("inEnd").classList.remove("bad");
  $("selDur").textContent = fmt(sel.end - sel.start, 2);
}
function setSel(a, b, redraw = true) {
  a = clamp(a, 0, duration); b = clamp(b, 0, duration);
  if (b - a < MIN_SEL) { if (a !== sel.start) a = Math.max(0, b - MIN_SEL); else b = Math.min(duration, a + MIN_SEL); }
  sel.start = a; sel.end = b; updateInputs();
  if (redraw) { drawOver(); drawOverview(); }
}

// ---- lecture ----
function seek(t) { playhead = clamp(t, 0, duration); try { audio.currentTime = playhead; } catch (e) {} drawOver(); drawOverview(); }
function loop() {
  playhead = audio.currentTime;
  if (playingSel && playhead >= sel.end) { audio.pause(); playingSel = false; playhead = sel.end; }
  if (!audio.paused) {
    const x = tToX(playhead);
    if (x < 0 || x > W * 0.92) setView(playhead - (W / view.pps) * 0.08, view.pps);
  }
  drawOver(); drawOverview();
  if (!audio.paused) requestAnimationFrame(loop);
}
audio.addEventListener("play", () => requestAnimationFrame(loop));
audio.addEventListener("pause", () => { playhead = audio.currentTime; drawOver(); });
function playSelection() { audio.currentTime = sel.start; playingSel = true; audio.play(); }
function togglePlay() { if (audio.paused) { playingSel = false; audio.play(); } else audio.pause(); }

// ---- interactions souris ----
const HIT = 9;
function hitGuide(x) {
  const ds = Math.abs(x - tToX(sel.start)), de = Math.abs(x - tToX(sel.end));
  if (ds > HIT && de > HIT) return null;
  return ds <= de ? "start" : "end";
}
overCv.addEventListener("pointerdown", (e) => {
  overCv.setPointerCapture(e.pointerId);
  const x = e.offsetX, g = hitGuide(x);
  drag = { mode: g || "pan", x0: x, vs: view.start, moved: false };
});
overCv.addEventListener("pointermove", (e) => {
  const x = e.offsetX;
  if (!drag) { overCv.style.cursor = hitGuide(x) ? "ew-resize" : "grab"; return; }
  if (drag.mode === "start") setSel(Math.min(xToT(x), sel.end - MIN_SEL), sel.end);
  else if (drag.mode === "end") setSel(sel.start, Math.max(xToT(x), sel.start + MIN_SEL));
  else {
    const dx = x - drag.x0; if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.moved) { overCv.style.cursor = "grabbing"; setView(drag.vs - dx / view.pps, view.pps); }
  }
});
function endDrag(e) {
  if (!drag) return;
  if (drag.mode === "pan" && !drag.moved) seek(xToT(e.offsetX));
  drag = null; overCv.style.cursor = "grab";
}
overCv.addEventListener("pointerup", endDrag);
overCv.addEventListener("pointercancel", () => { drag = null; });
overCv.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) { setView(view.start + (e.deltaX || e.deltaY) / view.pps, view.pps); return; }
  const x = e.offsetX, tAt = xToT(x), pps = clamp(view.pps * Math.exp(-e.deltaY * 0.0015), minPps(), MAX_PPS);
  setView(tAt - x / pps, pps);
}, { passive: false });

function ovTime(e) { return (clamp(e.offsetX, 0, ovCv.width) / ovCv.width) * duration; }
let ovDrag = false;
ovCv.addEventListener("pointerdown", (e) => { ovDrag = true; ovCv.setPointerCapture(e.pointerId); const t = ovTime(e); setView(t - W / view.pps / 2, view.pps); });
ovCv.addEventListener("pointermove", (e) => { if (ovDrag) { const t = ovTime(e); setView(t - W / view.pps / 2, view.pps); } });
ovCv.addEventListener("pointerup", () => { ovDrag = false; });

// ---- contrôles ----
function zoomAt(f) { const c = view.start + W / view.pps / 2; const pps = clamp(view.pps * f, minPps(), MAX_PPS); setView(c - W / pps / 2, pps); }
$("zoomIn").onclick = () => zoomAt(1.6);
$("zoomOut").onclick = () => zoomAt(1 / 1.6);
$("zoomAll").onclick = () => setView(0, minPps());
$("zoomSel").onclick = () => {
  const span = Math.max(sel.end - sel.start, 0.5) * 1.2, pps = clamp(W / span, minPps(), MAX_PPS);
  setView((sel.start + sel.end) / 2 - W / pps / 2, pps);
};
$("playSel").onclick = playSelection;
$("playPause").onclick = togglePlay;
$("setStart").onclick = () => setSel(Math.min(playhead, sel.end - MIN_SEL), sel.end);
$("setEnd").onclick = () => setSel(sel.start, Math.max(playhead, sel.start + MIN_SEL));
function onTimeInput(which) {
  return () => {
    const el = $(which === "start" ? "inStart" : "inEnd"), t = parseTime(el.value);
    const t2 = Math.min(t, duration);
    const order = which === "start" ? t2 <= sel.end - MIN_SEL : t2 >= sel.start + MIN_SEL;
    if (isNaN(t) || t < 0 || t > duration + 0.001 || !order) {
      el.classList.add("bad");
      el.title = isNaN(t) ? "Format attendu : h:mm:ss.cc (ex. 12:03.5)" : t > duration ? "Dépasse la durée du fichier" : "Le début doit précéder la fin";
      return;
    }
    el.title = "";
    if (which === "start") setSel(t2, sel.end); else setSel(sel.start, t2);
  };
}
$("inStart").addEventListener("change", onTimeInput("start"));
$("inEnd").addEventListener("change", onTimeInput("end"));
document.addEventListener("keydown", (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.code === "Space") { e.preventDefault(); if (e.target.tagName !== "BUTTON") togglePlay(); }
  else if (e.key === "i" || e.key === "I") $("setStart").click();
  else if (e.key === "o" || e.key === "O") $("setEnd").click();
});

// ---- téléchargement + décodage ----
async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Téléchargement impossible (HTTP " + res.status + ").");
  const total = +res.headers.get("content-length") || 0;
  if (!res.body || !res.body.getReader) { const ab = new Uint8Array(await res.arrayBuffer()); setProgress(1); return ab; }
  const reader = res.body.getReader(), parts = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    parts.push(value); got += value.length;
    setStatus("Téléchargement… " + (got / 1e6).toFixed(1) + (total ? " / " + (total / 1e6).toFixed(1) : "") + " Mo");
    if (total) setProgress(got / total);
  }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function decodeRange(a, b, sampleRate) {
  const part = src.cut(a, b);
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const ab = part.data.buffer.slice(part.data.byteOffset, part.data.byteOffset + part.data.byteLength);
  const buf = await ctx.decodeAudioData(ab);
  return { buf, startTime: part.startTime };
}

async function analyze() {
  const total = Math.ceil(duration / HOP_SEC) + 4;
  spec.mag = new Uint8Array(total * BINS); spec.level = new Uint8Array(total); spec.cols = total;
  for (let a = 0; a < duration; a += CHUNK) {
    const b = Math.min(duration, a + CHUNK);
    const { buf, startTime } = await decodeRange(a, b, ANA_SR);
    const n = buf.length, ch = buf.numberOfChannels, mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    const s = DSP.spectro(mono, { fftSize: FFT, hop: HOP });
    for (let i = 0; i < s.cols; i++) {
      const t = startTime + i * HOP_SEC; if (t < a - 1e-6) continue;       // on ignore la marge de pré-roll
      const gi = Math.round(t / HOP_SEC); if (gi < 0 || gi >= total) continue;
      spec.mag.set(s.mag.subarray(i * BINS, (i + 1) * BINS), gi * BINS); spec.level[gi] = s.level[i];
    }
    setProgress(b / duration); setStatus("Analyse du spectre… " + Math.round((b / duration) * 100) + " %");
    drawBase(); drawOverview();
    await tick();
  }
}

// ---- export ----
function saveBlob(blob, filename) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 15000);
}
async function exportMp3(t0, t1, kbps, onProgress) {
  const SR = 44100, parts = []; let enc = null, pos = t0;
  while (pos < t1 - 1e-6) {
    const a = pos, b = Math.min(t1, pos + CHUNK);
    const { buf, startTime } = await decodeRange(a, b, SR);
    const ch = Math.min(2, buf.numberOfChannels);
    if (!enc) enc = new lamejs.Mp3Encoder(ch, SR, kbps);
    const skip = Math.max(0, Math.round((a - startTime) * SR));
    const len = Math.max(0, Math.min(buf.length - skip, Math.round((b - a) * SR)));
    const L = buf.getChannelData(0), R = ch > 1 ? buf.getChannelData(1) : null;
    const to16 = (x) => (x <= -1 ? -32768 : x >= 1 ? 32767 : Math.round(x * 32767));
    let blocks = 0;
    for (let i = skip; i < skip + len; i += 1152) {
      const m = Math.min(1152, skip + len - i), l = new Int16Array(m), r = R ? new Int16Array(m) : null;
      for (let k = 0; k < m; k++) { l[k] = to16(L[i + k]); if (r) r[k] = to16(R[i + k]); }
      const o = r ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
      if (o.length) parts.push(new Uint8Array(o));
      if (++blocks % 300 === 0) await tick();
    }
    pos = b; onProgress((pos - t0) / (t1 - t0));
  }
  if (enc) { const f = enc.flush(); if (f.length) parts.push(new Uint8Array(f)); }
  return new Blob(parts, { type: "audio/mpeg" });
}
$("export").onclick = async () => {
  const t0 = sel.start, t1 = sel.end, btn = $("export"), st = $("exportStatus");
  if (t1 - t0 < MIN_SEL) return;
  const mode = document.querySelector("input[name=mode]:checked").value;
  btn.disabled = true; st.textContent = "";
  try {
    let blob, ext;
    if (mode === "native" || src.ext === "mp3") { blob = new Blob([src.cut(t0, t1).data], { type: src.mime }); ext = src.ext; }
    else {
      st.textContent = "Encodage MP3… 0 %";
      blob = await exportMp3(t0, t1, +$("kbps").value, (p) => { st.textContent = "Encodage MP3… " + Math.round(p * 100) + " %"; });
      ext = "mp3";
    }
    saveBlob(blob, sanitize(BASE) + " [extrait " + fileT(t0) + "-" + fileT(t1) + "]." + ext);
    st.textContent = "✔ Exporté (" + (blob.size / 1e6).toFixed(2) + " Mo)";
  } catch (e) { st.textContent = "Erreur : " + (e && e.message ? e.message : e); }
  btn.disabled = false;
};

// ---- mise en page ----
function layout() {
  W = Math.max(320, Math.floor($("stage").parentElement.clientWidth - 2));
  for (const c of [baseCv, overCv]) { c.width = W; c.height = H; c.style.width = W + "px"; c.style.height = H + "px"; }
  $("stage").style.height = H + "px"; ovCv.width = W; ovCv.style.width = "100%";
  imgData = null;
}
window.addEventListener("resize", () => {
  if (!src) return;
  const center = view.start + W / view.pps / 2; layout();
  setView(center - W / view.pps / 2, view.pps); // (pps minimal recalculé)
});

// ---- démarrage ----
async function main() {
  $("title").textContent = BASE;
  if (!SRC_URL) { setStatus("Aucune source audio fournie (ouvre l'éditeur depuis le popup de l'extension).", true); return; }
  try {
    bytes = await download(SRC_URL);
    setStatus("Lecture du fichier…");
    src = AudioCut.open(bytes); duration = src.duration;
    $("ui").hidden = false; layout();
    if (src.ext === "mp3") { $("lblNative").textContent = "MP3 d'origine — sans réencodage, instantané"; $("rowMp3").hidden = true; }
    audio.src = URL.createObjectURL(new Blob([bytes], { type: src.mime }));
    setSel(0, duration, false);                 // par défaut : tout le fichier (guide de fin tout à droite)
    setView(0, minPps());
    setProgress(0);
    await analyze();
    setStatus("Prêt — durée " + fmt(duration, 0, duration >= 3600) + ". Règle les guides vert (début) et rouge (fin).");
    $("bar").style.visibility = "hidden";
  } catch (e) {
    console.error(e);
    setStatus("Erreur : " + (e && e.message ? e.message : e) + (src ? "\n(Le décodage audio nécessite Google Chrome.)" : ""), true);
  }
}
main();
