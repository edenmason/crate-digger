/* Crate Digger — per-site metadata extractors (runs in the page as a content script).
   window.CDExtract() -> { source, items: [track/release objects], defaults: [indexes to quick-save] } */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const meta = n => (($(`meta[property="${n}"]`) || $(`meta[name="${n}"]`)) || {}).content?.trim() || '';
  const abs = u => { try { return new URL(u, location.origin).href.split('#')[0]; } catch (e) { return location.href; } };

  function ldjson() {
    return $$('script[type="application/ld+json"]').flatMap(s => {
      try { const j = JSON.parse(s.textContent); return Array.isArray(j) ? j : (j['@graph'] || [j]); } catch (e) { return []; }
    });
  }
  function fmtDate(d) {
    if (d == null || d === '') return '';
    const s = String(d).trim();
    if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s)) return s;
    const t = Date.parse(s);
    if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    const y = s.match(/\b(19|20)\d{2}\b/);
    return y ? y[0] : s;
  }
  function splitAT(s) {
    const m = s && s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : null;
  }
  const JUNK = /\s*[\[(](?:official\s*(?:music\s*)?(?:video|audio|visuali[sz]er)|lyrics?(?:\s*video)?|audio|hq|hd|4k|free\s*(?:download|dl)|out\s*now|premiere|full\s*(?:album|ep))[^\])]*[\])]/gi;
  const clean = s => (s || '').replace(JUNK, '').replace(/^\s*premiere\s*[:|]\s*/i, '').replace(/\s+/g, ' ').trim();
  const GENRE_WORDS = /house|techno|garage|jungle|dnb|d&b|drum|bass|dub|disco|funk|soul|jazz|ambient|electro|breaks|trance|acid|hip.?hop|boom.?bap|lo.?fi|balearic|italo|boogie|reggae|rock|minimal|grime|dubstep|edit/i;

  /* ---------------- Bandcamp ---------------- */
  function bandcamp() {
    let tra = null, emb = null;
    try { tra = JSON.parse($('script[data-tralbum]')?.getAttribute('data-tralbum') || 'null'); } catch (e) {}
    try { emb = JSON.parse($('script[data-embed]')?.getAttribute('data-embed') || 'null'); } catch (e) {}
    const ld = ldjson().find(j => /Music(Album|Recording)/.test([].concat(j['@type']).join(' ')));
    if (!tra && !ld) return null;

    const isTrack = tra ? tra.item_type === 'track' : /\/track\//.test(location.pathname);
    const artist = tra?.artist || ld?.byArtist?.name || emb?.artist || '';
    const pageTitle = tra?.current?.title || ld?.name || '';
    const pub = ld?.publisher?.name || txt($('#band-name-location .title'));
    let label = ld?.recordLabel?.name || '';
    if (!label && pub && pub.toLowerCase() !== artist.toLowerCase()) label = pub;
    const releaseDate = fmtDate(tra?.album_release_date || tra?.current?.release_date || ld?.datePublished);

    let tags = $$('.tralbum-tags a.tag').map(txt).filter(Boolean);
    if (!tags.length && ld?.keywords) tags = [].concat(ld.keywords).flatMap(k => String(k).split(',')).map(s => s.trim()).filter(Boolean);
    const base = {
      source: 'Bandcamp', label, releaseDate,
      genre: tags[0] || '', style: tags.slice(1, 8).join(', '),
      release: isTrack ? (ld?.inAlbum?.name || emb?.album_title || '') : pageTitle
    };
    const url = tra?.url ? abs(tra.url) : location.origin + location.pathname;
    // Compilations / label accounts often title tracks "Artist - Title"
    const canSplit = /^(various|various artists|v\.?\s?a\.?)$/i.test(artist) || (pub && artist.toLowerCase() === pub.toLowerCase());
    const mk = (title, tArtist, u) => {
      let a = tArtist || artist, t = title || '';
      if (!tArtist && canSplit) { const s = splitAT(t); if (s) { a = s.artist; t = s.title; } }
      return { ...base, type: 'track', artist: a, title: clean(t), url: u };
    };

    const items = [];
    let defaults = [];
    if (isTrack) {
      const it = mk(pageTitle, null, url);
      const dur = tra?.trackinfo?.[0]?.duration;
      if (dur > 0) it.length = String(Math.round(dur));
      items.push(it);
      defaults = [0];
    } else {
      items.push({ ...base, type: 'release', artist, title: '', url });
      const isPlaying = !!$('.inline_player .playbutton.playing') ||
        (txt($('.inline_player .time_elapsed')) && txt($('.inline_player .time_elapsed')) !== '00:00');
      const playingTitle = isPlaying ? (txt($('.inline_player .title-section .title')) || txt($('.inline_player .title'))) : '';
      (tra?.trackinfo || []).forEach((t, i) => {
        const it = mk(t.title, t.artist, t.title_link ? abs(t.title_link) : url);
        if (t.duration > 0) it.length = String(Math.round(t.duration));
        it.position = String(t.track_num || i + 1);
        items.push(it);
        if (playingTitle && t.title === playingTitle) { it.nowPlaying = true; defaults = [items.length - 1]; }
      });
      if (!defaults.length) defaults = [0];
    }
    return { source: 'Bandcamp', items, defaults };
  }

  /* ---------------- SoundCloud ---------------- */
  function scHydration() {
    for (const s of $$('script')) {
      const c = s.textContent;
      if (c.includes('__sc_hydration')) {
        try { return JSON.parse(c.slice(c.indexOf('['), c.lastIndexOf(']') + 1)); } catch (e) {}
      }
    }
    return [];
  }
  const tagList = s => (s || '').match(/"[^"]+"|\S+/g)?.map(x => x.replace(/"/g, '')).join(', ') || '';

  function soundcloud() {
    const norm = u => { try { const x = new URL(u, location.origin); return (x.origin + x.pathname).replace(/\/$/, '').toLowerCase(); } catch (e) { return ''; } };
    const parts = location.pathname.split('/').filter(Boolean);
    const RESERVED = new Set(['discover', 'stream', 'you', 'search', 'upload', 'charts', 'feed', 'notifications', 'messages', 'settings', 'people', 'pages', 'tags', 'popular', 'terms-of-use', 'jobs']);
    const SUB = new Set(['sets', 'tracks', 'albums', 'reposts', 'likes', 'followers', 'following', 'popular-tracks', 'comments', 'spotlight', 'recommended']);
    const isTrackPage = parts.length === 2 && !RESERVED.has(parts[0]) && !SUB.has(parts[1]);
    const here = norm(location.href);
    const hyd = scHydration().find(h => h.hydratable === 'sound' && norm(h.data?.permalink_url) === here)?.data;

    const make = (rawTitle, uploader, genre, date, url, extra = {}) => {
      const pm = extra.pm || {};
      let title = clean(rawTitle), artist = pm.artist || '';
      const s = splitAT(title);
      if (!artist) { if (s) { artist = s.artist; title = s.title; } else artist = uploader || ''; }
      else if (s && s.artist.toLowerCase() === artist.toLowerCase()) title = s.title;
      return {
        source: 'SoundCloud', type: 'track', artist, title,
        label: extra.label || '', release: pm.album_title || pm.release_title || extra.release || '',
        releaseDate: fmtDate(extra.releaseDate || date), genre: (genre || '').replace(/^#\s*/, ''),
        style: extra.tags || '', url,
        notes: uploader && uploader.toLowerCase() !== artist.toLowerCase() ? `Uploaded by ${uploader}` : ''
      };
    };

    const items = [];
    let defaults = [];
    if (isTrackPage) {
      const hero = $('.fullHero__title') || document;
      const t = txt($('.soundTitle__title span', hero)) || txt($('.soundTitle__title', hero)) || hyd?.title;
      const up = txt($('.soundTitle__username', hero)) || hyd?.user?.username || '';
      const g = txt($('.soundTitle__tag', hero)) || hyd?.genre || '';
      const d = ($('.fullHero__uploadTime time') || $('.soundTitle__uploadTime time') || $('time.relativeTime'))?.getAttribute('datetime') || hyd?.created_at;
      if (t) {
        items.push(make(t, up, g, d, location.origin + location.pathname, hyd ? {
          pm: hyd.publisher_metadata, label: hyd.label_name, releaseDate: hyd.release_date || hyd.display_date, tags: tagList(hyd.tag_list)
        } : {}));
        defaults = [0];
      }
    }
    if (parts[1] === 'sets' && parts.length >= 3) {
      const setTitle = txt($('.fullHero__title .soundTitle__title span')) || txt($('.soundTitle__title'));
      $$('.trackList__item').forEach(li => {
        const a = $('.trackItem__trackTitle', li);
        if (a) items.push(make(txt(a), txt($('.trackItem__username', li)), '', '', abs(a.getAttribute('href')), { release: setTitle }));
      });
    }
    // Now playing (works on any SoundCloud page, incl. feeds and search)
    const np = $('.playbackSoundBadge__titleLink');
    if (np) {
      const npUrl = abs(np.getAttribute('href')).split('?')[0];
      const idx = items.findIndex(i => norm(i.url) === norm(npUrl));
      if (idx >= 0) { items[idx].nowPlaying = true; if (!isTrackPage) defaults = [idx]; }
      else {
        const npTitle = np.getAttribute('title') || txt($('span[aria-hidden="true"]', np)) || txt(np);
        const upEl = $('.playbackSoundBadge__lightLink');
        const it = make(npTitle, upEl?.getAttribute('title') || txt(upEl), '', '', npUrl);
        it.nowPlaying = true;
        items.push(it);
        if (!defaults.length) defaults = [items.length - 1];
      }
    }
    if (!items.length) return null;
    return { source: 'SoundCloud', items, defaults: defaults.length ? defaults : [0] };
  }

  /* ---------------- YouTube ---------------- */
  function ytmusic() {
    const bar = $('ytmusic-player-bar');
    const title = txt(bar && $('.title', bar));
    if (!title) return null;
    const p = txt($('.byline', bar)).split('•').map(s => s.trim()).filter(x => x && !/views|likes|plays/i.test(x));
    let date = '', album = '';
    if (p.length >= 2 && /^\d{4}$/.test(p[p.length - 1])) date = p.pop();
    if (p.length >= 2) album = p.pop();
    const vid = new URLSearchParams(location.search).get('v');
    return { source: 'YouTube Music', defaults: [0], items: [{
      source: 'YouTube Music', type: 'track', artist: p.join(', '), title: clean(title), release: album, releaseDate: date,
      url: vid ? `https://music.youtube.com/watch?v=${vid}` : location.href
    }] };
  }

  function youtube() {
    if (location.hostname.startsWith('music.')) return ytmusic();
    const q = new URLSearchParams(location.search);
    let vid = q.get('v');
    if (!vid) { const m = location.pathname.match(/^\/shorts\/([\w-]+)/); vid = m && m[1]; }
    if (!vid) return null;
    const url = `https://www.youtube.com/watch?v=${vid}`;
    const rawTitle = txt($('ytd-watch-metadata h1 yt-formatted-string')) || txt($('ytd-watch-metadata h1')) ||
      document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
    const channel = txt($('ytd-watch-metadata ytd-channel-name a')) || txt($('#owner #channel-name a'));
    const descEl = $('ytd-watch-metadata #description-inline-expander yt-attributed-string') ||
      $('#description-inline-expander') || $('ytd-watch-metadata #description');
    const desc = descEl ? descEl.textContent : '';

    const it = { source: 'YouTube', type: 'track', url, video: url, artist: '', title: '', label: '', release: '', releaseDate: '', genre: '', style: '',
      notes: channel ? `Channel: ${channel}` : '' };

    // Auto-generated "Provided to YouTube by ..." uploads carry proper metadata
    const prov = desc.match(/Provided to YouTube by ([^\n]+)/);
    if (prov) {
      const lines = desc.split('\n').map(s => s.trim()).filter(Boolean);
      const i = lines.findIndex(l => l.includes(' · '));
      if (i >= 0) {
        const p = lines[i].split(' · ');
        it.title = p[0]; it.artist = p.slice(1).join(', ');
        const nxt = lines[i + 1];
        if (nxt && !/^(℗|©|Released on|Auto-generated|Provided)/i.test(nxt)) it.release = nxt;
      }
      const ph = desc.match(/℗\s*(?:((?:19|20)\d{2})\s+)?([^\n]+)/);
      it.label = ph && ph[2] ? ph[2].trim() : prov[1].trim();
      if (ph && ph[2]) it.notes = [it.notes, `Distributor: ${prov[1].trim()}`].filter(Boolean).join(' | ');
      const rd = desc.match(/Released on:\s*([\d-]+)/);
      it.releaseDate = rd ? rd[1] : ph && ph[1] ? ph[1] : '';
    }

    // "Music" section cards in the description
    const cards = $$('yt-video-attribute-view-model, ytd-video-attribute-view-model').map(c => ({
      title: txt($('[class*="__title"]', c)), artist: txt($('[class*="__subtitle"]', c)), release: txt($('[class*="__secondary-subtitle"]', c))
    })).filter(c => c.title);
    if (!it.title && cards.length === 1) Object.assign(it, cards[0]);

    // Fall back to parsing the video title: "Artist - Title (1994) [Label]"
    if (!it.title) {
      let t = rawTitle;
      const yr = t.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/);
      if (yr) { it.releaseDate = yr[1]; t = t.replace(yr[0], ' '); }
      t = clean(t);
      const br = t.match(/\s*\[([^\]]+)\]\s*$/);
      if (br) {
        if (GENRE_WORDS.test(br[1])) it.genre = br[1].trim(); else it.label = br[1].trim();
        t = t.slice(0, br.index).trim();
      }
      const s = splitAT(t);
      if (s) { it.artist = s.artist; it.title = s.title; }
      else { it.title = t; it.artist = channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, ''); }
    }

    const items = [it];
    if (cards.length > 1) cards.forEach(c => items.push({ source: 'YouTube', type: 'track', url, ...c, notes: `From video: ${rawTitle}` }));
    return { source: 'YouTube', items, defaults: [0] };
  }

  /* ---------------- Discogs (uses the public Discogs API via the background worker) ---------------- */
  const ytId = u => (String(u || '').match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{11})/) || [])[1] || '';
  const squashFull = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const squash = s => squashFull(String(s || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' '));
  const discogsApi = path => new Promise(res => {
    try { chrome.runtime.sendMessage({ type: 'cd-discogs', path }, r => res(r && r.ok ? r.data : null)); } catch (e) { res(null); }
  });
  function discogsDom() {
    const t = document.title.split(' | ')[0].replace(/\s*[-–]\s*Discogs$/i, '').replace(/\s*\([^)]*\)\s*$/, '');
    const s = splitAT(t);
    return { source: 'Discogs', defaults: [0], items: [{ source: 'Discogs', type: 'release', artist: s ? s.artist : '', title: '',
      release: s ? s.title : t, url: location.origin + location.pathname }] };
  }
  async function discogs() {
    const m = location.pathname.match(/\/(release|master)\/(\d+)/);
    if (!m) return null;
    const d = await discogsApi(`/${m[1] === 'master' ? 'masters' : 'releases'}/${m[2]}`);
    if (!d) return discogsDom();
    let labels = d.labels;
    if (!labels && d.main_release) { const mr = await discogsApi(`/releases/${d.main_release}`); labels = mr?.labels; }
    const strip = s => (s || '').replace(/\s\(\d+\)$/, '').replace(/\*$/, '').trim();
    const joinArtists = arr => (arr || []).map((a, i) => strip(a.anv || a.name) +
      (i < arr.length - 1 ? (a.join && a.join !== ',' ? ` ${a.join} ` : ', ') : '')).join('').replace(/\s+/g, ' ').trim();
    const artist = joinArtists(d.artists);
    const lab = (labels || [])[0];
    const base = {
      source: 'Discogs', label: lab ? strip(lab.name) : '', catno: lab && !/^none$/i.test(lab.catno || '') ? lab.catno : '',
      release: d.title, releaseDate: d.released ? fmtDate(d.released.replace(/-00/g, '')) : (d.year ? String(d.year) : ''),
      genre: (d.genres || []).join(', '), style: (d.styles || []).join(', '), url: location.origin + location.pathname
    };
    // YouTube videos attached to the release on Discogs
    const videos = [];
    for (const v of d.videos || []) {
      const id = ytId(v.uri);
      if (id && !videos.some(x => x.id === id)) videos.push({ id, title: v.title || '', url: `https://www.youtube.com/watch?v=${id}` });
    }
    const allUrl = videos.length > 1 ? `https://www.youtube.com/watch_videos?video_ids=${videos.map(v => v.id).join(',')}` : (videos[0]?.url || '');
    const used = new Set();
    // Find the video whose title contains the track title: exact (with mix name) first, then bare title.
    // Longest track titles are matched first so "Dub" doesn't steal the "Dub Mix" video.
    const matchVideo = title => {
      for (const [f, t] of [[squashFull, squashFull(title)], [squash, squash(title)]]) {
        if (!t || t.length < 2) continue;
        const hit = videos.find(v => !used.has(v.id) && f(v.title).includes(t));
        if (hit) { used.add(hit.id); return hit; }
      }
      return null;
    };

    const items = [{ ...base, type: 'release', artist, title: '', video: allUrl }];
    const tracks = [];
    const pushTrack = t => tracks.push({ ...base, type: 'track', artist: t.artists ? joinArtists(t.artists) : artist, title: t.title, position: t.position, length: t.duration || '' });
    (d.tracklist || []).forEach(t => {
      if (t.type_ === 'index') (t.sub_tracks || []).forEach(pushTrack);
      else if (!t.type_ || t.type_ === 'track') pushTrack(t);
    });
    [...tracks].sort((a, b) => squashFull(b.title).length - squashFull(a.title).length).forEach(t => {
      const v = matchVideo(t.title);
      t.video = v ? v.url : '';
      if (v) { t.videoId = v.id; t.videoTitle = v.title; }
    });
    items.push(...tracks);

    // Every video that isn't tied to a tracklist row (remixes, alternate mixes, edits…) becomes its own saveable track,
    // named from the video title, with the release's label/cat#/year/genre attached.
    const tagRx = new RegExp(`\\s*[\\[(]\\s*(?:${[base.label, base.catno].filter(Boolean)
      .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '(?!x)x'})\\s*[\\])]\\s*$`, 'i');
    for (const v of videos) {
      if (used.has(v.id)) continue;
      const raw = clean(v.title).replace(/[\[(]\s*(?:19|20)\d{2}\s*[\])]/g, ' ').replace(tagRx, '').replace(/\s+/g, ' ').trim();
      const s = splitAT(raw);
      items.push({ ...base, type: 'track', artist: s ? s.artist : artist, title: s ? s.title : raw,
        video: v.url, videoId: v.id, videoTitle: v.title, fromVideo: true });
    }

    // Whatever is playing in Discogs' own video player becomes the quick-save default
    let defaults = [0];
    const playing = discogsPlayingId(videos);
    if (playing) {
      const idx = items.findIndex(i => i.videoId === playing);
      if (idx > 0) { items[idx].nowPlaying = true; defaults = [idx]; }
    }
    return { source: 'Discogs', items, defaults, videos, allUrl };
  }

  /* Best effort: find the video that's selected/playing in Discogs' player on the page */
  function discogsPlayingId(videos) {
    const ids = new Set(videos.map(v => v.id));
    if (!ids.size) return '';
    const marked = el => {
      const sel = el.getAttribute('aria-selected'), cur = el.getAttribute('aria-current'), pr = el.getAttribute('aria-pressed');
      return sel === 'true' || pr === 'true' || (cur && cur !== 'false') ||
        /(^|[\s_-])(active|selected|playing|current|isPlaying)/i.test(el.getAttribute('class') || '');
    };
    // 1. the highlighted entry in the video list (thumbnails are i.ytimg.com/vi/<id>/…)
    for (const img of $$('img[src*="ytimg.com/vi"]')) {
      const m = img.src.match(/\/vi(?:_webp)?\/([\w-]{11})\//);
      if (!m || !ids.has(m[1])) continue;
      for (let el = img, i = 0; el && i < 6; el = el.parentElement, i++) if (marked(el)) return m[1];
    }
    // 2. the embedded YouTube player itself
    const frames = [...new Set($$('iframe[src*="youtube"]').map(f => ytId(f.src)).filter(id => ids.has(id)))];
    return frames.length === 1 ? frames[0] : '';
  }

  /* ---------------- Anything else ---------------- */
  function generic() {
    const t = clean(meta('og:title') || document.title);
    const s = splitAT(t);
    const src = location.hostname.replace(/^www\./, '');
    return { source: src, generic: true, defaults: [0], items: [{
      source: src, type: 'track', artist: s ? s.artist : (meta('og:site_name') || ''), title: s ? s.title : t, url: location.href
    }] };
  }

  window.CDExtract = async function () {
    const h = location.hostname;
    let r = null;
    try {
      if ($('script[data-tralbum]') || h.endsWith('bandcamp.com')) r = bandcamp();
      else if (h === 'soundcloud.com' || h.endsWith('.soundcloud.com')) r = soundcloud();
      else if (h.endsWith('youtube.com')) r = youtube();
      else if (h.endsWith('discogs.com')) r = await discogs();
    } catch (e) { console.warn('[Crate Digger] extractor error', e); }
    if (!r || !r.items || !r.items.length) r = generic();
    return r;
  };
})();
