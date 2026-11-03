#!/bin/bash
# ------------------------------------------------------------------
#  Crate Digger updater
#  Checks GitHub for a newer release and installs it. Run by a background
#  service every 6 hours and at login; safe to run by hand any time.
#
#  update.sh "<Crate Digger extension folder>" ["<Sockseek folder>"]
#
#  Files it reads, from the repo's "updates" branch (only changed when an update is published):
#    version.json                 {"extension":"2.3.0","sockseek":"3.0.6","updater":"1","notes":[...]}
#    crate-digger-extension.zip   the extension's files
#    update.sh                    this script (so the updater can update itself)
#  Works with macOS's built-in bash 3.2, curl and unzip. No GitHub account or token needed.
# ------------------------------------------------------------------
UPDATER_VERSION="2"
REPO="${CD_REPO:-edenmason/crate-digger}"
BASE="${CD_UPDATE_BASE:-https://raw.githubusercontent.com/$REPO/updates}"
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

# ---------- 0. the "Check for updates" helper ----------
# Chrome can't run programs itself, but it can talk to a small helper registered for Crate Digger's ID only
# (native messaging). The button in Crate Digger uses it to run this updater straight away.
ensure_helper() {
  local NAME="com.cratedigger.updater" ID="mhoonaimgahglpomeilibppkjagipdib"
  local HDIR="$HOME/.crate-digger" HOST="$HOME/.crate-digger/native-host.sh"
  mkdir -p "$HDIR"
  cat > "$TMP/host.sh" <<'HOSTEOF'
#!/bin/bash
# Crate Digger: lets the "Check for updates" button run the updater straight away.
# Chrome starts this and talks to it through stdin/stdout (native messaging). Written by update.sh.
UPDATER="__UPDATER__"
EXT="__EXT__"
SS="__SS__"
LOG="$HOME/Library/Logs/Crate Digger Updater.log"
len=$(head -c 4 | od -An -tu4 | tr -d ' \n')
msg=""
[ -n "$len" ] && [ "$len" -gt 0 ] 2>/dev/null && msg=$(head -c "$len")
ver() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$EXT/manifest.json" 2>/dev/null | head -1; }
esc() { sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/ /g' | awk 'BEGIN { ORS = "\\n" } { print }'; }
reply() {
  local n
  n=$(printf '%s' "$1" | wc -c | tr -d ' ')
  printf "$(printf '\\%03o\\%03o\\%03o\\%03o' $((n & 255)) $(((n >> 8) & 255)) $(((n >> 16) & 255)) $(((n >> 24) & 255)))"
  printf '%s' "$1"
}
case "$msg" in
  *'"update"'*)
    before=$(ver)
    start=0; [ -f "$LOG" ] && start=$(wc -l < "$LOG" | tr -d ' ')
    /bin/bash "$UPDATER" "$EXT" "$SS" >/dev/null 2>&1
    after=$(ver)
    lines=""; [ -f "$LOG" ] && lines=$(tail -n +$((start + 1)) "$LOG" | tail -n 8 | esc)
    reply "{\"ok\":true,\"before\":\"$before\",\"after\":\"$after\",\"log\":\"$lines\"}" ;;
  *)
    reply "{\"ok\":true,\"version\":\"$(ver)\"}" ;;
esac
HOSTEOF
  local c; c="$(cat "$TMP/host.sh")"
  c="${c/__UPDATER__/$SELF}"; c="${c/__EXT__/$EXT}"; c="${c/__SS__/$SS}"
  printf '%s\n' "$c" > "$TMP/host.sh"
  if ! cmp -s "$TMP/host.sh" "$HOST"; then cp "$TMP/host.sh" "$HOST" && chmod 755 "$HOST"; fi
  local J="{\"name\":\"$NAME\",\"description\":\"Crate Digger updater\",\"path\":\"$HOST\",\"type\":\"stdio\",\"allowed_origins\":[\"chrome-extension://$ID/\"]}"
  local d
  for d in "${BROWSERS[@]}"; do
    [ -d "$d" ] || continue
    mkdir -p "$d/NativeMessagingHosts" && printf '%s\n' "$J" > "$d/NativeMessagingHosts/$NAME.json"
  done
}
if [ -n "$CD_NMH_DIR" ]; then BROWSERS=("$CD_NMH_DIR"); else
  BROWSERS=("$HOME/Library/Application Support/Google/Chrome" "$HOME/Library/Application Support/Google/Chrome Beta"
            "$HOME/Library/Application Support/Chromium" "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"); fi
ensure_helper

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
