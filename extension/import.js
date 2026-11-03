/* Crate Digger — import page */
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const result = document.getElementById('result');

const nameFromFile = n => n.replace(/\.[^.]+$/, '')
  .replace(/-\d{4}-\d{2}-\d{2}$/, '')       // strip the date we add on export
  .replace(/-soulseek-searches$/, '')
  .replace(/[-_]+/g, ' ').trim() || 'Imported';

function card(title, bad) {
  const c = document.createElement('div');
  c.className = 'card' + (bad ? ' bad' : '');
  const h = document.createElement('strong');
  h.textContent = title;
  c.append(h);
  result.prepend(c);
  return c;
}

async function importFile(file) {
  try {
    const text = await file.text();
    const isJson = /\.json$/i.test(file.name) || /^\s*[{[]/.test(text.replace(/^﻿/, ''));
    const groups = isJson ? CD.jsonToGroups(text) : CD.csvToGroups(text, nameFromFile(file.name));
    const report = await CD.importGroups(groups);
    const total = report.reduce((n, r) => n + r.added, 0);
    const skipped = report.reduce((n, r) => n + r.skipped, 0);
    const c = card(`✓ ${file.name}: imported ${total} track${total === 1 ? '' : 's'}${skipped ? `, ${skipped} already there` : ''}`);
    const table = document.createElement('table');
    for (const r of report) {
      const tr = table.insertRow();
      const a = tr.insertCell();
      a.textContent = r.name;
      if (r.created) { const s = document.createElement('span'); s.className = 'new'; s.textContent = '＋ new playlist'; a.append(s); }
      tr.insertCell().textContent = `+${r.added}${r.skipped ? ` (${r.skipped} skipped)` : ''}`;
    }
    c.append(table);
  } catch (e) {
    card(`✕ ${file.name}: couldn't import (${e.message})`, true);
  }
}
async function importAll(files) { for (const f of files) await importFile(f); }

fileInput.addEventListener('change', () => { importAll([...fileInput.files]); fileInput.value = ''; });
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); importAll([...e.dataTransfer.files]); });
