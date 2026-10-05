/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */
/* audiocut.js — découpe SANS RÉENCODAGE d'un fichier .m4a (MP4/AAC, y compris fragmenté) ou .mp3.
 * Fonctionne sur des Uint8Array. Aucune dépendance. Utilisable dans le navigateur (window.AudioCut)
 * et dans Node (module.exports) pour les tests.
 */
(function (root) {
  "use strict";

  // ---------- utilitaires binaires ----------
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
  const wr32 = (b, o, v) => { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; };
  const wr64 = (b, o, v) => { wr32(b, o, Math.floor(v / 4294967296)); wr32(b, o + 4, v >>> 0); };
  const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const cc = (s) => Uint8Array.from([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
  const be32 = (v) => { const a = new Uint8Array(4); wr32(a, 0, v); return a; };

  function concat(parts) {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function box(type, ...payload) {
    const body = concat(payload);
    const out = new Uint8Array(8 + body.length);
    wr32(out, 0, out.length); out.set(cc(type), 4); out.set(body, 8);
    return out;
  }

  // ---------- MP4 : lecture des boîtes ----------
  function readBoxes(b, start, end) {
    const out = []; let p = start;
    while (p + 8 <= end) {
      let size = u32(b, p); const type = fourcc(b, p + 4); let hdr = 8;
      if (size === 1) { size = u64(b, p + 8); hdr = 16; }
      else if (size === 0) size = end - p;
      if (p + size > end) size = end - p;      // dernière boîte tronquée : on tolère
      if (size < hdr) break;
      out.push({ type, start: p, size, hdr, end: p + size });
      p += size;
    }
    return out;
  }
  const kids = (b, bx) => readBoxes(b, bx.start + bx.hdr, bx.end);
  const pick = (list, type) => list.find((x) => x.type === type);
  const pay = (bx) => bx.start + bx.hdr;     // début de la charge utile

  function parseMp4(b) {
    const top = readBoxes(b, 0, b.length);
    const moov = pick(top, "moov");
    if (!moov) throw new Error("Fichier MP4 invalide (moov introuvable).");
    const moovKids = kids(b, moov);
    const mvhd = pick(moovKids, "mvhd");

    // piste audio ('soun')
    let trak = null, mk = null, mdia = null;
    for (const t of moovKids.filter((x) => x.type === "trak")) {
      const m = pick(kids(b, t), "mdia"); if (!m) continue;
      const k = kids(b, m); const h = pick(k, "hdlr");
      if (h && fourcc(b, pay(h) + 8) === "soun") { trak = t; mdia = m; mk = k; break; }
    }
    if (!trak) throw new Error("Aucune piste audio trouvée dans le MP4.");
    const tk = kids(b, trak);
    const tkhd = pick(tk, "tkhd"), mdhd = pick(mk, "mdhd"), minf = pick(mk, "minf");
    const mkv = (b[pay(mdhd)] === 1);
    const timescale = u32(b, pay(mdhd) + (mkv ? 20 : 12));
    const trackId = u32(b, pay(tkhd) + (b[pay(tkhd)] === 1 ? 20 : 12));
    const minfKids = kids(b, minf);
    const stbl = pick(minfKids, "stbl");
    const sk = kids(b, stbl);
    const stsd = pick(sk, "stsd");

    let offs, sizes, durs, n;
    const hasFrag = top.some((x) => x.type === "moof");
    if (!hasFrag) {
      // ----- MP4 classique : tables stts / stsz / stsc / stco -----
      const stts = pick(sk, "stts"), stsz = pick(sk, "stsz"), stsc = pick(sk, "stsc");
      const stco = pick(sk, "stco"), co64 = pick(sk, "co64");
      if (!stts || !stsz || !stsc || !(stco || co64)) throw new Error("Tables d'échantillons MP4 incomplètes.");
      // tailles
      const fixed = u32(b, pay(stsz) + 4); n = u32(b, pay(stsz) + 8);
      sizes = new Uint32Array(n);
      for (let i = 0; i < n; i++) sizes[i] = fixed ? fixed : u32(b, pay(stsz) + 12 + 4 * i);
      // durées
      durs = new Uint32Array(n);
      const nst = u32(b, pay(stts) + 4); let si = 0;
      for (let e = 0; e < nst; e++) {
        const cnt = u32(b, pay(stts) + 8 + 8 * e), d = u32(b, pay(stts) + 12 + 8 * e);
        for (let k = 0; k < cnt && si < n; k++) durs[si++] = d;
      }
      // offsets via stsc + stco
      const nsc = u32(b, pay(stsc) + 4);
      const sc = []; for (let e = 0; e < nsc; e++) sc.push([u32(b, pay(stsc) + 8 + 12 * e), u32(b, pay(stsc) + 12 + 12 * e)]);
      const big = !!co64; const cb = big ? co64 : stco;
      const nch = u32(b, pay(cb) + 4);
      offs = new Float64Array(n);
      let s = 0, e = 0;
      for (let c = 0; c < nch && s < n; c++) {
        while (e + 1 < sc.length && sc[e + 1][0] <= c + 1) e++;
        let off = big ? u64(b, pay(cb) + 8 + 8 * c) : u32(b, pay(cb) + 8 + 4 * c);
        for (let k = 0; k < sc[e][1] && s < n; k++) { offs[s] = off; off += sizes[s]; s++; }
      }
    } else {
      // ----- MP4 fragmenté : on rassemble les échantillons de tous les moof -----
      let dSize = 0, dDur = 0;
      const mvex = pick(moovKids, "mvex");
      if (mvex) for (const t of kids(b, mvex).filter((x) => x.type === "trex")) {
        if (u32(b, pay(t) + 4) === trackId) { dDur = u32(b, pay(t) + 12); dSize = u32(b, pay(t) + 16); }
      }
      const O = [], S = [], D = [];
      for (const mf of top.filter((x) => x.type === "moof")) {
        for (const traf of kids(b, mf).filter((x) => x.type === "traf")) {
          const tk2 = kids(b, traf); const tfhd = pick(tk2, "tfhd");
          if (!tfhd || u32(b, pay(tfhd) + 4) !== trackId) continue;
          const fl = u32(b, pay(tfhd)) & 0xffffff; let p = pay(tfhd) + 8;
          let base = mf.start, tDur = dDur, tSize = dSize;
          if (fl & 1) { base = u64(b, p); p += 8; }
          if (fl & 2) p += 4;
          if (fl & 8) { tDur = u32(b, p); p += 4; }
          if (fl & 0x10) { tSize = u32(b, p); p += 4; }
          let cur = base;
          for (const tr of tk2.filter((x) => x.type === "trun")) {
            const tf = u32(b, pay(tr)) & 0xffffff; const cnt = u32(b, pay(tr) + 4); let q = pay(tr) + 8;
            if (tf & 1) { cur = base + i32(b, q); q += 4; }
            if (tf & 4) q += 4;
            for (let i = 0; i < cnt; i++) {
              let d = tDur, sz = tSize;
              if (tf & 0x100) { d = u32(b, q); q += 4; }
              if (tf & 0x200) { sz = u32(b, q); q += 4; }
              if (tf & 0x400) q += 4;
              if (tf & 0x800) q += 4;
              O.push(cur); S.push(sz); D.push(d); cur += sz;
            }
          }
        }
      }
      n = O.length; offs = Float64Array.from(O); sizes = Uint32Array.from(S); durs = Uint32Array.from(D);
    }
    if (!n) throw new Error("Aucun échantillon audio dans le MP4.");

    const dts = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) dts[i + 1] = dts[i] + durs[i];

    return {
      format: "mp4", ext: "m4a", mime: "audio/mp4", b, n, offs, sizes, durs, dts, timescale,
      duration: dts[n] / timescale,
      boxes: { mvhd, tkhd, mdhd, stsd, mdia, mk, minfKids, tk },
    };
  }

  function lowerIndex(dts, n, ticks) {            // plus grand i tel que dts[i] <= ticks
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (dts[mid] <= ticks) lo = mid; else hi = mid - 1; }
    return lo;
  }

  function patchDur(b, bx, kind, mvTs, mvDur, mdDur) {
    // copie d'une boîte mvhd / tkhd / mdhd avec la durée corrigée
    const c = b.slice(bx.start, bx.end); const v1 = c[bx.hdr] === 1; const P = bx.hdr;
    if (kind === "mvhd") { if (v1) wr64(c, P + 24, mvDur); else wr32(c, P + 16, mvDur); }
    else if (kind === "tkhd") { if (v1) wr64(c, P + 28, mvDur); else wr32(c, P + 20, mvDur); }
    else if (kind === "mdhd") { if (v1) wr64(c, P + 24, mdDur); else wr32(c, P + 16, mdDur); }
    return c;
  }

  function cutMp4(src, t0, t1) {
    const { b, n, offs, sizes, durs, dts, timescale, boxes } = src;
    const PRE = 1, POST = 1;                      // 1 trame (~23 ms) de marge de chaque côté
    t0 = Math.max(0, t0); t1 = Math.min(src.duration, Math.max(t1, t0));
    const i0 = Math.max(0, lowerIndex(dts, n, t0 * timescale) - PRE);
    const i1 = Math.min(n - 1, lowerIndex(dts, n, Math.max(0, t1 * timescale - 1)) + POST);
    const cnt = i1 - i0 + 1;

    let total = 0; for (let i = i0; i <= i1; i++) total += sizes[i];
    const mediaDur = dts[i1 + 1] - dts[i0];
    const mvTs = u32(b, pay(boxes.mvhd) + (b[pay(boxes.mvhd)] === 1 ? 20 : 12));
    const mvDur = Math.round((mediaDur / timescale) * mvTs);

    // stts (durées compressées par plages)
    const runs = [];
    for (let i = i0; i <= i1; i++) {
      const last = runs[runs.length - 1];
      if (last && last[1] === durs[i]) last[0]++; else runs.push([1, durs[i]]);
    }
    const sttsB = new Uint8Array(8 + 8 * runs.length);
    wr32(sttsB, 4, runs.length); runs.forEach((r, k) => { wr32(sttsB, 8 + 8 * k, r[0]); wr32(sttsB, 12 + 8 * k, r[1]); });
    const stscB = new Uint8Array(20); wr32(stscB, 4, 1); wr32(stscB, 8, 1); wr32(stscB, 12, cnt); wr32(stscB, 16, 1);
    const stszB = new Uint8Array(12 + 4 * cnt); wr32(stszB, 8, cnt);
    for (let i = 0; i < cnt; i++) wr32(stszB, 12 + 4 * i, sizes[i0 + i]);
    const copyBox = (bx) => b.slice(bx.start, bx.end);

    const buildMoov = (chunkOffset) => {
      const stcoB = new Uint8Array(12); wr32(stcoB, 4, 1); wr32(stcoB, 8, chunkOffset);
      const stbl = box("stbl", copyBox(boxes.stsd), box("stts", sttsB), box("stsc", stscB), box("stsz", stszB), box("stco", stcoB));
      const minf = box("minf", ...boxes.minfKids.map((x) => (x.type === "stbl" ? stbl : copyBox(x))));
      const mdia = box("mdia", ...boxes.mk.map((x) =>
        x.type === "minf" ? minf : x.type === "mdhd" ? patchDur(b, x, "mdhd", mvTs, mvDur, mediaDur) : copyBox(x)));
      const trakParts = [];
      for (const x of boxes.tk) {
        if (x.type === "tkhd") trakParts.push(patchDur(b, x, "tkhd", mvTs, mvDur, mediaDur));
        else if (x.type === "mdia") trakParts.push(mdia);
        // edts / udta / meta / tref : volontairement omis
      }
      return box("moov", patchDur(b, boxes.mvhd, "mvhd", mvTs, mvDur, mediaDur), box("trak", ...trakParts));
    };

    const ftyp = box("ftyp", cc("M4A "), be32(0), cc("M4A "), cc("mp42"), cc("isom"));
    const moov0 = buildMoov(0);
    const moov = buildMoov(ftyp.length + moov0.length + 8);
    const out = new Uint8Array(ftyp.length + moov.length + 8 + total);
    let o = 0;
    out.set(ftyp, o); o += ftyp.length;
    out.set(moov, o); o += moov.length;
    wr32(out, o, 8 + total); out.set(cc("mdat"), o + 4); o += 8;
    for (let i = i0; i <= i1; i++) { out.set(b.subarray(offs[i], offs[i] + sizes[i]), o); o += sizes[i]; }
    return { data: out, startTime: dts[i0] / timescale, endTime: dts[i1 + 1] / timescale };
  }

  // ---------- MP3 ----------
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SRT = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

  function parseMp3(b) {
    let p = 0;
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
      p = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));
      if (b[5] & 0x10) p += 10;
    }
    const offs = [], sizes = []; let sr = 0, spf = 0;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) { p++; continue; }
      const ver = (b[p + 1] >> 3) & 3, layer = (b[p + 1] >> 1) & 3, bri = (b[p + 2] >> 4) & 15, sri = (b[p + 2] >> 2) & 3, pad = (b[p + 2] >> 1) & 1;
      if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) { p++; continue; }
      const mpeg1 = ver === 3; const kbps = (mpeg1 ? BR1 : BR2)[bri]; const rate = SRT[ver][sri];
      const len = (mpeg1 ? Math.floor((144000 * kbps) / rate) : Math.floor((72000 * kbps) / rate)) + pad;
      if (p + len > b.length) break;
      const nxt = p + len;
      const ok = nxt + 2 > b.length || (b[nxt] === 0xff && (b[nxt + 1] & 0xe0) === 0xe0) || fourcc(b, nxt).startsWith("TAG") || fourcc(b, nxt).startsWith("ID3");
      if (!ok) { p++; continue; }
      if (!sr) { sr = rate; spf = mpeg1 ? 1152 : 576; }
      // trame d'en-tête Xing/Info : pas de l'audio
      let isInfo = false;
      if (!offs.length) { const s = fourcc(b, p + 4 + 32 > b.length ? p : p + 4 + 32), s2 = fourcc(b, p + 4 + 17), s3 = fourcc(b, p + 4 + 9); isInfo = [s, s2, s3].some((x) => x === "Xing" || x === "Info"); }
      if (!isInfo) { offs.push(p); sizes.push(len); }
      p += len;
    }
    if (!offs.length) throw new Error("Aucune trame MP3 valide.");
    return { format: "mp3", ext: "mp3", mime: "audio/mpeg", b, n: offs.length, offs, sizes, sr, spf, duration: (offs.length * spf) / sr };
  }

  function cutMp3(src, t0, t1) {
    const { b, n, offs, sizes, sr, spf } = src;
    const i0 = Math.max(0, Math.floor((t0 * sr) / spf) - 2);        // 2 trames de marge (réservoir de bits)
    const i1 = Math.min(n - 1, Math.ceil((t1 * sr) / spf) + 1);
    let total = 0; for (let i = i0; i <= i1; i++) total += sizes[i];
    const out = new Uint8Array(total); let o = 0;
    for (let i = i0; i <= i1; i++) { out.set(b.subarray(offs[i], offs[i] + sizes[i]), o); o += sizes[i]; }
    return { data: out, startTime: (i0 * spf) / sr, endTime: ((i1 + 1) * spf) / sr };
  }

  // ---------- API ----------
  function open(b) {
    if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
    const t4 = b.length > 8 ? fourcc(b, 4) : "";
    let src;
    if (["ftyp", "moov", "mdat", "free", "styp", "skip", "wide"].includes(t4)) src = parseMp4(b);
    else if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) src = parseMp3(b);
    else throw new Error("Format non reconnu (ni MP4/M4A ni MP3).");
    return {
      format: src.format, ext: src.ext, mime: src.mime, duration: src.duration,
      cut: (t0, t1) => (src.format === "mp4" ? cutMp4(src, t0, t1) : cutMp3(src, t0, t1)),
    };
  }

  const API = { open };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.AudioCut = API;
})(typeof self !== "undefined" ? self : this);
