#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */
/* Génère les PNG de l'extension à partir des SVG de assets/ (nécessite : npm install).
 *   16 et 32 px : assets/icon-small.svg (version simplifiée, lisible en petit)
 *   48 et 128 px : assets/icon.svg      (version détaillée)
 *   512 px       : assets/icon-512.png  (README)
 */
const fs = require("fs"), path = require("path");
let Resvg;
try { ({ Resvg } = require("@resvg/resvg-js")); }
catch (e) { console.error("Dépendance manquante : lance d'abord `npm install`."); process.exit(1); }

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, "assets", f), "utf8");
const png = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
const small = read("icon-small.svg"), full = read("icon.svg");

const jobs = [
  [small, 16, "extension/icons/icon16.png"],
  [small, 32, "extension/icons/icon32.png"],
  [full, 48, "extension/icons/icon48.png"],
  [full, 128, "extension/icons/icon128.png"],
  [full, 512, "assets/icon-512.png"],
];
for (const [svg, size, out] of jobs) {
  fs.writeFileSync(path.join(root, out), png(svg, size));
  console.log("✔", out);
}
