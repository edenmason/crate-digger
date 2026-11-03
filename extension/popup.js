/* Crate Digger — popup */
const $ = id => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'value') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}

let state = null, tab = null, page = null, picked = new Set(), filterTimer;
const active = () => state.playlists[state.activeId];
const line = it => it.type === 'release'
  ? `${it.artist || 'Unknown artist'} – ${it.release || 'Untitled'}`
  : `${it.artist || 'Unknown artist'} – ${it.title || 'Untitled'}`;
const sub = (it, withRelease) => [
  it.position, withRelease && it.type !== 'release' ? it.release : '', it.label, it.catno, it.releaseDate,
  [it.genre, it.style].filter(Boolean).join(' / ')
].filter(Boolean).join(' · ');
const slug = s => (s || 'playlist').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'playlist';
const today = () => new Date().toISOString().slice(0, 10);

function snack(msg, bad, sticky) {
  const s = $('snack');
  s.textContent = (bad && !/^[⚠✕✓ⓘ]/.test(msg) ? '⚠ ' : '') + msg;
  s.className = 'snack' + (bad ? ' bad' : '');
  clearTimeout(snack.t);
  if (!sticky) snack.t = setTimeout(() => { s.className = 'snack hidden'; }, 2600);
}

/* ---------- sheets (modal) ---------- */
const closeSheet = () => $('modal').classList.add('hidden');
function openSheet(...nodes) { $('sheet').replaceChildren(...nodes); $('modal').classList.remove('hidden'); }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeSheet(); });

function ask(heading, value = '') {
  return new Promise(res => {
    const inp = h('input', { value, placeholder: 'Name' });
    const done = v => { closeSheet(); res(v); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value.trim()); if (e.key === 'Escape') done(null); });
    openSheet(h('h3', {}, heading), h('div', { class: 'form' }, inp),
      h('div', { class: 'row end' },
        h('button', { class: 'ghost', onclick: () => done(null) }, 'Cancel'),
        h('button', { class: 'primary', onclick: () => done(inp.value.trim()) }, 'OK')));
    inp.focus(); inp.select();
  });
}
function confirmSheet(msg, okLabel = 'Delete', ...detail) {
  return new Promise(res => {
    const done = v => { closeSheet(); res(v); };
    openSheet(h('h3', {}, msg), ...detail.map(d => typeof d === 'string' ? h('p', {}, d) : d), h('div', { class: 'row end' },
      h('button', { class: 'ghost', onclick: () => done(false) }, 'Cancel'),
      h('button', { class: 'primary', onclick: () => done(true) }, okLabel)));
  });
}

const FORM = [['artist', 'Artist'], ['title', 'Title'], ['label', 'Label'], ['catno', 'Catalog #'], ['release', 'Release / album'],
  ['releaseDate', 'Release date'], ['genre', 'Genre'], ['style', 'Style / tags'], ['source', 'Source'], ['url', 'URL'], ['video', 'YouTube link'], ['notes', 'Notes']];
function openForm(heading, data, onSave) {
  const inputs = {};
  const type = h('select', {}, h('option', { value: 'track' }, 'Track'), h('option', { value: 'release' }, 'Whole release'));
  type.value = data.type || 'track';
  openSheet(
    h('h3', {}, heading),
    h('div', { class: 'form' },
      h('label', {}, h('span', {}, 'Type'), type),
      ...FORM.map(([k, lab]) => {
        inputs[k] = h(k === 'notes' ? 'textarea' : 'input', { value: data[k] || '' });
        return h('label', {}, h('span', {}, lab), inputs[k]);
      })),
    h('div', { class: 'row end' },
      h('button', { class: 'ghost', onclick: closeSheet }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        const out = { type: type.value };
        for (const k in inputs) out[k] = inputs[k].value;
        await onSave(out);
        closeSheet();
      } }, 'Save')));
  inputs.artist.focus();
}

/* ---------- rendering ---------- */
function renderPlaylists() {
  $('plSelect').replaceChildren(...state.order.map(id => {
    const p = state.playlists[id];
    return h('option', { value: id }, `${p.name} (${p.tracks.length})`);
  }));
  $('plSelect').value = state.activeId;
}

function renderPage() {
  const box = $('pageItems');
  if (!page) return;
  $('pageSource').textContent = page.source ? `· ${page.source}` : '';
  box.replaceChildren(...page.items.map((it, i) => {
    const cb = h('input', { type: 'checkbox', checked: picked.has(i) });
    cb.addEventListener('change', () => { cb.checked ? picked.add(i) : picked.delete(i); updateAddBtn(); });
    return h('label', { class: 'item' }, cb, h('div', { class: 'it-text' },
      h('div', { class: 'it-main', title: line(it) }, line(it),
        it.type === 'release' ? h('span', { class: 'tag' }, 'release') : null,
        it.fromVideo ? h('span', { class: 'tag', title: it.videoTitle || '' }, 'video') : null,
        it.nowPlaying ? h('span', { class: 'tag np' }, '♪ playing') : null,
        (w => w.length ? h('span', { class: 'tag ok', title: 'Already in: ' + w.map(x => x.name).join(', ') }, CD.savedLabel(w)) : null)(CD.findSaved(state, it))),
      h('div', { class: 'it-sub' }, sub(it, false) || (page.generic ? 'Not a supported site — check the details after adding' : 'No extra info on page'))));
  }));
  $('toggleAll').classList.toggle('hidden', page.items.length < 3);
  updateAddBtn();
}
function updateAddBtn() {
  $('addSelected').disabled = !picked.size;
  $('addSelected').textContent = picked.size > 1 ? `Add ${picked.size} selected` : 'Add selected';
  if (page) $('toggleAll').textContent = picked.size === page.items.length ? 'Select none' : 'Select all';
}

