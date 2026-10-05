#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */
/* Vérifie que le manifest est valide et que tous les fichiers référencés existent. */
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "extension");
const errors = [];
const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));

if (m.manifest_version !== 3) errors.push("manifest_version doit valoir 3");
if (!/^\d+\.\d+\.\d+$/.test(m.version || "")) errors.push("version : format X.Y.Z attendu (reçu " + m.version + ")");

const refs = new Set();
const add = (p) => p && refs.add(p);
add(m.background && m.background.service_worker);
add(m.action && m.action.default_popup);
Object.values((m.action && m.action.default_icon) || {}).forEach(add);
Object.values(m.icons || {}).forEach(add);
// fichiers référencés par les pages HTML (scripts / feuilles de style)
for (const html of ["popup.html", "editor.html"]) {
  const src = fs.readFileSync(path.join(dir, html), "utf8");
  for (const r of src.matchAll(/(?:src|href)="([^"#?]+)"/g)) if (!/^https?:/.test(r[1])) add(r[1]);
}
for (const r of refs) if (!fs.existsSync(path.join(dir, r))) errors.push("fichier référencé introuvable : " + r);

if (errors.length) { console.error("✖ " + errors.join("\n✖ ")); process.exit(1); }
console.log(`✔ manifest OK (v${m.version}, ${refs.size} fichiers référencés présents)`);
