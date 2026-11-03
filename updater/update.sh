#!/bin/bash
# ------------------------------------------------------------------
#  Crate Digger updater
#  Checks GitHub for a newer release and installs it. Run by a background
#  service every 6 hours and at login; safe to run by hand any time.
#
#  update.sh "<Crate Digger extension folder>" ["<Sockseek folder>"]
#
#  Release assets it reads (from the repo's *latest* GitHub release):
#    version.json                 {"extension":"2.3.0","sockseek":"3.0.6","updater":"1","notes":[...]}
#    crate-digger-extension.zip   the extension's files
#    update.sh                    this script (so the updater can update itself)
#  Works with macOS's built-in bash 3.2, curl and unzip. No GitHub account or token needed.
# ------------------------------------------------------------------
UPDATER_VERSION="1"
REPO="${CD_REPO:-edenmason/crate-digger}"
BASE="${CD_UPDATE_BASE:-https://github.com/$REPO/releases/latest/download}"
EXT="$1"
SS="$2"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
LOG="${CD_LOG:-$HOME/Library/Logs/Crate Digger Updater.log}"

mkdir -p "$(dirname "$LOG")"
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 200000 ] && tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$LOG"; }

if [ ! -f "$EXT/manifest.json" ]; then
  log "Crate Digger folder not found ($EXT). Drive unplugged? Skipping."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

json_val() {   # json_val KEY FILE -> first "KEY": "value"
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$2" | head -1
}
newer() {      # newer A B -> success if version A > version B
  local IFS=. i x y
  local a=($1) b=($2)
  for i in 0 1 2 3; do
    x=${a[$i]:-0}; y=${b[$i]:-0}
    x=${x//[^0-9]/}; y=${y//[^0-9]/}; x=${x:-0}; y=${y:-0}
    [ "$x" -gt "$y" ] && return 0
    [ "$x" -lt "$y" ] && return 1
  done
  return 1
}

if ! curl -fsSL --max-time 30 -o "$TMP/version.json" "$BASE/version.json"; then
  log "Couldn't reach GitHub (offline?). Will try again later."
  exit 0
fi

# ---------- 1. the extension ----------
REMOTE="$(json_val extension "$TMP/version.json")"
LOCAL="$(json_val version "$EXT/manifest.json")"
if [ -n "$REMOTE" ] && newer "$REMOTE" "$LOCAL"; then
  log "Updating Crate Digger $LOCAL -> $REMOTE"
  if curl -fsSL --max-time 300 -o "$TMP/ext.zip" "$BASE/crate-digger-extension.zip" \
     && mkdir "$TMP/new" && unzip -q "$TMP/ext.zip" -d "$TMP/new" \
     && [ "$(json_val version "$TMP/new/manifest.json")" = "$REMOTE" ]; then
    # every file except manifest.json first; manifest.json last, because Crate Digger reloads when its version changes
    (cd "$TMP/new" && find . -type f ! -name manifest.json ! -name '._*') | while IFS= read -r f; do
      f="${f#./}"
      mkdir -p "$EXT/$(dirname "$f")" && cp -f "$TMP/new/$f" "$EXT/$f"
    done
    cp -f "$TMP/new/manifest.json" "$EXT/manifest.json" && log "Crate Digger updated to $REMOTE"
  else
    log "Download of Crate Digger $REMOTE failed or looked wrong. Nothing was changed."
  fi
fi

# ---------- 2. Sockseek (only when a release says so) ----------
SSV="$(json_val sockseek "$TMP/version.json")"
if [ -n "$SS" ] && [ -f "$SS/sockseek" ] && [ -n "$SSV" ]; then
  HAVE="$(cat "$SS/.sockseek-version" 2>/dev/null)"
  if [ -n "$HAVE" ] && newer "$SSV" "$HAVE"; then
    ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || ARCH="x64"
    URL="https://github.com/fiso64/sockseek/releases/download/v$SSV/sockseek_${SSV}_osx-$ARCH.tar.gz"
    log "Updating Sockseek $HAVE -> $SSV"
    if curl -fsSL --max-time 900 -o "$TMP/ss.tgz" "$URL" && mkdir "$TMP/ss" && tar xzf "$TMP/ss.tgz" -C "$TMP/ss" && [ -f "$TMP/ss/sockseek" ]; then
      chmod +x "$TMP/ss/sockseek"
      xattr -dr com.apple.quarantine "$TMP/ss/sockseek" 2>/dev/null
      # copy next to it then swap, so a running Sockseek isn't disturbed mid-file
      cp "$TMP/ss/sockseek" "$SS/sockseek.new" && mv -f "$SS/sockseek.new" "$SS/sockseek" && echo "$SSV" > "$SS/.sockseek-version"
      launchctl kickstart -k "gui/$(id -u)/com.cratedigger.sockseek" >/dev/null 2>&1
      log "Sockseek updated to $SSV"
    else
      log "Download of Sockseek $SSV failed. Nothing was changed."
    fi
  fi
fi

# ---------- 3. this updater ----------
UV="$(json_val updater "$TMP/version.json")"
if [ -n "$UV" ] && newer "$UV" "$UPDATER_VERSION"; then
  if curl -fsSL --max-time 60 -o "$TMP/update.sh" "$BASE/update.sh" && bash -n "$TMP/update.sh" && grep -q 'Crate Digger updater' "$TMP/update.sh"; then
    cp "$TMP/update.sh" "$SELF.new" && chmod +x "$SELF.new" && mv -f "$SELF.new" "$SELF" && log "Updater updated to v$UV"
  else
    log "Updater v$UV download failed. Keeping the current one."
  fi
fi
exit 0
