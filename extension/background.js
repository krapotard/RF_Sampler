/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */
// Écoute passive des requêtes audio émises par la page (filet de sécurité quand tu lances la lecture).
const AUDIO_RE = /\.(mp3|m4a|aac)(\?|$)/i;

chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    if (details.tabId < 0 || !AUDIO_RE.test(details.url)) return;
    const key = `sniffed:${details.tabId}`;
    const data = await chrome.storage.session.get(key);
    const list = data[key] || [];
    if (!list.includes(details.url)) {
      list.push(details.url);
      await chrome.storage.session.set({ [key]: list });
      chrome.action.setBadgeText({ tabId: details.tabId, text: String(list.length) });
      chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#e2001a" });
    }
  },
  { urls: ["*://*.radiofrance-podcast.net/*", "*://*.radiofrance.fr/*"] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`sniffed:${tabId}`);
});
