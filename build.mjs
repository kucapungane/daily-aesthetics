#!/usr/bin/env node
// 每日美學課程: builds the static site into dist/ from lessons/NNN.html.
//
//   node build.mjs            (SITE_URL=https://… for absolute links in the feed)
//
// A lesson file is the same HTML the daily routine writes to Google Drive, headed by a comment:
//   <!-- lesson
//   number: 1
//   title: 美學一詞的誕生
//   date: 2026-10-29
//   domain: 攝影
//   contrast: 音樂
//   doc: https://docs.google.com/…
//   -->
// followed by the eight <h2> sections. Pictures are remote URLs, or files in lessons/img/.
// Zero dependencies. Node 18+.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'dist');
const SITE_URL = (process.env.SITE_URL || 'https://kucapungane.github.io/daily-aesthetics').replace(/\/$/, '');
const NAME = '每日美學課程';
const PUBLISH_TIME = '06:53';
const DOMAINS = ['電影', '劇場', '空間設計', '視覺構圖', '舞蹈', '攝影', '音樂'];
// the source types every paragraph declares (the routine's rules, step 2)
const SOURCE_TYPES = ['經典理論', '實證研究', '史料', '依二手文獻', '傳說', '已被反駁', '史料研究'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const num3 = (n) => String(n).padStart(3, '0');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const longDate = (d) => { const [y, m, day] = d.split('-').map(Number); const w = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); return `${y} 年 ${m} 月 ${day} 日 · 星期${WEEK[w]}`; };
const dotDate = (d) => d.replace(/-/g, '.');

