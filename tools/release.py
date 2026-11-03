#!/usr/bin/env python3
"""Build and publish a Crate Digger release to GitHub.

  python3 tools/release.py "What changed, line 1" "line 2" ...      # build dist/ and publish
  python3 tools/release.py --build-only "notes"                       # just build dist/

Assets: version.json, crate-digger-extension.zip, update.sh, Crate-Digger-Installer.zip
The updater on each Mac reads releases/latest, so publishing is what ships an update.
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
if build_only: sys.exit(0)

def gh(*a, inp=None):
    r = subprocess.run(['gh', 'api', *a], input=inp, capture_output=True)
    if r.returncode: raise SystemExit(r.stderr.decode() or r.stdout.decode())
    return json.loads(r.stdout or b'{}')
body = '\n'.join(f'- {n}' for n in notes) or 'Updates and fixes.'
rel = gh('--method', 'POST', f'repos/{REPO}/releases', '-f', f'tag_name=v{version}', '-f', 'target_commitish=main',
         '-f', f'name=Crate Digger {version}', '-f', f'body={body}')
for f in ['version.json', 'crate-digger-extension.zip', 'update.sh', 'Crate-Digger-Installer.zip']:
    ctype = 'application/json' if f.endswith('.json') else 'application/zip' if f.endswith('.zip') else 'text/x-shellscript'
    gh('--method', 'POST', '-H', f'Content-Type: {ctype}', f"https://uploads.github.com/repos/{REPO}/releases/{rel['id']}/assets?name={f}",
       '--input', os.path.join(dist, f))
    print('uploaded', f)
print('released', rel['html_url'])
