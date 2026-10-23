'use strict';
const settings = require('../settings');
const readers = require('../readers');
const { escapeHtml: esc, formatDate, truncate } = require('../util');

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  x: '<path d="M4 4l16 16M20 4 4 20"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  rss: '<path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.4" fill="currentColor"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  note: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const ldScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const abs = (base, p) => (!p ? '' : /^https?:/i.test(p) ? p : base + p);

function socialLinks(s) {
  const items = [['X', s.social_x], ['Facebook', s.social_facebook], ['YouTube', s.social_youtube], ['Instagram', s.social_instagram]].filter(([, u]) => u);
  return items.map(([n, u]) => `<a href="${esc(u)}" rel="noopener me" target="_blank">${n}</a>`).join('');
}

function nav(s, active, ctx, { home = false } = {}) {
  const reader = ctx ? readers.current(ctx) : null;
  const links = [];
  if (home) links.push(['home', '/', 'Home']);
  links.push(['blog', '/blog', 'Reflections']);
  if (s.enable_gallery === '1') links.push(['gallery', '/gallery', 'Gallery']);
  if (s.enable_videos === '1') links.push(['videos', '/videos', 'Videos']);
  links.push(['about', '/about', 'About']);
  if (s.enable_contact === '1') links.push(['contact', '/contact', 'Contact']);
  let out = links.map(([k, href, label]) => `<li><a href="${href}"${active === k ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  if (s.enable_donations === '1') out += `<li class="nav-give"><a href="/donate"${active === 'donate' ? ' aria-current="page"' : ''}>Give</a></li>`;
  if (reader) out += `<li class="nav-account"><a href="/journal"${active === 'journal' ? ' aria-current="page"' : ''}>My journal</a></li>`;
  else if (s.enable_accounts === '1') out += `<li class="nav-account"><a href="/signin"${active === 'signin' ? ' aria-current="page"' : ''}>Sign in</a></li>`;
  return out;
}

const MARK = `<svg class="mark" viewBox="0 0 64 64" width="34" height="34" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#17297a"/> <circle cx="32" cy="32" r="28.6" fill="none" stroke="#e3c06a" stroke-width="1.3"/> <g transform="translate(2.6 -1.8)"> <path d="M44 57 L44 41" stroke="#7fd1a6" stroke-width="2.7" stroke-linecap="round" fill="none"/> <path d="M44 53.5 C38.4 53.5 36.2 50 36.2 47 C41.4 47 44 49 44 53.5Z" fill="#7fd1a6"/> <path d="M44 50.5 C49.2 50.5 51.4 47.6 51.4 45 C46.6 45 44 47 44 50.5Z" fill="#5fb88b"/> <g fill="#f6d56f"> <circle cx="44" cy="35.1" r="4.1"/><circle cx="48.3" cy="38.3" r="4.1"/><circle cx="46.7" cy="43.3" r="4.1"/> <circle cx="41.3" cy="43.3" r="4.1"/><circle cx="39.7" cy="38.3" r="4.1"/> </g> <circle cx="44" cy="39.5" r="3.1" fill="#e2603f"/> </g> <g transform="translate(5 5.4) scale(.76) rotate(24 22 22)"> <path d="M11 15 H31 L29.5 31 H12.5 Z" fill="#eef2ff"/> <rect x="10" y="13.6" width="22" height="3" rx="1.5" fill="#ffffff"/> <path d="M12.5 18.5 C5.5 17.5 5.5 28 13 27.5" stroke="#eef2ff" stroke-width="2.7" fill="none" stroke-linecap="round"/> <path d="M30 27 L41 18" stroke="#eef2ff" stroke-width="3.5" stroke-linecap="round"/> <path d="M38.6 14.6 L43.6 20.2" stroke="#ffffff" stroke-width="4.8" stroke-linecap="round"/> </g> <g fill="#a9c3ff"> <path d="M33.6 31.4 q2 3.2 0 4.8 q-2 -1.6 0 -4.8z"/> <path d="M37.6 30.6 q2 3.2 0 4.8 q-2 -1.6 0 -4.8z"/> <path d="M35.2 38.2 q1.8 2.9 0 4.3 q-1.8 -1.4 0 -4.3z"/> <path d="M31 36.6 q1.5 2.5 0 3.7 q-1.5 -1.2 0 -3.7z"/> </g></svg>`;

/**
 * Full HTML document.
 * o: { title, description, path, active, type, image, jsonld[], body, robots, publishedTime, modifiedTime, tags[], bodyClass, rss }
 */
function layout(ctx, o) {
  const s = settings.getAll();
  const base = settings.baseUrl(ctx);
  const canonical = base + (o.path || ctx.pathname);
  const siteTitle = s.site_title;
  const fullTitle = o.title ? (o.rawTitle ? o.title : `${o.title} | ${siteTitle}`) : `${siteTitle}: ${s.tagline}`;
  const desc = truncate(o.description || s.site_description, 300);
  const image = o.image ? abs(base, o.image) : '';
  const robots = o.robots || 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

  const meta = [
    `<meta name="description" content="${esc(desc)}">`,
    o.keywords || s.site_keywords ? `<meta name="keywords" content="${esc(o.keywords || s.site_keywords)}">` : '',
    `<meta name="robots" content="${robots}">`,
    `<meta name="author" content="${esc(s.author_name)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:site_name" content="${esc(siteTitle)}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:type" content="${o.type || 'website'}">`,
    `<meta property="og:title" content="${esc(o.ogTitle || fullTitle)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(o.ogTitle || fullTitle)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
    o.publishedTime ? `<meta property="article:published_time" content="${esc(o.publishedTime)}">` : '',
    o.modifiedTime ? `<meta property="article:modified_time" content="${esc(o.modifiedTime)}">` : '',
    ...(o.tags || []).map((t) => `<meta property="article:tag" content="${esc(t)}">`),
    `<link rel="alternate" type="application/rss+xml" title="${esc(siteTitle)} feed" href="${base}/feed.xml">`,
  ].filter(Boolean).join('\n');

  const site = {
    '@context': 'https://schema.org', '@type': 'WebSite', name: siteTitle, url: base + '/', description: s.site_description,
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${base}/blog?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
  };
  const org = { '@context': 'https://schema.org', '@type': 'Organization', name: siteTitle, url: base + '/', sameAs: [s.social_x, s.social_facebook, s.social_youtube, s.social_instagram].filter(Boolean) };
  const jsonld = [...(o.path === '/' || ctx.pathname === '/' ? [site, org] : []), ...(o.jsonld || [])].map(ldScript).join('\n');

  const newsletter = s.enable_newsletter === '1' ? `
    <form class="subscribe" data-subscribe action="/subscribe" method="post">
      <label for="sub-email" class="eyebrow">Receive new reflections</label>
      <div class="subscribe-row">
        <input id="sub-email" type="email" name="email" placeholder="you@example.com" autocomplete="email" required>
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button type="submit" class="btn btn-gold">Subscribe</button>
      </div>
      <p class="subscribe-msg" role="status" aria-live="polite"></p>
    </form>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
${meta}
<meta name="theme-color" content="#0e1b57">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/site.css">
${jsonld}
</head>
<body class="${o.bodyClass || ''}" data-reader="${readers.current(ctx) ? '1' : '0'}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/" aria-label="${esc(siteTitle)}, home">${MARK}<span>${esc(siteTitle)}</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">${icon('menu')}<span class="sr">Menu</span></button>
    <nav class="site-nav" id="site-nav" aria-label="Primary"><ul>${nav(s, o.active, ctx)}</ul></nav>
  </div>
</header>
<main id="main">
${o.body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-about">
      <a class="brand brand-light" href="/">${MARK}<span>${esc(siteTitle)}</span></a>
      <p>${esc(s.tagline)}</p>
      <p class="footer-verse"><em>${esc(s.footer_text)}</em>${s.footer_ref ? ` <span class="sc">${esc(s.footer_ref)}</span>` : ''}</p>
    </div>
    <nav aria-label="Footer"><h2 class="footer-h">Explore</h2><ul>${nav(s, '', ctx, { home: true }).replace(/ class="nav-(give|account)"/g, '')}<li><a href="/feed.xml">RSS feed</a></li></ul></nav>
    <div>${newsletter}<div class="social">${socialLinks(s)}</div></div>
  </div>
  <div class="wrap footer-base"><span>&copy; ${new Date().getFullYear()} ${esc(siteTitle)}</span><span>Scripture quotations are from the King James Version (public domain).</span></div>
</footer>
<script src="/assets/js/site.js" defer></script>
<script src="/assets/js/reader.js" defer></script>
</body>
</html>`;
}

function cover(p, sizes = '') {
  if (p.cover_filename) return `<img src="/uploads/${esc(p.cover_filename)}" alt="" loading="lazy" decoding="async"${sizes ? ` sizes="${sizes}"` : ''}>`;
  const letter = (p.title || '?').trim().charAt(0).toUpperCase();
  return `<div class="cover-fallback" aria-hidden="true"><span>${esc(letter)}</span></div>`;
}

function postCard(p, { large = false } = {}) {
  const tags = p.tags ? p.tags.split(',').slice(0, 3) : [];
  return `<article class="card${large ? ' card-large' : ''}">
  <a class="card-cover" href="/post/${esc(p.slug)}" tabindex="-1" aria-hidden="true">${cover(p)}</a>
  <div class="card-body">
    ${p.category ? `<a class="eyebrow" href="/blog?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a>` : ''}
    <h3><a href="/post/${esc(p.slug)}">${esc(p.title)}</a></h3>
    <p>${esc(truncate(p.excerpt, large ? 260 : 150))}</p>
    <div class="meta"><time datetime="${esc(p.published_at)}">${formatDate(p.published_at)}</time>${tags.length ? `<span aria-hidden="true">·</span><span>${tags.map(esc).join(', ')}</span>` : ''}</div>
  </div>
</article>`;
}

function sectionHead(eyebrow, title, href, linkText) {
  return `<div class="section-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2></div>${href ? `<a class="more" href="${href}">${esc(linkText || 'View all')} ${icon('arrow')}</a>` : ''}</div>`;
}

function pager(page, pages, hrefFor) {
  if (pages <= 1) return '';
  const items = [];
  const win = new Set([1, pages, page - 1, page, page + 1]);
  let last = 0;
  for (let i = 1; i <= pages; i += 1) {
    if (!win.has(i)) continue;
    if (i - last > 1) items.push('<span class="gap" aria-hidden="true">…</span>');
    items.push(i === page ? `<span class="current" aria-current="page">${i}</span>` : `<a href="${hrefFor(i)}">${i}</a>`);
    last = i;
  }
  return `<nav class="pager" aria-label="Pagination">${page > 1 ? `<a class="prev" href="${hrefFor(page - 1)}" rel="prev">${icon('left')} Newer</a>` : '<span></span>'}<div class="pages">${items.join('')}</div>${page < pages ? `<a class="next" href="${hrefFor(page + 1)}" rel="next">Older ${icon('right')}</a>` : '<span></span>'}</nav>`;
}

module.exports = { layout, postCard, cover, sectionHead, pager, icon, ldScript, abs, esc };
