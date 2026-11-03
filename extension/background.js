/* Crate Digger — background service worker */
importScripts('storage.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'cd-save', title: 'Save to Crate Digger', contexts: ['page', 'video', 'audio'] });
  seedOnce().then(applyActionMode);
});

/* Toolbar icon opens the docked side panel (default) or the small popup, per Settings */
async function applyActionMode() {
  const { settings } = await CD.load();
  const panel = settings.openIn !== 'popup';
  await chrome.action.setPopup({ popup: panel ? '' : 'popup.html' });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: panel }).catch(() => {});
}
chrome.runtime.onStartup.addListener(applyActionMode);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.cd_state &&
      ch.cd_state.newValue?.settings?.openIn !== ch.cd_state.oldValue?.settings?.openIn) applyActionMode();
});

/* First start: bring in the playlists from seed-backup.json (a backup saved from the old version).
   Runs once per backup file; tracks already there are skipped, so it can never create duplicates. */
let seeding = null;
async function importSeed() {
  try {
    const r = await fetch(chrome.runtime.getURL('seed-backup.json'));
    if (!r.ok) return;
    const text = await r.text();
    const tag = 'cd_seed_' + (JSON.parse(text).exported || 'v1');
    if ((await chrome.storage.local.get(tag))[tag]) return;
    const report = await CD.importGroups(CD.jsonToGroups(text));
    await chrome.storage.local.set({ [tag]: { at: Date.now(), report } });
  } catch (e) { /* no seed file, or it couldn't be read: nothing to do */ }
}
/* defaults.json (written by the installer) sets starting settings, e.g. the download folder. Applied once per file. */
async function applyDefaults() {
  try {
    const r = await fetch(chrome.runtime.getURL('defaults.json'));
    if (!r.ok) return;
    const d = await r.json();
    const tag = 'cd_defaults_' + (d.version || 'v1');
    if ((await chrome.storage.local.get(tag))[tag]) return;
    const allowed = ['dlBase', 'dlDateFolders', 'dlQuality', 'ssUrl', 'ssHint', 'openIn'];
    const patch = Object.fromEntries(Object.entries(d.settings || {}).filter(([k]) => allowed.includes(k)));
    await CD.saveSettings(patch);
    await chrome.storage.local.set({ [tag]: { at: Date.now() } });
  } catch (e) { /* no defaults file: keep built-in defaults */ }
}
const seedOnce = () => (seeding ||= applyDefaults().then(importSeed));
seedOnce().then(applyActionMode);
chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === 'cd-save' && tab) quickSave(tab.id); });
chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== 'save-current') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) quickSave(tab.id);
});
async function quickSave(tabId) {
  if (await CD.ensureContent(tabId)) chrome.tabs.sendMessage(tabId, { type: 'cd-quicksave' }).catch(() => {});
}

/* Discogs API (public endpoints work without a token; database search needs one) */
async function discogs(path, retried) {
  const { settings } = await CD.load();
  const url = new URL('https://api.discogs.com' + path);
  if (settings.discogsToken) url.searchParams.set('token', settings.discogsToken.trim());
  const r = await fetch(url.toString(), { headers: { Accept: 'application/vnd.discogs.v2.discogs+json' } });
  if (r.status === 429 && !retried) { await sleep(6000); return discogs(path, true); }
  if (!r.ok) throw new Error(r.status === 401 ? 'Discogs token missing or invalid' : `Discogs HTTP ${r.status}`);
  return r.json();
}

/* Fill missing label / cat# / year / genre / style from the best Discogs search match */
const addNote = (n, x) => (n && n.includes(x.split(':')[0])) ? n : [n, x].filter(Boolean).join(' | ');
async function enrichTrack(plId, trackId) {
  const s = await CD.load();
  const t = s.playlists[plId]?.tracks.find(x => x.id === trackId);
  if (!t) return;
  const q = CD.searchQuery(t);
  if (!q) return;
  const data = await discogs(`/database/search?type=release&per_page=5&q=${encodeURIComponent(q)}`);
  const hit = (data.results || [])[0];
  if (!hit) { await CD.updateTrack(plId, trackId, { notes: addNote(t.notes, 'No Discogs match found') }); return; }
  const patch = {};
  const fill = (k, v) => { if (!t[k] && v) patch[k] = String(v); };
  fill('label', (hit.label || [])[0]);
  fill('catno', hit.catno && !/^none$/i.test(hit.catno) ? hit.catno : '');
  fill('releaseDate', hit.year);
  fill('genre', (hit.genre || []).join(', '));
  fill('style', (hit.style || []).join(', '));
  fill('release', (hit.title || '').split(' - ').slice(1).join(' - '));
  patch.notes = addNote(t.notes, `Discogs guess: https://www.discogs.com${hit.uri}`);
  await CD.updateTrack(plId, trackId, patch);
}

const queue = [];
let running = false;
async function runQueue() {
  if (running) return;
  running = true;
  let error = '';
  try {
    while (queue.length) {
      await chrome.storage.local.set({ cd_enrich: { left: queue.length } });
      const [pl, id] = queue.shift();
      try { await enrichTrack(pl, id); }
      catch (e) { error = e.message; if (/token/i.test(error)) { queue.length = 0; break; } }
      await sleep(1100); // stay under Discogs' 60 requests/minute
    }
  } finally {
    running = false;
    await chrome.storage.local.set({ cd_enrich: { left: 0, error, at: Date.now() } });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  switch (msg.type) {
    case 'cd-add':
      CD.addItems(msg.items, msg.playlistId, { tidyUp: true }).then(send, e => send({ error: String(e) }));
      return true;
    case 'cd-discogs':
      discogs(msg.path).then(d => send({ ok: true, data: d }), e => send({ ok: false, error: e.message }));
      return true;
    case 'cd-badge': {   // ✓ on the toolbar icon when the track on this tab is already saved
      const tabId = _sender.tab?.id;
      if (tabId != null) {
        chrome.action.setBadgeText({ tabId, text: msg.text || '' }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#56B4E9' }).catch(() => {});
        chrome.action.setBadgeTextColor?.({ tabId, color: '#06243a' })?.catch?.(() => {});
        chrome.action.setTitle({ tabId, title: msg.title || 'Crate Digger' }).catch(() => {});
      }
      return false;
    }
    case 'cd-check-files':   // after "Update now": pick up the new files and restart
      checkForNewFiles(); send({ ok: true });
      return false;
    case 'cd-enrich':
      for (const id of msg.trackIds) if (!queue.some(([, x]) => x === id)) queue.push([msg.playlistId, id]);
      runQueue();
      send({ queued: queue.length });
      return false;
  }
});


/* ---------- updates ----------
   The Crate Digger updater (installed on the Mac) downloads new releases from GitHub into this folder.
   Here we notice the newer files and reload ourselves, then the panel shows what's new. */
const vparts = v => String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
const isNewer = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function checkForNewFiles() {
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' });
    const onDisk = (await r.json()).version, running = chrome.runtime.getManifest().version;
    if (isNewer(onDisk, running)) {
      await chrome.storage.local.set({ cd_updated: { from: running, to: onDisk, at: Date.now() } });
      chrome.runtime.reload();
    }
  } catch (e) { /* files mid-copy: try again next time */ }
}
chrome.alarms.create('cd-update-check', { periodInMinutes: 15 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'cd-update-check') checkForNewFiles(); });
chrome.runtime.onStartup.addListener(checkForNewFiles);
checkForNewFiles();
