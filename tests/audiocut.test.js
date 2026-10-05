/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */
"use strict";
/* Tests de la découpe sans réencodage. Nécessitent ffmpeg (générateur de fichiers de test + décodeur de référence). */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const AC = require("../extension/audiocut.js");
const DSP = require("../extension/dsp.js");

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rfpt-"));
const FREQS = [440, 880, 1320];                 // 3 segments de 10 s
const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);

const FORMATS = {
  "m4a (moov au début)": ["m4a_fast.m4a", ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]],
  "m4a (moov à la fin)": ["m4a_end.m4a", ["-c:a", "aac", "-b:a", "128k"]],
  "m4a fragmenté": ["m4a_frag.m4a", ["-c:a", "aac", "-b:a", "128k", "-movflags", "frag_keyframe+empty_moov+default_base_moof"]],
  "mp3 CBR": ["cbr.mp3", ["-c:a", "libmp3lame", "-b:a", "128k"]],
  "mp3 VBR": ["vbr.mp3", ["-c:a", "libmp3lame", "-q:a", "4"]],
};

before(() => {
  if (!HAS_FFMPEG) return;
  const inputs = FREQS.flatMap((f) => ["-f", "lavfi", "-t", "10", "-i", `sine=frequency=${f}:sample_rate=44100`]);
  ff([...inputs, "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1,aformat=channel_layouts=stereo[o]", "-map", "[o]", path.join(tmp, "ref.wav")]);
  for (const [file, opts] of Object.values(FORMATS)) ff(["-i", path.join(tmp, "ref.wav"), ...opts, path.join(tmp, file)]);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function decodeMono8k(file) {
  const out = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
}
function peakHz(x, t) {                           // fréquence dominante à l'instant t (secondes)
  const s = DSP.spectro(x, { fftSize: 256, hop: 160 }), c = Math.round(t / 0.02);
  let best = 0, bv = -1;
  for (let k = 0; k < s.bins; k++) { const v = s.mag[c * s.bins + k]; if (v > bv) { bv = v; best = k; } }
  return (best * 8000) / 256;
}

for (const [name, [file]] of Object.entries(FORMATS)) {
  test(`${name} : durée et découpe`, { skip: !HAS_FFMPEG && "ffmpeg absent" }, () => {
    const src = AC.open(new Uint8Array(fs.readFileSync(path.join(tmp, file))));
    assert.ok(Math.abs(src.duration - 30) < 0.15, `durée ${src.duration}`);

    const cut = src.cut(8, 12);                   // chevauche la bascule 440 → 880 Hz à t = 10 s
    assert.ok(cut.startTime <= 8 && cut.startTime > 7.8, `startTime ${cut.startTime}`);
    assert.ok(cut.endTime >= 12 && cut.endTime < 12.2, `endTime ${cut.endTime}`);

    const out = path.join(tmp, "cut_" + file); fs.writeFileSync(out, cut.data);
    const x = decodeMono8k(out), dur = x.length / 8000;
    assert.ok(Math.abs(dur - (cut.endTime - cut.startTime)) < 0.1, `durée décodée ${dur}`);
    // contenu : avant la bascule (≈ 9 s) → 440 Hz ; après (≈ 11 s) → 880 Hz
    const t9 = 9 - cut.startTime, t11 = 11 - cut.startTime;
    assert.ok(Math.abs(peakHz(x, t9) - 440) <= 40, `à 9 s : ${peakHz(x, t9)} Hz`);
    assert.ok(Math.abs(peakHz(x, t11) - 880) <= 40, `à 11 s : ${peakHz(x, t11)} Hz`);
  });
}

test("bornes hors fichier : la coupe est ramenée dans [0, durée]", { skip: !HAS_FFMPEG && "ffmpeg absent" }, () => {
  const src = AC.open(new Uint8Array(fs.readFileSync(path.join(tmp, "m4a_fast.m4a"))));
  const c = src.cut(-5, 999);
  assert.ok(c.startTime >= 0 && Math.abs(c.endTime - src.duration) < 0.1);
});

test("fichier non reconnu : erreur explicite", () => {
  assert.throws(() => AC.open(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), /Format non reconnu/);
});

test("spectrogramme : le pic d'un sinus 1 kHz tombe au bon bin", () => {
  const sr = 8000, x = new Float32Array(sr);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
  const s = DSP.spectro(x, { fftSize: 256, hop: 160 });
  let best = 0, bv = -1; for (let k = 0; k < s.bins; k++) if (s.mag[10 * s.bins + k] > bv) { bv = s.mag[10 * s.bins + k]; best = k; }
  assert.equal(best, 32);                          // 1000 Hz / 31,25 Hz par bin
});