// ---------- image sizes ----------
// Width and height from a local PNG, JPEG, GIF or WebP file's header, so every <img> can carry them.
function imageSize(src) {
  if (!src || /^https?:|^data:/.test(src)) return null;
  const file = join(ROOT, 'lessons', src.replace(/^\.?\//, ''));
  let b; try { b = readFileSync(file); } catch { return null; }
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const k = b.toString('ascii', 12, 16);
    if (k === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (k === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (k === 'VP8L') { const n = b.readUInt32LE(21); return { w: 1 + (n & 0x3fff), h: 1 + ((n >> 14) & 0x3fff) }; }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}
const sizeAttrs = (src) => { const d = imageSize(src); return d ? ` width="${d.w}" height="${d.h}"` : ''; };

// ---------- sanitize ----------
// The site is public, so a lesson file may only carry text markup: an allowlist of tags, of attributes
// (href and src, plus an image's size), and of link and picture schemes. Everything else is dropped, and
// the elements that can run or embed something are dropped with their contents.
const ALLOWED_TAGS = new Set(['h2', 'h3', 'p', 'br', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'em', 'strong', 'b', 'i', 'sup', 'sub', 'blockquote', 'span']);
const DROP_WITH_CONTENT = /<(script|style|iframe|frame|frameset|object|embed|applet|form|svg|math|template|noscript|textarea|select|button|video|audio|canvas|head|title)\b[\s\S]*?<\/\1\s*>/gi;
const safeHref = (u) => /^(https?:|mailto:|#|\.{0,2}\/|[^:]*$)/i.test(u.trim());
const safeSrc = (u) => /^(https:|http:|data:image\/(png|jpe?g|gif|webp);base64,|img\/|\.{0,2}\/)/i.test(u.trim()) || /^[\w./-]+$/.test(u.trim());
function sanitize(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_CONTENT, '');
  return html.replace(/<\/?([a-zA-Z][\w-]*)\b([^>]*)>/g, (tag, name, attrs) => {
    name = name.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (tag.startsWith('</')) return `</${name}>`;
    const get = (a) => attrs.match(new RegExp(`\\b${a}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((v) => v !== undefined);
    let out = '';
    if (name === 'a') { const h = get('href'); if (h !== undefined && safeHref(h.replace(/&amp;/g, '&'))) out += ` href="${h.replace(/"/g, '&quot;')}"`; }
    if (name === 'img') {
      const s = get('src'); if (s === undefined || !safeSrc(s.replace(/&amp;/g, '&'))) return '';
      out += ` src="${s.replace(/"/g, '&quot;')}"`;
      for (const a of ['width', 'height']) { const v = get(a); if (v && /^\d{1,4}$/.test(v)) out += ` ${a}="${v}"`; }
    }
    return `<${name}${out}>`;
  });
}

// ---------- read lessons ----------
function parseLesson(file) {
  const raw = readFileSync(join(ROOT, 'lessons', file), 'utf8');
  const m = raw.match(/<!--\s*lesson\s*([\s\S]*?)-->/);
  if (!m) throw new Error(`${file}: no <!-- lesson … --> header`);
  const meta = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^\s*([a-z]+)\s*:\s*(.*?)\s*$/)).filter(Boolean).map((x) => [x[1], x[2]]));
  const number = Number(meta.number || file.match(/\d+/)?.[0]);
  if (!number || !meta.title || !/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) throw new Error(`${file}: the header needs number, title and date (YYYY-MM-DD)`);
  // body only: drop the header and anything a full document wraps around it
  let body = raw.replace(m[0], '');
  const b = body.match(/<body[^>]*>([\s\S]*)<\/body>/i); if (b) body = b[1];
  body = sanitize(body);
  const parts = body.split(/<h2[^>]*>/i).slice(1).map((p) => { const [h, ...rest] = p.split(/<\/h2>/i); return { heading: strip(h), html: rest.join('</h2>') }; });
  if (!parts.length) throw new Error(`${file}: no <h2> sections`);
  const sec = (re) => parts.find((p) => re.test(p.heading));
  const lead = strip(sec(/今日重點/)?.html || parts[0].html);
  return { file, ...meta, number, id: num3(number), parts, lead };
}

// ---------- lesson body: figures, stamps, practice timer ----------
const imgSrc = (src, depth) => { src = src.replace(/&amp;/g, '&'); return /^https?:/.test(src) ? src : `${'../'.repeat(depth)}lessons/${src.replace(/^\.?\//, '')}`; };

function stamps(html) {
  // "史料｜一篇談詩的學位論文。 Rest" -> a stamp, the lead sentence in bold, then the rest
  html = html.replace(/<p>\s*((?:<(?:strong|em)>)*)\s*(經典理論|實證研究|史料|傳說|已被反駁|依二手文獻)(，依二手文獻)?([｜|。])\s*/g, (all, open, type, second, sep) => {
    const marks = `<mark class="src src-${SOURCE_TYPES.indexOf(type)}"${sep === '。' ? '' : ` data-open="${(open.match(/<(strong|em)>/g) || []).length}"`}>${type}</mark>${second ? `<mark class="src src-3">依二手文獻</mark>` : ''}`;
    // "類型。 正文" has no title of its own: keep any bold the routine opened around the label only
    return `<p>${marks}${sep === '。' && open ? open.replace(/<(strong|em)>/g, '') : ''}`;
  });
  // the lead sentence after the stamp goes bold; tags the routine opened before the stamp close right after it
  html = html.replace(/(<mark class="src[^"]*" data-open="(\d)">[^<]+<\/mark>)((?:(?!<\/p>)[^。？<])+[。？])((?:\s*<\/(?:strong|em)>){0,2})/g, (all, mark, n, lead, closers) => `${mark.replace(/ data-open="\d"/, '')}<strong class="lead-in">${lead}</strong>${closers.replace(/<\/(strong|em)>/g, '').trimEnd()}`);
  html = html.replace(/ data-open="\d"/g, '');
  html = html.replace(/<strong class="lead-in">([\s\S]*?)<\/strong>/g, (a, inner) => `<strong class="lead-in">${inner.replace(/<\/?strong>/g, '')}</strong>`);
  // inline declarations: （經典理論） or （經典理論，《Aesthetica》§1）
  html = html.replace(/（(經典理論|實證研究|史料|傳說|已被反駁|依二手文獻)([，）])/g, (a, type, after) => `（<mark class="src src-inline src-${SOURCE_TYPES.indexOf(type)}">${type}</mark>${after}`);
  return html;
}

function figures(html, depth) {
  let n = 0;
  return html.replace(/<p>\s*<img([^>]*)>\s*<\/p>\s*(<p>\s*(?:<em>)?\s*(圖\s*\d+[｜|][\s\S]*?)(?:<\/em>)?\s*<\/p>)?/g, (all, attrs, capP, cap) => {
    n++;
    const src = attrs.match(/src="([^"]+)"/)?.[1] || '';
    const w = Number(attrs.match(/width="(\d+)"/)?.[1]) || 0;
    const alt = cap ? strip(cap).replace(/^圖\s*\d+[｜|]/, '').split(/來源：/)[0].trim() : '';
    const shape = w && w < 440 ? ' fig-tall' : '';
    return `<figure class="fig${shape}" data-reveal><img src="${esc(imgSrc(src, depth))}"${sizeAttrs(src)} alt="${esc(alt)}" loading="lazy" decoding="async">${cap ? `<figcaption>${cap.replace(/<\/?em>/g, '')}</figcaption>` : ''}</figure>`;
  });
}

function tables(html) {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (all, inner) => {
    inner = inner.replace(/<\/?(p|tbody|thead)[^>]*>/g, '');
    let first = true;
    inner = inner.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (r, cells) => {
      if (first) { first = false; return `<thead><tr>${cells.replace(/<(\/?)td/g, '<$1th')}</tr></thead><tbody>`; }
      return `<tr>${cells}</tr>`;
    });
    return `<div class="table-wrap" data-reveal><table>${inner}</tbody></table></div>`;
  });
}

