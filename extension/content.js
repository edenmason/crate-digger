/* Crate Digger — in-page save button + toast + message handling */
(() => {
  // Skip if a live copy is already running (re-init after the extension is reloaded/updated)
  if (window.__cdAlive && window.__cdAlive()) return;
  document.getElementById('crate-digger-host')?.remove();
  window.__cdAlive = () => { try { return !!chrome.runtime?.id; } catch (e) { return false; } };

  const AUTO = /(^|\.)(bandcamp|soundcloud|youtube|discogs)\.com$/.test(location.hostname) || !!document.querySelector('script[data-tralbum]');
  const CSS = `
    :host { all: initial; }
    .btn { position: fixed; right: 18px; bottom: 96px; z-index: 2147483646; width: 46px; height: 46px; border-radius: 50%;
      border: 2px solid #f2a33a; background: radial-gradient(circle at 50% 50%, #f2a33a 0 6px, #111 7px 100%);
      box-shadow: 0 4px 14px rgba(0,0,0,.45); cursor: pointer; color: #fff; font: 700 13px/1 system-ui, sans-serif;
      display: flex; align-items: flex-end; justify-content: flex-end; padding: 0; transition: transform .12s; }
    .btn:hover { transform: scale(1.08); }
    .btn:active { transform: scale(.95); }
    .btn span { background: #f2a33a; color: #111; border-radius: 50%; width: 18px; height: 18px; display: flex;
      align-items: center; justify-content: center; margin: -4px -4px 0 0; font-size: 15px; }
    .toast { position: fixed; right: 18px; bottom: 152px; z-index: 2147483647; max-width: 320px; padding: 10px 14px;
      border-radius: 10px; background: #161616; color: #f4f1ea; border-left: 4px solid #f2a33a;
      font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.4); opacity: 0; transform: translateY(8px);
      transition: opacity .2s, transform .2s; pointer-events: none; }
    .toast.show { opacity: 1; transform: none; }
    .toast.bad { border-left: 6px double #E58FC4; }
    .viewer { position: fixed; left: 18px; bottom: 18px; z-index: 2147483646; font: 13px/1.4 system-ui, sans-serif;
      color: #f4f1ea; width: 360px; max-width: calc(100vw - 36px); }
    .vhead { display: inline-flex; align-items: center; gap: 8px; background: #111; border: 2px solid #f2a33a; color: #f4f1ea;
      border-radius: 999px; padding: 7px 14px; cursor: pointer; font: 600 13px/1 system-ui, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,.45); }
    .vhead .yt { background: #f00; color: #fff; border-radius: 4px; padding: 2px 5px; font-size: 11px; }
    .vbody { display: none; margin-bottom: 8px; background: #161616; border: 1px solid #333; border-radius: 12px;
      box-shadow: 0 8px 26px rgba(0,0,0,.5); max-height: 60vh; overflow-y: auto; }
    .viewer.open .vbody { display: block; }
    .vtop { display: flex; gap: 6px; padding: 10px; border-bottom: 1px solid #2a2a2a; position: sticky; top: 0; background: #161616; }
    .vtop a, .vtop button { flex: 1; text-align: center; text-decoration: none; background: #f2a33a; color: #111; border: 0;
      border-radius: 7px; padding: 7px 8px; font: 600 12px/1.2 system-ui, sans-serif; cursor: pointer; }
    .vtop button { background: #2a2a2a; color: #f4f1ea; }
    .vrow { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid #222; }
    .vrow:last-child { border-bottom: 0; }
    .vpos { color: #8d877c; width: 26px; flex: none; font-size: 12px; }
    .vtitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vtitle small { color: #8d877c; }
    .vrow a, .vrow button { flex: none; text-decoration: none; border: 0; cursor: pointer; border-radius: 6px;
      padding: 4px 8px; font: 600 12px/1.2 system-ui, sans-serif; }
    .vplay { background: #c00; color: #fff; }
    .vsearch { background: #2a2a2a; color: #ccc; }
    .vsc { background: #ff5500; color: #fff; }
    .vrow.now { background: #2a2111; box-shadow: inset 3px 0 0 #f2a33a; }
    .vrow.now .vpos::after { content: '♪'; color: #f2a33a; margin-left: 2px; }
    .vsave { background: #2a2a2a; color: #f2a33a; }
    .vsave.done, .vsave.saved { background: #56B4E9; color: #06243a; font-weight: 800; }
    .btn.saved { border: 3px double #56B4E9; }
    .btn.saved span { background: #56B4E9; color: #06243a; font-weight: 900; }
    .vtop button.saved { background: #56B4E9; color: #06243a; }
    .vsec { padding: 8px 10px 4px; color: #8d877c; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; }`;

  let host, root, btn, mark, toastEl, timer, viewer;
  function build() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'crate-digger-host';
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    btn = document.createElement('button');
    btn.className = 'btn';
    btn.title = 'Save to Crate Digger (Alt+Shift+S)';
    mark = document.createElement('span');
    mark.textContent = '+';
    btn.append(mark);
    btn.style.display = 'none';
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); quickSave(); });
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    root.append(style, btn, toastEl);
    (document.body || document.documentElement).append(host);
  }
  function applyButton(show) { build(); btn.style.display = show && AUTO ? '' : 'none'; }
  function toast(msg, ok = true) {
    build();
    toastEl.textContent = (!ok && !/^[⚠✕✓ⓘ]/.test(msg) ? '⚠ ' : '') + msg;
    toastEl.className = 'toast show' + (ok ? '' : ' bad');
    clearTimeout(timer);
    timer = setTimeout(() => { toastEl.className = 'toast' + (ok ? '' : ' bad'); }, 2800);
  }
  const describe = it => it.type === 'release' ? `${it.artist} – ${it.release}` : `${it.artist} – ${it.title}`;

  async function quickSave() {
    if (!window.__cdAlive()) return toast('Crate Digger was updated — refresh this page', false);
    try {
      const r = await window.CDExtract();
      const items = (r.defaults || []).map(i => r.items[i]).filter(Boolean);
      if (!items.length) return toast('Nothing to save on this page', false);
      const res = await chrome.runtime.sendMessage({ type: 'cd-add', items });
      if (!res || res.error) return toast('Could not save' + (res?.error ? ': ' + res.error : ''), false);
      const what = items.length === 1 ? describe(items[0]) : `${items.length} items`;
      toast(res.added ? `✓ Saved to “${res.playlist}”: ${what}` : `ⓘ Already in “${res.playlist}”: ${what}`, !!res.added);
    } catch (e) { toast('Could not save: ' + e.message, false); }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (msg.type === 'cd-ping') { send({ ok: true }); return; }
    if (msg.type === 'cd-extract') { window.CDExtract().then(send).catch(e => send({ error: String(e) })); return true; }
    if (msg.type === 'cd-quicksave') { quickSave(); send({ ok: true }); }
  });

  /* ---------- Discogs track viewer: plays the release's videos on youtube.com (Premium, no ads) ---------- */
  const ON_DISCOGS = /(^|\.)discogs\.com$/.test(location.hostname);
  let viewerOn = true, viewerPath = '', viewerOpen = false, viewerResult = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const link = (cls, text, href, title) => { const a = el('a', cls, text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; if (title) a.title = title; return a; };
  const ytSearch = it => 'https://www.youtube.com/results?search_query=' +
    encodeURIComponent(`${it.artist || ''} ${it.title || it.release || ''}`.replace(/[\[\](){}"]/g, ' ').replace(/\s+/g, ' ').trim());

  function renderViewer(r) {
    build();
    viewer?.remove();
    viewer = null;
    if (!viewerOn || !r || r.source !== 'Discogs') return;
    const tracks = r.items.filter(i => i.type === 'track' && !i.fromVideo);
    const videoOnly = r.items.filter(i => i.fromVideo);
    const release = r.items.find(i => i.type === 'release');
    if (!tracks.length && !(r.videos || []).length) return;

    viewer = el('div', 'viewer' + (viewerOpen ? ' open' : ''));
    const body = el('div', 'vbody');
    const top = el('div', 'vtop');
    if (r.allUrl) top.append(link('', `▶ Play all on YouTube (${r.videos.length})`, r.allUrl, 'Opens every video from this release as a YouTube queue'));
    else top.append(link('', '▶ Search release on YouTube', release ? ytSearch({ artist: release.artist, title: release.release }) : '#'));
    const relWhere = release ? CD.findSaved(cdState, release) : [];
    const saveAll = el('button', relWhere.length ? 'saved' : '', relWhere.length ? CD.savedLabel(relWhere) : '+ Save release');
    if (relWhere.length) saveAll.title = 'Already in: ' + relWhere.map(w => w.name).join(', ');
    saveAll.addEventListener('click', () => save([release], saveAll));
    if (release) top.append(saveAll);
    body.append(top);

    const row = (t, label, sub) => {
      const r = el('div', 'vrow' + (t.nowPlaying ? ' now' : ''));
      r.append(el('span', 'vpos', t.position || ''));
      const title = el('span', 'vtitle', label);
      if (sub) { title.append(' '); title.append(el('small', '', sub)); }
      title.title = t.videoTitle ? `YouTube video: ${t.videoTitle}` : `${t.artist} – ${t.title}`;
      r.append(title);
      if (t.video) r.append(link('vplay', '▶', t.video, t.videoTitle ? `Play “${t.videoTitle}” on YouTube` : 'Play on YouTube'));
      else r.append(link('vsearch', '⌕', ytSearch(t), 'No video on Discogs — search YouTube'));
      r.append(link('vsc', '☁', 'https://soundcloud.com/search/sounds?q=' +
        encodeURIComponent(`${t.artist || ''} ${t.title || ''}`.replace(/[\[\](){}"]/g, ' ').replace(/\s+/g, ' ').trim()), 'Search on SoundCloud'));
      const where = CD.findSaved(cdState, t);
      const s = el('button', 'vsave' + (where.length ? ' saved' : ''), where.length ? '✓' : '+');
      s.title = where.length ? `Already in: ${where.map(w => w.name).join(', ')}. Click to also add it to your current playlist` : 'Save just this one to Crate Digger';
      s.addEventListener('click', () => save([t], s));
      r.append(s);
      return r;
    };

    if (tracks.length) body.append(el('div', 'vsec', 'Tracklist'));
    for (const t of tracks) {
      body.append(row(t, t.title, t.artist && release && t.artist !== release.artist ? `– ${t.artist}` : ''));
    }
    if (videoOnly.length) {
      body.append(el('div', 'vsec', 'Other mixes & videos on this release'));
      for (const t of videoOnly) body.append(row(t, t.title, release && t.artist !== release.artist ? `– ${t.artist}` : ''));
    }

    const head = el('button', 'vhead');
    head.append(el('span', 'yt', '▶'), `Tracks on YouTube · ${(r.videos || []).length} video${(r.videos || []).length === 1 ? '' : 's'}`);
    head.addEventListener('click', () => { viewerOpen = !viewerOpen; viewer.classList.toggle('open', viewerOpen); });
    viewer.append(body, head);
    root.append(viewer);
  }

  async function save(items, button) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'cd-add', items: items.filter(Boolean) });
      if (!res || res.error) return toast('Could not save', false);
      button.textContent = '✓';
      button.classList.add('done');
      toast(res.added ? `✓ Saved to “${res.playlist}”` : `ⓘ Already in “${res.playlist}”`, !!res.added);
    } catch (e) { toast('Crate Digger was updated — refresh this page', false); }
  }

  async function checkDiscogs(force) {
    const path = location.pathname;
    if (!force && path === viewerPath) return;
    viewerPath = path;
    if (!/\/(release|master)\/\d+/.test(path)) return renderViewer(null);
    const r = await window.CDExtract();
    if (location.pathname === path) { viewerResult = r; renderViewer(r); lastResult = r; paintSaved(); }
  }

  if (ON_DISCOGS) setInterval(() => { if (window.__cdAlive()) checkDiscogs(false); }, 1000); // Discogs changes pages without reloading

  /* ---------- "already in a playlist?" on the floating button, the toolbar icon and the viewer ---------- */
  let cdState = null, lastResult = null, lastSig = '', refreshing = false;
  const nowPlayingSig = () => {
    const q = sel => document.querySelector(sel);
    return [q('.playbackSoundBadge__titleLink')?.getAttribute('href'), q('.inline_player .title')?.textContent,
      q('ytmusic-player-bar .title')?.textContent, q('.inline_player .playbutton.playing') ? 'p' : ''].join('|');
  };
  function paintSaved() {
    if (!lastResult || !cdState) return;
    const items = (lastResult.defaults || []).map(i => lastResult.items[i]).filter(Boolean);
    const found = items.map(it => CD.findSaved(cdState, it));
    const all = items.length > 0 && found.every(f => f.length);
    const names = [...new Set(found.flat().map(w => w.name))];
    if (btn) {
      btn.classList.toggle('saved', all);
      mark.textContent = all ? '✓' : '+';
      btn.title = all ? `✓ Already in: ${names.join(', ')}. Click to also add it to your current playlist (Alt+Shift+S)` : 'Save to Crate Digger (Alt+Shift+S)';
    }
    try { chrome.runtime.sendMessage({ type: 'cd-badge', text: all ? '✓' : '', title: all ? `Crate Digger: ✓ already in ${names.join(', ')}` : 'Crate Digger' }); } catch (e) {}
  }
  async function refreshSaved(force) {
    if (refreshing || !window.__cdAlive()) return;
    const sig = location.href + '|' + nowPlayingSig();
    if (!force && sig === lastSig) return;
    lastSig = sig;
    if (ON_DISCOGS) { if (viewerResult && viewerPath === location.pathname) { lastResult = viewerResult; paintSaved(); } return; } // the viewer reads Discogs
    refreshing = true;
    try { lastResult = await window.CDExtract(); paintSaved(); } catch (e) {} finally { refreshing = false; }
  }
  if (AUTO) setInterval(() => refreshSaved(false), 1500);

  const applySettings = st => {
    if (AUTO) applyButton(st?.showButton !== false);
    const on = st?.showViewer !== false;
    if (ON_DISCOGS && on !== viewerOn) { viewerOn = on; checkDiscogs(true); }
  };
  if (AUTO) chrome.storage.local.get('cd_state').then(r => { cdState = r.cd_state; applySettings(cdState?.settings); refreshSaved(true); });
  chrome.storage.onChanged.addListener(ch => {
    if (!ch.cd_state) return;
    cdState = ch.cd_state.newValue;
    applySettings(cdState?.settings);
    paintSaved();
    if (viewerResult && viewer) renderViewer(viewerResult);   // redraw ✓ marks in the Discogs viewer
  });
})();
