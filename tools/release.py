#!/usr/bin/env python3
"""Build and publish a Crate Digger update (to the repo's "updates" branch).

  python3 tools/release.py "What changed, line 1" "line 2" ...      # build dist/ and publish
  python3 tools/release.py --build-only "notes"                       # just build dist/

Assets: version.json, crate-digger-extension.zip, update.sh, Crate-Digger-Installer.zip
The updater on each Mac reads the updates branch, so publishing is what ships an update.
"""
import json, os, re, shutil, subprocess, sys, zipfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = 'edenmason/crate-digger'
SOCKSEEK = '3.0.6'
args = sys.argv[1:]
build_only = '--build-only' in args
notes = [a for a in args if a != '--build-only']
ext = os.path.join(ROOT, 'extension')
version = json.load(open(os.path.join(ext, 'manifest.json')))['version']
updater_v = re.search(r'UPDATER_VERSION="(\d+)"', open(os.path.join(ROOT, 'updater', 'update.sh')).read()).group(1)
dist = os.path.join(ROOT, 'dist'); shutil.rmtree(dist, ignore_errors=True); os.makedirs(dist)

def add_tree(z, src, prefix):
    for base, dirs, files in os.walk(src):
        for f in sorted(files):
            if f in ('seed-backup.json', 'defaults.json', '.DS_Store') or f.startswith('._'): continue
            p = os.path.join(base, f)
            info = zipfile.ZipInfo(os.path.join(prefix, os.path.relpath(p, src)))
            info.external_attr = (0o755 if f.endswith(('.command', '.sh')) else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, open(p, 'rb').read())

whats_new = json.dumps({'version': version, 'notes': notes}, indent=2, ensure_ascii=False)
with zipfile.ZipFile(os.path.join(dist, 'crate-digger-extension.zip'), 'w') as z:
    add_tree(z, ext, ''); z.writestr('whats-new.json', whats_new)
with zipfile.ZipFile(os.path.join(dist, 'Crate-Digger-Installer.zip'), 'w') as z:
    top = 'Crate Digger Installer'
    add_tree(z, os.path.join(ROOT, 'installer'), top)
    add_tree(z, ext, f'{top}/Crate Digger extension'); z.writestr(f'{top}/Crate Digger extension/whats-new.json', whats_new)
    add_tree(z, os.path.join(ROOT, 'updater'), f'{top}/Updater')
shutil.copy(os.path.join(ROOT, 'updater', 'update.sh'), dist)
json.dump({'extension': version, 'sockseek': SOCKSEEK, 'updater': updater_v, 'notes': notes},
          open(os.path.join(dist, 'version.json'), 'w'), indent=2, ensure_ascii=False)
print('built', version, '->', sorted(os.listdir(dist)))
body = '\n'.join(f'- {n}' for n in notes) or 'Updates and fixes.'
if build_only: sys.exit(0)

# Publish: commit dist/ to the "updates" branch. The updater on each Mac reads that branch.
import tempfile
def git(*a, cwd=ROOT):
    r = subprocess.run(['git', *a], cwd=cwd, capture_output=True, text=True)
    if r.returncode: raise SystemExit(f"git {' '.join(a)} failed:\n{r.stderr or r.stdout}")
    return r.stdout.strip()
wt = tempfile.mkdtemp(prefix='cd-updates-')
has_branch = subprocess.run(['git', 'ls-remote', '--exit-code', 'origin', 'updates'], cwd=ROOT, capture_output=True).returncode == 0
if has_branch:
    git('fetch', '-q', 'origin', 'updates:refs/remotes/origin/updates')
    git('worktree', 'add', '-q', '-B', 'updates', wt, 'origin/updates')
else:
    git('worktree', 'add', '-q', '--detach', wt)
    git('checkout', '-q', '--orphan', 'updates', cwd=wt)
    git('rm', '-rfq', '.', cwd=wt)
for f in os.listdir(wt):
    if f != '.git': (shutil.rmtree if os.path.isdir(os.path.join(wt, f)) else os.remove)(os.path.join(wt, f))
for f in os.listdir(dist): shutil.copy(os.path.join(dist, f), wt)
open(os.path.join(wt, 'README.md'), 'w').write(f"""# Crate Digger updates

This branch holds the **published** version of Crate Digger. The updater on each Mac checks `version.json` here
every few hours and installs anything newer. Don't edit by hand; `tools/release.py` on `main` writes it.

**Current version: {version}**

{body}

To install on a new Mac: download [Crate-Digger-Installer.zip](https://github.com/{REPO}/raw/updates/Crate-Digger-Installer.zip),
unzip it and double-click **Install Crate Digger**.
""")
git('add', '-A', cwd=wt)
git('commit', '-q', '-m', f'Publish Crate Digger {version}\n\n{body}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01Njrh59FsUXpibw1tCPuikF', cwd=wt)
git('push', '-q', 'origin', 'HEAD:updates', cwd=wt)
git('worktree', 'remove', '--force', wt)
print(f'published {version} to the "updates" branch: https://github.com/{REPO}/tree/updates')
