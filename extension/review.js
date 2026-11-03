/* Crate Digger: review page. A spreadsheet of the playlist to check names before downloading. */
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
const line = it => SS.isRelease(it) ? `${it.artist || 'Unknown artist'} – ${it.release || 'Untitled'}` : `${it.artist || 'Unknown artist'} – ${it.title || 'Untitled'}`;
function snack(msg, bad) {
  const s = $('snack');
  s.textContent = (bad && !/^[⚠✕✓ⓘ]/.test(msg) ? '⚠ ' : '') + msg;
  s.className = 'snack' + (bad ? ' bad' : '');
  clearTimeout(snack.t); snack.t = setTimeout(() => { s.className = 'snack hidden'; }, 3200);
}

let state, pl, rows = [], filter = 'all', windowId = null, busy = new Set();

/* one row per track: the original, the tidied suggestion, and what's in the boxes now */
function makeRow(t, i) {
  const rel = SS.isRelease(t);
  const tidied = CD.tidy(t).item;
  const r = { t, i, rel, tidied, done: t.dl?.state === 'done', busy: busy.has(t.id) };
  r.inc = !r.done && !r.busy;
  r.fA = h('input', { value: tidied.artist || '', placeholder: 'Artist', 'aria-label': `Artist, row ${i + 1}` });
  r.fT = h('input', { value: (rel ? tidied.release : tidied.title) || '', placeholder: rel ? 'Release name' : 'Title', 'aria-label': `Title, row ${i + 1}` });
  r.cb = h('input', { type: 'checkbox', checked: r.inc, disabled: r.busy, 'aria-label': `Download row ${i + 1}` });
  r.cb.addEventListener('change', () => { r.inc = r.cb.checked; paintRow(r); counts(); });
  for (const f of [r.fA, r.fT]) {
    f.addEventListener('input', () => { paintRow(r); counts(); });
    f.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); moveDown(r, f === r.fA ? 'fA' : 'fT', e.shiftKey ? -1 : 1); } });
  }
  r.st = h('td', { class: 'c-st' });
  r.q = h('code', {});
  r.why = h('div', { class: 'why' });
  r.reset = h('button', { class: 'reset', title: 'Put back the original name', onclick: () => { r.fA.value = t.artist || ''; r.fT.value = (rel ? t.release : t.title) || ''; paintRow(r); counts(); } }, '↺');
  r.tr = h('tr', {},
    h('td', { class: 'c-inc' }, r.cb),
    h('td', { class: 'c-num' }, i + 1),
    r.st,
    h('td', { class: 'c-a' }, r.fA),
    h('td', { class: 'c-t' }, r.fT, r.why),
    h('td', { class: 'c-q' }, r.q),
    h('td', { class: 'c-x' }, r.reset));
  return r;
}
const current = r => ({ ...r.t, ...r.tidied, artist: r.fA.value.trim(), [r.rel ? 'release' : 'title']: r.fT.value.trim() });
const changedFromSaved = r => r.fA.value.trim() !== (r.t.artist || '') || r.fT.value.trim() !== ((r.rel ? r.t.release : r.t.title) || '');
function paintRow(r) {
  const cur = current(r), why = SS.needsCheck(cur);
  r.needs = why.length > 0;
  const tag = r.busy ? ['busy', '⬇', 'In progress'] : r.done ? ['ok', '✓', 'Downloaded'] : r.needs ? ['warn', '⚠', 'Check'] : ['ready', '•', 'Ready'];
  r.st.replaceChildren(h('span', { class: `tag t-${tag[0]}`, title: why.join('\n') }, h('i', {}, tag[1]), tag[2]));
  r.why.replaceChildren(...why.map(w => h('div', {}, '⚠ ', w)));
  r.q.textContent = CD.searchQuery(cur) || '(nothing to search)';
  const edited = changedFromSaved(r);
  r.fA.classList.toggle('edited', r.fA.value.trim() !== (r.t.artist || ''));
  r.fT.classList.toggle('edited', r.fT.value.trim() !== ((r.rel ? r.t.release : r.t.title) || ''));
  r.fA.title = r.fA.classList.contains('edited') ? `✎ Was: ${r.t.artist || '(empty)'}` : '';
  r.fT.title = r.fT.classList.contains('edited') ? `✎ Was: ${(r.rel ? r.t.release : r.t.title) || '(empty)'}` : '';
  r.reset.style.visibility = edited ? 'visible' : 'hidden';
  r.tr.className = [r.inc ? 'inc' : 'skip', r.needs && !r.done && !r.busy ? 'needs' : '', r.done ? 'is-done' : '', r.busy ? 'is-busy' : ''].join(' ');
}
const shown = r => filter === 'all' || (filter === 'check' && r.needs && !r.done && !r.busy) || (filter === 'todo' && !r.done);
function render() {
  const list = rows.filter(shown);
  $('rows').replaceChildren(...list.map(r => r.tr));
  $('empty').classList.toggle('hidden', list.length > 0);
  $('incAll').checked = list.length > 0 && list.filter(r => !r.busy).every(r => r.inc);
  counts();
}
function counts() {
  $('cAll').textContent = rows.length;
  $('cCheck').textContent = rows.filter(r => r.needs && !r.done && !r.busy).length;
  $('cTodo').textContent = rows.filter(r => !r.done).length;
  const n = rows.filter(r => r.inc && !r.busy).length;
  const looks = rows.filter(r => r.inc && r.needs && !r.busy).length;
  $('goBtn').textContent = n ? `⬇ Download ${n} track${n === 1 ? '' : 's'}` : '⬇ Download';
  $('goBtn').disabled = !n;
  $('goBtn').title = looks ? `${looks} ticked track${looks === 1 ? '' : 's'} still marked ⚠ Check. They'll be searched as shown.` : '';
}
function moveDown(r, key, dir) {
  const list = rows.filter(shown), i = list.indexOf(r), next = list[i + dir];
  if (next) { next[key].focus(); next[key].select(); }
}

