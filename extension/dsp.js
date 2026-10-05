/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */
/* dsp.js — spectrogramme + enveloppe pour l'affichage (FFT radix-2). */
(function (root) {
  "use strict";
  function makeFFT(N) {
    const levels = Math.log2(N) | 0;
    const cos = new Float32Array(N / 2), sin = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = Math.sin((2 * Math.PI * i) / N); }
    const rev = new Uint32Array(N);
    for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b); rev[i] = r; }
    return function fft(re, im) {
      for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let size = 2; size <= N; size <<= 1) {
        const half = size >> 1, step = N / size;
        for (let i = 0; i < N; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const tr = re[l] * cos[k] + im[l] * sin[k], ti = -re[l] * sin[k] + im[l] * cos[k];
            re[l] = re[j] - tr; im[l] = im[j] - ti; re[j] += tr; im[j] += ti;
          }
        }
      }
    };
  }

  /** x : Float32Array mono. Retourne {cols, bins, mag(Uint8 cols*bins), level(Uint8 cols)} ; colonne i ↔ temps i*hop/sr. */
  function spectro(x, o) {
    const N = (o && o.fftSize) || 256, H = (o && o.hop) || 160, bins = N / 2;
    const cols = Math.floor(x.length / H);
    const mag = new Uint8Array(cols * bins), level = new Uint8Array(cols);
    const fft = makeFFT(N), re = new Float32Array(N), im = new Float32Array(N);
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const norm = N / 4;
    for (let c = 0; c < cols; c++) {
      const s0 = c * H - (N >> 1);
      for (let i = 0; i < N; i++) { const k = s0 + i; re[i] = k >= 0 && k < x.length ? x[k] * win[i] : 0; im[i] = 0; }
      fft(re, im);
      const base = c * bins;
      for (let k = 0; k < bins; k++) {
        const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / norm;
        const v = (20 * Math.log10(m + 1e-9) + 90) / 80;
        mag[base + k] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0;
      }
      let e = 0, cnt = 0;
      for (let i = c * H - (H >> 1); i < c * H + (H >> 1); i++) if (i >= 0 && i < x.length) { e += x[i] * x[i]; cnt++; }
      const rms = cnt ? Math.sqrt(e / cnt) : 0;
      const lv = (20 * Math.log10(rms + 1e-5) + 70) / 70;
      level[c] = lv <= 0 ? 0 : lv >= 1 ? 255 : (lv * 255) | 0;
    }
    return { cols, bins, mag, level };
  }

  const API = { spectro };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.DSP = API;
})(typeof self !== "undefined" ? self : this);
