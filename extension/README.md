# Crate Digger

Save tracks while you dig on Bandcamp, SoundCloud, YouTube (incl. YouTube Music) and Discogs, keep them in playlists, and download them in lossless quality through Sockseek, straight onto your drive.

## Downloading (the Download tab)
1. Double-click **Start Sockseek** (in `Programs/Crate Digger/Sockseek` on the Seagate). A Terminal window opens: leave it open while you download, and close it when you're done.
2. In the side panel, open the **Download** tab. The light goes green when it can see Sockseek.
3. Press **⬇** on any track in the Dig tab, or **Download playlist** to get everything not yet downloaded.

- **Check before downloading:** pressing ⬇ on a track whose name looks messy pops up a small box with the name already tidied and a preview of exactly what Soulseek will search. Fix it if needed, then press Enter. Clean names download straight away. Tick *Don't show this again* to skip it (turn it back on in the Download tab's ⚙, where you can also choose "every time").
- **Download playlist** opens a **review page** (a spreadsheet in a Chrome tab): one row per track with editable Artist and Title, the Soulseek search preview, ⚠ flags on names that need a look, and tick boxes. Press **⬇ Download** at the bottom; your edits are saved to the playlist and the side panel jumps to the Download tab. Tick *Skip this page next time* if you'd rather go straight through.
- **Where files go:** `Seagate/USB Music/<today's date>/<playlist name>/`, e.g. `USB Music/2026-11-03/TRANCE NIGHT NOV`. Each day gets a new date folder with only that day's downloads, sorted into a folder per playlist; a release gets its own folder inside that. Switch the date or playlist folders off in the Download tab's ⚙.
- **Quality:** *Lossless only* (FLAC/WAV/AIFF) by default. Switch to *Lossless, or MP3 320* or *Any* when you need to.
- **Length never rules a file out:** the version closest in length to your saved track is ranked first, but longer (extended) or shorter (edit) versions still download.
- **Files keep honest names:** tagged files become `Artist - Title`; untagged ones keep their original filename, so the mix name is never lost.
- **Not found / wrong version?** Use **Choose a file myself…** or **Get a different version…** to see every file Soulseek has, best quality first, with size and length and warnings for likely fakes or YouTube rips. Then pick the one you want.
- **"Paused for Soulseek's search limit"** is normal: Sockseek waits so you don't get a 30-minute ban, then carries on by itself.
- The list has three sections, one row per track: **⚠ Needs attention** (not found / failed / cancelled), **⬇ In progress** and **✓ Completed**. Every status has an icon, a word and its own shape (striped, solid, dashed, dotted), so nothing relies on colour.
- **✎ Tidy titles** (next to the playlist filter) moves cat numbers, label names in [brackets], years and junk like [FREE] or (PREVIEW) out of titles into their own fields, so Soulseek searches only use artist + track. You see a preview first. New saves are tidied automatically.
- Tracks you've downloaded get a **✓ downloaded** tag, are skipped by *Download playlist*, and the CSV has a *Downloaded File* column.

## Updating without losing playlists
From version 2.0 Crate Digger has a fixed ID, so your playlists stay put even if you move the folder. To update, copy the new files over the same folder and hit reload ↻ on its card in `chrome://extensions`. Back up now and then anyway (⚙ → *Back up everything*).

## Moving playlists between installs
- ⚙ Settings → **Back up everything (.json)** saves all playlists in one file.
- ⚙ Settings → **Import playlists (CSV or backup)…** opens an import page. Drop in a backup, or a CSV from *Export all playlists* (works with files from older versions too). Tracks merge into playlists with the same name; duplicates are skipped, so importing twice is harmless.

## Install
1. Keep this folder somewhere permanent (it lives in `Seagate/Programs/Crate Digger/Crate Digger extension`). Chrome loads it from here, so if the drive isn't plugged in when Chrome starts, Crate Digger won't load until you plug it back in and press reload.
2. Open `chrome://extensions`, switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Pin it from the puzzle-piece menu so the icon sits in your toolbar.

## Side panel
Clicking the toolbar icon (or **Alt+Shift+D**) docks Crate Digger to the side of the window. It stays open while you browse, and "On this page" updates as you switch tabs or move between pages. If SoundCloud moves on to the next track without changing page, hit **↻ Rescan**. Drag the panel's edge to resize it. Prefer the small popup? ⚙ Settings → *Toolbar icon opens* → Popup. Needs Chrome 116 or newer.

## Saving tracks
- **Floating button** (orange record, bottom right) on supported sites — one click saves what you're on/playing to the active playlist.
- **Alt+Shift+S** does the same (change at `chrome://extensions/shortcuts`).
- **Right-click → Save to Crate Digger** works too.
- **Toolbar popup** shows everything it found on the page with tickboxes — pick single tracks off a Bandcamp album or Discogs release, or save the whole release as one row.

What it picks by default:
| Site | Quick-save grabs |
|---|---|
| Bandcamp track | that track (artist, title, album, label, date, tags as genre/style) |
| Bandcamp album | the track that's playing, otherwise the whole release |
| SoundCloud | the track page you're on, otherwise whatever's playing in the bottom bar |
| YouTube | the video — uses "Provided to YouTube by…" / Music section data when present, otherwise parses `Artist - Title (Year) [Label]` |
| Discogs release/master | the whole release (label, cat #, year, genres, styles via the Discogs API) |

Anything missing can be fixed with ✎ edit. Other sites (including Bandcamp labels on their own domain) work through the popup.

## Listening on YouTube (Premium, no ads)
- Every saved track has a red **▶** (YouTube) and an orange **☁** (SoundCloud search) button. It opens the track on youtube.com itself, so your YouTube Premium applies (no ads, background play).
  - Saved from Discogs: opens the exact video Discogs has for that track (matched by title, including the mix name).
  - Saved from YouTube: opens that video.
  - Anything else (or no video on Discogs): opens a YouTube search for artist + title.
- On Discogs release/master pages there's a **"Tracks on YouTube"** pill bottom-left. Click it for the tracklist with ▶ per track, **+** to save that track, **Play all on YouTube** (queues every video from the release in one YouTube tab), and any extra videos on the release. Videos that don't match a tracklist row (remixes, alternate mixes, edits) are listed under **Other mixes & videos**, each with its own **+**, so you can save just that version. It's named from the video title and gets the release's label, cat # and year. Hover a ▶ to see which video it opens. Turn the viewer off in ⚙ Settings.
- If you're playing something in Discogs' own video player, the floating save button (and the panel's default tick) goes to **that** video. Detection is best-effort; if it picks the wrong one, use the **+** on the right row instead.
- The CSV has a **YouTube** column with the same link.

## Filling gaps from Discogs (optional)
YouTube and SoundCloud rarely give label/genre. Add a free Discogs token in ⚙ Settings, then use ✦ on a track or "Fill missing info" for the whole playlist. It's a best-guess match, so a link to the Discogs page it used goes in Notes.

## Exporting for Soulseek
- **Export CSV**: Artist, Title, Label, Catalog Number, Release, Release Date, Genre, Style / Tags, Length, Type, Source, URL, YouTube, **Soulseek Search**, Downloaded File, Notes, Added. Opens fine in Excel/Numbers/Sheets.
- **Copy Soulseek searches** / **.txt export**: one cleaned-up search per line (junk like "Official Video" and brackets stripped, no leading hyphens since Soulseek treats `-word` as "exclude"). Paste into Soulseek's search or a Nicotine+ wishlist.

Everything is stored locally in Chrome (`chrome.storage.local`) — nothing leaves your machine except Discogs lookups, and the Download tab only talks to Sockseek on your own Mac.
