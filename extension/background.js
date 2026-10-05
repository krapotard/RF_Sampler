/* SPDX-License-Identifier: GPL-3.0-only
 * RF Sampler — Copyright (C) 2026 Thomas Garnier
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
 * licence GNU GPL version 3 (voir le fichier LICENSE). Il est distribué SANS AUCUNE GARANTIE. */
// Compatibilité Chrome / Firefox : Firefox expose `browser` (API à promesses), Chrome expose `chrome`.
const api = globalThis.browser ?? globalThis.chrome;

// Écoute passive des requêtes audio émises par la page (filet de sécurité quand tu lances la lecture).
const AUDIO_RE = /\.(mp3|m4a|aac)(\?|$)/i;

api.webRequest.onBeforeRequest.addListener(
  async (details) => {
    if (details.tabId < 0 || !AUDIO_RE.test(details.url)) return;
    const key = `sniffed:${details.tabId}`;
    const data = await api.storage.session.get(key);
    const list = data[key] || [];
    if (!list.includes(details.url)) {
      list.push(details.url);
      await api.storage.session.set({ [key]: list });
      api.action.setBadgeText({ tabId: details.tabId, text: String(list.length) });
      api.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#e2001a" });
    }
  },
  { urls: ["*://*.radiofrance-podcast.net/*", "*://*.radiofrance.fr/*"] }
);

api.tabs.onRemoved.addListener((tabId) => {
  api.storage.session.remove(`sniffed:${tabId}`);
});