const iconBtn = (sym, title, fn) => h('button', { title, onclick: fn }, sym);
function renderYtToggle() {
  const music = state.settings.ytTarget === 'music';
  document.querySelectorAll('#ytToggle button').forEach(b => {
    const on = (b.dataset.yt === 'music') === music;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
}
function renderTracks() {
  const pl = active();
  const f = $('filter').value.trim().toLowerCase();
  $('plTitle').textContent = `${pl.name} · ${pl.tracks.length}`;
  const list = [...pl.tracks].reverse().filter(t => !f || Object.values(t).join(' ').toLowerCase().includes(f));
  if (!list.length) {
    $('tracks').replaceChildren(h('div', { class: 'muted empty' },
      pl.tracks.length ? 'No matches.' : 'Nothing saved yet — find something good and hit Add.'));
    return;
  }
  const hasToken = !!state.settings.discogsToken;
  $('tracks').replaceChildren(...list.map(t => h('div', { class: 'track' },
    h('div', { class: 'tk-text' },
      h('div', { class: 'tk-main', title: line(t) }, line(t), t.type === 'release' ? h('span', { class: 'tag' }, 'release') : null, dlBadge(t)),
      h('div', { class: 'tk-sub', title: sub(t, true) },
        h('span', { class: 'src src-' + (t.source || 'manual').toLowerCase().replace(/[^a-z]/g, '') }, t.source || 'Manual'),
        ' ', sub(t, true))),
    h('div', { class: 'tk-act' },
      h('button', { class: 'dlb', title: t.dl?.state === 'done' ? 'Already downloaded. Click to download again' : 'Download with Sockseek',
        onclick: () => startDownloads([t], { force: true }) }, '⬇'),
      (() => { const music = state.settings.ytTarget === 'music', where = music ? 'YouTube Music' : 'YouTube';
        return h('button', { class: music ? 'yt ytm' : 'yt', title: (t.video || /youtube\.com\/watch/.test(t.url) ? 'Play on ' : 'Search on ') + where,
          onclick: () => chrome.tabs.create({ url: CD.youtubeLink(t, state.settings.ytTarget) }) }, music ? '♫' : '▶'); })(),
      h('button', { class: 'sc', title: 'Search on SoundCloud',
        onclick: () => chrome.tabs.create({ url: CD.soundcloudLink(t) }) }, '☁'),
      t.url ? iconBtn('↗', 'Open where you found it', () => chrome.tabs.create({ url: t.url })) : null,
      iconBtn('⧉', 'Copy Soulseek search', async () => { await navigator.clipboard.writeText(CD.searchQuery(t)); snack('Copied: ' + CD.searchQuery(t)); }),
      iconBtn('⌕', 'Search on Discogs', () => chrome.tabs.create({ url: 'https://www.discogs.com/search/?type=all&q=' + encodeURIComponent(CD.searchQuery(t)) })),
      hasToken ? iconBtn('✦', 'Fill missing info from Discogs', () => enrich([t.id])) : null,
      iconBtn('✎', 'Edit', () => openForm('Edit', t, patch => CD.updateTrack(pl.id, t.id, patch))),
      iconBtn('✕', 'Remove', () => CD.removeTrack(pl.id, t.id))))));
}

async function refresh() {
  state = await CD.load();
  SS.setBase(state.settings.ssUrl);
  renderPlaylists();
  renderYtToggle();
  renderTracks();
  if (page) renderPage();
  if (curTab === 'dl') renderDownloads();
}

/* ---------- reading the current tab ---------- */
async function readPage() {
  const box = $('pageItems');
  const seq = readSeq;
  const none = msg => { if (seq !== readSeq) return; page = null; $('pageSource').textContent = ''; box.replaceChildren(h('div', { class: 'muted' }, msg)); $('addSelected').disabled = true; };
  if (!tab || !/^https?:/.test(tab.url || '')) return none('Open a Bandcamp, SoundCloud, YouTube or Discogs page to grab tracks.');
  if (!(await CD.ensureContent(tab.id))) return none("Can't read this page. You can still add a track manually.");
  let r = null;
  try { r = await chrome.tabs.sendMessage(tab.id, { type: 'cd-extract' }); } catch (e) {}
  if (!r || r.error || !r.items?.length) return none('Nothing found on this page.');
  if (seq !== readSeq) return; // you've moved on to another page since this read started
  page = r;
  picked = new Set(r.defaults || [0]);
  renderPage();
}

/* ---------- actions ---------- */
async function enrich(ids) {
  if (!state.settings.discogsToken) return snack('Add a Discogs token in Settings first', true);
  const r = await chrome.runtime.sendMessage({ type: 'cd-enrich', playlistId: state.activeId, trackIds: ids });
  snack(`Looking up on Discogs… ${r?.queued ?? ids.length} to go`, false, true);
}
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
function exportCsv(all) {
  const pls = all ? state.order.map(id => state.playlists[id]) : [active()];
  const rows = pls.flatMap(p => p.tracks.map(t => ({ ...t, _playlist: p.name })));
  if (!rows.length) return snack('Nothing to export yet', true);
  download(`${all ? 'crate-digger-all' : slug(active().name)}-${today()}.csv`, CD.toCSV(rows, all), 'text/csv;charset=utf-8');
  snack(`Exported ${rows.length} rows`);
}
function searchesText() { return active().tracks.map(CD.searchQuery).filter(Boolean).join('\n'); }

function openSettings() {
  const tok = h('input', { type: 'password', value: state.settings.discogsToken, placeholder: 'Paste personal access token' });
  const show = h('input', { type: 'checkbox', checked: state.settings.showButton });
  const viewer = h('input', { type: 'checkbox', checked: state.settings.showViewer });
  const openIn = h('select', {}, h('option', { value: 'panel' }, 'Side panel (stays open)'), h('option', { value: 'popup' }, 'Popup'));
  openIn.value = state.settings.openIn || 'panel';
  const missing = active().tracks.filter(t => !t.genre || !t.label || !t.releaseDate);
  openSheet(
    h('h3', {}, 'Settings ', h('span', { class: 'muted', style: 'font-weight:400;font-size:12px' }, `· v${chrome.runtime.getManifest().version}`)),
    h('div', { class: 'row' }, h('button', { onclick: checkForUpdates }, '⟳ Check for updates')),
    h('div', { class: 'form' },
      h('label', { class: 'check' }, show, h('span', {}, 'Show the floating save button on supported sites')),
      h('label', { class: 'check' }, viewer, h('span', {}, 'Show the YouTube track viewer on Discogs releases')),
      h('label', {}, h('span', {}, 'Toolbar icon opens'), openIn),
      h('label', {}, h('span', {}, 'Discogs token'), tok)),
    ...downloadSettingsFields(),
    h('p', {}, 'Optional. Lets Crate Digger fill in label, cat #, year, genre and style for YouTube/SoundCloud finds by searching Discogs (best guess — a link to the match is added to Notes so you can check it). Get a free token at ',
      h('a', { href: '#', style: 'color:var(--accent)', onclick: e => { e.preventDefault(); chrome.tabs.create({ url: 'https://www.discogs.com/settings/developers' }); } }, 'discogs.com/settings/developers'),
      ' → Generate new token.'),
    h('div', { class: 'row end' },
      h('button', { class: 'ghost', onclick: closeSheet }, 'Close'),
      h('button', { class: 'primary', onclick: async () => {
        await CD.saveSettings({ discogsToken: tok.value.trim(), showButton: show.checked, showViewer: viewer.checked, openIn: openIn.value,
          ...readDownloadSettingsFields() });
        closeSheet(); snack('Settings saved'); checkConnection();
      } }, 'Save')),
    h('div', { class: 'stack' },
      h('button', { onclick: () => { closeSheet(); openTidy(); } }, '✎ Tidy up titles in this playlist…'),
      h('button', { disabled: !state.settings.discogsToken || !missing.length, onclick: () => { closeSheet(); enrich(missing.map(t => t.id)); } },
        `Fill missing info from Discogs (${missing.length} in this playlist)`),
      h('button', { class: 'primary', onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL('import.html') }) },
        'Import playlists (CSV or backup)…'),
      h('button', { onclick: () => exportCsv(true) }, 'Export all playlists (one CSV)'),
      h('button', { onclick: async () => download(`crate-digger-backup-${today()}.json`, await CD.backupJSON(), 'application/json') },
        'Back up everything (.json)'),
      h('button', { onclick: () => {
        const t = searchesText();
        if (!t) return snack('Nothing to export yet', true);
        download(`${slug(active().name)}-soulseek-searches-${today()}.txt`, t, 'text/plain;charset=utf-8');
      } }, 'Export Soulseek search list (.txt)')));
}

