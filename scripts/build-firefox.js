#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */

/* Génère la version Firefox de l'extension dans dist/firefox/ à partir de extension/.
 * Seul le manifeste change : Firefox utilise une « event page » (background.scripts) au lieu du service worker
 * de Chrome, et exige un identifiant d'extension et la déclaration des données collectées.
 * Usage : node scripts/build-firefox.js */
const fs = require("fs"), path = require("path");

const GECKO_ID = "rf-sampler@krapotard.github.io";   // identifiant fixe de l'extension (ne pas changer après signature)
const MIN_FIREFOX = "142.0";                          // data_collection_permissions est géré à partir de cette version

const root = path.join(__dirname, "..");
const src = path.join(root, "extension"), out = path.join(root, "dist", "firefox");

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const m = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
const sw = m.background && m.background.service_worker;
if (!sw) throw new Error("manifest Chrome inattendu : background.service_worker introuvable");
m.background = { scripts: [sw] };
m.browser_specific_settings = {
  gecko: {
    id: GECKO_ID,
    strict_min_version: MIN_FIREFOX,
    data_collection_permissions: { required: ["none"] },   // aucune donnée collectée (voir PRIVACY.md)
  },
};
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
console.log(`✔ Firefox : dist/firefox/ (v${m.version}, Firefox ≥ ${MIN_FIREFOX}, id ${GECKO_ID})`);
