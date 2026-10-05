/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */
const $ = (id) => document.getElementById(id);

// Exécutée DANS la page. Doit rester autonome (aucune référence à l'extérieur).
function scanPage() {
  const AUDIO_FILE = /\.(mp3|m4a|aac)(\?|$)/i;
  const AUDIO_ANY = /https?:\/\/[^\s"'<>\\)]+?\.(?:mp3|m4a|aac)(?:\?[^\s"'<>\\)]*)?/gi;
  const norm = (s) => s.replace(/\\u002F/gi, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const isRF = (u) => { try { return /radiofrance/i.test(new URL(u).hostname); } catch { return false; } };

  const main = new Set();   // fichier audio de l'épisode de la page
  const others = new Set(); // autres fichiers audio trouvés dans la page (épisodes suggérés…)

  // 1) JSON-LD : AudioObject.contentUrl = l'épisode de la page
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n.contentUrl === "string" && isRF(n.contentUrl)) main.add(n.contentUrl);
    Object.values(n).forEach(walk);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try { walk(JSON.parse(s.textContent)); } catch (e) { /* JSON-LD illisible : on ignore */ }
  });

  // 2) Balises <audio> (si le lecteur est déjà chargé)
  document.querySelectorAll("audio").forEach((a) => {
    const u = a.currentSrc || a.src;
    if (u && isRF(u) && AUDIO_FILE.test(u)) main.add(u);
  });

  // 3) Balayage brut du HTML + données embarquées (SvelteKit)
  const html = norm(document.documentElement.outerHTML);
  for (const m of html.matchAll(AUDIO_ANY)) {
    if (isRF(m[0]) && !main.has(m[0])) others.add(m[0]);
  }

  const date = document.querySelector("time[datetime]")?.getAttribute("datetime")?.slice(0, 10) || "";
  const h1 = document.querySelector("h1")?.textContent?.trim() || "";
  const title = h1 || document.querySelector('meta[property="og:title"]')?.content || document.title || "podcast";
  return { title, date, main: [...main], others: [...others] };
}

const sanitize = (s) =>
  s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "podcast";
const extOf = (url) => (url.split("?")[0].match(/\.(mp3|m4a|aac)$/i)?.[1] || "m4a").toLowerCase();

function download(url, baseName) {
  chrome.downloads.download({
    url,
    filename: `${sanitize(baseName)}.${extOf(url)}`,
    conflictAction: "uniquify",
    saveAs: false,
  });
}

function item(url, baseName) {
  const li = document.createElement("li");
  const name = document.createElement("span");
  name.className = "name";
  name.innerHTML = `<span class="ext">.${extOf(url)}</span> — `;
  name.append(document.createTextNode(baseName));
  const row = document.createElement("div");
  row.className = "row";

  const dl = document.createElement("button");
  dl.textContent = "Télécharger";
  dl.onclick = () => download(url, baseName);
  row.append(dl);

  const ed = document.createElement("button");
  ed.className = "secondary";
  ed.textContent = "✂ Découper un extrait";
  ed.onclick = () => chrome.tabs.create({
    url: chrome.runtime.getURL("editor.html") + "?src=" + encodeURIComponent(url) + "&name=" + encodeURIComponent(baseName),
  });
  row.append(ed);

  if (extOf(url) !== "mp3") {
    const cp = document.createElement("button");
    cp.className = "secondary";
    cp.textContent = "Copier la commande MP3 (ffmpeg)";
    cp.onclick = async () => {
      const cmd = `ffmpeg -i "${url}" -vn -codec:a libmp3lame -q:a 2 "${sanitize(baseName)}.mp3"`;
      await navigator.clipboard.writeText(cmd);
      cp.textContent = "Copiée ✔";
    };
    row.append(cp);
  }
  li.append(name, row);
  return li;
}

function group(title, urls, nameFor) {
  if (!urls.length) return;
  const h = document.createElement("h2");
  h.textContent = title;
  const ul = document.createElement("ul");
  urls.forEach((u) => ul.append(item(u, nameFor(u))));
  $("groups").append(h, ul);
}

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https:\/\/([^/]+\.)?radiofrance\.fr\//.test(tab.url)) {
      $("status").textContent = "Ouvre d'abord une page d'épisode sur radiofrance.fr.";
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanPage,
    });

    const key = `sniffed:${tab.id}`;
    const sniffedAll = (await chrome.storage.session.get(key))[key] || [];
    const known = new Set([...result.main, ...result.others]);
    const sniffed = sniffedAll.filter((u) => !known.has(u));

    const base = [result.date, result.title].filter(Boolean).join(" - ");
    const total = result.main.length + sniffed.length + result.others.length;

    if (!total) {
      $("status").textContent = "Aucun fichier audio trouvé. Lance la lecture puis rouvre cette fenêtre.";
      return;
    }

    $("status").textContent = result.main.length
      ? "Épisode détecté."
      : "Pas d'audio principal identifié : vérifie les fichiers ci-dessous.";

    group("Épisode de cette page", result.main, () => base);
    group("Détecté à la lecture", sniffed, (u) => `${base} (${decodeURIComponent(u.split("?")[0].split("/").pop())})`);
    group("Autres épisodes cités dans la page", result.others,
      (u) => decodeURIComponent(u.split("?")[0].split("/").pop()).replace(/\.\w+$/, ""));
  } catch (e) {
    $("status").innerHTML = '<span class="error"></span>';
    $("status").firstChild.textContent = "Erreur : " + (e && e.message ? e.message : String(e));
  }
})();
