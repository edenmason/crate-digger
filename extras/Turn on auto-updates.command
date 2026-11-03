#!/bin/bash
# ------------------------------------------------------------------
#  Double-click once. Crate Digger in THIS folder will then keep itself
#  up to date from GitHub (checks every 6 hours and at login).
#  For a Crate Digger folder you set up by hand (e.g. on an external drive).
#  The installer already does this for you, so you don't need it after "Install Crate Digger".
# ------------------------------------------------------------------
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT="$HERE/Crate Digger extension"
SS="$HERE/Sockseek"
DEST="$HOME/Library/Application Support/Crate Digger"
ULABEL="com.cratedigger.updater"
UPLIST="$HOME/Library/LaunchAgents/$ULABEL.plist"
msg() { osascript - "$1" <<'OSA' >/dev/null 2>&1
on run argv
  display dialog (item 1 of argv) buttons {"OK"} default button 1 with title "Crate Digger" with icon note
end run
OSA
}
[ -f "$EXT/manifest.json" ] && [ -f "$HERE/Updater/update.sh" ] || { msg "Couldn't find the Crate Digger extension and Updater folders next to this file."; exit 1; }
mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
cp -f "$HERE/Updater/update.sh" "$DEST/update.sh" && chmod +x "$DEST/update.sh"
[ -f "$SS/sockseek" ] && [ ! -f "$SS/.sockseek-version" ] && echo "3.0.6" > "$SS/.sockseek-version"
launchctl bootout "gui/$(id -u)" "$UPLIST" >/dev/null 2>&1 || launchctl unload "$UPLIST" >/dev/null 2>&1
cat > "$UPLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ULABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DEST/update.sh</string><string>$EXT</string><string>$SS</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>21600</integer>
</dict>
</plist>
PL
launchctl bootstrap "gui/$(id -u)" "$UPLIST" >/dev/null 2>&1 || launchctl load -w "$UPLIST" >/dev/null 2>&1
echo "Checking for an update now..."
/bin/bash "$DEST/update.sh" "$EXT" "$SS"
tail -n 3 "$HOME/Library/Logs/Crate Digger Updater.log" 2>/dev/null
msg "✓ Auto-updates are on.

Crate Digger will check GitHub every 6 hours (and when you log in) and update itself. You'll see \"✓ Crate Digger updated\" in the side panel when it does.

If the drive isn't plugged in, it just skips that check."
