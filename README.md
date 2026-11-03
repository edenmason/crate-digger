# Crate Digger

A Chrome extension for digging on Bandcamp, SoundCloud, YouTube and Discogs: save tracks into playlists, check names, and download them in lossless quality through [Sockseek](https://github.com/fiso64/sockseek) (Soulseek), straight into dated folders.

## What's in here

| Folder | What it is |
|---|---|
| `extension/` | The Chrome extension (load this folder with **Load unpacked**) |
| `installer/` | `Install Crate Digger.command`: one double-click setup for a Mac |
| `extras/` | `Turn on auto-updates.command`: auto-updates for a hand-made setup (e.g. Crate Digger on an external drive) |
| `updater/` | `update.sh`: checks the `updates` branch and installs anything newer |
| `tools/release.py` | Builds an update and publishes it to the `updates` branch |

## Installing on a Mac

Download **[Crate-Digger-Installer.zip](../../raw/updates/Crate-Digger-Installer.zip)** (from the `updates` branch), unzip it, double-click **Install Crate Digger** and follow the pop-ups. It sets up Crate Digger, Sockseek (started automatically at login) and automatic updates. See `installer/How to install.txt`.

## How updates work

1. A small background job on each Mac runs `update.sh` every 6 hours and at login. It reads `version.json` from the **`updates` branch**, and if it's newer, downloads `crate-digger-extension.zip` and copies the files into the extension folder (`manifest.json` last).
2. Crate Digger checks every 15 minutes whether newer files are in its folder, reloads itself, and shows "✓ Updated" with the release notes.
3. Nothing changes on anyone's Mac until an update is **published** to the `updates` branch. The repo is public, so no GitHub account or token is needed on the Macs.

Releases can also bump Sockseek (`"sockseek"` in `version.json`) and the updater itself (`"updater"`).

## Publishing an update

```
# bump "version" in extension/manifest.json, commit, push, then:
python3 tools/release.py "What changed" "Another change"
```

Personal data (playlist backups `seed-backup.json`, per-Mac `defaults.json`) is never committed.
