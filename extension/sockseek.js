/* Crate Digger — Sockseek connection (talks to `sockseek daemon` running on this Mac) */
const SS = (() => {
  const LOSSLESS = ['flac', 'wav', 'aiff', 'aif'];
  const QUALITY = {
    lossless:    { label: 'Lossless only (FLAC / WAV / AIFF)', formats: LOSSLESS },
    lossless320: { label: 'Lossless, or MP3 320 if that’s all there is', formats: [...LOSSLESS, 'mp3'], minBitrate: 320 },
    any:         { label: 'Any quality (lossless ranked first)', formats: [...LOSSLESS, 'mp3', 'm4a', 'alac', 'ogg', 'opus'] }
  };
  const DL_KEY = 'cd_dl';
  const SEARCH_MS = 15000;              // listen this long for results (slow peers with big lossless folders answer late)
  const NEVER = 2147483647;             // "no limit" for Sockseek's stale timer: a queued or slow download is never given up on
  const AGAIN_MS = 30 * 60 * 1000;      // every file failed: search again this often, until you stop it

  /* ---------- http ---------- */
  let base = 'http://127.0.0.1:5030';
  const setBase = url => { base = String(url || base).trim().replace(/\/+$/, '') || base; };
  async function api(path, body, { method, timeout = 8000 } = {}) {
    let r;
    try {
      r = await fetch(base + path, {
        method: method || (body !== undefined ? 'POST' : 'GET'),
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout)
      });
    } catch (e) {
      const err = new Error('Sockseek isn’t running');
      err.offline = true;
      throw err;
    }
    if (r.status === 404) { const e = new Error('Not found'); e.notFound = true; throw e; }
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!r.ok) throw new Error(data?.error || data?.title || `Sockseek error ${r.status}`);
    return data;
  }

  const info = () => api('/api/server/info', undefined, { timeout: 2500 });
  const status = () => api('/api/server/status', undefined, { timeout: 2500 });
  const getJob = id => api(`/api/jobs/${id}`);
  const cancel = id => api(`/api/jobs/${id}/cancel`, {});
  const nextCandidate = id => api(`/api/jobs/${id}/next-candidate`, {});
  const results = id => api(`/api/jobs/${id}/results/files`);

  /* ---------- what to send ---------- */
  function localDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  /* a playlist name that's safe as a folder name on any drive (exFAT/FAT32 included) */
  const safeName = n => String(n || '').replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^\.+|[. ]+$/g, '').slice(0, 80) || 'Playlist';
  /* USB Music / 2026-11-03 / TRANCE NIGHT NOV : each part can be switched off in settings */
  function folderFor(settings, plName, d) {
    const b = String(settings.dlBase || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    const parts = [b];
    if (settings.dlDateFolders !== false) parts.push(localDate(d));
    if (settings.dlPlaylistFolders !== false && plName) parts.push(safeName(plName));
    return parts.join('/');
  }
  function optionsFor(settings, folder, quality, { album = false } = {}) {
    const q = QUALITY[quality || settings.dlQuality] || QUALITY.lossless;
    const necessary = { formats: { replace: q.formats }, lengthTolerance: -1 };   // length never rejects a file…
    if (q.minBitrate) necessary.minBitrate = q.minBitrate;
    const preferred = { formats: { replace: LOSSLESS }, lengthTolerance: 3 };     // …it only ranks the closest match first
    const o = { downloadSettings: { search: { necessaryCond: necessary, preferredCond: preferred, searchTimeout: SEARCH_MS, maxStaleTime: NEVER },
      // a hard failure (user offline, refused) moves on to the next file quickly instead of retrying the same one
      transfer: { maxDownloadRetries: album ? 10 : 2 } } };
    // Single tracks: name from the file's own tags; untagged files keep their original name (so the mix name is never lost).
    // Releases keep Sockseek's default: their own folder with the original filenames.
    if (!album) o.downloadSettings.output = { nameFormat: '{artist( - )title|filename}' };
    if (folder) o.outputParentDir = folder;
    return o;
  }
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  function songQuery(t) {
    const tt = CD.tidy(t).item;
    // "(Original Mix)" is usually left off filenames, so don't make it a search word
    const q = { artist: clean(tt.artist), title: clean(String(tt.title || '').replace(/\s*\((original mix)\)\s*/i, ' ')) };
    const len = CD.lengthSecs(t.length);
    if (len) q.length = len;
    if (/soundcloud|youtube/i.test(t.source || '')) q.artistMaybeWrong = true; // the "artist" may just be the uploader
    return q;
  }
  const isRelease = t => t.type === 'release' || (!t.title && t.release);

  async function submit(t, settings, quality, plName, keepFolder) {
    const folder = keepFolder || folderFor(settings, plName);
    const album = isRelease(t);
    const options = optionsFor(settings, folder, quality, { album });
    const s = album
      ? await api('/api/jobs/downloads/album', { albumQuery: { artist: clean(t.artist), album: clean(t.release) }, options })
      : await api('/api/jobs/downloads/song', { songQuery: songQuery(t), options });
    return { summary: s, folder };
  }
  async function search(t, settings, quality, plName) {
    const options = optionsFor(settings, folderFor(settings, plName), quality);
    return api('/api/jobs/search/tracks', { songQuery: songQuery(t), options });
  }
  async function downloadFile(searchJobId, ref, settings, quality, plName) {
    const folder = folderFor(settings, plName);
    const list = await api(`/api/jobs/${searchJobId}/downloads/files`, { files: [ref], options: optionsFor(settings, folder, quality) });
    return { summary: (list || [])[0], folder };
  }

  /* ---------- does a name need a look before searching? (empty list = looks fine) ---------- */
  function needsCheck(t) {
    const why = [];
    if (isRelease(t)) {
      if (!clean(t.artist)) why.push('No artist');
      if (!clean(t.release)) why.push('No release name');
      return why;
    }
    if (!clean(t.artist)) why.push('No artist');
    if (!clean(t.title)) why.push('No title');
    const r = CD.tidy(t), tt = r.item;
    if (r.changes.includes('artist') || r.changes.includes('title')) why.push('Extra bits in the name (cat number, [label], track number, junk)');
    if (/\s[-–—]\s/.test(tt.title || '')) why.push('Title has a “ - ” in it, so the artist may be stuck in the title');
    if ((tt.title || '').length > 70) why.push('Very long title');
    if (/^(various( artists)?|va|v\/a|unknown( artist)?)$/i.test(clean(tt.artist))) why.push('Artist is “Various” or “Unknown”');
    return why;
  }

  /* ---------- send tracks to Sockseek (used by the panel and the review page) ---------- */
  async function sendTracks(tracks, plId, settings, { quality, force = false, onProgress } = {}) {
    setBase(settings.ssUrl);
    let started = '';
    try { started = (await info())?.startedAtUtc || ''; }
    catch (e) { return { sent: 0, skipped: 0, failed: tracks.length, lastErr: e.message, offline: true }; }
    const q = quality || settings.dlQuality;
    const plName = (await CD.load()).playlists[plId]?.name || '';
    const d = await loadJobs();
    const busy = new Set(d.order.map(id => d.jobs[id]).filter(r => r && !isDone(r.s) && !r.lost).map(r => r.trackId));
    let sent = 0, skipped = 0, failed = 0, lastErr = '', offline = false;
    let i = 0;
    for (const t of tracks) {
      onProgress?.(++i, tracks.length);
      if (busy.has(t.id) || (!force && t.dl?.state === 'done') || !(t.artist || t.title || t.release)) { skipped++; continue; }
      try {
        const lbl = isRelease(t) ? `${t.artist || 'Unknown artist'} – ${t.release || 'Untitled'}` : `${t.artist || 'Unknown artist'} – ${t.title || 'Untitled'}`;
        if (isRelease(t)) {
          const { summary, folder } = await submit(t, settings, q, plName);
          await addJob({ id: summary.jobId, plId, trackId: t.id, label: lbl, kind: summary.kind, quality: q, folder, ss: started,
            created: Date.now(), s: { life: summary.lifecycleState, phase: summary.activityPhase } });
          await CD.setDownload(plId, t.id, { state: 'queued', jobId: summary.jobId, reason: '' });
        } else {
          // single tracks: Crate Digger searches, ranks and works down the list itself (see "tasks" below)
          const rec = newTask(t, { plId, label: lbl, quality: q, folder: folderFor(settings, plName), ss: started });
          await addJob(rec);
          await CD.setDownload(plId, t.id, { state: 'queued', jobId: rec.id, reason: '' });
        }
        sent++;
      } catch (e) { failed++; lastErr = e.message; if (e.offline) { offline = true; break; } }
    }
    if (sent) kick();
    return { sent, skipped, failed, lastErr, offline };
  }
  /* wake the background worker, which drives every download (see tick) */
  const kick = () => { try { chrome.runtime.sendMessage({ type: 'cd-dl-kick' }).catch(() => {}); } catch (e) {} };

  /* ---------- job records (kept in chrome.storage so they survive closing the panel) ---------- */
  async function loadJobs() {
    const r = await chrome.storage.local.get(DL_KEY);
    const d = r[DL_KEY] || {};
    return { jobs: d.jobs || {}, order: (d.order || []).filter(id => d.jobs?.[id]) };
  }
  const saveJobs = d => chrome.storage.local.set({ [DL_KEY]: d });
  // one lock shared by every extension page, so two pages can't overwrite each other's download records
  const mutateJobs = fn => {
    const run = async () => { const d = await loadJobs(); const out = await fn(d); await saveJobs(d); return out; };
    return navigator.locks ? navigator.locks.request('cd-dl', run) : run();
  };

  const addJob = rec => mutateJobs(d => { d.jobs[rec.id] = rec; d.order = [rec.id, ...d.order.filter(x => x !== rec.id)].slice(0, 400); });
  const updateJob = (id, patch) => mutateJobs(d => { if (d.jobs[id]) d.jobs[id] = { ...d.jobs[id], ...patch }; return d.jobs[id]; });
  const removeJobs = pred => mutateJobs(d => {
    for (const id of d.order) if (pred(d.jobs[id])) delete d.jobs[id];
    d.order = d.order.filter(id => d.jobs[id]);
  });

  /* Pull the bits we show out of a job snapshot */
  function snap(detail) {
    const s = detail.summary || {}, p = detail.payload || {};
    const kids = detail.children || [];
    return {
      life: s.lifecycleState, phase: p.activityPhase || s.activityPhase, outcome: s.terminalOutcome, skip: s.skipReason,
      fail: s.failureReason || p.failureReason || '', failMsg: s.failureMessage || p.failureMessage || '',
      until: p.activityUntilUtc || s.activityUntilUtc || '',
      pct: p.progressPercent ?? null, bytes: p.bytesTransferred ?? null, total: p.totalBytes ?? null,
      path: p.downloadPath || '', ext: (p.resolvedExtension || '').replace('.', ''), size: p.resolvedSize ?? null,
      user: p.resolvedUsername || '', file: p.resolvedFilename || '', ts: p.transferState || '',
      kids: p.selectedFolderFileCount ?? kids.length,
      kidsDone: p.selectedFolderSucceededFileCount ?? kids.filter(k => k.lifecycleState === 'Terminal' && k.terminalOutcome === 'Succeeded').length,
      kidsFailed: p.selectedFolderFailedFileCount ?? kids.filter(k => k.lifecycleState === 'Terminal' && /Failed|Cancelled/.test(k.terminalOutcome)).length,
      album: p.kind === 'album'
    };
  }
  const isDone = s => s && s.life === 'Terminal';

  /* ---------- wording ---------- */
  const mb = n => n == null ? '' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round(n / 1e6) + ' MB';
  function describeRaw(rec, now = Date.now()) {
    const s = rec.s || {};
    if (rec.lost) return { text: 'Sockseek was restarted, so this one stopped. Retry it.', cls: 'bad' };
    if (rec.task && !isDone(s)) return describeTask(rec, now);
    if (!s.life || s.life === 'Pending') return { text: 'Queued', cls: 'wait' };
    if (s.life === 'AwaitingSelection') return { text: 'Waiting for you to pick a file', cls: 'wait' };
    if (s.life !== 'Terminal') {
      switch (s.phase) {
        case 'SearchRateLimited': {
          const secs = s.until ? Math.max(0, Math.round((Date.parse(s.until) - now) / 1000)) : null;
          return { text: `Paused for Soulseek’s search limit${secs != null ? `, resumes in ${secs}s` : ''}`, cls: 'wait' };
        }
        case 'WaitingForSearchConcurrency': return { text: 'Waiting to search', cls: 'wait' };
        case 'Searching': return { text: 'Searching Soulseek…', cls: 'run' };
        case 'ProcessingSearchResults': return { text: 'Picking the best file…', cls: 'run' };
        case 'RunningFallback': return { text: 'Trying a simpler search…', cls: 'run' };
        case 'Downloading': {
          const pct = s.pct != null ? Math.floor(s.pct) : null;
          return { text: `Downloading${pct != null ? ` ${pct}%` : '…'}${s.ext ? ` · ${s.ext.toUpperCase()}` : ''}${s.total ? ` · ${mb(s.total)}` : ''}`, cls: 'run', pct };
        }
        case 'RunningChildren': return { text: s.kids ? `Downloading tracks ${s.kidsDone}/${s.kids}` : 'Downloading tracks…', cls: 'run' };
        case 'RetrievingFolder': return { text: s.kids ? `Downloading release ${s.kidsDone}/${s.kids} tracks` : 'Looking through the folder…', cls: 'run' };
        case 'Organizing': return { text: 'Saving…', cls: 'run' };
        default: return { text: 'Working…', cls: 'run' };
      }
    }
    if (s.outcome === 'Succeeded' && s.album) return { text: `Saved release · ${s.kidsDone} tracks`, cls: 'ok' };
    if (s.outcome === 'Succeeded') return { text: `Saved${s.ext ? ` · ${s.ext.toUpperCase()}` : ''}${s.size ? ` · ${mb(s.size)}` : ''}`, cls: 'ok' };
    if (s.outcome === 'PartialSuccess') return { text: `Partly done: ${s.kidsDone} saved, ${s.kidsFailed} failed`, cls: 'warn' };
    if (s.outcome === 'Cancelled') return { text: 'Cancelled', cls: 'muted' };
    if (s.outcome === 'Skipped') {
      if (s.skip === 'AlreadyExists') return { text: 'Already in that folder', cls: 'ok' };
      if (s.skip === 'NotFoundLastTime') return { text: 'Skipped: not found last time', cls: 'warn' };
      return { text: 'Skipped', cls: 'muted' };
    }
    const q = QUALITY[rec.quality] || QUALITY.lossless;
    switch (s.fail) {
      case 'NoSearchResults':
      case 'NoMatchingResults':
        return { text: rec.quality === 'any' ? 'Not found on Soulseek' : `No ${rec.quality === 'lossless320' ? 'lossless or 320' : 'lossless'} copy found`, cls: 'bad', canPick: true };
      case 'OutOfDownloadRetries':
      case 'AllDownloadsFailed':
        return { text: 'Found it, but the downloads failed (users offline or too slow)', cls: 'bad', canPick: true };
      case 'OnlyOtherVersions':
        return { text: 'Only other versions found (remixes, edits or a different title), so choose one yourself', cls: 'bad', canPick: true };
      case 'InvalidSearchString': return { text: 'Search was empty, so check the artist/title', cls: 'bad' };
      default: return { text: s.failMsg || 'Failed', cls: 'bad', canPick: true };
    }
  }

  /* Every state gets an icon + a word + a shape (see popup.css), so nothing relies on colour alone. */
  function describe(rec, now = Date.now()) {
    const d = describeRaw(rec, now), s = rec.s || {};
    const set = (icon, word) => Object.assign(d, { icon, word });
    if (rec.lost) return set('✕', 'Stopped');
    if (d.word) return d;   // tasks name their own state
    switch (d.cls) {
      case 'ok': return set('✓', /^Already/.test(d.text) ? 'Already there' : 'Saved');
      case 'warn': return set('⚠', s.outcome === 'PartialSuccess' ? 'Partly done' : 'Skipped');
      case 'muted': return set('⊘', s.outcome === 'Cancelled' ? 'Cancelled' : 'Skipped');
      case 'bad': return set('✕', /found/i.test(d.text) && !/downloads failed/.test(d.text) ? 'Not found' : 'Failed');
      case 'wait':
        if (s.phase === 'SearchRateLimited') return set('⏸', 'Paused');
        if (s.life === 'AwaitingSelection') return set('☝', 'Your pick');
        return set('⏸', s.phase === 'WaitingForSearchConcurrency' ? 'Waiting' : 'Queued');
      default:
        if (s.phase === 'Searching' || s.phase === 'ProcessingSearchResults') return set('⌕', 'Searching');
        if (s.phase === 'RunningFallback') return set('↻', 'Retrying');
        if (s.phase === 'Organizing') return set('⬇', 'Saving');
        return set('⬇', 'Downloading');
    }
  }

  /* ---------- matching: is this file the track you saved? ---------- */
  const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’‘`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const wordsOf = s => fold(s).split(' ').filter(Boolean).map(w => w === 'pt' ? 'part' : w);
  const MIXY = /\b(remix|rmx|mix|edit|dub|version|rework|re ?edit|bootleg|vip|instrumental|acapella|acappella|cappella|cover|live|extended|club|radio|original|main|reprise|refix|flip|remaster(ed)?|vocal)\b/;
  const FEAT = /^(feat|ft|featuring)\b/;
  const GENERIC = new Set(['original', 'extended', 'main', 'club', 'radio', 'mix', 'remix', 'rmx', 'edit', 'version', 'full', 'length', 'album', 'single', 'remaster', 'remastered', 'inch', '12', '7', 'and', 'the', 'a', 's']);
  const FINE = /\b(original|extended|main|club|radio|album|full length|12 ?inch|7 ?inch) (mix|edit|version)\b|\bremaster(ed)?\b|\boriginal\b/g;  // all the same track
  const OTHER = /\b(remix|rmx|rework|re ?edit|bootleg|vip|dub|refix|flip|edit|cover|live|acapella|acappella|cappella|instrumental|reprise|mashup|remake|mix)\b/g;
  const ARTIST_SPLIT = /\s*(?:,|&|\+|\/|\band\b|\bx\b|\bvs\.?|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bpres(?:ents|\.))\s*/i;

  /* What a file needs to have in it: title words, one of the artists, and the mix name if you saved a particular mix */
  function wantFor(track) {
    const tt = CD.tidy(track).item;
    const mixes = [];
    let title = String(tt.title || '').replace(/[([]([^)\]]*)[)\]]/g, (m, inner) => {
      const f = fold(inner);
      if (FEAT.test(f)) return ' ';
      if (MIXY.test(f)) { mixes.push(f); return ' '; }
      return m;                                                    // e.g. "(Part 2)" is part of the title
    });
    title = title.replace(/\s[-–—]\s(.+)$/, (m, tail) => MIXY.test(fold(tail)) ? (mixes.push(fold(tail)), ' ') : m);   // "Title - Someone Remix"
    title = title.replace(/\s(feat|ft|featuring)\.?\s.*$/i, ' ').replace(/\s+/g, ' ').trim();
    const mixWords = mixes.join(' ').split(' ').filter(Boolean);
    const artists = String(tt.artist || '').replace(/\([^)]*\)/g, ' ').split(ARTIST_SPLIT).map(wordsOf).filter(w => w.length);
    return {
      core: wordsOf(title), coreText: title || clean(tt.title),
      named: [...new Set(mixWords.filter(w => !GENERIC.has(w)))],                     // "Kerri Chandler Remix" → kerri, chandler; "Dub Mix" → dub
      kinds: mixWords.filter(w => ['extended', 'original', 'club', 'radio', 'main'].includes(w)),
      artists, maybeWrong: /soundcloud|youtube/i.test(track.source || ''), len: CD.lengthSecs(track.length) || 0
    };
  }
  function matchFile(c, want) {
    const parts = String(c.filename || '').split(/[\\/]/);
    const base = parts.pop().replace(/\.[a-z0-9]{2,5}$/i, '');
    const nameW = new Set(wordsOf(base)), pathW = new Set(wordsOf(parts.join(' ') + ' ' + base));
    const titleOk = want.core.every(w => nameW.has(w));
    const artistOk = !want.artists.length || want.artists.some(a => a.every(w => pathW.has(w)));
    let versionOk = true;
    if (want.named.length) versionOk = want.named.filter(w => nameW.has(w)).length >= Math.min(2, want.named.length);
    else {
      const core = new Set(want.core);
      versionOk = !(fold(base).replace(FINE, ' ').match(OTHER) || []).some(w => !core.has(w));
    }
    const kindBonus = want.kinds.some(k => nameW.has(k)) ? 5 : 0;
    return { titleOk, artistOk, versionOk, ok: titleOk && versionOk && (artistOk || want.maybeWrong), kindBonus };
  }

  /* ---------- ranking ---------- */
  const LOSSY_RIP = /\b(youtube|yt ?rip|\byt\b|radio ?rip|preview|snippet|sample)\b/i;
  const TIER = { flac: 0, wav: 0, aiff: 1, aif: 1, mp3: 2 };        // FLAC/WAV first, then AIFF, then MP3 (only if allowed)
  function rate(c, wantLen, want) {
    const ext = String(c.extension || c.filename.split('.').pop() || '').replace('.', '').toLowerCase();
    const lossless = LOSSLESS.includes(ext);
    const len = Number(c.length) || 0;
    const mbPerMin = len ? c.size / 1e6 / (len / 60) : null;
    const notes = [];
    let score = lossless ? 100 - 20 * (TIER[ext] || 0) : ext === 'mp3' && (c.bitRate >= 320 || (mbPerMin && mbPerMin > 2.2)) ? 60 : 30;

    // size sanity check against length (only meaningful if Soulseek reports a length)
    if (mbPerMin != null) {
      if (ext === 'flac' && mbPerMin < 3) { notes.push({ t: 'Small for FLAC, may be made from an MP3', bad: true }); score -= 40; }
      if ((ext === 'wav' || ext === 'aiff' || ext === 'aif') && mbPerMin < 8) { notes.push({ t: `Small for ${ext.toUpperCase()}, may be converted`, bad: true }); score -= 40; }
      if (ext === 'mp3' && c.bitRate >= 320 && mbPerMin < 2) { notes.push({ t: 'Small for 320, may be upscaled', bad: true }); score -= 25; }
    }
    if (LOSSY_RIP.test(c.filename)) { notes.push({ t: 'Looks like a YouTube/radio rip', bad: true }); score -= 50; }

    // length: information only. A longer one may well be the extended mix you want.
    if (wantLen && len) {
      const diff = len - wantLen;
      if (Math.abs(diff) <= 5) { notes.push({ t: 'Same length as your saved track', good: true }); score += 10; }
      else notes.push({ t: `${diff > 0 ? '+' : '−'}${CD.fmtLength(Math.abs(diff))} ${diff > 0 ? 'longer (maybe an extended mix?)' : 'shorter (maybe an edit?)'}` });
    }
    let match = null;
    if (want) {
      match = matchFile(c, want);
      if (!match.titleOk) { notes.push({ t: 'Title doesn’t match your saved track', bad: true }); score -= 200; }
      else if (!match.versionOk) { notes.push({ t: 'Looks like a different version (remix, edit…)', bad: true }); score -= 150; }
      if (!match.artistOk) { notes.push({ t: 'Artist name isn’t in the file or folder name', bad: !want.maybeWrong }); score -= want.maybeWrong ? 10 : 100; }
      else score += 10;
      score += match.kindBonus;
    }

    if (c.peer?.hasFreeUploadSlot) score += 8; else notes.push({ t: 'User has a queue' });
    if (c.peer?.uploadSpeed) score += Math.min(8, c.peer.uploadSpeed / 250000);
    return { ext, lossless, len, score, notes, match };
  }
  /* Files Crate Digger will try by itself, best first. Format beats speed; a likely fake drops below every genuine file. */
  function rank(items, want, quality, pin) {
    const q = QUALITY[quality] || QUALITY.lossless;
    const list = [];
    let other = 0;
    for (const c of items) {
      const r = rate(c, want.len, want);
      if (!q.formats.includes(r.ext)) continue;
      if (pin) { if (c.username === pin.user && c.filename === pin.file) list.push({ c, r, tier: 0 }); continue; }
      if (!r.match.ok) { other++; continue; }
      list.push({ c, r, tier: (TIER[r.ext] ?? 3) + (r.notes.some(n => n.bad) ? 1.5 : 0) });
    }
    list.sort((a, b) => a.tier - b.tier || b.r.score - a.r.score);
    return { list, other };
  }

  /* ---------- tasks: one per single track, driven by the background worker ----------
     search (wider each time if nothing fits) → rank → download the best file → if it hard-fails, the next one →
     every file failed: wait 30 min and search again. A queued or slow download is never given up on. */
  const newId = () => 'task-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function newTask(t, { plId, label, quality, folder, ss, pin = null, cands = [] }) {
    return { id: newId(), task: true, kind: 'song', plId, trackId: t.id, label, quality, folder, ss, created: Date.now(),
      track: { artist: t.artist, title: t.title, length: t.length, source: t.source },
      pin, picked: !!pin, pick: pin ? pin.file.split(/[\\/]/).pop() : undefined,
      stage: cands.length ? 'download' : 'search', qi: 0, sj: '', cands, idx: -1, dlJob: '', bad: [], tried: 0, rounds: 0, raw: 0, other: 0,
      s: { life: 'Pending' } };
  }
  function queriesFor(track) {
    const w = wantFor(track), base = songQuery(track), title = w.coreText;
    const out = [{ ...base, title }];
    const first = String(base.artist || '').split(ARTIST_SPLIT)[0].replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (first && fold(first) !== fold(base.artist)) out.push({ ...base, artist: first, title });     // just the first artist
    if (w.core.length >= 2 || fold(title).length >= 8) {                                               // the title on its own
      const q = { title };
      if (base.length) q.length = base.length;
      out.push(q);
    }
    return out;
  }
  const candOf = (c, r, sj, tier) => ({ ref: c.ref, user: c.username, file: c.filename, ext: r.ext, size: c.size, len: r.len, tier, score: r.score, sj });

  /* the one track a file is for: playlists keep a ✓ / ✕ on each track */
  async function trackOf(r) { return (await CD.load()).playlists[r.plId]?.tracks.find(x => x.id === r.trackId); }
  async function markTrack(r, patch) {
    const t = await trackOf(r);
    if (!t || t.dl?.jobId !== r.id || t.dl?.state === patch.state) return;
    await CD.setDownload(r.plId, r.trackId, patch);
  }
  async function syncTrack(r) {
    const s = r.s;
    const t = await trackOf(r);
    if (!t || (t.dl?.jobId && t.dl.jobId !== r.id && t.dl.state === 'done')) return;
    if (s.outcome === 'Succeeded' || (s.outcome === 'Skipped' && s.skip === 'AlreadyExists') || s.outcome === 'PartialSuccess')
      await CD.setDownload(r.plId, r.trackId, { state: 'done', jobId: r.id, path: s.path || r.folder, ext: s.ext, size: s.size, at: Date.now(), reason: '' });
    else if (s.outcome !== 'Cancelled')
      await CD.setDownload(r.plId, r.trackId, { state: 'failed', jobId: r.id, reason: describe(r).text });
    else await CD.setDownload(r.plId, r.trackId, null);
  }

  async function stepTask(r, started, settings) {
    const save = async p => { Object.assign(r, p); await updateJob(r.id, p); };
    const quiet = async id => { if (id) try { await cancel(id); } catch (e) { if (e.offline) throw e; } };
    const research = () => save({ stage: 'search', qi: 0, sj: '', cands: [], idx: -1, dlJob: '', raw: 0, other: 0 });
    const finish = async s => { await save({ stage: 'done', s: { ...s, life: 'Terminal' } }); await syncTrack(r); return false; };

    async function startNext() {
      let i = r.idx + 1;
      while (i < r.cands.length && r.bad.includes(r.cands[i].user)) i++;
      if (i >= r.cands.length) {                     // every file failed this round: try again later
        await save({ stage: 'wait', nextAt: Date.now() + AGAIN_MS, rounds: r.rounds + 1, dlJob: '', s: { life: 'Running', phase: 'Waiting' } });
        return false;
      }
      const c = r.cands[i];
      let job;
      try { job = (await api(`/api/jobs/${c.sj}/downloads/files`, { files: [c.ref], options: optionsFor(settings, r.folder, r.quality) }) || [])[0]; }
      catch (e) { if (e.notFound) { await research(); return true; } throw e; }     // that search is gone (Sockseek restarted)
      const now = Date.now();
      await save({ stage: 'download', idx: i, dlJob: job.jobId, tried: r.tried + 1, since: now, moved: now, lastBytes: 0, lastAt: now,
        s: { life: 'Running', phase: 'Starting', ext: c.ext, total: c.size, user: c.user, n: i + 1, of: r.cands.length } });
      return true;
    }

    // your buttons
    if (r.cmd === 'stop') { await quiet(r.dlJob); await quiet(r.stage === 'search' ? r.sj : ''); return finish({ outcome: 'Cancelled' }); }
    if (r.cmd === 'next') { await save({ cmd: '' }); if (r.stage === 'download') { await quiet(r.dlJob); return startNext(); } }
    if (r.cmd === 'again') { await save({ cmd: '', bad: [] }); if (r.stage === 'wait') await research(); }
    // Sockseek restarted: its jobs are gone, so pick up where we were with a fresh search
    if (started && r.ss !== started) { await save({ ss: started }); if (r.stage !== 'wait') await research(); }

    if (r.stage === 'wait') {
      if (Date.now() < r.nextAt) return false;
      await save({ bad: [] });
      await research();
    }

    if (r.stage === 'search') {
      const qs = queriesFor(r.track);
      if (!r.sj) {
        if (r.qi >= qs.length) {                     // every search done and nothing fits
          if (r.pin || r.rounds) {                   // it was there before: its sharers are just offline right now
            await save({ stage: 'wait', nextAt: Date.now() + AGAIN_MS, rounds: r.rounds + 1, s: { life: 'Running', phase: 'Waiting' } });
            return false;
          }
          return finish({ outcome: 'Failed', fail: r.raw ? (r.other ? 'OnlyOtherVersions' : 'NoMatchingResults') : 'NoSearchResults' });
        }
        const j = await api('/api/jobs/search/tracks', { songQuery: qs[r.qi], options: optionsFor(settings, r.folder, r.quality) });
        await save({ sj: j.jobId, s: { life: 'Running', phase: 'Searching' } });
        await markTrack(r, { state: 'running' });
        return true;
      }
      let detail;
      try { detail = await getJob(r.sj); } catch (e) { if (e.notFound) { await save({ sj: '' }); return true; } throw e; }
      const sum = detail.summary || {}, p = detail.payload || {};
      if (sum.lifecycleState !== 'Terminal' && !p.isComplete) {
        const s = { life: 'Running', phase: sum.activityPhase || 'Searching', until: sum.activityUntilUtc || '' };
        if (JSON.stringify(s) !== JSON.stringify(r.s)) await save({ s });
        return true;
      }
      const items = (await results(r.sj).catch(() => null))?.items || [];
      const { list, other } = rank(items, wantFor(r.track), r.quality, r.pin);
      const seen = new Set(r.cands.map(c => c.user + '\n' + c.file));
      const cands = [...r.cands, ...list.filter(x => !seen.has(x.c.username + '\n' + x.c.filename)).map(x => candOf(x.c, x.r, r.sj, x.tier))]
        .sort((a, b) => a.tier - b.tier || b.score - a.score).slice(0, 60);
      await save({ cands, raw: r.raw + items.length, other: r.other + other, sj: '', qi: r.qi + 1 });
      if (!cands.length) return true;                 // nothing fits yet: next, wider search
      await save({ stage: 'download', idx: -1 });
      return startNext();
    }

    if (r.stage === 'download') {
      if (!r.dlJob) return startNext();
      let s;
      try { s = snap(await getJob(r.dlJob)); } catch (e) { if (e.notFound) { await research(); return true; } throw e; }
      const c = r.cands[r.idx] || {};
      const extra = { n: r.idx + 1, of: r.cands.length, user: c.user, ext: c.ext || s.ext, total: s.total || c.size };
      if (isDone(s)) {
        if (s.outcome === 'Succeeded' || s.outcome === 'Skipped') return finish({ ...s, ...extra });
        // a hard failure (offline, refused, couldn't connect): leave this user alone for this round, try the next file
        await save({ bad: [...r.bad, c.user], lastFail: s.failMsg || s.fail || '', dlJob: '' });
        return startNext();
      }
      const now = Date.now(), bytes = s.bytes || 0, p = { lastBytes: bytes, lastAt: now };
      if (bytes > (r.lastBytes || 0)) {
        const v = (bytes - (r.lastBytes || 0)) / Math.max(0.5, (now - (r.lastAt || now)) / 1000);
        p.speed = r.speed ? r.speed * 0.6 + v * 0.4 : v;
        p.moved = now;
      }
      await save({ ...p, s: { ...s, ...extra, since: r.since, moved: p.moved || r.moved, speed: p.speed ?? r.speed ?? 0 } });
      if (s.life === 'Running') await markTrack(r, { state: 'running' });
      return true;
    }
    return false;
  }

  /* releases (and downloads started by older versions) are plain Sockseek jobs: just follow them */
  async function stepJob(r, started, settings) {
    try {
      const s = snap(await getJob(r.id));
      await updateJob(r.id, { s, misses: 0, firstMiss: 0 });
      if (isDone(s)) await syncTrack({ ...r, s });
      else if (s.life === 'Running') await markTrack(r, { state: 'running' });
    } catch (e) {
      if (!e.notFound) throw e;
      // Only give up on a job if Sockseek really restarted (its start time changed), or it's been missing for over a minute.
      const misses = (r.misses || 0) + 1;
      const restarted = started && r.ss && r.ss !== started;
      if (!restarted && !(misses >= 5 && Date.now() - (r.firstMiss || Date.now()) > 60000)) {
        await updateJob(r.id, { misses, firstMiss: r.firstMiss || Date.now() });
        return true;
      }
      await updateJob(r.id, { lost: true });
      const st = await CD.load(), t = st.playlists[r.plId]?.tracks.find(x => x.id === r.trackId);
      if (t && isRelease(t) && t.dl?.jobId === r.id) {          // releases start again by themselves, into the same folder
        const { summary } = await submit(t, settings, r.quality, st.playlists[r.plId]?.name, r.folder);
        await addJob({ ...r, id: summary.jobId, ss: started, created: Date.now(), misses: 0, firstMiss: 0, lost: false, s: { life: summary.lifecycleState } });
        await CD.setDownload(r.plId, r.trackId, { state: 'queued', jobId: summary.jobId, reason: '' });
      } else await markTrack(r, { state: 'failed', reason: 'Sockseek was restarted' });
    }
    return true;
  }

  /* One pass over every unfinished download. True = something is moving, so check again in a couple of seconds. */
  async function tick() {
    const d = await loadJobs();
    const live = d.order.map(id => d.jobs[id]).filter(r => r && !isDone(r.s) && !r.lost && r.kind !== 'search');
    if (!live.length) return false;
    const { settings } = await CD.load();
    setBase(settings.ssUrl);
    let started;
    try { started = (await info())?.startedAtUtc || ''; } catch (e) { return false; }   // Sockseek isn't running: the alarm looks again soon
    let busy = false;
    for (const r of live) {
      try { if (await (r.task ? stepTask(r, started, settings) : stepJob(r, started, settings))) busy = true; }
      catch (e) { if (e.offline) return false; console.warn('Crate Digger download', r.label, e); busy = true; }
    }
    return busy;
  }
  const command = async (id, cmd) => { await updateJob(id, { cmd }); kick(); };

  /* "Choose a file myself": a task that only ever downloads that file (waiting for its owner if needed) */
  async function sendPick(t, plId, c, searchJobId, settings, quality, plName, ss) {
    const r = rate(c, 0);
    const rec = newTask(t, { plId, label: `${t.artist || 'Unknown artist'} – ${t.title || 'Untitled'}`, quality, folder: folderFor(settings, plName), ss,
      pin: { user: c.username, file: c.filename }, cands: [candOf(c, r, searchJobId, 0)] });
    await addJob(rec);
    await CD.setDownload(plId, t.id, { state: 'queued', jobId: rec.id, reason: '' });
    kick();
    return rec;
  }

  function describeTask(r, now) {
    const s = r.s || {};
    const mins = t => { const m = Math.max(0, Math.round((now - (t || now)) / 60000)); return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
    const which = s.of ? ` · ${String(s.ext || '').toUpperCase()} · file ${s.n} of ${s.of}` : '';
    if (r.stage === 'wait') {
      const left = Math.max(1, Math.ceil(((r.nextAt || now) - now) / 60000));
      const tried = r.tried ? ` (${r.tried} file${r.tried === 1 ? '' : 's'} tried)` : '';
      return { text: `Everyone sharing it is offline or refused${tried} · searching again in ${left} min`, cls: 'wait', icon: '⏸', word: 'Waiting', again: true };
    }
    if (r.stage !== 'download') {
      if (s.phase === 'SearchRateLimited') {
        const secs = s.until ? Math.max(0, Math.round((Date.parse(s.until) - now) / 1000)) : null;
        return { text: `Paused for Soulseek’s search limit${secs != null ? `, resumes in ${secs}s` : ''}`, cls: 'wait', icon: '⏸', word: 'Paused' };
      }
      if (!s.life || s.life === 'Pending' || s.phase === 'WaitingForSearchConcurrency') return { text: 'Waiting to search', cls: 'wait', icon: '⏸', word: 'Waiting' };
      return r.qi > 0 ? { text: 'Trying a wider search…', cls: 'run', icon: '↻', word: 'Retrying' } : { text: 'Searching Soulseek…', cls: 'run', icon: '⌕', word: 'Searching' };
    }
    const ts = s.ts || '', pct = s.pct != null ? Math.floor(s.pct) : null;
    if (s.phase === 'Organizing') return { text: 'Saving…', cls: 'run', icon: '⬇', word: 'Saving' };
    if (/Queued/i.test(ts) && !s.bytes) return { text: `in ${s.user || 'the user'}’s upload queue · waiting ${mins(s.since)}${which}`, cls: 'wait', icon: '⏸', word: 'Queued', next: true };
    if (s.bytes > 0 || /InProgress/i.test(ts)) {
      if (s.moved && now - s.moved > 120000) return { text: `at ${pct ?? 0}%, no data for ${mins(s.moved)}, still waiting${which}`, cls: 'wait', icon: '⏸', word: 'Stalled', pct, next: true };
      return { text: `${pct != null ? pct + '%' : '…'}${s.speed ? ` · ${(s.speed / 1e6).toFixed(1)} MB/s` : ''}${which}`, cls: 'run', icon: '⬇', word: 'Downloading', pct, next: true };
    }
    return { text: `asking ${s.user || 'the user'} for the file${which}`, cls: 'run', icon: '⬇', word: 'Starting', next: true };
  }

  return { needsCheck, sendTracks, QUALITY, LOSSLESS, setBase, info, status, getJob, cancel, nextCandidate, results, submit, search, downloadFile,
    folderFor, safeName, localDate, loadJobs, addJob, updateJob, removeJobs, snap, isDone, describe, rate, mb, isRelease,
    wantFor, matchFile, rank, queriesFor, tick, command, sendPick, kick };
})();