/* ---------- tidy titles (preview, then apply) ---------- */
function openTidy() {
  const pl = active();
  const rows = pl.tracks.map(t => ({ t, r: CD.tidy(t) })).filter(x => x.r.changes.length);
  if (!rows.length) return snack(`✓ Titles in “${pl.name}” are already tidy`);
  const boxes = [];
  const fmt = (o, keys) => keys.map(k => o[k]).filter(Boolean).join(' · ');
  openSheet(
    h('h3', {}, `✎ Tidy ${rows.length} title${rows.length === 1 ? '' : 's'} in “${pl.name}”`),
    h('p', {}, 'Cat numbers, label names in [brackets], years and junk like [FREE] or (PREVIEW) move out of the title into their own fields, so Soulseek searches only use the artist and track name. Mix names stay. Untick anything you want left as it is.'),
    h('div', { class: 'tidy-list' }, ...rows.map(({ t, r }) => {
      const cb = h('input', { type: 'checkbox', checked: true }); boxes.push([cb, t.id]);
      const moved = ['label', 'catno', 'releaseDate'].filter(k => (r.item[k] || '') !== (t[k] || '')).map(k => `${{ label: 'Label', catno: 'Cat #', releaseDate: 'Year' }[k]}: ${r.item[k]}`);
      return h('label', { class: 'tidy-row' }, cb, h('div', {},
        h('div', { class: 'tidy-old' }, '✕ ', line(t)),
        h('div', { class: 'tidy-new' }, '✓ ', line(r.item)),
        moved.length ? h('div', { class: 'tidy-moved' }, '➜ ', moved.join('  ·  ')) : null));
    })),
    h('div', { class: 'row end' },
      h('button', { class: 'ghost', onclick: closeSheet }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        const ids = boxes.filter(([cb]) => cb.checked).map(([, id]) => id);
        const n = await CD.tidyTracks(pl.id, ids); closeSheet(); snack(`✓ Tidied ${n} title${n === 1 ? '' : 's'}`);
      } }, 'Tidy selected')));
}

/* ---------- wiring ---------- */
$('plSelect').addEventListener('change', e => CD.setActive(e.target.value));
$('plNew').addEventListener('click', async () => { const n = await ask('New playlist'); if (n) await CD.createPlaylist(n); });
$('plRename').addEventListener('click', async () => { const n = await ask('Rename playlist', active().name); if (n) await CD.renamePlaylist(state.activeId, n); });
$('plDelete').addEventListener('click', async () => {
  const p = active();
  if (await confirmSheet(`Delete “${p.name}” and its ${p.tracks.length} tracks?`)) await CD.deletePlaylist(p.id);
});
$('filter').addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderTracks, 120); });
$('toggleAll').addEventListener('click', () => {
  picked = picked.size === page.items.length ? new Set() : new Set(page.items.map((_, i) => i));
  renderPage();
});
$('addSelected').addEventListener('click', async () => {
  const items = [...picked].sort((a, b) => a - b).map(i => page.items[i]);
  if (!items.length) return;
  const r = await CD.addItems(items, state.activeId, { tidyUp: true });
  snack(r.added ? `Added ${r.added} to “${r.playlist}”${r.skipped ? ` (${r.skipped} already there)` : ''}` : 'Already in this playlist', !r.added);
});
$('addManual').addEventListener('click', () => {
  const pre = page && page.items[[...picked][0] ?? 0] || { url: tab?.url || '', source: 'Manual' };
  openForm('Add track', { ...pre, source: pre.source || 'Manual' }, async d => {
    const r = await CD.addItems([d], state.activeId);
    snack(r.added ? 'Added' : 'Already in this playlist', !r.added);
  });
});
$('exportCsv').addEventListener('click', () => exportCsv(false));
$('copyQueries').addEventListener('click', async () => {
  const t = searchesText();
  if (!t) return snack('Nothing to copy yet', true);
  await navigator.clipboard.writeText(t);
  snack(`Copied ${t.split('\n').length} searches`);
});
$('settingsBtn').addEventListener('click', openSettings);
$('tidyBtn').addEventListener('click', openTidy);
document.querySelectorAll('#ytToggle button').forEach(b => b.addEventListener('click', () => CD.saveSettings({ ytTarget: b.dataset.yt })));

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.cd_state) refresh();
  const e = ch.cd_enrich?.newValue;
  if (e) {
    if (e.left > 0) snack(`Looking up on Discogs… ${e.left} to go`, false, true);
    else if (e.error) snack('Discogs: ' + e.error, true);
    else snack('Discogs lookup done');
  }
});

/* =====================================================================
   Download tab — drives `sockseek daemon` on this Mac
   ===================================================================== */
let dl = { jobs: {}, order: [] }, ssOnline = null, ssVersion = '', ssStarted = '', pollTimer = null, connTimer = null, curTab = 'dig';

function dlBadge(t) {
  const d = t.dl;
  if (!d) return null;
  if (d.state === 'done') return h('span', { class: 'tag ok', title: d.path ? `Saved to ${d.path}` : 'Downloaded' }, '✓ downloaded');
  if (d.state === 'queued' || d.state === 'running') return h('span', { class: 'tag busy', title: 'Downloading with Sockseek' }, '⬇ downloading');
  if (d.state === 'failed') return h('span', { class: 'tag bad', title: d.reason || 'Download failed' }, '✕ not found');
  return null;
}

