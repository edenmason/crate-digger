/* Crate Digger — Sockseek connection (talks to `sockseek daemon` running on this Mac) */
const SS = (() => {
  const LOSSLESS = ['flac', 'wav', 'aiff', 'aif'];
  const QUALITY = {
    lossless:    { label: 'Lossless only (FLAC / WAV / AIFF)', formats: LOSSLESS },
    lossless320: { label: 'Lossless, or MP3 320 if that’s all there is', formats: [...LOSSLESS, 'mp3'], minBitrate: 320 },
    any:         { label: 'Any quality (lossless ranked first)', formats: [...LOSSLESS, 'mp3', 'm4a', 'alac', 'ogg', 'opus'] }
  };
  const DL_KEY = 'cd_dl';

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
  function folderFor(settings, d) {
    const b = String(settings.dlBase || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    return settings.dlDateFolders !== false ? `${b}/${localDate(d)}` : b;
  }
  function optionsFor(settings, folder, quality, { album = false } = {}) {
    const q = QUALITY[quality || settings.dlQuality] || QUALITY.lossless;
    const necessary = { formats: { replace: q.formats }, lengthTolerance: -1 };   // length never rejects a file…
    if (q.minBitrate) necessary.minBitrate = q.minBitrate;
    const preferred = { formats: { replace: LOSSLESS }, lengthTolerance: 3 };     // …it only ranks the closest match first
    const o = { downloadSettings: { search: { necessaryCond: necessary, preferredCond: preferred } } };
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

  async function submit(t, settings, quality) {
    const folder = folderFor(settings);
    const album = isRelease(t);
    const options = optionsFor(settings, folder, quality, { album });
    const s = album
      ? await api('/api/jobs/downloads/album', { albumQuery: { artist: clean(t.artist), album: clean(t.release) }, options })
      : await api('/api/jobs/downloads/song', { songQuery: songQuery(t), options });
    return { summary: s, folder };
  }
  async function search(t, settings, quality) {
    const options = optionsFor(settings, folderFor(settings), quality);
    return api('/api/jobs/search/tracks', { songQuery: songQuery(t), options });
  }
  async function downloadFile(searchJobId, ref, settings, quality) {
    const folder = folderFor(settings);
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
    const d = await loadJobs();
    const busy = new Set(d.order.map(id => d.jobs[id]).filter(r => r && !isDone(r.s) && !r.lost).map(r => r.trackId));
    let sent = 0, skipped = 0, failed = 0, lastErr = '', offline = false;
    let i = 0;
    for (const t of tracks) {
      onProgress?.(++i, tracks.length);
      if (busy.has(t.id) || (!force && t.dl?.state === 'done') || !(t.artist || t.title || t.release)) { skipped++; continue; }
      try {
        const { summary, folder } = await submit(t, settings, q);
        const lbl = isRelease(t) ? `${t.artist || 'Unknown artist'} – ${t.release || 'Untitled'}` : `${t.artist || 'Unknown artist'} – ${t.title || 'Untitled'}`;
        await addJob({ id: summary.jobId, plId, trackId: t.id, label: lbl, kind: summary.kind, quality: q, folder, ss: started,
          created: Date.now(), s: { life: summary.lifecycleState, phase: summary.activityPhase } });
        await CD.setDownload(plId, t.id, { state: 'queued', jobId: summary.jobId, reason: '' });
        sent++;
      } catch (e) { failed++; lastErr = e.message; if (e.offline) { offline = true; break; } }
    }
    return { sent, skipped, failed, lastErr, offline };
  }

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
      user: p.resolvedUsername || '', file: p.resolvedFilename || '',
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
      case 'InvalidSearchString': return { text: 'Search was empty, so check the artist/title', cls: 'bad' };
      default: return { text: s.failMsg || 'Failed', cls: 'bad', canPick: true };
    }
  }

  /* Every state gets an icon + a word + a shape (see popup.css), so nothing relies on colour alone. */
  function describe(rec, now = Date.now()) {
    const d = describeRaw(rec, now), s = rec.s || {};
    const set = (icon, word) => Object.assign(d, { icon, word });
    if (rec.lost) return set('✕', 'Stopped');
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

  /* ---------- ranking candidates when you choose a file yourself ---------- */
  const LOSSY_RIP = /\b(youtube|yt ?rip|\byt\b|radio ?rip|preview|snippet|sample)\b/i;
  function rate(c, wantLen) {
    const ext = String(c.extension || c.filename.split('.').pop() || '').replace('.', '').toLowerCase();
    const lossless = LOSSLESS.includes(ext);
    const len = Number(c.length) || 0;
    const mbPerMin = len ? c.size / 1e6 / (len / 60) : null;
    const notes = [];
    let score = lossless ? 100 : ext === 'mp3' && (c.bitRate >= 320 || (mbPerMin && mbPerMin > 2.2)) ? 60 : 30;

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

    if (c.peer?.hasFreeUploadSlot) score += 8; else notes.push({ t: 'User has a queue' });
    if (c.peer?.uploadSpeed) score += Math.min(8, c.peer.uploadSpeed / 250000);
    return { ext, lossless, len, score, notes };
  }

  return { needsCheck, sendTracks, QUALITY, LOSSLESS, setBase, info, status, getJob, cancel, nextCandidate, results, submit, search, downloadFile,
    folderFor, localDate, loadJobs, addJob, updateJob, removeJobs, snap, isDone, describe, rate, mb, isRelease };
})();
