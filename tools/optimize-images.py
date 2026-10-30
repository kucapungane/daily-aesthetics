#!/usr/bin/env python3
"""Give every lesson photograph the copies the site serves: NAME.webp (at most 1400 px) and NAME-480.webp
for phones. Runs in the deploy job before the build, so a lesson gets them however it was imported.
Only JPEGs are converted; diagrams stay PNG. Files that already have their WebP are left alone.

    python3 tools/optimize-images.py        (needs Pillow)
"""
import glob, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
done = 0
for path in sorted(glob.glob(os.path.join(ROOT, 'lessons', 'img', '*.jp*g'))):
    base = path.rsplit('.', 1)[0]
    if base.endswith('-480') or os.path.exists(f'{base}.webp'):
        continue
    with Image.open(path) as im:
        im = im.convert('RGB')
    if max(im.size) > 1400:
        im.thumbnail((1400, 1400))
    im.save(f'{base}.webp', 'WEBP', quality=70, method=6)
    if im.width > 480:
        im.resize((480, round(im.height * 480 / im.width))).save(f'{base}-480.webp', 'WEBP', quality=68, method=6)
    done += 1
    print('webp', os.path.relpath(base, ROOT))
print(f'{done} picture(s) given WebP copies')