const MINUTES = /^(看|做|回顧)\s*[（(]\s*(\d+)\s*分鐘\s*[)）]\s*$/;
function practice(html) {
  // the three steps: a paragraph "看（5 分鐘）" followed by its text, until the next step
  const blocks = html.split(/(?=<p>\s*(?:<strong>)?\s*(?:看|做|回顧)\s*[（(]\s*\d+\s*分鐘\s*[)）]\s*(?:<\/strong>)?\s*<\/p>)/);
  const intro = blocks.shift();
  if (!blocks.length) return html;
  const steps = blocks.map((b) => {
    const m = b.match(/^<p>\s*(?:<strong>)?\s*([^<]+?)\s*(?:<\/strong>)?\s*<\/p>([\s\S]*)$/);
    const [, name, min] = m[1].match(MINUTES);
    return { name, min: Number(min), rest: m[2] };
  });
  const total = steps.reduce((a, s) => a + s.min, 0);
  return `${intro}<div class="practice" data-practice data-reveal>
<p class="practice-total">共 ${total} 分鐘：${steps.map((s) => `${s.name} ${s.min}`).join('、')}</p>
${steps.map((s, i) => `<section class="step" data-step data-seconds="${s.min * 60}" aria-labelledby="step-${i}">
<div class="step-head"><h3 id="step-${i}">${esc(s.name)}</h3><span class="step-time" aria-live="off"><span data-clock>${s.min}:00</span></span><button type="button" class="step-go" data-go hidden aria-label="${esc(s.name)}：開始計時 ${s.min} 分鐘">開始</button></div>
<div class="step-body">${s.rest}</div>
</section>`).join('\n')}
</div>`;
}

function lessonBody(l, depth) {
  return l.parts.map((p, i) => {
    let html = p.html;
    html = figures(html, depth);
    html = tables(html);
    if (/今日練習/.test(p.heading)) html = practice(html);
    html = stamps(html);
    // the routine numbers the three claims of the theory as "1. …": keep them as a real list
    if (/^\s*<p>\s*1\.\s/.test(html.replace(/^[\s\S]*?(?=<p>\s*1\.\s)/, ''))) {
      html = html.replace(/((?:<p>\s*\d+\.\s[\s\S]*?<\/p>\s*(?:<figure[\s\S]*?<\/figure>\s*)?)+)/, (run) => {
        const items = run.split(/(?=<p>\s*\d+\.\s)/).filter(Boolean).map((it) => it.replace(/^<p>\s*\d+\.\s*/, '<li><p>').replace(/<\/p>/, '</p>') + '</li>');
        return `<ol class="claims">${items.join('')}</ol>`;
      });
    }
    const id = ['point', 'story', 'theory', 'example', 'contrast', 'myths', 'practice', 'sources'][i] || `s${i}`;
    return `<section class="part part-${id}" id="${id}" aria-labelledby="h-${id}"><h2 id="h-${id}" data-reveal>${esc(p.heading)}</h2>${html}</section>`;
  }).join('\n');
}

