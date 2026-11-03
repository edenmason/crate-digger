/* Crate Digger — shared storage & helpers (used by popup, background, review page and content scripts) */
var CD = globalThis.CD || (() => {
  const KEY = 'cd_state';
  const FIELDS = ['type', 'artist', 'title', 'label', 'catno', 'release', 'releaseDate', 'genre', 'style', 'source', 'url', 'video', 'length', 'notes'];
  const DEFAULT_SETTINGS = {
    discogsToken: '', showButton: true, showViewer: true, openIn: 'panel',
    // Sockseek downloads
    ssUrl: 'http://127.0.0.1:5030', dlBase: '/Volumes/Seagate/USB Music', dlDateFolders: true, dlQuality: 'lossless', ssHint: '', ytTarget: 'youtube',
    checkSingle: 'messy', checkPlaylist: true   // check names before downloading: 'messy' | 'always' | 'never'
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const newPlaylist = name => ({ id: uid(), name: name || 'Digging', created: Date.now(), tracks: [] });

  async function load() {
    const r = await chrome.storage.local.get(KEY);
    let s = r[KEY];
    if (!s || !s.playlists || !Object.keys(s.playlists).length) {
      const p = newPlaylist('Digging');
      s = { playlists: { [p.id]: p }, order: [p.id], activeId: p.id, settings: { ...DEFAULT_SETTINGS } };
      await save(s);
    }
    s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    s.order = (s.order || []).filter(id => s.playlists[id]);
    for (const id of Object.keys(s.playlists)) if (!s.order.includes(id)) s.order.push(id);
    if (!s.playlists[s.activeId]) s.activeId = s.order[0];
    return s;
  }
  const save = s => chrome.storage.local.set({ [KEY]: s });
  /* Every change goes through one lock, so the side panel, the review page and the background
     never overwrite each other's saves (Web Locks are shared by all of the extension's pages). */
  async function mutate(fn) {
    const run = async () => { const s = await load(); const out = await fn(s); await save(s); return out; };
    return (typeof navigator !== 'undefined' && navigator.locks) ? navigator.locks.request('cd-state', run) : run();
  }

  function normalize(it) {
    const kept = it.added && !isNaN(Date.parse(it.added)) ? new Date(it.added).toISOString() : '';
    const t = { id: uid(), added: kept || new Date().toISOString() };
    for (const f of FIELDS) t[f] = it[f] == null ? '' : String(it[f]).trim();
    if (!t.type) t.type = 'track';
    if (it.dl && typeof it.dl === 'object') t.dl = it.dl; // keep download info when restoring a backup
    return t;
  }
  const keyOf = t => [t.url || t.artist, t.type, t.title, t.release].join('|').toLowerCase();

  const addItems = (items, playlistId, { tidyUp = false } = {}) => mutate(s => {
    const pl = s.playlists[playlistId] || s.playlists[s.activeId];
    const seen = new Set(pl.tracks.map(keyOf));
    let added = 0, skipped = 0;
    for (const it of items) {
      const t = normalize(tidyUp ? tidy(it).item : it), k = keyOf(t);
      if (seen.has(k)) { skipped++; continue; }
      seen.add(k); pl.tracks.push(t); added++;
    }
    return { added, skipped, playlist: pl.name, total: pl.tracks.length };
  });
  /* ---------- "is this already in a playlist?" ----------
     Matches even after a title was tidied: same track URL / YouTube video, or same artist + title. */
  const normUrl = u => {
    try {
      const x = new URL(u);
      let p = (x.hostname.replace(/^(www|m)\./, '') + x.pathname).replace(/\/$/, '');
      const v = x.searchParams.get('v'); if (v) p += '?v=' + v;
      return p.toLowerCase();
    } catch (e) { return String(u || '').toLowerCase(); }
  };
  const normTxt = s => String(s || '').toLowerCase().replace(/\(original mix\)/g, '').replace(/[^a-z0-9]+/g, '');
  const ONE_TRACK_URL = /youtube\.com\/watch\?v=|^soundcloud\.com\/[^/]+\/[^/?]+$|bandcamp\.com\/track\//;
  const tidyCache = new WeakMap();
  const tidied = t => { if (!tidyCache.has(t)) tidyCache.set(t, tidy(t).item); return tidyCache.get(t); };
  function sameItem(a, b) {
    if ((a.type || 'track') !== (b.type || 'track')) return false;
    const ta = tidied(a), tb = tidied(b);
    const ua = a.url ? normUrl(a.url) : '', ub = b.url ? normUrl(b.url) : '';
    if (a.type === 'release') return (ua && ua === ub) || (!!normTxt(ta.release) && normTxt(ta.artist) === normTxt(tb.artist) && normTxt(ta.release) === normTxt(tb.release));
    if (ua && ua === ub && ONE_TRACK_URL.test(ua)) return true;
    if (a.video && a.video === b.video && !/watch_videos/.test(a.video)) return true;
    const title = normTxt(ta.title);
    if (!title || title !== normTxt(tb.title)) return false;
    return (ua && ua === ub) || (!!normTxt(ta.artist) && normTxt(ta.artist) === normTxt(tb.artist));
  }
  /* which playlists already have this item: [{ id, name }] */
  function findSaved(s, it) {
    if (!s?.playlists || !it) return [];
    const out = [];
    for (const id of s.order || Object.keys(s.playlists)) {
      const pl = s.playlists[id];
      if (pl && pl.tracks.some(t => sameItem(t, it))) out.push({ id, name: pl.name });
    }
    return out;
  }
  const savedLabel = where => !where.length ? '' : where.length === 1 ? `✓ in ${where[0].name}` : `✓ in ${where.length} playlists`;

  const isSaved = (s, it) => {
    const k = keyOf(normalize(it));
    return s.playlists[s.activeId].tracks.some(t => keyOf(t) === k);
  };

  const createPlaylist = name => mutate(s => {
    const p = newPlaylist(name); s.playlists[p.id] = p; s.order.push(p.id); s.activeId = p.id; return p;
  });
  const renamePlaylist = (id, name) => mutate(s => { if (s.playlists[id]) s.playlists[id].name = name; });
  const deletePlaylist = id => mutate(s => {
    delete s.playlists[id];
    s.order = s.order.filter(x => x !== id);
    if (!s.order.length) { const p = newPlaylist('Digging'); s.playlists[p.id] = p; s.order.push(p.id); }
    if (!s.playlists[s.activeId]) s.activeId = s.order[0];
  });
  const setActive = id => mutate(s => { if (s.playlists[id]) s.activeId = id; });
  /* apply the title tidy-up to chosen tracks (ids) in a playlist */
  const tidyTracks = (plId, ids) => mutate(s => {
    const pl = s.playlists[plId]; if (!pl) return 0;
    const want = new Set(ids); let n = 0;
    pl.tracks = pl.tracks.map(t => { if (!want.has(t.id)) return t; const r = tidy(t); if (r.changes.length) n++; return r.changes.length ? r.item : t; });
    return n;
  });
  const updateTrack = (plId, trackId, patch) => mutate(s => {
    const t = s.playlists[plId]?.tracks.find(x => x.id === trackId);
    if (t) for (const f of FIELDS) if (f in patch) t[f] = String(patch[f] ?? '').trim();
    return t;
  });
  /* many edits in one save: [{ id, patch }] */
  const updateTracks = (plId, edits) => mutate(s => {
    const pl = s.playlists[plId]; if (!pl) return 0; let n = 0;
    for (const { id, patch } of edits) {
      const t = pl.tracks.find(x => x.id === id); if (!t) continue;
      for (const f of FIELDS) if (f in patch && patch[f] !== undefined) t[f] = String(patch[f] ?? '').trim();
      n++;
    }
    return n;
  });
  const removeTrack = (plId, trackId) => mutate(s => {
    const p = s.playlists[plId]; if (p) p.tracks = p.tracks.filter(x => x.id !== trackId);
  });
  const saveSettings = patch => mutate(s => { s.settings = { ...s.settings, ...patch }; return s.settings; });
  /* Download status on a track: { state: 'done'|'failed'|..., path, ext, size, at } — null clears it */
  const setDownload = (plId, trackId, dl) => mutate(s => {
    const t = s.playlists[plId]?.tracks.find(x => x.id === trackId);
    if (!t) return null;
    if (dl) t.dl = { ...(t.dl || {}), ...dl }; else delete t.dl;
    return t;
  });

  /* ---------- title tidy-up ----------
     Moves cat numbers, label names in [brackets], years and junk ([FREE], (PREVIEW), .mp3) out of the title
     into their own fields. Mix names like "(Kerri Chandler Remix)" stay. Returns a new object; also lists what changed. */
  const MIXWORD = /\b(remix|mix|edit|dub|rework|re-?work|version|vip|bootleg|flip|instrumental|acapella|acappella|vocal|club|extended|radio|original|cut|reprise|refix|re-?edit|interpretation|treatment|remaster(ed)?|feat\.?|ft\.?|featuring)\b/i;
  const JUNK = /^(free|free ?dl|free download|out now|preview|snippet|premiere|teaser|clip|hq|hd|4k|official( (music )?(video|audio))?|audio|lyrics?( video)?|visuali[sz]er|full track)$/i;
  const CATNO = /^(?=.*\d)[A-Z]{2,8}[\s-]?\d{1,5}[A-Z]{0,2}$|^[A-Z]{1,6}\d{2,5}[A-Z]{0,2}$/i;      // JAJ001, LCD 024, BM-002, WYLD002X
  const LABELWORD = /\b(records|recordings|rec\.?|discs|music group|label|audio ltd|white ?label)\b/i;
  const YEAR = /^(19[5-9]\d|20[0-4]\d)$/;
  function tidy(t) {
    const o = { ...t }, changes = [];
    if (o.type === 'release') return { item: o, changes };
    const note = (f, from, to) => { if (from !== to) changes.push(f); };
    let title = String(o.title || ''), artist = String(o.artist || '');
    const label0 = o.label, cat0 = o.catno, yr0 = o.releaseDate;
    const keepLabel = v => { if (!o.label) o.label = v.trim(); };
    const keepCat = v => { if (!o.catno) o.catno = CATNO.test(v.trim()) ? v.trim().toUpperCase() : v.trim(); };
    const keepYear = v => { if (!o.releaseDate) o.releaseDate = v; };

    // artist that is really a track number ("09", "03") -> title holds "Artist - Title"
    if (/^\d{1,3}\.?$/.test(artist.trim())) {
      const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (m) { artist = m[1]; title = m[2]; }
    }
    // track numbers stuck on the front: "15. Stone Factory", "02 Signum", "01 - Title" (keeps real names like "22 Interns")
    artist = artist.replace(/^\d{1,3}\.\s+/, '').replace(/^0\d\s+(?=\D)/, '');
    title = title.replace(/^\d{1,3}\s*[.)-]\s+(?=\D)/, '').replace(/^0\d\s+(?=\D)/, '');
    // file extensions
    title = title.replace(/\.(mp3|wav|flac|aiff?|m4a|aac|ogg|opus)$/i, '');
    // artist and title swapped: artist has the mix name in brackets, title doesn't
    if (/\(([^)]*\b(remix|mix|edit|dub|rework)\b[^)]*)\)/i.test(artist) && !MIXWORD.test(title.replace(/\b(feat\.?|ft\.?|featuring)\b.*/i, ''))) {
      [artist, title] = [title, artist];
    }
    // " - LCD Records - 1999" style tails
    title = title.replace(/(\s+[-–—]\s+[^-–—()\[\]]+)+$/, tail => {
      const parts = tail.split(/\s+[-–—]\s+/).map(x => x.trim()).filter(Boolean);
      if (!parts.every(x => YEAR.test(x) || LABELWORD.test(x) || CATNO.test(x))) return tail;
      parts.forEach(x => YEAR.test(x) ? keepYear(x) : CATNO.test(x) && !LABELWORD.test(x) ? keepCat(x) : keepLabel(x));
      return '';
    });
    // bracketed bits at the end, working backwards: [JAJ001] (2000) [FREE] (Steel City Dance Discs) [Say Namm]
    for (let guard = 0; guard < 6; guard++) {
      const m = title.match(/\s*([\[(])\s*([^\[\]()]+?)\s*[\])]\s*$/);
      if (!m || m.index === 0) break;
      const inner = m[2], square = m[1] === '[';
      if (MIXWORD.test(inner)) {                       // a mix / feat: keep it, as (round brackets)
        if (square) title = title.slice(0, m.index) + ` (${inner})`;
        break;
      }
      if (JUNK.test(inner)) { title = title.slice(0, m.index); continue; }
      if (YEAR.test(inner)) { keepYear(inner); title = title.slice(0, m.index); continue; }
      if (CATNO.test(inner)) { keepCat(inner); title = title.slice(0, m.index); continue; }
      const labelish = LABELWORD.test(inner) || / [A-Z]{2,}\s?\d{2,4}$/.test(inner);
      if (square || labelish) {                        // [Label Name] or (Something Records / Label 025)
        const cm = inner.match(/^(.*?)\s+(\d{2,4})$/);   // "Ritmo Fatale 025" -> label + cat
        if (cm && !YEAR.test(cm[2])) { keepLabel(cm[1]); keepCat(inner); } else keepLabel(inner);
        title = title.slice(0, m.index); continue;
      }
      break;                                           // e.g. "(To The Millennium)": part of the real title
    }
    // the artist can carry a stray year or junk too, e.g. "Skip Raiders feat. Jada (2000)"
    artist = artist.replace(/\s*[\[(]\s*([^\[\]()]+?)\s*[\])]\s*$/, (all, inner) =>
      YEAR.test(inner) ? (keepYear(inner), '') : JUNK.test(inner) ? '' : all);
    title = title.replace(/\s+[-–—:]\s*$/, '').replace(/\s+/g, ' ').trim();
    artist = artist.replace(/\s+/g, ' ').trim();
    note('artist', String(t.artist || ''), artist); note('title', String(t.title || ''), title);
    note('label', label0 || '', o.label || ''); note('catno', cat0 || '', o.catno || ''); note('releaseDate', yr0 || '', o.releaseDate || '');
    if (!title) return { item: { ...t }, changes: [] };   // never leave a track with no title
    o.artist = artist; o.title = title;
    return { item: o, changes };
  }

  /* A clean search string for Soulseek: "Artist Title", junk and brackets removed,
     leading hyphens dropped (Soulseek treats "-word" as an exclusion). */
  function searchQuery(t) {
    t = tidy(t).item;
    const a = t.artist || '';
    const b = (t.type === 'release' ? t.release : t.title) || t.release || '';
    return `${a} ${b}`
      .replace(/\b(original mix|free download|free dl|out now|premiere|official (music )?video|official audio|lyric video|visuali[sz]er|hq|hd|4k)\b/gi, ' ')
      .replace(/[\[\](){}"“”«»|#*~]/g, ' ')
      .replace(/\s[-–—]+\s/g, ' ')
      .replace(/(^|\s)-+/g, ' ')
      .replace(/\b(various artists|various)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* Best YouTube link for a track: the exact video if we know it, otherwise a YouTube search.
     Always youtube.com itself, so YouTube Premium applies (no ads). */
  /* where ▶ goes: 'youtube' (youtube.com) or 'music' (YouTube Music). Both use your Premium. */
  const ytId = u => (String(u || '').match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{11})/) || [])[1] || '';
  function ytOpen(url, target) {               // an exact video, on whichever site you chose
    const id = ytId(url);
    if (!id || /watch_videos/.test(url)) return url; // a "play all" queue only works on youtube.com
    return target === 'music' ? `https://music.youtube.com/watch?v=${id}` : `https://www.youtube.com/watch?v=${id}`;
  }
  const ytSearchUrl = (q, target) => !q ? '' : target === 'music'
    ? 'https://music.youtube.com/search?q=' + encodeURIComponent(q)
    : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  function youtubeLink(t, target = 'youtube') {
    if (t.video) return ytOpen(t.video, target);
    if (/^https?:\/\/((www|m|music)\.)?youtube\.com\/watch/.test(t.url || '')) return ytOpen(t.url, target);
    return ytSearchUrl(searchQuery(t), target);
  }

  /* SoundCloud track search for artist + title */
  const soundcloudLink = t => 'https://soundcloud.com/search/sounds?q=' + encodeURIComponent(searchQuery(t));

  const COLS = [
    ['Artist', 'artist'], ['Title', 'title'], ['Label', 'label'], ['Catalog Number', 'catno'],
    ['Release', 'release'], ['Release Date', 'releaseDate'], ['Genre', 'genre'], ['Style / Tags', 'style'],
    ['Length', 'length'], ['Type', 'type'], ['Source', 'source'], ['URL', 'url'], ['YouTube', '_yt'], ['Soulseek Search', '_q'],
    ['Downloaded File', '_dl'], ['Notes', 'notes'], ['Added', 'added']
  ];
  /* "6:12" / "1:02:03" / "372" -> seconds (number) or '' */
  function lengthSecs(v) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s);
    const p = s.split(':').map(Number);
    if (p.some(isNaN) || p.length > 3) return '';
    return p.reduce((a, b) => a * 60 + b, 0);
  }
  const fmtLength = v => { const n = lengthSecs(v); return n === '' ? '' : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  function cell(v) {
    v = v == null ? '' : String(v);
    if (/^[=+@]/.test(v)) v = "'" + v;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }
  function toCSV(rows, withPlaylist) {
    const cols = withPlaylist ? [['Playlist', '_playlist'], ...COLS] : COLS;
    const out = [cols.map(c => cell(c[0])).join(',')];
    for (const r of rows) {
      out.push(cols.map(([, k]) => cell(
        k === '_q' ? searchQuery(r) : k === '_yt' ? youtubeLink(r) : k === '_dl' ? (r.dl?.state === 'done' ? r.dl.path || '' : '')
          : k === 'length' ? fmtLength(r.length) : k === 'type' ? (r.type === 'release' ? 'Release' : 'Track') : r[k]
      )).join(','));
    }
    return '\uFEFF' + out.join('\r\n') + '\r\n';
  }

  /* ---------- import ---------- */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  const HEADER_MAP = {
    'playlist': '_playlist', 'artist': 'artist', 'title': 'title', 'track': 'title', 'label': 'label',
    'catalog number': 'catno', 'catalog #': 'catno', 'catalogue number': 'catno', 'cat #': 'catno', 'catno': 'catno',
    'release': 'release', 'album': 'release', 'release date': 'releaseDate', 'year': 'releaseDate', 'genre': 'genre',
    'style / tags': 'style', 'style': 'style', 'tags': 'style', 'type': 'type', 'source': 'source', 'url': 'url',
    'youtube': '_yt', 'notes': 'notes', 'added': 'added', 'length': 'length', 'duration': 'length'
  };
  /* CSV text -> [{ name, items }] grouped by the Playlist column (or one group named fallbackName) */
  function csvToGroups(text, fallbackName) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('No rows found in that CSV');
    const cols = rows[0].map(h => HEADER_MAP[h.trim().toLowerCase()] || null);
    if (!cols.includes('artist') && !cols.includes('title')) throw new Error('This CSV has no Artist or Title column');
    const groups = new Map();
    for (const r of rows.slice(1)) {
      const it = {};
      cols.forEach((k, i) => {
        if (!k) return;
        let v = (r[i] ?? '').trim();
        if (/^'[=+@]/.test(v)) v = v.slice(1); // undo the spreadsheet-formula guard added on export
        it[k] = v;
      });
      it.type = /^release$/i.test(it.type || '') ? 'release' : 'track';
      if (it._yt && /youtube\.com\/(watch|watch_videos)/.test(it._yt)) it.video = it._yt; // searches are rebuilt automatically
      const name = it._playlist || fallbackName || 'Imported';
      delete it._yt; delete it._playlist;
      if (!it.artist && !it.title && !it.release) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(it);
    }
    return [...groups].map(([name, items]) => ({ name, items }));
  }
  /* Merge groups into playlists with the same name (case-insensitive), creating any that don't exist. */
  const importGroups = groups => mutate(s => {
    const report = [];
    for (const g of groups) {
      let pl = Object.values(s.playlists).find(p => p.name.trim().toLowerCase() === g.name.trim().toLowerCase());
      const created = !pl;
      if (!pl) { pl = newPlaylist(g.name); s.playlists[pl.id] = pl; s.order.push(pl.id); }
      const seen = new Set(pl.tracks.map(keyOf));
      let added = 0, skipped = 0;
      for (const it of g.items) {
        const t = normalize(it), k = keyOf(t);
        if (seen.has(k)) { skipped++; continue; }
        seen.add(k); pl.tracks.push(t); added++;
      }
      report.push({ name: pl.name, created, added, skipped });
    }
    return report;
  });
  /* Full backup as JSON */
  async function backupJSON() {
    const s = await load();
    return JSON.stringify({ app: 'crate-digger', exported: new Date().toISOString(),
      playlists: s.order.map(id => ({ name: s.playlists[id].name, tracks: s.playlists[id].tracks })) }, null, 2);
  }
  function jsonToGroups(text) {
    const j = JSON.parse(String(text).replace(/^﻿/, ''));
    const pls = Array.isArray(j.playlists) ? j.playlists : j.playlists && typeof j.playlists === 'object' ? Object.values(j.playlists) : null;
    if (!pls) throw new Error('Not a Crate Digger backup');
    return pls.map(p => ({ name: p.name || 'Imported', items: p.tracks || [] }));
  }

  /* Make sure our content script is in the tab (injects it on pages like custom Bandcamp domains). */
  async function ensureContent(tabId) {
    try { const r = await chrome.tabs.sendMessage(tabId, { type: 'cd-ping' }); if (r && r.ok) return true; } catch (e) {}
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['storage.js', 'extractors.js', 'content.js'] }); return true; }
    catch (e) { return false; }
  }

  return { tidy, tidyTracks, updateTracks, load, addItems, isSaved, findSaved, savedLabel, sameItem, createPlaylist, renamePlaylist, deletePlaylist, setActive, updateTrack,
    removeTrack, saveSettings, setDownload, lengthSecs, fmtLength, searchQuery, youtubeLink, ytOpen, ytSearchUrl, soundcloudLink, toCSV, ensureContent, FIELDS,
    parseCSV, csvToGroups, jsonToGroups, importGroups, backupJSON };
})();
