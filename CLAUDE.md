# Crate Digger: project brief

Read this before changing anything. It's the context a new chat needs.

## What it is

A Chrome extension (Manifest V3, loaded with **Load unpacked**, Developer mode on) for digging on
Bandcamp, SoundCloud, YouTube/YouTube Music and Discogs. It saves tracks into playlists, tidies names,
and downloads them in lossless quality through **Sockseek** (a Soulseek downloader, `sockseek daemon`,
HTTP API on `127.0.0.1:5030`) into dated folders on an external drive, for DJing from USB.

Users: the owner (UK DJ/producer, Apple-chip Mac, Seagate drive) and his girlfriend (Apple-chip Mac).
Both use YouTube Premium. Non-technical end users: anything they touch must be double-click simple.

## Hard rules

- **Colour-blind friendly (the owner is colour-blind).** Never show status by red/green colour alone.
  Every status = **icon + word + shape** (✓ filled · ✕ striped outline + double edge · ⚠ yellow + dashed ·
  ⬇/⌕ solid outline · ⏸ dotted). Palette (Okabe–Ito): ok `#56B4E9`, problem `#E58FC4`, warning `#F0E442`,
  accent orange `#f2a33a`. Check new UI through a deuteranopia filter before shipping.
- **UK English, plain words** in all UI text. No jargon for end users.
- **Never commit personal data**: `seed-backup.json` (playlist backup) and `defaults.json` (per-Mac settings) are gitignored.
- **Nothing ships until it's published** to the `updates` branch (see Releasing). `main` is not live.
- Low friction: smart defaults, one obvious button, previews before anything destructive.

## Repo layout

| Path | What |
|---|---|
| `extension/` | The extension. `storage.js` (CD: data, playlists, tidy, matching, CSV), `sockseek.js` (SS: daemon API, job records, quality presets), `extractors.js` (per-site scraping, content script), `content.js` (floating save button, toast, Discogs track viewer, saved ✓), `background.js` (service worker: messages, Discogs API, badge, seed/defaults import, update self-reload), `popup.*` (side panel: Dig + Download tabs), `review.*` (playlist review spreadsheet), `import.*` (import page) |
| `installer/` | `Install Crate Digger.command` (+ `How to install.txt`): one double-click Mac setup |
| `extras/` | `Turn on auto-updates.command` for a hand-made setup (the owner's Seagate) |
| `updater/update.sh` | Auto-updater (bash 3.2-safe: macOS default shell). Also installs the native-messaging helper |
| `tools/release.py` | Builds `dist/` and publishes to the `updates` branch |

## Key behaviours (don't break)

- **Playlists** live in `chrome.storage.local` under `cd_state`. All writes go through `CD.mutate`/`SS.mutateJobs`,
  which take a **Web Lock** (`cd-state` / `cd-dl`) so the panel, review page and background never overwrite each other.
- **Fixed extension ID** `mhoonaimgahglpomeilibppkjagipdib` via `"key"` in the manifest, so moving the folder keeps playlists.
  The native-messaging helper is registered for this ID only.
- **Title tidy** (`CD.tidy`): moves cat numbers, `[labels]`, years, junk (`[FREE]`, `(PREVIEW)`, `.mp3`), leading track
  numbers out of titles; keeps mix names. Searches always use the tidy version. New saves are tidied automatically.
- **Saved check** (`CD.findSaved`): across all playlists, by single-track URL / YouTube video / artist+title (after tidy).
- **Downloads**: one Sockseek job per track (album job for releases). Folder = `dlBase / YYYY-MM-DD / <playlist>`
  (`SS.folderFor`, both parts switchable). Length is a *preference* (`lengthTolerance: -1` necessary, `3` preferred),
  so extended mixes/edits still download. Lossless-only by default. File names `{artist( - )title|filename}` so a
  mix name is never hidden; releases keep Sockseek's default naming.
- **Download list**: one row per track (latest attempt), sections ⚠ Needs attention / ⬇ In progress / ✓ Completed.
  A job is only "lost" if the daemon's `startedAtUtc` changed or it's been missing > 60 s.
- **Check before download**: single track → box only when `SS.needsCheck` finds a problem (setting `checkSingle`:
  messy/always/never); whole playlist → `review.html` (setting `checkPlaylist`).
- **▶ / ♫ toggle**: `ytTarget` `youtube`|`music`; `CD.youtubeLink(t, target)`. "Play all" queues stay on youtube.com.

## Updates (how they reach the Macs)

1. `update.sh` runs every 6 h + at login (LaunchAgent `com.cratedigger.updater`). Reads
   `https://raw.githubusercontent.com/edenmason/crate-digger/updates/version.json`; if `extension` is newer it
   downloads `crate-digger-extension.zip` and copies files in, **manifest.json last**. Can also bump Sockseek (`sockseek`)
   and itself (`updater`).
2. The extension checks every 15 min whether `manifest.json` on disk is newer than what's running, then
   `chrome.runtime.reload()` and shows "✓ Updated" with `whats-new.json`. (Reload needs Developer mode ON.)
3. ⚙ Settings → ⟳ Check for updates: fetches `version.json`; **Update now** calls the native-messaging helper
   (`~/.crate-digger/native-host.sh`, `com.cratedigger.updater`) which runs `update.sh` immediately.

## Releasing

```
# 1. bump "version" in extension/manifest.json   2. commit + push main
python3 tools/release.py "Plain-English note 1" "Note 2"   # notes show in the app's ✓ Updated box
```
GitHub Releases can't be created from Claude sessions; publishing = committing `dist/` to the `updates` branch.
Also copy the new extension + installer onto the owner's Seagate (below) when the Mac is linked.

## The owner's setup (Seagate drive)

```
/Volumes/Seagate/Programs/Crate Digger/
  Crate Digger extension/      ← loaded in Chrome (has his seed-backup.json; never overwrite that)
  Sockseek/                    sockseek (x64), sockseek.conf (his login: never print it), Start Sockseek.command
  Updater/update.sh            Turn on auto-updates.command
  Installer for another Mac/   girlfriend's installer (arm64 Sockseek bundled, no personal data)
  Playlist exports/  Backups/
/Volumes/Seagate/USB Music/<date>/<playlist>/   ← downloads
```
The drive is exFAT over a FUSE mount from the Linux VM: files can briefly read as missing right after a write
(retry with a short sleep), `rm` is not permitted, and `sed -i` is unreliable. Write files with Python `open(...,'wb')`.

## Testing (no Soulseek account needed)

- Practice Sockseek: `sockseek daemon --no-config --mock-files-dir <dir> --mock-files-no-read-tags [--mock-files-slow] --server-port 5030 -o <out>`
  with fake files made by `truncate -s 40M "Artist - Title.flac"` (Linux build of the same version, 3.0.6).
- Chrome: Playwright `launchPersistentContext` with `channel: 'chromium'` and `--disable-extensions-except/--load-extension`.
  For anything involving `chrome.runtime.reload()`, launch Chromium with a profile whose Preferences has
  `extensions.ui.developer_mode: true` and load via CDP `Extensions.loadUnpacked` (`--enable-unsafe-extension-debugging`).
- Never `pkill -f` with a pattern that also appears in your own command line (it kills the shell). Use `pkill -x sockseek`.