// ---------- page chrome ----------
// The web fonts never hold up the first paint: their stylesheet (about 500 KB for the Chinese serif) loads
// as a print sheet and site.js switches it on, so text shows at once in the system face and the fonts
// swap in when they arrive. Body Chinese uses the system's own face (PingFang, Noto Sans CJK, JhengHei).
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500&family=Jost:wght@400;500&family=Noto+Serif+TC:wght@500;600&display=swap';
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_CSS}" media="print" data-webfonts>
<noscript><link rel="stylesheet" href="${FONT_CSS}"></noscript>`;

// structured data for search engines; "<" is escaped so the JSON can never close its script element
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const PUBLISHER = { '@type': 'Organization', name: NAME, url: `${SITE_URL}/`, logo: `${SITE_URL}/assets/logo/seal.svg` };
// Google Search Console: put the verification code here (the content of its meta tag), or drop its
// googleXXXX.html file into src/root/, which is copied to the top of the site
const GOOGLE_SITE_VERIFICATION = '';

function head({ title, description, depth, image, url, type = 'website', ld }) {
  const up = '../'.repeat(depth);
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-Du+OJKJSbdUgz5nrHeWWINvez6XKDDU/tyj/5c2uvwo='; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="${NAME}">
<meta property="og:locale" content="zh_TW">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
${GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${esc(GOOGLE_SITE_VERIFICATION)}">` : ''}
${ld ? jsonLd(ld) : ''}
<link rel="alternate" type="application/rss+xml" title="${NAME}" href="${up}feed.xml">
<link rel="icon" href="${up}assets/logo/seal.svg" type="image/svg+xml">
${FONTS}
<link rel="stylesheet" href="${up}assets/site.css">
<script>document.documentElement.classList.add('js')</script>
</head>`;
}

function bar(depth, current) {
  const up = '../'.repeat(depth);
  return `<header class="bar"><a class="wordmark" href="${up || './'}"><img src="${up}assets/logo/seal.svg" alt="" width="30" height="30"><span>${NAME}<span lang="grc">αἴσθησις</span></span></a><nav aria-label="主要"><a href="${up}lessons/"${current === 'archive' ? ' aria-current="page"' : ''}>全部課程</a></nav></header>`;
}

function credits(depth) {
  const up = '../'.repeat(depth);
  return [
    ['Michel de Montaigne，《Ephemeris historica》第 177 頁的手記，1568 年', 'https://commons.wikimedia.org/wiki/File:Livre_de_raison_Montaigne.jpg'],
    ['Michel Beuther 編、Montaigne 家藏《Ephemeris historica》的封皮，16 世紀', 'https://commons.wikimedia.org/wiki/File:Livre_de_raison_Montaigne_reliure.jpg'],
    ['Lumière 兄弟，〈Danse serpentine〉影片，1897 年', 'https://commons.wikimedia.org/wiki/File:Danse_serpentine_(Lumi%C3%A8re,_1897).webm'],
    ['Henri de Toulouse-Lautrec，〈La Loïe Fuller aux Folies-Bergère〉，1893 年，攝影 Didier Descouens', 'https://commons.wikimedia.org/wiki/File:(Albi)_-_La_Lo%C3%AFe_Fuller_aux-Folies-Berg%C3%A8re_-_Toulouse-Lautrec_(1893)_MTL.152.jpg'],
    ['Dorothea Lange，〈Migrant Mother〉，1936 年', 'https://commons.wikimedia.org/wiki/File:Lange-MigrantMother02.jpg'],
  ].map(([t, u]) => `<a href="${u}">${esc(t)}</a>`).join('；');
}

function footer(depth, { withCredits = false } = {}) {
  const up = '../'.repeat(depth);
  return `<footer class="back" id="follow">
<div class="card" data-reveal>
<div class="card-message">
<h2>明早見</h2>
<p>每天早上 ${PUBLISH_TIME}，新的一堂會出現在這裡。用 RSS 閱讀器訂閱，就不會錯過任何一堂。</p>
<p>每堂課的圖片都是公有領域或開放授權，出處寫在圖說和文末的來源表。</p>
</div>
<div class="card-address">
<img class="stamp" src="${up}assets/img/stamp.jpg" width="88" height="117" alt="Toulouse-Lautrec 畫的舞者 Loïe Fuller，1893 年">
<ul>
<li><a href="${up}feed.xml">RSS 訂閱</a></li>
<li><a href="${up}lessons/">全部課程</a></li>
<li><a href="https://github.com/kucapungane/daily-aesthetics">網站原始碼</a></li>
</ul>
</div>
</div>
<p class="imprint">${NAME} · 文字由 Claude 依課綱撰寫並逐條查證來源<br>標誌：甲骨文「美」字（《說文解字》：从羊从大）刻成的印，旁為 Baumgarten 1735 年造 aesthetica 一詞所本的希臘字 αἴσθησις${withCredits ? `<br>本頁圖片：${credits(depth)}，皆為公有領域，經 Wikimedia Commons 取得。` : '<br>郵票圖：Henri de Toulouse-Lautrec，1893 年，公有領域。'}</p>
</footer>
<script src="${up}assets/site.js" defer></script>
</body>
</html>`;
}

// ---------- pages ----------
function lessonPage(l, prev, next) {
  const depth = 2;
  const url = `${SITE_URL}/lessons/${l.id}/`;
  const pic = lessonImageFor(l);
  const ogImg = pic ? (/^https?:/.test(pic) ? pic : `${SITE_URL}/lessons/${pic}`) : null;
  return `${head({ title: `第${l.id}堂｜${l.title}｜${NAME}`, description: l.lead.slice(0, 120), depth, image: ogImg, url, type: 'article', ld: {
    '@context': 'https://schema.org', '@type': 'Article', headline: `第${l.id}堂｜${l.title}`, description: l.lead.slice(0, 200), inLanguage: 'zh-Hant-TW',
    datePublished: `${l.date}T${PUBLISH_TIME}:00+08:00`, url, mainEntityOfPage: url, ...(ogImg ? { image: ogImg } : {}),
    author: PUBLISHER, publisher: PUBLISHER, isPartOf: { '@type': 'WebSite', name: NAME, url: `${SITE_URL}/` },
    about: [l.domain, l.contrast].filter(Boolean),
  } })}