/* ---- settings fields (shown in the main ⚙ sheet and the Download tab's ⚙) ---- */
let dsf = null;
function downloadSettingsFields() {
  dsf = {
    base: h('input', { value: state.settings.dlBase, placeholder: '/Volumes/Seagate/USB Music' }),
    dated: h('input', { type: 'checkbox', checked: state.settings.dlDateFolders !== false }),
    plf: h('input', { type: 'checkbox', checked: state.settings.dlPlaylistFolders !== false }),
    url: h('input', { value: state.settings.ssUrl, placeholder: 'http://127.0.0.1:5030' }),
    check: h('select', {}, h('option', { value: 'messy' }, 'Only when a name looks messy'), h('option', { value: 'always' }, 'Every time'), h('option', { value: 'never' }, 'Never')),
    review: h('input', { type: 'checkbox', checked: state.settings.checkPlaylist !== false })
  };
  dsf.check.value = state.settings.checkSingle || 'messy';
  return [
    h('h3', { style: 'margin-top:16px' }, 'Downloads (Sockseek)'),
    h('div', { class: 'form' },
      h('label', {}, h('span', {}, 'Download folder'), dsf.base),
      h('label', { class: 'check' }, dsf.dated, h('span', {}, 'Put each day’s downloads in a dated folder (e.g. 2026-11-03)')),
      h('label', { class: 'check' }, dsf.plf, h('span', {}, 'Put each playlist in its own folder (inside the day’s folder)')),
      h('label', {}, h('span', {}, 'Sockseek address'), dsf.url),
      h('label', {}, h('span', {}, 'Check names before downloading a track'), dsf.check),
      h('label', { class: 'check' }, dsf.review, h('span', {}, 'Open the review page (spreadsheet) when downloading a whole playlist'))),
    h('p', {}, 'Tip: to get the exact folder path, drag the folder from Finder into this box (or right-click it in Finder, hold ⌥ Option, then "Copy … as Pathname").')
  ];
}
function readDownloadSettingsFields() {
  if (!dsf) return {};
  return { dlBase: dsf.base.value.trim().replace(/\/+$/, ''), dlDateFolders: dsf.dated.checked, dlPlaylistFolders: dsf.plf.checked, ssUrl: dsf.url.value.trim() || 'http://127.0.0.1:5030',
    checkSingle: dsf.check.value, checkPlaylist: dsf.review.checked };
}
function openDownloadSettings() {
  openSheet(...downloadSettingsFields(),
    h('div', { class: 'row end' },
      h('button', { class: 'ghost', onclick: closeSheet }, 'Close'),
      h('button', { class: 'primary', onclick: async () => { await CD.saveSettings(readDownloadSettingsFields()); closeSheet(); snack('Saved'); checkConnection(); } }, 'Save')));
  // dragging a folder from Finder drops a file:// path
  dsf.base.addEventListener('drop', e => {
    const u = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (u && u.startsWith('file://')) { e.preventDefault(); dsf.base.value = decodeURIComponent(u.replace(/^file:\/\//, '').split('\n')[0]).replace(/\/+$/, ''); }
  });
}

/* ---- connection ---- */
async function checkConnection() {
  SS.setBase(state.settings.ssUrl);
  const was = ssOnline;
  try { const i = await SS.info(); ssOnline = true; ssVersion = String(i?.version || '').replace(/\.0$/, ''); ssStarted = i?.startedAtUtc || ''; }
  catch (e) { ssOnline = false; }
  if (was !== ssOnline) renderDownloads(); else renderStatus();
  if (ssOnline && !pollTimer && !polling && hasLive()) pollNow();
}
function renderStatus() {
  const box = $('ssStatus');
  if (ssOnline === null) return box.replaceChildren(h('div', { class: 'muted' }, 'Checking for Sockseek…'));
  if (ssOnline) {
    box.className = 'ss-status on';
    return box.replaceChildren(h('span', { class: 'ss-icon' }, '✓'), h('span', {}, h('b', {}, 'Connected'), ` · Sockseek${ssVersion ? ` v${ssVersion}` : ''} is running`));
  }
  box.className = 'ss-status off';
  box.replaceChildren(
    h('div', { class: 'ss-off-head' }, h('span', { class: 'ss-icon' }, '✕'), h('strong', {}, 'Not connected: Sockseek isn’t running')),
    h('div', { class: 'muted' }, state.settings.ssHint || ['Double-click ', h('b', {}, 'Start Sockseek'), ' in your Sockseek folder (Seagate → Programs → Crate Digger → Sockseek) and keep that window open while you download.']),
    h('div', { class: 'row' }, h('button', { onclick: checkConnection }, 'Check again')));
}

/* ---- sending tracks ---- */
const trackJobs = trackId => dl.order.map(id => dl.jobs[id]).filter(r => r && r.trackId === trackId);
const activeJobFor = trackId => trackJobs(trackId).find(r => !SS.isDone(r.s) && !r.lost);

async function startDownloads(tracks, opts = {}) {
  const { force = false, quality, checked = false } = opts;
  const st = state.settings;
  if (!st.dlBase) { openDownloadSettings(); return snack('Choose a download folder first', true); }
  // one track: check its name first (by default only when it looks messy)
  if (tracks.length === 1 && !checked) {
    const mode = st.checkSingle || 'messy';
    if (mode === 'always' || (mode === 'messy' && SS.needsCheck(tracks[0]).length)) return openCheck(tracks[0], opts);
  }
  await checkConnection();
  if (!ssOnline) { switchTab('dl'); return snack('✕ Start Sockseek first', true); }
  const r = await SS.sendTracks(tracks, opts.plId || active().id, st, { quality: quality || st.dlQuality, force });
  dl = await SS.loadJobs();
  if (r.sent) { switchTab('dl'); pollNow(); }
  snack(r.sent ? `✓ Sent ${r.sent} to Sockseek${r.skipped ? ` (${r.skipped} skipped: already downloaded or in progress)` : ''}` + (r.failed ? `, ${r.failed} failed: ${r.lastErr}` : '')
    : r.failed ? `Couldn’t send: ${r.lastErr}` : 'Nothing new to download, everything here is already downloaded or in progress', !r.sent);
}

/* ---- check a track's name before downloading it ---- */
function openCheck(t, opts = {}) {
  const pl = active();
  const rel = SS.isRelease(t);
  const tidied = CD.tidy(t).item;
  const why = SS.needsCheck(t);
  const fA = h('input', { value: tidied.artist || '', placeholder: 'Artist' });
  const fT = h('input', { value: (rel ? tidied.release : tidied.title) || '', placeholder: rel ? 'Release name' : 'Track title (keep the mix name)' });
  const preview = h('code', { class: 'search-preview' });
  const save = h('input', { type: 'checkbox', checked: true });
  const never = h('input', { type: 'checkbox' });
  const current = () => ({ ...t, ...tidied, artist: fA.value.trim(), [rel ? 'release' : 'title']: fT.value.trim() });
  const upd = () => { preview.textContent = CD.searchQuery(current()) || '(nothing to search for)'; };
  fA.addEventListener('input', upd); fT.addEventListener('input', upd);
  const go = async () => {
    const item = current();
    if (!(item.artist || item.title || item.release)) return snack('Type an artist or title first', true);
    if (never.checked) await CD.saveSettings({ checkSingle: 'never' });
    if (save.checked) await CD.updateTrack(pl.id, t.id, { artist: item.artist, title: item.title, release: item.release, label: item.label, catno: item.catno, releaseDate: item.releaseDate });
    closeSheet();
    await startDownloads([item], { ...opts, checked: true });
    if (never.checked) snack('✓ Won’t ask again. Turn it back on in the Download tab’s ⚙');
  };
  [fA, fT].forEach(f => f.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }));
  const changed = (tidied.artist || '') !== (t.artist || '') || (tidied.title || '') !== (t.title || '');
  openSheet(
    h('h3', {}, '⬇ Check before downloading'),
    why.length ? h('div', { class: 'why' }, ...why.map(w => h('div', {}, '⚠ ', w))) : null,
    changed ? h('p', { class: 'was' }, 'ⓘ Tidied from: ', h('s', {}, line(t))) : null,
    h('div', { class: 'form' },
      h('label', {}, h('span', {}, 'Artist'), fA),
      h('label', {}, h('span', {}, rel ? 'Release' : 'Title'), fT)),
    h('div', { class: 'preview-line' }, h('span', { class: 'lbl' }, 'Soulseek will search'), preview),
    h('label', { class: 'check-inline' }, save, ' Save these names to my playlist'),
    h('label', { class: 'check-inline' }, never, ' Don’t show this again'),
    h('div', { class: 'row end' },
      h('button', { class: 'ghost', onclick: closeSheet }, 'Cancel'),
      h('button', { class: 'primary', onclick: go }, '⬇ Download')));
  upd(); fT.focus(); fT.select();
}

async function downloadPlaylist() {
  const pl = active();
  const todo = pl.tracks.filter(t => t.dl?.state !== 'done' && !activeJobFor(t.id));
  if (!todo.length) return snack(pl.tracks.length ? 'Everything in this playlist is downloaded or in progress' : 'This playlist is empty', true);
  if (state.settings.checkPlaylist !== false) {
    // review page: a spreadsheet of every track, so names can be checked before anything is searched
    return chrome.tabs.create({ url: chrome.runtime.getURL(`review.html?pl=${encodeURIComponent(pl.id)}`) });
  }
  const done = pl.tracks.filter(t => t.dl?.state === 'done').length;
  const q = SS.QUALITY[$('dlQuality').value] || SS.QUALITY.lossless;
  const ok = await confirmSheet(`Download ${todo.length} track${todo.length === 1 ? '' : 's'} from “${pl.name}”?`, 'Download',
    h('div', { class: 'confirm-facts' },
      h('div', {}, h('span', { class: 'lbl' }, 'Into'), h('code', {}, SS.folderFor(state.settings, pl.name))),
      h('div', {}, h('span', { class: 'lbl' }, 'Quality'), q.label),
      done ? h('div', {}, h('span', { class: 'lbl' }, 'Skipping'), `${done} already downloaded`) : null),
    'Sockseek works through them on its own and pauses now and then for Soulseek’s search limit, which is normal. You can close this panel; progress shows again when you reopen it.');
  if (ok) await startDownloads(todo, { checked: true });
}

/* ---- polling ---- */
const hasLive = () => dl.order.some(id => { const r = dl.jobs[id]; return r && !SS.isDone(r.s) && !r.lost && r.kind !== 'search'; });
let polling = false, pollAgain = false;
async function pollNow() {
  if (polling) { pollAgain = true; return; }
  polling = true;
  try { await pollOnce(); } finally { polling = false; }
  if (pollAgain) { pollAgain = false; pollNow(); }
}
async function pollOnce() {
  clearTimeout(pollTimer); pollTimer = null;
  dl = await SS.loadJobs();
  const live = dl.order.map(id => dl.jobs[id]).filter(r => r && !SS.isDone(r.s) && !r.lost && r.kind !== 'search');
  let offline = false;
  for (const r of live) {
    try {
      const s = SS.snap(await SS.getJob(r.id));
      await SS.updateJob(r.id, { s, misses: 0, firstMiss: 0 });
      if (SS.isDone(s)) await syncTrack({ ...r, s });
      else if (s.life === 'Running') await markTrack(r, { state: 'running' });
    } catch (e) {
      if (e.notFound) {
        // Only give up on a job if Sockseek really restarted (its start time changed), or it's been missing for over a minute.
        const misses = (r.misses || 0) + 1;
        const restarted = ssStarted && r.ss && r.ss !== ssStarted;
        if (restarted || (misses >= 5 && Date.now() - (r.firstMiss || Date.now()) > 60000)) {
          await SS.updateJob(r.id, { lost: true }); await markTrack(r, { state: 'failed', reason: 'Sockseek was restarted' });
        } else await SS.updateJob(r.id, { misses, firstMiss: r.firstMiss || Date.now() });
      }
      else if (e.offline) { offline = true; break; }
    }
  }
  if (offline && ssOnline) { ssOnline = false; renderStatus(); }
  dl = await SS.loadJobs();
  renderDownloads();
  if (hasLive() && !offline) pollTimer = setTimeout(pollNow, 1500);
}
async function markTrack(r, patch) {
  const t = state.playlists[r.plId]?.tracks.find(x => x.id === r.trackId);
  if (!t || t.dl?.jobId !== r.id || t.dl?.state === patch.state) return;
  await CD.setDownload(r.plId, r.trackId, patch);
}
async function syncTrack(r) {
  const s = r.s;
  const t = state.playlists[r.plId]?.tracks.find(x => x.id === r.trackId);
  if (!t || (t.dl?.jobId && t.dl.jobId !== r.id && t.dl.state === 'done')) return;
  if (s.outcome === 'Succeeded' || (s.outcome === 'Skipped' && s.skip === 'AlreadyExists') || s.outcome === 'PartialSuccess')
    await CD.setDownload(r.plId, r.trackId, { state: 'done', jobId: r.id, path: s.path || r.folder, ext: s.ext, size: s.size, at: Date.now(), reason: '' });
  else if (s.outcome !== 'Cancelled')
    await CD.setDownload(r.plId, r.trackId, { state: 'failed', jobId: r.id, reason: SS.describe(r).text });
  else await CD.setDownload(r.plId, r.trackId, null);
}

/* ---- rendering ---- */
function renderDownloads() {
  renderStatus();
  const st = state.settings;
  $('dlFolder').textContent = SS.folderFor(st, active().name) || 'Not set, click ⚙';
  const qs = $('dlQuality');
  if (!qs.options.length) qs.replaceChildren(...Object.entries(SS.QUALITY).map(([k, v]) => h('option', { value: k }, v.label)));
  if (document.activeElement !== qs) qs.value = st.dlQuality || 'lossless';

  const pl = active();
  const todo = pl.tracks.filter(t => t.dl?.state !== 'done' && !activeJobFor(t.id)).length;
  $('dlPlaylist').textContent = todo ? `Download “${pl.name}” (${todo})` : '✓ Playlist all downloaded';
  $('dlPlaylist').disabled = !todo;

  // One row per track: its latest attempt. Older attempts (e.g. the "not found" before you picked a file) are hidden.
  const all = dl.order.map(id => dl.jobs[id]).filter(r => r && r.kind !== 'search');
  const byTrack = new Map();
  for (const r of all) {
    const k = r.trackId ? `${r.plId}|${r.trackId}` : r.id;
    if (!byTrack.has(k)) byTrack.set(k, []);
    byTrack.get(k).push(r);
  }
  const now = Date.now();
  const groups = { attn: [], prog: [], done: [] };
  for (const list of byTrack.values()) {
    list.sort((a, b) => b.created - a.created);
    const r = list[0], d = SS.describe(r, now);
    const live = !SS.isDone(r.s) && !r.lost;
    const earlier = list.slice(1).find(x => SS.isDone(x.s) && x.s.outcome === 'Succeeded');
    const item = { r, d, live, earlier, all: list };
    if (live) groups.prog.push(item);
    else if (d.cls === 'ok') groups.done.push(item);
    else groups.attn.push(item);
  }
  const n = { attn: groups.attn.length, prog: groups.prog.length, done: groups.done.length };
  $('dlCount').textContent = [n.prog || '', n.attn ? `⚠${n.attn}` : ''].filter(Boolean).join(' ');
  $('dlCount').classList.toggle('hidden', !n.prog && !n.attn);
  $('dlCount').title = `${n.prog} in progress, ${n.attn} need attention`;
  $('dlHead').textContent = byTrack.size
    ? [n.attn && `⚠ ${n.attn} need${n.attn === 1 ? 's' : ''} attention`, n.prog && `⬇ ${n.prog} in progress`, n.done && `✓ ${n.done} completed`].filter(Boolean).join('  ·  ')
    : 'Downloads';

  if (!byTrack.size) {
    $('dlList').replaceChildren(h('div', { class: 'muted empty' }, 'Nothing yet. Hit ⬇ on any track in the Dig tab, or download the whole playlist above.'));
    return;
  }
  let doneOpen = true;
  try { doneOpen = sessionStorage.getItem('cd_done_closed') !== '1'; } catch (e) {}
  const section = (key, icon, title, hint, items, collapsible) => {
    if (!items.length) return [];
    const open = !collapsible || doneOpen;
    const head = h('div', { class: `dl-sec sec-${key}`, title: hint },
      h('span', { class: 'sec-icon' }, icon), h('span', { class: 'sec-title' }, title), h('span', { class: 'sec-count' }, items.length),
      collapsible ? h('button', { class: 'link sec-toggle', onclick: () => { try { sessionStorage.setItem('cd_done_closed', open ? '1' : '0'); } catch (e) {} renderDownloads(); } }, open ? 'Hide' : 'Show') : null);
    return [head, ...(open ? items.map(rowFor) : [])];
  };
  $('dlList').replaceChildren(
    ...section('attn', '⚠', 'Needs attention', 'Not found, failed or cancelled: choose a file, retry, or dismiss', groups.attn),
    ...section('prog', '⬇', 'In progress', 'Searching, downloading or waiting', groups.prog),
    ...section('done', '✓', 'Completed', 'Saved to your download folder', groups.done, true));
}

function rowFor({ r, d, live, earlier, all }) {
  const t = state.playlists[r.plId]?.tracks.find(x => x.id === r.trackId);
  const title = t ? line(t) : r.label;
  const acts = [];
  if (live && r.s.phase === 'Downloading') acts.push(h('button', { title: 'Stop this download and try the next-best file', onclick: () => act(() => SS.nextCandidate(r.id), 'Trying the next file…') }, 'Try another file'));
  if (live) acts.push(h('button', { title: 'Cancel', onclick: () => act(() => SS.cancel(r.id), 'Cancelled') }, 'Cancel'));
  if (!live && t && (d.canPick || r.lost || d.cls !== 'ok')) acts.push(h('button', { class: 'act-main', onclick: () => pickFile(t, r.plId) }, '⌕ Choose a file myself…'));
  if (!live && t && d.cls !== 'ok') acts.push(h('button', { onclick: () => startDownloads([t], { force: true }) }, '↻ Retry'));
  if (!live && t && d.canPick && r.quality === 'lossless') acts.push(h('button', { title: 'Try again allowing MP3 320', onclick: () => startDownloads([t], { force: true, quality: 'lossless320' }) }, '↻ Retry, allow MP3 320'));
  if (!live && t && d.cls === 'ok') acts.push(h('button', { onclick: () => pickFile(t, r.plId) }, '⌕ Get a different version…'));
  const path = SS.isDone(r.s) && r.s.path ? r.s.path : '';
  if (path) acts.push(h('button', { title: path, onclick: async () => { await navigator.clipboard.writeText(path); snack('✓ Copied the file location'); } }, '📁 Copy location'));
  if (!live) acts.push(h('button', { class: 'x', title: d.cls === 'ok' ? 'Remove from this list (the file stays on your drive)' : 'Dismiss', onclick: async () => {
    const ids = new Set(all.map(x => x.id));
    await SS.removeJobs(x => ids.has(x.id)); dl = await SS.loadJobs(); renderDownloads();
  } }, '✕'));
  const detail = d.text.replace(new RegExp('^' + d.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[·:]?\\s*', 'i'), '');
  return h('div', { class: `dl-row ${d.cls}` },
    h('div', { class: 'dl-main' },
      h('div', { class: 'dl-title', title }, title),
      h('div', { class: 'dl-state' }, h('span', { class: `st st-${d.cls}` }, h('i', {}, d.icon), d.word), detail ? ' ' + detail : ''),
      r.pick ? h('div', { class: 'dl-note' }, 'ⓘ Your pick: ' + r.pick) : null,
      d.pct != null ? h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, d.pct)}%` })) : null,
      path ? h('div', { class: 'dl-path', title: path }, '📁 ' + path.split('/').filter(Boolean).slice(-2).join(' / ')) : null,
      !live && d.cls !== 'ok' && earlier?.s?.path ? h('div', { class: 'dl-note' }, 'ⓘ Your earlier download is still saved: ' + earlier.s.path.split('/').pop()) : null),
    acts.length ? h('div', { class: 'dl-acts' }, ...acts) : null);
}

async function act(fn, msg) {
  try { await fn(); snack(msg); } catch (e) { snack(e.message, true); }
  pollNow();
}
// tick once a second so the search-limit countdown moves
setInterval(() => {
  if (curTab === 'dl' && dl.order.some(id => dl.jobs[id]?.s?.phase === 'SearchRateLimited' && !SS.isDone(dl.jobs[id].s))) renderDownloads();
}, 1000);

/* ---- choose a file yourself ---- */
async function pickFile(t, plId) {
  await checkConnection();
  if (!ssOnline) return snack('Start Sockseek first', true);
  let quality = state.settings.dlQuality === 'any' ? 'any' : 'lossless', jobId = null, stop = false, timer = null;
  const wantLen = CD.lengthSecs(t.length) || 0;
  const list = h('div', { class: 'cands' }, h('div', { class: 'muted' }, 'Searching Soulseek… (this can take up to half a minute)'));
  const head = h('div', { class: 'muted' });
  const showAll = h('input', { type: 'checkbox', checked: quality === 'any' });
  const close = () => { stop = true; clearTimeout(timer); closeSheet(); };

  async function run() {
    clearTimeout(timer);
    list.replaceChildren(h('div', { class: 'muted' }, 'Searching Soulseek… (this can take up to half a minute)'));
    try { jobId = (await SS.search(t, state.settings, quality, state.playlists[plId]?.name)).jobId; }
    catch (e) { list.replaceChildren(h('div', { class: 'muted' }, 'Search failed: ' + e.message)); return; }
    poll();
  }
  async function poll() {
    if (stop) return;
    let r;
    try { r = await SS.results(jobId); } catch (e) { r = null; }
    const items = (r?.items || []).map(c => ({ c, q: SS.rate(c, wantLen) })).sort((a, b) => b.q.score - a.q.score);
    head.textContent = r?.isComplete ? `${items.length} file${items.length === 1 ? '' : 's'} found` : `Searching… ${items.length} so far`;
    if (items.length) list.replaceChildren(...items.slice(0, 60).map(({ c, q }) => cand(c, q)));
    else if (r?.isComplete) list.replaceChildren(h('div', { class: 'muted' }, quality === 'any' ? 'Nothing found on Soulseek.' : 'No lossless files found. Tick “Show MP3s and other formats” to see everything.'));
    if (!r?.isComplete) timer = setTimeout(poll, 1500);
  }
  function cand(c, q) {
    const parts = c.filename.split(/[\\/]/);
    const name = parts.pop(), folder = parts.slice(-2).join(' / ');
    const facts = [q.ext.toUpperCase(), SS.mb(c.size), q.len ? CD.fmtLength(q.len) : '', c.bitRate && !q.lossless ? `${c.bitRate} kbps` : '',
      c.sampleRate ? `${(c.sampleRate / 1000).toFixed(1).replace('.0', '')} kHz` : ''].filter(Boolean).join(' · ');
    const btn = h('button', { class: 'primary', onclick: async () => {
      btn.disabled = true;
      try {
        const { summary, folder: dest } = await SS.downloadFile(jobId, c.ref, state.settings, quality, state.playlists[plId]?.name);
        await SS.addJob({ id: summary.jobId, plId, trackId: t.id, label: line(t), pick: name, kind: 'song', quality, folder: dest, picked: true, ss: ssStarted,
          created: Date.now(), s: { life: summary.lifecycleState } });
        await CD.setDownload(plId, t.id, { state: 'queued', jobId: summary.jobId, reason: '' });
        close(); switchTab('dl'); pollNow(); snack('Downloading your pick');
      } catch (e) { btn.disabled = false; snack(e.message, true); }
    } }, 'Download');
    return h('div', { class: 'cand' + (q.lossless ? ' ll' : '') },
      h('div', { class: 'cand-main' },
        h('div', { class: 'cand-name', title: c.filename }, q.lossless ? h('span', { class: 'll-badge', title: 'Lossless' }, '◆ LOSSLESS') : h('span', { class: 'lossy-badge', title: 'Compressed (not lossless)' }, '◇ ' + (q.ext || 'lossy').toUpperCase()), ' ', name),
        h('div', { class: 'cand-sub', title: c.filename }, folder),
        h('div', { class: 'cand-facts' }, h('b', {}, facts), ` · ${c.username}${c.peer?.hasFreeUploadSlot ? ' · free slot' : ''}`),
        q.notes.length ? h('div', { class: 'cand-notes' }, ...q.notes.map(n => h('span', { class: n.bad ? 'bad' : n.good ? 'good' : '' }, (n.bad ? '⚠ ' : n.good ? '✓ ' : 'ⓘ ') + n.t))) : null),
      btn);
  }
  showAll.addEventListener('change', () => { quality = showAll.checked ? 'any' : 'lossless'; run(); });
  openSheet(
    h('h3', {}, `Choose a file: ${line(t)}`),
    h('p', {}, wantLen ? `Your saved track is ${CD.fmtLength(wantLen)} long. Longer or shorter versions are shown too, in case you want the extended mix or an edit.`
      : 'Best quality first. Check the mix name in the filename before you download.'),
    h('label', { class: 'check-inline' }, showAll, ' Show MP3s and other formats'),
    head, list,
    h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: close }, 'Close')));
  run();
}

/* ---- tabs ---- */
function switchTab(name) {
  curTab = name;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $('tab-dig').classList.toggle('hidden', name !== 'dig');
  $('tab-dl').classList.toggle('hidden', name !== 'dl');
  try { sessionStorage.setItem('cd_tab', name); } catch (e) {}
  if (name === 'dl') { renderDownloads(); checkConnection(); }
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('dlPlaylist').addEventListener('click', downloadPlaylist);
$('dlSettings').addEventListener('click', openDownloadSettings);
$('dlQuality').addEventListener('change', e => CD.saveSettings({ dlQuality: e.target.value }));
$('dlClear').addEventListener('click', async () => {
  // remove every attempt for tracks whose latest attempt completed; keep anything running or needing attention
  const latest = {};
  for (const id of dl.order) { const r = dl.jobs[id]; if (!r) continue; const k = r.trackId ? `${r.plId}|${r.trackId}` : r.id; if (!latest[k] || r.created > latest[k].created) latest[k] = r; }
  const doneKeys = new Set(Object.entries(latest).filter(([, r]) => SS.isDone(r.s) && SS.describe(r).cls === 'ok').map(([k]) => k));
  await SS.removeJobs(r => r.kind === 'search' || doneKeys.has(r.trackId ? `${r.plId}|${r.trackId}` : r.id));
  dl = await SS.loadJobs(); renderDownloads();
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.cd_dl) {
    dl = ch.cd_dl.newValue || { jobs: {}, order: [] };
    if (curTab === 'dl') renderDownloads();
    if (!pollTimer && !polling && hasLive()) pollNow();
  }
  if (area === 'local' && ch.cd_open_tab?.newValue) { switchTab(ch.cd_open_tab.newValue); chrome.storage.local.remove('cd_open_tab'); }
});

/* Same page runs as the small popup or as the docked side panel */
const IS_PANEL = !chrome.extension.getViews({ type: 'popup' }).includes(window);
if (IS_PANEL) document.body.classList.add('panel');
let myWindowId = null, rescanTimer, readSeq = 0;

async function rescan() {
  const seq = ++readSeq;
  const q = myWindowId != null ? { active: true, windowId: myWindowId } : { active: true, currentWindow: true };
  const [t] = await chrome.tabs.query(q);
  if (seq !== readSeq) return; // a newer rescan started
  tab = t;
  await readPage();
}
const rescanSoon = (ms = 500) => { clearTimeout(rescanTimer); rescanTimer = setTimeout(rescan, ms); };
$('rescan').addEventListener('click', () => rescan());

if (IS_PANEL) {
  // Follow whatever you're looking at: tab switches, page loads, and in-site navigation (YouTube/SoundCloud/Discogs)
  chrome.tabs.onActivated.addListener(info => { if (myWindowId == null || info.windowId === myWindowId) rescanSoon(150); });
  chrome.tabs.onUpdated.addListener((id, info, t) => {
    if (!t.active || (myWindowId != null && t.windowId !== myWindowId)) return;
    if (info.status === 'complete') rescanSoon(600);
    else if (info.url && tab && id === tab.id) rescanSoon(1200); // in-page navigation: give the site a moment to render
  });
}

(async () => {
  try { myWindowId = (await chrome.windows.getCurrent()).id; } catch (e) {}
  await refresh();
  dl = await SS.loadJobs();
  let saved = null;
  try { saved = sessionStorage.getItem('cd_tab'); } catch (e) {}
  const ask = (await chrome.storage.local.get('cd_open_tab')).cd_open_tab;
  if (ask) { saved = ask; chrome.storage.local.remove('cd_open_tab'); }
  switchTab(saved === 'dl' ? 'dl' : 'dig');
  checkConnection();
  // keep an eye on the connection while the Download tab is open, or while downloads are going
  connTimer = setInterval(() => {
    const busy = dl.order.some(id => { const r = dl.jobs[id]; return r && !SS.isDone(r.s) && !r.lost; });
    if (curTab === 'dl' || busy) checkConnection();
  }, 5000);
  showWhatsNew();
  await rescan();
})();

/* ---------- ⟳ Check for updates ---------- */
const UPDATE_URL = 'https://raw.githubusercontent.com/edenmason/crate-digger/updates/version.json';
const HELPER = 'com.cratedigger.updater';
const vparts = v => String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
const isNewer = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function helperOn() {
  try { await chrome.runtime.sendNativeMessage(HELPER, { action: 'ping' }); return true; } catch (e) { return false; }
}
const HELPER_OFF = 'Switch auto-updates on for this Mac once: double-click “Turn on auto-updates” in your Crate Digger folder (or run “Install Crate Digger” again). After that, updates install themselves, and this button can install them straight away.';
async function checkForUpdates() {
  const now = chrome.runtime.getManifest().version;
  const body = h('div', { class: 'upd' }, h('p', {}, '⟳ Checking GitHub…'));
  openSheet(h('h3', {}, '⟳ Check for updates'), body, h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: closeSheet }, 'Close')));
  let v;
  try {
    const r = await fetch(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    v = await r.json();
  } catch (e) {
    return body.replaceChildren(h('p', { class: 'upd-bad' }, '✕ Couldn’t reach GitHub. Check the internet connection and try again.'));
  }
  const on = await helperOn();
  const auto = h('p', { class: 'muted' }, on ? '✓ Auto-updates are on for this Mac.' : '⚠ Auto-updates aren’t switched on for this Mac yet.');
  if (!isNewer(v.extension, now)) {
    return body.replaceChildren(h('p', { class: 'upd-ok' }, h('span', { class: 'ok-badge' }, '✓'), ` You’re up to date (v${now}).`), auto);
  }
  const status = h('p', {});
  const btn = h('button', { class: 'primary', onclick: install }, `⬆ Update to ${v.extension} now`);
  body.replaceChildren(
    h('p', { class: 'upd-new' }, h('span', { class: 'new-badge' }, '⬆'), ' ', h('b', {}, `Version ${v.extension} is available`), ` (you have ${now}).`),
    (v.notes || []).length ? h('ul', { class: 'notes' }, ...v.notes.map(n => h('li', {}, n))) : null,
    on ? btn : h('p', { class: 'upd-warn' }, '⚠ ', HELPER_OFF),
    status);
  async function install() {
    btn.disabled = true; btn.textContent = '⟳ Updating…';
    try {
      const r = await chrome.runtime.sendNativeMessage(HELPER, { action: 'update' });
      if (r?.after && isNewer(r.after, now)) {
        status.replaceChildren(h('b', {}, `✓ Installed ${r.after}.`), ' Crate Digger is restarting. Open the panel again in a moment. Open music sites may need a refresh.');
        btn.remove();
        setTimeout(() => chrome.runtime.sendMessage({ type: 'cd-check-files' }), 1500);
      } else {
        btn.disabled = false; btn.textContent = `⬆ Try again`;
        status.replaceChildren(h('span', { class: 'upd-warn' }, '⚠ The updater ran but couldn’t install it this time.'), h('pre', { class: 'upd-log' }, r?.log || '(no details)'));
      }
    } catch (e) {
      btn.remove();
      status.replaceChildren(h('span', { class: 'upd-warn' }, '⚠ ', HELPER_OFF));
    }
  }
}

/* after an automatic update: say so, with the release notes */
async function showWhatsNew() {
  const u = (await chrome.storage.local.get('cd_updated')).cd_updated;
  const now = chrome.runtime.getManifest().version;
  if (!u || u.to !== now) return;
  await chrome.storage.local.remove('cd_updated');
  let notes = [];
  try { notes = (await (await fetch(chrome.runtime.getURL('whats-new.json'), { cache: 'no-store' })).json()).notes || []; } catch (e) {}
  openSheet(h('h3', {}, `✓ Crate Digger updated to ${now}`),
    notes.length ? h('ul', { class: 'notes' }, ...notes.map(n => h('li', {}, n))) : h('p', {}, 'It updated itself in the background. Your playlists are untouched.'),
    h('p', { class: 'muted' }, 'ⓘ Open music sites may need a refresh before the save button works again.'),
    h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: closeSheet }, 'Nice')));
}
