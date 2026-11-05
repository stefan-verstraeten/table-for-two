#!/usr/bin/env python3
"""Bump the app version and refresh the service worker's file list.

Run before every release:  python3 tools/bump.py
Changing sw.js is what makes installed phones show "A new version is ready".
"""
import datetime, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {'.git', 'tools', '.github', '.claude'}
SKIP_FILES = {'sw.js', 'README.md', '.nojekyll', '.gitignore', 'CLAUDE.md'}

def assets():
    out = ['./']
    for d, dirs, files in os.walk(ROOT):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith('.'))
        for f in sorted(files):
            rel = os.path.relpath(os.path.join(d, f), ROOT)
            if f in SKIP_FILES or f.startswith('.') or rel.startswith('icons/icon-1024'):
                continue
            out.append(rel)
    return out

def main():
    today = datetime.date.today().strftime('%Y.%m.%d')
    sw_path = os.path.join(ROOT, 'sw.js')
    sw = open(sw_path).read()
    old = re.search(r"const VERSION = '([^']+)'", sw).group(1)
    n = int(old.rsplit('-', 1)[1]) + 1 if old.startswith(today) else 1
    version = f'{today}-{n}'
    sw = re.sub(r"const VERSION = '[^']+'", f"const VERSION = '{version}'", sw)
    listing = ',\n'.join(f"  '{a}'" for a in assets())
    sw = re.sub(r"const ASSETS = \[.*?\];", f"const ASSETS = [\n{listing},\n];", sw, flags=re.S)
    open(sw_path, 'w').write(sw)

    cfg_path = os.path.join(ROOT, 'js', 'config.js')
    cfg = open(cfg_path).read()
    cfg = re.sub(r"APP_VERSION = '[^']+'", f"APP_VERSION = '{version}'", cfg)
    open(cfg_path, 'w').write(cfg)
    print('Version', version)

if __name__ == '__main__':
    main()