<body class="page-lesson">
${bar(depth)}
<main>
<article class="lesson">
<header class="leaf" data-reveal>
<p class="leaf-number" aria-hidden="true">${l.id}</p>
<div class="leaf-text">
<h1><span class="leaf-count">第${l.id}堂</span>${esc(l.title)}</h1>
<p class="leaf-date"><time datetime="${l.date}">${longDate(l.date)}</time></p>
<dl class="leaf-facts">
${l.domain ? `<div><dt>主例</dt><dd>${esc(l.domain)}</dd></div>` : ''}${l.contrast ? `<div><dt>對照</dt><dd>${esc(l.contrast)}</dd></div>` : ''}<div><dt>閱讀</dt><dd>約 15 分鐘</dd></div>
</dl>
<a class="button leaf-go" href="#practice">直接做今日練習，20 分鐘</a>
</div>
<div class="leaf-perforation" aria-hidden="true"></div>
</header>
<div class="lesson-body">
${lessonBody(l, depth)}
</div>
</article>
<nav class="pager" aria-label="上一堂與下一堂">
${prev ? `<a class="pager-prev" href="../${prev.id}/"><span>上一堂</span>第${prev.id}堂｜${esc(prev.title)}</a>` : '<span></span>'}
${next ? `<a class="pager-next" href="../${next.id}/"><span>下一堂</span>第${next.id}堂｜${esc(next.title)}</a>` : `<p class="pager-next pager-soon"><span>下一堂</span>明早 ${PUBLISH_TIME} 出刊</p>`}
</nav>
</main>
${footer(depth)}`;
}

function archivePage(lessons) {
  const depth = 1;
  return `${head({ title: `全部課程｜${NAME}`, description: `${NAME}的全部 ${lessons.length} 堂課，從最新的一堂開始。`, depth, url: `${SITE_URL}/lessons/`, ld: {
    '@context': 'https://schema.org', '@type': 'ItemList', name: `${NAME}：全部課程`,
    itemListElement: lessons.map((l, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/lessons/${l.id}/`, name: `第${l.id}堂｜${l.title}` })),
  } })}
<body class="page-archive">
${bar(depth, 'archive')}
<main class="archive">
<header class="archive-head">
<div class="archive-words" data-reveal>
<h1>全部課程</h1>
<p>${lessons.length} 堂，每天早上 ${PUBLISH_TIME} 多一堂。指向任何一堂，可以先看它的第一張圖。</p>
<a class="button" href="${lessons[0].id}/">讀最新一堂：第${lessons[0].id}堂</a>
</div>
<figure class="archive-photo" data-reveal><img src="../assets/img/montaigne.jpg" width="1097" height="1600" alt="Montaigne 在印好日期的曆書頁上手寫的記事，1568 年 6 月 18 日"><figcaption>一天一頁：Montaigne 在曆書 6 月 18 日那頁寫下的記事，1568 年。</figcaption></figure>
</header>
<div class="index" data-index>
<ol class="index-rows">
${lessons.map((l) => `<li class="index-row" data-reveal${lessonImageFor(l) ? ` data-preview="${esc(imgSrc(lessonImageFor(l), depth))}"` : ''}>
<a href="${l.id}/"><span class="index-num">${l.id}</span><span class="index-title">${esc(l.title)}</span><span class="index-meta">${dotDate(l.date)}${l.domain ? ` · ${esc(l.domain)}` : ''}</span></a>
${lessonImageFor(l) ? `<img class="index-inline" src="${esc(imgSrc(lessonImageFor(l), depth))}"${sizeAttrs(lessonImageFor(l))} alt="" loading="lazy" decoding="async">` : ''}
</li>`).join('\n')}
</ol>
<div class="index-frame" aria-hidden="true"><img alt="" width="800" height="1000"></div>
</div>
</main>
${footer(depth)}`;
}

function homePage(lessons) {
  const depth = 0;
  const t = lessons[0];
  const tabs = [['today', '今天這一堂'], ['daily', '每天一堂'], ['sources', '每段都標出處'], ['all', '全部課程'], ['domains', '七個領域']];
  const domainIdx = Math.max(0, DOMAINS.indexOf(t.domain));
  const contrastIdx = DOMAINS.indexOf(t.contrast);
  const pt = (i, r = 1) => { const a = (-90 + i * (360 / 7)) * Math.PI / 180; return [(150 + Math.cos(a) * 120 * r).toFixed(1), (150 + Math.sin(a) * 120 * r).toFixed(1)]; };
  const slips = [
    ['經典理論', '某人主張，不是已證實', ['Baumgarten 主張：美是感性', '認識本身的完善', '（《Aesthetica》§14）']],
    ['實證研究', '有方法、有數據的研究', ['寫出研究者、年份與期刊', '數據圖只畫有出處的數字', '示意圖會寫明不是實測']],
    ['史料', '有文獻記載的事', ['Lange 1936 年 3 月', '在加州 Nipomo 拍下', '《Migrant Mother》', '（美國國會圖書館）']],
    ['依二手文獻', '查不到原文時', ['寫明轉引自哪一本書', 'Leibniz 的音樂名言', '依 MacTutor 引文頁，', '轉引自 Oliver Sacks']],
    ['傳說', '軼事與流傳的故事', ['照樣可以講', '但會標出是傳說', '不當成史實']],
    ['已被反駁', '曾經流行、後來被推翻', ['寫出反駁的來源', '讓你知道為什麼', '不再這樣說']],
  ];
  return `${head({ title: `${NAME}｜每天早上一堂美學課`, description: `每天早上 ${PUBLISH_TIME}，一堂查證過來源的美學課，加二十分鐘只用手機和紙筆的日常練習。`, depth, image: `${SITE_URL}/assets/img/montaigne.jpg`, url: `${SITE_URL}/`, ld: {
    '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, url: `${SITE_URL}/`, inLanguage: 'zh-Hant-TW', publisher: PUBLISHER,
    description: `每天早上 ${PUBLISH_TIME}，一堂查證過來源的美學課，加二十分鐘只用手機和紙筆的日常練習。`,
  } })}
<body class="page-home">
<div class="hero">
${bar(depth)}
<div class="hero-title">
<h1>${NAME}</h1>
<p>每天早上 ${PUBLISH_TIME}，一堂十五分鐘的美學課，加二十分鐘只用手機和紙筆的練習。</p>
</div>
<nav class="pad" aria-label="本頁段落">
${tabs.slice(1).reverse().map(([id, label], i, arr) => `<a class="pad-leaf pad-leaf-${arr.length - i}" href="#${id}"><span class="pad-tab">${label}</span></a>`).join('\n')}
<div class="pad-leaf pad-leaf-0"><a class="pad-tab" href="#today">${tabs[0][1]}</a><a class="button" href="lessons/${t.id}/">讀第${t.id}堂：${esc(t.title)}</a></div>
</nav>
</div>
<main>
<section class="today" id="today" aria-labelledby="today-title">
<div class="today-leaf">
<div class="today-grid">
<p class="today-number" aria-hidden="true" data-reveal>${t.id}</p>
<div class="today-text">
<h2 id="today-title" data-reveal>第${t.id}堂｜${esc(t.title)}</h2>
<p class="today-date" data-reveal><time datetime="${t.date}">${longDate(t.date)}</time>${t.domain ? ` · 主例${esc(t.domain)}` : ''}${t.contrast ? `，對照${esc(t.contrast)}` : ''}</p>
<p class="today-lead" data-reveal>${esc(t.lead)}</p>
<p data-reveal><a href="lessons/${t.id}/">讀完整一堂，約 15 分鐘</a></p>
</div>
${lessonImageFor(t) ? `<figure class="today-fig" data-reveal><img src="${esc(imgSrc(lessonImageFor(t), depth))}"${sizeAttrs(lessonImageFor(t))} alt="${esc(firstCaption(t))}" loading="lazy" decoding="async"><figcaption>${esc(firstCaption(t))}</figcaption></figure>` : ''}
</div>
</div>
</section>

<section class="daily" id="daily" aria-labelledby="daily-title">
<div class="daily-top">
<h2 id="daily-title" data-reveal>每天一堂</h2>
<p data-reveal>每一堂都是同一套八段格式，所以你永遠知道讀到哪裡、還剩多少。讀完就能直接做練習。</p>
</div>
<dl class="facts">
<div data-reveal><dt>${PUBLISH_TIME}</dt><dd>每天早上出刊，台灣時間</dd></div>
<div data-reveal><dt>15 分鐘</dt><dd>讀完一堂，通勤就夠</dd></div>
<div data-reveal><dt>20 分鐘</dt><dd>練習：看 5、做 10、回顧 5</dd></div>
<div data-reveal><dt>8 段</dt><dd>每天同一套格式</dd></div>
</dl>
<ol class="parts" data-reveal>
<li><strong>今日重點</strong>這一堂要帶走的一件事</li>
<li><strong>故事引入</strong>一段有文獻的歷史</li>
<li><strong>理論本體</strong>原典怎麼說，誰主張的</li>
<li><strong>主例分析</strong>一件作品，深入看</li>
<li><strong>跨領域對照</strong>換一個領域再看一次</li>
<li><strong>常見誤解</strong>最容易說錯的地方</li>
<li><strong>今日練習</strong>看、做、回顧，共 20 分鐘</li>
<li><strong>來源與延伸閱讀</strong>每個連結都寫查核日期</li>
</ol>
<figure class="daily-photo" data-reveal>
<img src="assets/img/montaigne-binding.jpg" width="774" height="1100" alt="一本封皮磨破、書頁捲曲的十六世紀曆書" loading="lazy">
<figcaption>一天一頁的書被翻成這樣：Montaigne 家用了幾十年的《Ephemeris historica》。</figcaption>
</figure>
</section>

<section class="sources" id="sources" aria-labelledby="sources-title">
<img class="sources-photo" src="assets/img/montaigne.jpg" width="1097" height="1600" alt="Montaigne 在印好日期的《Ephemeris historica》6 月 18 日頁上，手寫記下父親在 1568 年過世" loading="lazy">
<div class="sources-text">
<h2 id="sources-title">每段都標出處</h2>
<p>課程裡的每一段，都先說它是哪一種知識。理論是某人的主張，研究要有數據，史料要有文獻。</p>
<p>查不到原文的，寫明轉引自哪本書；查不到的，就不寫。</p>
</div>
<ul class="slips" aria-label="六種來源標示">
${slips.map(([type, line, rows], i) => `<li class="slip slip-${i}"><p class="slip-type"><mark class="src src-${SOURCE_TYPES.indexOf(type)}">${type}</mark></p><p class="slip-line">${line}</p><p class="slip-rule" aria-hidden="true">- - - - - - - - - - - -</p><p class="slip-rows">${rows.map((r) => `<span>${esc(r)}</span>`).join(' ')}</p></li>`).join('\n')}
</ul>
<p class="sources-credit">背景：Montaigne 家藏的《Ephemeris historica》，一天一頁的印刷曆書，他在 6 月 18 日那頁寫下父親的死訊。</p>
</section>

<section class="all" id="all" aria-labelledby="all-title">
<h2 id="all-title" data-reveal>全部課程</h2>
<div class="deck" data-deck>
${lessons.slice(0, 8).reverse().map((l, i, arr) => `<article class="deck-card tone-${l.number % 3}${i === arr.length - 1 ? ' is-open' : ''}" data-card>
<button type="button" class="deck-spine" data-spine aria-label="展開第${l.id}堂：${esc(l.title)}" aria-expanded="${i === arr.length - 1}"><span>${l.id} ${esc(l.title)}</span></button>
<div class="deck-face">
<div class="deck-words">
<h3>第${l.id}堂｜${esc(l.title)}</h3>
<p>${esc(l.lead.slice(0, 64))}…</p>
<p class="deck-foot"><time datetime="${l.date}">${dotDate(l.date)}</time><a href="lessons/${l.id}/">讀這一堂</a></p>
</div>
${l.firstImg ? `<img class="deck-img" src="${esc(imgSrc(l.firstImg, depth))}"${sizeAttrs(l.firstImg)} alt="" loading="lazy" decoding="async">` : ''}
</div>
</article>`).join('\n')}
<article class="deck-card deck-next" aria-label="下一堂">
<div class="deck-face"><h3>第${num3(t.number + 1)}堂</h3><p>明早 ${PUBLISH_TIME} 出刊。</p></div>
</article>
</div>
<p class="all-count" data-reveal>共 ${lessons.length} 堂 · <a href="lessons/">看全部課程</a></p>
</section>

<section class="domains" id="domains" aria-labelledby="domains-title">
<h2 id="domains-title" data-reveal>七個領域</h2>
<p class="domains-lead" data-reveal>每堂課只挑一個領域深入，再拿另一個領域對照：${DOMAINS.join('、')}。</p>
<div class="domains-tiles">
<figure class="domains-photo" data-reveal>
<video muted loop playsinline preload="none" poster="assets/video/danse-serpentine-poster.jpg" width="640" height="480" aria-hidden="true" data-film data-src="assets/video/danse-serpentine.webm"></video>
<figcaption>舞蹈與電影：Lumière 兄弟 1897 年拍下的〈Danse serpentine〉，一位舞者用長棒撐開綢布，讓布料本身成為動作。</figcaption>
</figure>
<div class="domains-tile" data-reveal>
<svg viewBox="0 0 300 300" role="img" aria-label="七個領域，今天的主例是${esc(t.domain || '')}">
<polygon points="${DOMAINS.map((d, i) => pt(i).join(',')).join(' ')}" fill="#ffffff" fill-opacity=".12"/>
${DOMAINS.map((d, i) => { const [x, y] = pt(i, 1.36); return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" class="domain-label${i === domainIdx ? ' is-today' : ''}">${d}</text>`; }).join('')}
${contrastIdx >= 0 ? `<circle cx="${pt(contrastIdx)[0]}" cy="${pt(contrastIdx)[1]}" r="7" fill="none" stroke="#ffffff" stroke-width="3"/>` : ''}
<circle cx="${pt(domainIdx)[0]}" cy="${pt(domainIdx)[1]}" r="9" fill="#ffffff"/>
</svg>
</div>
<dl class="domains-facts" data-reveal>
<div><dt>今天的主例</dt><dd>${esc(t.domain || '—')}</dd></div>
<div><dt>今天的對照</dt><dd>${esc(t.contrast || '—')}</dd></div>
<div><dt>進度</dt><dd>第 ${t.number} 堂</dd></div>
<div><dt>下一堂</dt><dd>明早 ${PUBLISH_TIME}</dd></div>
</dl>
</div>
</section>
</main>
${footer(depth, { withCredits: true })}`;
}

// the first picture of a lesson and its caption, for the home page
function lessonImageFor(l) { return l.firstPhoto || l.firstImg; }
function firstCaption(l) {
  const all = l.parts.map((p) => p.html).join('');
  const m = all.match(/<img[^>]*src="([^"]+)"[^>]*>\s*<\/p>\s*<p>\s*(?:<em>)?\s*(圖\s*\d+[｜|][\s\S]*?)<\/p>/g) || [];
  const pick = m.find((x) => x.includes(lessonImageFor(l))) || m[0] || '';
  return strip(pick.replace(/^[\s\S]*?(圖\s*\d+)/, '$1')).replace(/來源：[\s\S]*$/, '').replace(/。?授權：[\s\S]*$/, '').trim();
}

function feed(lessons) {
  const items = lessons.slice(0, 30).map((l) => `<item><title>第${l.id}堂｜${esc(l.title)}</title><link>${SITE_URL}/lessons/${l.id}/</link><guid>${SITE_URL}/lessons/${l.id}/</guid><pubDate>${new Date(`${l.date}T${PUBLISH_TIME}:00+08:00`).toUTCString()}</pubDate><description>${esc(l.lead)}</description></item>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>${NAME}</title><link>${SITE_URL}/</link><description>每天早上一堂查證過來源的美學課。</description><language>zh-TW</language>${items}</channel></rss>
`;
}

// ---------- build ----------
const files = readdirSync(join(ROOT, 'lessons')).filter((f) => /^\d{3,}\.html$/.test(f));
const lessons = files.map(parseLesson).sort((a, b) => b.number - a.number);
const seen = new Set();
for (const l of lessons) { if (seen.has(l.number)) throw new Error(`lesson ${l.id} appears twice`); seen.add(l.number); }
// Outside its own lesson page a picture appears without its full credit line (home page, deck, archive,
// link previews), so only pictures that need no credit go there: public domain or CC0, or the course's
// own diagrams ("本課程依…繪製"). A CC BY or CC BY-SA picture stays on its lesson page, with its credit.
// The home page prefers a photograph to a diagram.
const CREDIT_FREE = /public\s*domain|公有領域|\bCC0\b|本課程依/i;
for (const l of lessons) {
  const all = l.parts.map((p) => p.html).join('');
  const pics = [...all.matchAll(/<img[^>]*src="([^"]+)"[^>]*>\s*<\/p>\s*<p>\s*(?:<em>)?\s*(圖\s*\d+[｜|][\s\S]*?)<\/p>/g)].map((m) => ({ src: m[1], caption: m[2] }));
  const free = pics.filter((p) => CREDIT_FREE.test(strip(p.caption)));
  l.firstImg = free[0]?.src || null;
  l.firstPhoto = free.find((p) => /\.(jpe?g)(\?|$)/i.test(p.src) && !/quickchart/.test(p.src))?.src || null;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'lessons'), { recursive: true });
cpSync(join(ROOT, 'src', 'assets'), join(OUT, 'assets'), { recursive: true });
if (existsSync(join(ROOT, 'lessons', 'img'))) cpSync(join(ROOT, 'lessons', 'img'), join(OUT, 'lessons', 'img'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), homePage(lessons));
writeFileSync(join(OUT, 'lessons', 'index.html'), archivePage(lessons));
lessons.forEach((l, i) => {
  mkdirSync(join(OUT, 'lessons', l.id), { recursive: true });
  writeFileSync(join(OUT, 'lessons', l.id, 'index.html'), lessonPage(l, lessons[i + 1], lessons[i - 1]));
});
writeFileSync(join(OUT, 'feed.xml'), feed(lessons));
// the sitemap for search engines: the home page, the archive, and every lesson with the day it came out
const newest = lessons[0].date;
const urls = [[`${SITE_URL}/`, newest, 'daily'], [`${SITE_URL}/lessons/`, newest, 'daily'], ...lessons.map((l) => [`${SITE_URL}/lessons/${l.id}/`, l.date, 'monthly'])];
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d, f]) => `<url><loc>${esc(u)}</loc><lastmod>${d}</lastmod><changefreq>${f}</changefreq></url>`).join('\n')}\n</urlset>\n`);
// files that must sit at the top of the site (a Search Console verification file, for one)
if (existsSync(join(ROOT, 'src', 'root'))) cpSync(join(ROOT, 'src', 'root'), OUT, { recursive: true });
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`built ${lessons.length} lesson(s) into dist/ (latest: 第${lessons[0].id}堂 ${lessons[0].title})`);
