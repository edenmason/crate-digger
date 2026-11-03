#!/bin/bash
# ------------------------------------------------------------------
#  Crate Digger installer: double-click this file.
#  Sets up Crate Digger (Chrome extension) + Sockseek (Soulseek downloader)
#  in your home folder, with downloads going to Music/Crate Digger Downloads.
#  Safe to run again later (e.g. to change your Soulseek login).
# ------------------------------------------------------------------
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Applications/Crate Digger"
EXT="$APP/Crate Digger extension"
SS="$APP/Sockseek"
DL="$HOME/Music/Crate Digger Downloads"
LABEL="com.cratedigger.sockseek"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Crate Digger Sockseek.log"
UPD="$APP/Updater"
ULABEL="com.cratedigger.updater"
UPLIST="$HOME/Library/LaunchAgents/$ULABEL.plist"
SOCKSEEK_VERSION="3.0.6"

clear
echo "Crate Digger installer"
echo "======================"
echo "(You can ignore this window, answer the pop-ups instead.)"
echo

# --- little helpers: Mac pop-ups (text is passed as arguments, so any characters are safe) ---
msg() {  # msg "text" ["Button"]
  osascript - "$1" "${2:-OK}" <<'EOF' >/dev/null 2>&1
on run argv
  display dialog (item 1 of argv) buttons {item 2 of argv} default button 1 with title "Crate Digger" with icon note
end run
EOF
}
confirm() {  # confirm "text" "Yes-button"  -> 0 if Yes
  osascript - "$1" "$2" <<'EOF' >/dev/null 2>&1
on run argv
  display dialog (item 1 of argv) buttons {"Cancel", item 2 of argv} default button 2 cancel button 1 with title "Crate Digger" with icon note
end run
EOF
}
ask() {  # ask "text" "default" [hidden]  -> prints answer, exit status 1 if cancelled
  osascript - "$1" "$2" "${3:-}" <<'EOF' 2>/dev/null
on run argv
  if (item 3 of argv) is "hidden" then
    set r to display dialog (item 1 of argv) default answer (item 2 of argv) with hidden answer buttons {"Cancel", "Next"} default button 2 cancel button 1 with title "Crate Digger" with icon note
  else
    set r to display dialog (item 1 of argv) default answer (item 2 of argv) buttons {"Cancel", "Next"} default button 2 cancel button 1 with title "Crate Digger" with icon note
  end if
  return text returned of r
end run
EOF
}
fail() { echo "!! $1"; msg "Something went wrong: $1

Nothing on your Mac was damaged. Send a photo of this message to whoever gave you the installer."; exit 1; }

# --- 1. checks ---
[ -d "$HERE/Crate Digger extension" ] || fail "The installer files are incomplete. Copy the whole installer folder, not just this file."
CHROME=""
for c in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app"; do [ -d "$c" ] && CHROME="$c"; done

confirm "Welcome! This sets up Crate Digger on this Mac:

• Crate Digger, for saving tracks from Bandcamp, SoundCloud, YouTube and Discogs into playlists
• Sockseek, which downloads them from Soulseek in lossless quality
• Automatic updates, so new versions arrive by themselves

Downloads will go into Music → Crate Digger Downloads.

You'll need a Soulseek username and password. If you don't have one, just make one up on the next screen; Soulseek creates it the first time it's used." "Set it up" || { echo "Cancelled."; exit 0; }

# --- 2. Soulseek login (reuse the old username if reinstalling) ---
OLDUSER=""
[ -f "$SS/sockseek.conf" ] && OLDUSER="$(grep -E '^[[:space:]]*username[[:space:]]*=' "$SS/sockseek.conf" | head -1 | sed -E 's/^[^=]*=[[:space:]]*//')"
while :; do
  SLUSER="$(ask "Soulseek username:

(Use a different one from any Soulseek app you already use, or the two will keep logging each other out.)" "$OLDUSER")" || { echo "Cancelled."; exit 0; }
  SLUSER="$(printf '%s' "$SLUSER" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  [ -n "$SLUSER" ] && break
  msg "Please type a username."
done
while :; do
  SLPASS="$(ask "Soulseek password for $SLUSER:" "" hidden)" || { echo "Cancelled."; exit 0; }
  [ -n "$SLPASS" ] && break
  msg "Please type a password."
done

# --- 3. copy files ---
echo "Installing into $APP ..."
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1
mkdir -p "$APP" "$SS" "$DL" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" || fail "Couldn't create folders in your home folder."
ditto "$HERE/Crate Digger extension" "$EXT" || fail "Couldn't copy the Crate Digger extension."
if [ -f "$HERE/Sockseek/sockseek" ]; then
  ditto "$HERE/Sockseek/sockseek" "$SS/sockseek" || fail "Couldn't copy Sockseek."
  [ -f "$HERE/Sockseek/LICENSE" ] && ditto "$HERE/Sockseek/LICENSE" "$SS/LICENSE"
elif [ ! -f "$SS/sockseek" ]; then
  echo "Downloading Sockseek $SOCKSEEK_VERSION ..."
  ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || ARCH="x64"
  T="$(mktemp -d)"
  curl -fsSL -o "$T/ss.tgz" "https://github.com/fiso64/sockseek/releases/download/v$SOCKSEEK_VERSION/sockseek_${SOCKSEEK_VERSION}_osx-$ARCH.tar.gz" \
    && tar xzf "$T/ss.tgz" -C "$T" && ditto "$T/sockseek" "$SS/sockseek" || fail "Couldn't download Sockseek. Check the internet connection and try again."
  [ -f "$T/LICENSE" ] && ditto "$T/LICENSE" "$SS/LICENSE"
  rm -rf "$T"
fi
[ -f "$SS/.sockseek-version" ] || echo "$SOCKSEEK_VERSION" > "$SS/.sockseek-version"
[ -f "$HERE/How to install.txt" ] && ditto "$HERE/How to install.txt" "$APP/How to install.txt"
chmod +x "$SS/sockseek"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null

# --- 4. Sockseek settings (login stays private to this Mac user) ---
umask 077
{
  echo "# Sockseek settings, written by the Crate Digger installer."
  echo "# To change your Soulseek login, just run the installer again."
  echo "username = $SLUSER"
  echo "password = $SLPASS"
  echo "output-dir = $DL"
  echo "format = flac,wav,aiff"
  echo "length-tol = -1"
  echo "pref-length-tol = 3"
} > "$SS/sockseek.conf" || fail "Couldn't save the Sockseek settings."
umask 022
unset SLPASS

# --- 5. starting settings for the extension (download folder etc.) ---
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
cat > "$EXT/defaults.json" <<EOF
{
  "version": "install-$(date +%Y%m%d%H%M%S)",
  "settings": {
    "dlBase": "$(json_escape "$DL")",
    "dlDateFolders": true,
    "dlQuality": "lossless",
    "ssHint": "Sockseek normally starts by itself when you log in. If it hasn't, double-click Restart Sockseek in your home folder → Applications → Crate Digger → Sockseek."
  }
}
EOF

# --- 6. helper buttons ---
cat > "$SS/Restart Sockseek.command" <<EOF
#!/bin/bash
# Double-click if Crate Digger says Sockseek isn't running.
launchctl kickstart -k "gui/\$(id -u)/$LABEL" 2>/dev/null || { launchctl unload "$PLIST" 2>/dev/null; launchctl load -w "$PLIST"; }
echo "Sockseek restarted. You can close this window."
EOF
cat > "$APP/Uninstall Crate Digger.command" <<EOF
#!/bin/bash
# Removes Crate Digger + Sockseek from this Mac. Your downloaded music is NOT touched.
read -r -p "Remove Crate Digger and Sockseek from this Mac? Your downloads stay. (y/n) " a
[ "\$a" = "y" ] || [ "\$a" = "Y" ] || exit 0
launchctl bootout "gui/\$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1
launchctl bootout "gui/\$(id -u)" "$UPLIST" >/dev/null 2>&1 || launchctl unload "$UPLIST" >/dev/null 2>&1
rm -f "$PLIST" "$UPLIST"
rm -rf "$APP"
echo
echo "Done. Last step: in Chrome open chrome://extensions and click Remove on Crate Digger."
EOF
chmod +x "$SS/Restart Sockseek.command" "$APP/Uninstall Crate Digger.command"

# --- 6b. automatic updates from GitHub (every 6 hours and at login) ---
mkdir -p "$UPD"
for u in "$HERE/Updater/update.sh" "$HERE/updater/update.sh"; do [ -f "$u" ] && ditto "$u" "$UPD/update.sh" && break; done
if [ -f "$UPD/update.sh" ]; then
  chmod +x "$UPD/update.sh"
  launchctl bootout "gui/$(id -u)" "$UPLIST" >/dev/null 2>&1 || launchctl unload "$UPLIST" >/dev/null 2>&1
  cat > "$UPLIST" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ULABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$UPD/update.sh</string><string>$EXT</string><string>$SS</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>21600</integer>
</dict>
</plist>
EOF2
  launchctl bootstrap "gui/$(id -u)" "$UPLIST" >/dev/null 2>&1 || launchctl load -w "$UPLIST" >/dev/null 2>&1
fi

# --- 7. start Sockseek automatically (now, and whenever you log in) ---
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$SS/sockseek</string>
    <string>daemon</string>
    <string>-c</string>
    <string>$SS/sockseek.conf</string>
  </array>
  <key>WorkingDirectory</key><string>$SS</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load -w "$PLIST" >/dev/null 2>&1

echo "Waiting for Sockseek to start..."
UP=""
for i in $(seq 1 25); do
  if curl -s -m 2 http://127.0.0.1:5030/api/server/info >/dev/null 2>&1; then UP=1; break; fi
  sleep 1
done
if [ -n "$UP" ]; then echo "Sockseek is running."; else echo "Sockseek didn't answer yet (see $LOG)."; fi

# --- 8. Chrome: the one part that has to be done by hand ---
printf '%s' "$EXT" | pbcopy
if [ -z "$CHROME" ]; then
  msg "Almost done! Sockseek is set up.

Google Chrome isn't installed on this Mac. Install it from google.com/chrome, then double-click this installer again to finish." "OK"
  open "https://www.google.com/chrome/"
  exit 0
fi
open -a "$CHROME" "chrome://extensions/" 2>/dev/null
open -R "$EXT"
msg "Last bit, in Chrome (the Extensions page is opening now):

1.  Top right: switch on Developer mode.
2.  Drag the highlighted Crate Digger extension folder from the Finder window onto the Chrome page.
     (Or click Load unpacked, press ⌘⇧G, press ⌘V, press Return, then click Select.)
3.  Click the puzzle-piece icon in Chrome's toolbar and pin Crate Digger.

Then click the Crate Digger icon. It opens on the side of the window. The Download tab should show a green light.$( [ -z "$UP" ] && printf '\n\n(Sockseek was slow to start. If the light is not green, double-click Restart Sockseek in Applications → Crate Digger → Sockseek in your home folder.)' )" "Done"

echo
echo "All set. You can close this window."