/* ---------- saving + downloading ---------- */
async function saveNames(onlyChanged = true) {
  const edits = rows.filter(r => !onlyChanged || changedFromSaved(r)).map(r => {
    const c = current(r);
    return { id: r.t.id, patch: { artist: c.artist, title: c.title, release: c.release, label: c.label, catno: c.catno, releaseDate: c.releaseDate } };
  });
  return edits.length ? CD.updateTracks(pl.id, edits) : 0;
}
async function download() {
  // open the side panel straight away (it has to happen inside the click), on its Download tab
  if (state.settings.openIn !== 'popup' && windowId != null) {
    chrome.storage.local.set({ cd_open_tab: 'dl' });
    chrome.sidePanel.open({ windowId }).catch(() => {});
  }
  const pick = rows.filter(r => r.inc && !r.busy);
  if (!pick.length) return;
  $('goBtn').disabled = true; $('goBtn').textContent = 'Saving names…';
  await saveNames();
  if ($('skipNext').checked) await CD.saveSettings({ checkPlaylist: false });
  state = await CD.load();
  const res = await SS.sendTracks(pick.map(current), pl.id, state.settings, { quality: $('quality').value, force: true,
    onProgress: (i, n) => { $('goBtn').textContent = `Sending ${i} of ${n}…`; } });
  if (res.offline) { counts(); showConn(false); return snack('✕ Sockseek isn’t running, so nothing was sent. Start it and press Download again.', true); }
  $('grid').classList.add('hidden'); $('empty').classList.add('hidden'); document.querySelector('.filters').classList.add('hidden');
  document.querySelector('.bar').classList.add('hidden');
  $('done').classList.remove('hidden');
  $('done').replaceChildren(...[
    h('div', { class: 'done-icon' }, '✓'),
    h('h2', {}, `Sent ${res.sent} track${res.sent === 1 ? '' : 's'} to Sockseek`),
    h('p', {}, res.skipped ? `${res.skipped} skipped (already downloading). ` : '', res.failed ? `⚠ ${res.failed} couldn’t be sent: ${res.lastErr}. ` : '',
      'Follow progress in the Crate Digger panel → ', h('b', {}, 'Download'), ' tab. Anything that isn’t found shows under ', h('b', {}, '⚠ Needs attention'), '.'),
    $('skipNext').checked ? h('p', { class: 'muted' }, 'ⓘ This page won’t open next time. Turn it back on in the Download tab’s ⚙.') : null,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => window.close() }, 'Close this tab'))].filter(Boolean));
}

