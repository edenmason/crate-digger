# Crate Digger updates

This branch holds the **published** version of Crate Digger. The updater on each Mac checks `version.json` here
every few hours and installs anything newer. Don't edit by hand; `tools/release.py` on `main` writes it.

**Current version: 2.3.0**

- ✓ Tracks you've already saved are marked: the floating button turns into ✓, the toolbar icon shows a ✓, and the Discogs viewer ticks saved rows
- ⬇ Check names before downloading: a quick box for messy names, and a spreadsheet-style review page for whole playlists
- ✎ Tidy titles: cat numbers, [labels], years and junk move out of titles so Soulseek finds more
- Downloads list: one row per track, in ⚠ Needs attention, ⬇ In progress and ✓ Completed
- Colour-blind friendly: every status has an icon, a word and its own shape
- Crate Digger now updates itself from GitHub

To install on a new Mac: download [Crate-Digger-Installer.zip](https://github.com/edenmason/crate-digger/raw/updates/Crate-Digger-Installer.zip),
unzip it and double-click **Install Crate Digger**.
