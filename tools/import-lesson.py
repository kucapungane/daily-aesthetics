#!/usr/bin/env python3
"""Turn one lesson exported from Google Docs into lessons/NNN.html for the site.

    python3 -I tools/import-lesson.py EXPORT --title "第002堂｜模仿論" --created 2026-10-30T22:58:00Z [--doc URL]

EXPORT is the Google Docs HTML export: either the raw .html, or the JSON file the Google Drive
download tool saves ({"content": <base64 or html>, ...}). Embedded pictures (data: URIs) are saved
to lessons/img/NNN-K.ext; linked pictures keep their URL. The date is the creation time in Taipei.
Standard library only.
"""
import argparse, base64, binascii, html as H, json, os, re, sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOMAINS = ['電影', '劇場', '空間設計', '視覺構圖', '舞蹈', '攝影', '音樂']
KEEP = {'h2', 'h3', 'p', 'ol', 'ul', 'li', 'table', 'tr', 'td', 'th', 'a', 'img', 'em', 'strong', 'br'}


def read_export(path):
    raw = open(path, encoding='utf-8').read()
    if raw.lstrip().startswith('{'):
        content = json.loads(raw)['content']
        try:
            return base64.b64decode(content, validate=True).decode('utf-8')
        except (binascii.Error, UnicodeDecodeError, ValueError):
            return content
    return raw


def clean(src, number, img_dir):
    css = ' '.join(re.findall(r'<style[^>]*>(.*?)</style>', src, re.S))
    bold = set(re.findall(r'\.(c\d+)\{[^}]*font-weight:700', css))
    ital = set(re.findall(r'\.(c\d+)\{[^}]*font-style:italic', css))
    body = src[src.find('<body'):] if '<body' in src else src
    out, stack, saved = [], [], []

    class P(HTMLParser):
        def handle_starttag(self, t, a):
            a = dict(a)
            cls = set((a.get('class') or '').split())
            if t == 'span':
                tags = (['strong'] if cls & bold else []) + (['em'] if cls & ital else [])
                stack.append(tags)
                out.extend(f'<{x}>' for x in tags)
                return
            if t in ('br',):
                out.append('<br>')
                return
            if t not in KEEP:
                stack.append([])
                return
            if t == 'a':
                h = a.get('href', '')
                if 'google.com/url' in h:
                    h = parse_qs(urlparse(h).query).get('q', [h])[0]
                out.append(f'<a href="{H.escape(h)}">')
                stack.append(['a'])
                return
            if t == 'img':
                s = a.get('src', '')
                m = re.match(r'data:image/([a-z+]+);base64,(.+)', s, re.S)
                if m:
                    ext = {'jpeg': 'jpg', 'svg+xml': 'svg'}.get(m.group(1), m.group(1))
                    name = f'{number:03d}-{len(saved) + 1}.{ext}'
                    saved.append((name, base64.b64decode(m.group(2))))
                    s = f'img/{name}'
                out.append(f'<img src="{H.escape(s)}" alt="">')
                return
            out.append(f'<{t}>')
            stack.append([t])

        def handle_endtag(self, t):
            if t in ('img', 'br') or not stack:
                return
            for x in reversed(stack.pop()):
                out.append(f'</{x}>')

        def handle_data(self, d):
            out.append(H.escape(d, quote=False))

    P().feed(body)
    s = ''.join(out)
    s = re.sub(r'<(strong|em)></\1>', '', s)
    s = re.sub(r'</strong><strong>|</em><em>', '', s)
    s = re.sub(r'<p>\s*</p>', '', s)
    s = re.sub(r'\s+', ' ', s).replace('> <', '><')
    s = re.sub(r'(</(p|h2|li|tr|table|ol|ul)>)', r'\1\n', s)
    os.makedirs(img_dir, exist_ok=True)
    for name, data in saved:
        path = os.path.join(img_dir, name)
        open(path, 'wb').write(data)
        shrink(path)
    return s, len(saved)


def shrink(path, longest=1400):
    """Make a picture no larger than a lesson page shows it: at most 1400 px on its longer side, JPEGs at
    quality 75. Needs Pillow; without it the picture is kept as exported."""
    try:
        from PIL import Image
    except ImportError:
        return
    with Image.open(path) as im:
        big = max(im.size) > longest
        if not big and not path.lower().endswith(('.jpg', '.jpeg')):
            return
        im = im.copy()
    if big:
        im.thumbnail((longest, longest))
    if path.lower().endswith(('.jpg', '.jpeg')):
        im = im.convert('RGB')
        im.save(path, 'JPEG', quality=75, optimize=True, progressive=True)
        # the site serves photographs as WebP (NAME.webp), and phones the 480 px copy (NAME-480.webp)
        base = path.rsplit('.', 1)[0]
        try:
            im.save(f'{base}.webp', 'WEBP', quality=70, method=6)
            if im.width > 480:
                im.resize((480, round(im.height * 480 / im.width))).save(f'{base}-480.webp', 'WEBP', quality=68, method=6)
        except (OSError, KeyError):
            pass  # this Pillow has no WebP encoder; the JPEG alone is served
    else:
        im.save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('export')
    ap.add_argument('--title', required=True, help='the Drive title, e.g. 第002堂｜模仿論')
    ap.add_argument('--created', required=True, help="the file's createdTime (RFC 3339)")
    ap.add_argument('--doc', default='', help='the Google Docs URL')
    o = ap.parse_args()
    m = re.match(r'\s*第\s*(\d+)\s*堂\s*[｜|]\s*(.+?)\s*$', o.title)
    if not m:
        sys.exit(f'title does not look like 第NNN堂｜主題: {o.title!r}')
    number, title = int(m.group(1)), m.group(2)
    created = datetime.fromisoformat(o.created.replace('Z', '+00:00'))
    date = created.astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    body, n_img = clean(read_export(o.export), number, os.path.join(ROOT, 'lessons', 'img'))
    heads = re.findall(r'<h2>(.*?)</h2>', body)
    if len(heads) < 6:
        sys.exit(f'only {len(heads)} <h2> sections found; is this a lesson?')
    pick = lambda pat: next((d for h in heads if re.search(pat, h) for d in DOMAINS if d in h), '')
    meta = ['<!-- lesson', f'number: {number}', f'title: {title}', f'date: {date}',
            f'domain: {pick("主例")}', f'contrast: {pick("對照")}', f'doc: {o.doc}', '-->']
    path = os.path.join(ROOT, 'lessons', f'{number:03d}.html')
    open(path, 'w', encoding='utf-8').write('\n'.join(meta) + '\n' + body)
    print(f'wrote lessons/{number:03d}.html: {title}, {date}, {len(heads)} sections, {n_img} embedded picture(s)')


if __name__ == '__main__':
    main()