/* ---------- connection banner ---------- */
function showConn(on) {
  const c = $('conn');
  if (on) { c.className = 'conn hidden'; return; }
  c.className = 'conn off';
  c.replaceChildren(h('span', { class: 'ci' }, '✕'), h('div', {}, h('b', {}, 'Sockseek isn’t running. '), state.settings.ssHint || 'Double-click Start Sockseek (Seagate → Programs → Crate Digger → Sockseek). You can still check and save names now.'),
    h('button', { onclick: checkConn }, 'Check again'));
}
async function checkConn() {
  SS.setBase(state.settings.ssUrl);
  try { await SS.info(); showConn(true); } catch (e) { showConn(false); }
}

/* ---------- start ---------- */
(async () => {
  try { windowId = (await chrome.windows.getCurrent()).id; } catch (e) {}
  state = await CD.load();
  const id = new URLSearchParams(location.search).get('pl');
  pl = state.playlists[id] || state.playlists[state.activeId];
  document.title = `Check: ${pl.name}`;
  $('plName').textContent = `⬇ ${pl.name}`;
  const jobs = await SS.loadJobs();
  busy = new Set(jobs.order.map(j => jobs.jobs[j]).filter(r => r && !SS.isDone(r.s) && !r.lost).map(r => r.trackId));
  rows = pl.tracks.map(makeRow);
  rows.forEach(paintRow);

  const tidiedRows = rows.filter(r => changedFromSaved(r));
  if (tidiedRows.length) {
    const note = $('tidyNote');
    note.classList.remove('hidden');
    note.replaceChildren(h('span', {}, `✎ Tidied ${tidiedRows.length} name${tidiedRows.length === 1 ? '' : 's'} for you (cat numbers, [labels], track numbers, junk). Hover a ✎ box to see the old name. `),
      h('button', { class: 'link', onclick: () => { for (const r of tidiedRows) r.reset.click(); note.classList.add('hidden'); } }, '↺ Undo all tidying'));
  }
  const qs = $('quality');
  qs.replaceChildren(...Object.entries(SS.QUALITY).map(([k, v]) => h('option', { value: k }, v.label)));
  qs.value = state.settings.dlQuality || 'lossless';
  qs.addEventListener('change', () => CD.saveSettings({ dlQuality: qs.value }));
  $('folder').textContent = SS.folderFor(state.settings, pl.name) || 'Not set: choose one in the Download tab’s ⚙';
  $('incAll').addEventListener('change', e => { for (const r of rows.filter(shown)) if (!r.busy) { r.inc = e.target.checked; r.cb.checked = r.inc; paintRow(r); } counts(); });
  document.querySelectorAll('.filters button').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.f; document.querySelectorAll('.filters button').forEach(x => x.classList.toggle('on', x === b)); render();
  }));
  $('goBtn').addEventListener('click', download);
  $('saveBtn').addEventListener('click', async () => { const n = await saveNames(); snack(n ? `✓ Saved ${n} name${n === 1 ? '' : 's'} to “${pl.name}”` : 'ⓘ Nothing changed'); });
  render();
  checkConn(); setInterval(checkConn, 6000);
})();
