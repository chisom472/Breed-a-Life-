'use strict';
const config = require('../config');
const { all, get, run } = require('../db');
const auth = require('../auth');
const readers = require('../readers');
const resets = require('../resets');
const mailer = require('../mailer');
const settings = require('../settings');
const { HttpError, json, html, text, redirect, send, readBody, sendFromDir, sendFile } = require('../http');
const pages = require('../views/pages');
const { escapeHtml: esc, truncate, stripHtml, nowIso, toInt } = require('../util');
const path = require('path');

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor|uptime|curl|wget|python|axios|node-fetch|go-http|java\//i;
const PUBLISHED = "p.status = 'published' AND p.published_at <= ?";
const CARD_COLS = `p.id, p.title, p.slug, p.excerpt, p.category, p.tags, p.published_at, m.filename AS cover_filename`;
const FROM = 'FROM posts p LEFT JOIN media m ON m.id = p.cover_id';
const subscribeLimiter = auth.createLimiter(6, 60 * 60 * 1000);
const contactLimiter = auth.createLimiter(5, 60 * 60 * 1000);

const isAdmin = (ctx) => !!auth.userFromToken(ctx.cookies[auth.COOKIE]);

function recordView(ctx, pathname, postId) {
  if (ctx.method !== 'GET' || BOT.test(ctx.req.headers['user-agent'] || '') || isAdmin(ctx)) return;
  const day = nowIso().slice(0, 10);
  try {
    run('INSERT INTO page_views (day, path, count) VALUES (?,?,1) ON CONFLICT(day, path) DO UPDATE SET count = count + 1', day, pathname.slice(0, 200));
    if (postId) run('UPDATE posts SET views = views + 1 WHERE id = ?', postId);
  } catch { /* analytics must never break a page */ }
}

function gate(ctx) {
  if (settings.flag('maintenance_mode') && !isAdmin(ctx)) {
    ctx.res.setHeader('Retry-After', '3600');
    html(ctx, pages.maintenance(ctx), 503);
    return true;
  }
  return false;
}
function moduleOff(key) {
  if (!settings.flag(key)) throw new HttpError(404, 'This page is not available.');
}

function listPosts(where, params, limit, offset = 0) {
  const w = where ? `AND ${where}` : '';
  return all(`SELECT ${CARD_COLS} ${FROM} WHERE ${PUBLISHED} ${w} ORDER BY p.published_at DESC, p.id DESC LIMIT ? OFFSET ?`, nowIso(), ...params, limit, offset);
}

async function errorPage(ctx, status, textMsg) {
  const heading = status === 404 ? 'Page not found' : status === 403 ? 'Not allowed' : status === 405 ? 'Method not allowed' : 'Something went wrong';
  ctx.res.setHeader('Cache-Control', 'no-store');
  const body = pages.message(ctx, { status: String(status), heading, text: status === 404 ? 'The page you were looking for has moved, been removed, or never existed.' : textMsg });
  html(ctx, body, status);
}
async function notFound(ctx) {
  if (ctx.pathname.startsWith('/api/')) return json(ctx, { error: 'Not found.' }, 404);
  return errorPage(ctx, 404);
}

function parseForm(buf) {
  const out = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) out[k] = v;
  return out;
}

function register(router) {
  /* ----- static ----- */
  router.get('/uploads/:file', (ctx) => sendFromDir(ctx, config.uploadDir, ctx.params.file, {
    cache: 'public, max-age=31536000, immutable',
    headers: /\.svg$/i.test(ctx.params.file) ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {},
  }));
  router.get('/assets/:dir/:file', (ctx) => {
    if (!['css', 'js', 'img'].includes(ctx.params.dir)) throw new HttpError(404, 'Not found.');
    return sendFromDir(ctx, config.publicDir, `${ctx.params.dir}/${ctx.params.file}`, { cache: 'no-cache' });
  });
  router.get('/favicon.svg', (ctx) => sendFile(ctx, path.join(config.publicDir, 'favicon.svg'), { cache: 'public, max-age=86400' }));
  router.get('/favicon.ico', (ctx) => redirect(ctx, '/favicon.svg', 301));

  /* ----- legacy URLs from the original static site (permanent redirects keep SEO value) ----- */
  const legacy = { '/index.html': '/', '/reflections.html': '/blog', '/gallery.html': '/gallery', '/videos.html': '/videos',
    '/post-independence-from-god.html': '/post/independence-from-god-has-never-turned-out-good-for-man' };
  for (const [from, to] of Object.entries(legacy)) router.get(from, (ctx) => redirect(ctx, to, 301));

  /* ----- SEO files ----- */
  router.get('/robots.txt', (ctx) => {
    const base = settings.baseUrl(ctx);
    text(ctx, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
  });

  router.get('/sitemap.xml', (ctx) => {
    const base = settings.baseUrl(ctx);
    const now = nowIso();
    const urls = [{ loc: '/', pri: '1.0', freq: 'weekly' }, { loc: '/blog', pri: '0.9', freq: 'weekly' }, { loc: '/about', pri: '0.5', freq: 'yearly' }];
    if (settings.flag('enable_gallery')) urls.push({ loc: '/gallery', pri: '0.6', freq: 'monthly' });
    if (settings.flag('enable_videos')) urls.push({ loc: '/videos', pri: '0.6', freq: 'monthly' });
    if (settings.flag('enable_contact')) urls.push({ loc: '/contact', pri: '0.5', freq: 'yearly' });
    if (settings.flag('enable_donations')) urls.push({ loc: '/donate', pri: '0.5', freq: 'yearly' });
    for (const p of all('SELECT slug, updated_at FROM posts WHERE status = \'published\' AND published_at <= ? ORDER BY published_at DESC', now)) {
      urls.push({ loc: `/post/${p.slug}`, pri: '0.8', freq: 'monthly', mod: p.updated_at });
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(base + u.loc)}</loc>${u.mod ? `<lastmod>${u.mod.slice(0, 10)}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join('\n')}\n</urlset>\n`;
    text(ctx, xml, 'application/xml; charset=utf-8');
  });

  router.get('/feed.xml', (ctx) => {
    const s = settings.getAll();
    const base = settings.baseUrl(ctx);
    const rows = all(`SELECT p.*, m.filename AS cover_filename ${FROM} WHERE ${PUBLISHED} ORDER BY p.published_at DESC LIMIT 20`, nowIso());
    const items = rows.map((p) => {
      const content = p.content.replace(/(src|href)="\/(?!\/)/g, `$1="${base}/`).replace(/]]>/g, ']]&gt;');
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(base)}/post/${esc(p.slug)}</link>
      <guid isPermaLink="true">${esc(base)}/post/${esc(p.slug)}</guid>
      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>
      ${p.category ? `<category>${esc(p.category)}</category>` : ''}
      <description>${esc(truncate(p.excerpt || stripHtml(p.content), 300))}</description>
      <content:encoded><![CDATA[${content}]]></content:encoded>
    </item>`;
    }).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(s.site_title)}</title>
    <link>${esc(base)}/</link>
    <description>${esc(s.site_description)}</description>
    <language>en-us</language>
    <atom:link href="${esc(base)}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>\n`;
    text(ctx, xml, 'application/rss+xml; charset=utf-8');
  });

  /* ----- newsletter ----- */
  router.post('/subscribe', async (ctx) => {
    const wantsJson = /application\/json/.test(ctx.req.headers['content-type'] || '') || ctx.req.headers['x-requested-with'] === 'fetch';
    const raw = await readBody(ctx.req, 8 * 1024);
    let data = {};
    try { data = wantsJson ? JSON.parse(raw.toString('utf8') || '{}') : parseForm(raw); } catch { data = {}; }
    const reply = (status, ok, message) => (wantsJson ? json(ctx, { ok, message }, status) : redirect(ctx, `/?subscribed=${ok ? 1 : 0}#subscribe`, 303));
    if (!settings.flag('enable_newsletter')) return reply(404, false, 'Subscriptions are closed.');
    if (data.website) return reply(200, true, 'Thank you for subscribing.'); // honeypot
    const gate_ = subscribeLimiter.take(ctx.ip);
    if (!gate_.allowed) return reply(429, false, 'Too many attempts. Please try again later.');
    const email = String(data.email || '').trim().toLowerCase().slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reply(422, false, 'Please enter a valid email address.');
    run('INSERT OR IGNORE INTO subscribers (email, created_at) VALUES (?, ?)', email, nowIso());
    return reply(200, true, 'Thank you. You are subscribed.');
  });

  /* ----- pages ----- */
  router.get('/', (ctx) => {
    if (gate(ctx)) return;
    const now = nowIso();
    const featured = get(`SELECT ${CARD_COLS} ${FROM} WHERE ${PUBLISHED} AND p.featured = 1 ORDER BY p.published_at DESC LIMIT 1`, now)
      || get(`SELECT ${CARD_COLS} ${FROM} WHERE ${PUBLISHED} ORDER BY p.published_at DESC LIMIT 1`, now);
    const latest = featured ? listPosts('p.id != ?', [featured.id], 6) : [];
    const images = settings.flag('enable_gallery') ? all("SELECT * FROM media WHERE kind = 'image' AND visible = 1 ORDER BY created_at DESC, id DESC LIMIT 6") : [];
    const videos = settings.flag('enable_videos') ? all("SELECT * FROM media WHERE kind = 'video' AND visible = 1 ORDER BY created_at DESC, id DESC LIMIT 2") : [];
    recordView(ctx, '/');
    html(ctx, pages.home(ctx, { featured, latest, images, videos }));
  });

  router.get('/blog', (ctx) => {
    if (gate(ctx)) return;
    const per = toInt(settings.get('posts_per_page'), 9);
    const page = Math.max(1, toInt(ctx.query.page, 1));
    const q = String(ctx.query.q || '').trim().slice(0, 100);
    const category = String(ctx.query.category || '').trim().slice(0, 60);
    const tag = String(ctx.query.tag || '').trim().slice(0, 40);
    const where = [];
    const params = [];
    if (q) { where.push("(p.title LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\' OR p.category LIKE ? ESCAPE '\\')"); const l = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'; params.push(l, l, l, l, l); }
    if (category) { where.push('p.category = ? COLLATE NOCASE'); params.push(category); }
    if (tag) { where.push("(',' || LOWER(p.tags) || ',') LIKE ? ESCAPE '\\'"); params.push('%,' + tag.toLowerCase().replace(/[\\%_]/g, (m) => '\\' + m) + ',%'); }
    const w = where.join(' AND ');
    const total = get(`SELECT COUNT(*) AS c ${FROM} WHERE ${PUBLISHED} ${w ? 'AND ' + w : ''}`, nowIso(), ...params).c;
    const pagesCount = Math.max(1, Math.ceil(total / per));
    const posts = listPosts(w, params, per, (Math.min(page, pagesCount) - 1) * per);
    const categories = all(`SELECT DISTINCT p.category FROM posts p WHERE ${PUBLISHED} AND p.category != '' ORDER BY p.category COLLATE NOCASE`, nowIso()).map((r) => r.category);
    recordView(ctx, '/blog');
    html(ctx, pages.blog(ctx, { posts, total, page: Math.min(page, pagesCount), pages: pagesCount, q, category, tag, categories }));
  });

  router.get('/post/:slug', (ctx) => {
    if (gate(ctx)) return;
    const preview = isAdmin(ctx) && ctx.query.preview === '1';
    const p = get(`SELECT p.*, m.filename AS cover_filename, m.alt AS cover_alt ${FROM} WHERE p.slug = ? ${preview ? '' : `AND ${PUBLISHED}`}`, ...(preview ? [ctx.params.slug] : [ctx.params.slug, nowIso()]));
    if (!p) throw new HttpError(404, 'Not found.');
    const when = p.published_at || p.created_at;
    const prev = get(`SELECT p.title, p.slug ${FROM} WHERE ${PUBLISHED} AND p.published_at > ? ORDER BY p.published_at ASC LIMIT 1`, nowIso(), when);
    const next = get(`SELECT p.title, p.slug ${FROM} WHERE ${PUBLISHED} AND p.published_at < ? ORDER BY p.published_at DESC LIMIT 1`, nowIso(), when);
    let related = [];
    if (p.category) related = listPosts('p.category = ? COLLATE NOCASE AND p.id != ?', [p.category, p.id], 3);
    if (related.length < 3) {
      const have = new Set([p.id, ...related.map((r) => r.id)]);
      related = related.concat(listPosts('', [], 6).filter((r) => !have.has(r.id))).slice(0, 3);
    }
    if (!preview) recordView(ctx, `/post/${p.slug}`, p.id);
    if (preview) ctx.res.setHeader('X-Robots-Tag', 'noindex');
    p.published_at = when;
    html(ctx, pages.post(ctx, { p, prev, next, related }));
  });

  router.get('/gallery', (ctx) => {
    if (gate(ctx)) return;
    moduleOff('enable_gallery');
    recordView(ctx, '/gallery');
    html(ctx, pages.gallery(ctx, { images: all("SELECT * FROM media WHERE kind = 'image' AND visible = 1 ORDER BY created_at DESC, id DESC") }));
  });

  router.get('/videos', (ctx) => {
    if (gate(ctx)) return;
    moduleOff('enable_videos');
    recordView(ctx, '/videos');
    html(ctx, pages.videos(ctx, { videos: all("SELECT * FROM media WHERE kind = 'video' AND visible = 1 ORDER BY created_at DESC, id DESC") }));
  });

  /* ----- contact ----- */
  router.get('/contact', (ctx) => {
    if (gate(ctx)) return;
    moduleOff('enable_contact');
    recordView(ctx, '/contact');
    html(ctx, pages.contact(ctx));
  });

  router.post('/contact', async (ctx) => {
    const raw = await readBody(ctx.req, 32 * 1024);
    const wantsJson = /application\/json/.test(ctx.req.headers['content-type'] || '');
    let data = {};
    try { data = wantsJson ? JSON.parse(raw.toString('utf8') || '{}') : parseForm(raw); } catch { data = {}; }
    const reply = (status, ok, message) => (wantsJson ? json(ctx, { ok, message }, status) : redirect(ctx, `/contact?sent=${ok ? 1 : 0}`, 303));
    if (!settings.flag('enable_contact')) return reply(404, false, 'The contact form is closed.');
    if (data.website) return reply(200, true, 'Thank you. Your message has been sent.'); // honeypot
    const clean = (v, max) => String(v || '').replace(/\u0000/g, '').trim().slice(0, max);
    const name = clean(data.name, 100);
    const email = clean(data.email, 200).toLowerCase();
    const subject = clean(data.subject, 150).replace(/[\r\n]+/g, ' ');
    const message = clean(data.message, 5000);
    if (!name) return reply(422, false, 'Please tell us your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reply(422, false, 'Please enter a valid email address so we can reply.');
    if (message.length < 10) return reply(422, false, 'Please write a little more. Your message is very short.');
    if (!contactLimiter.take(ctx.ip).allowed) return reply(429, false, 'You have sent several messages recently. Please try again later.');
    const r = run('INSERT INTO messages (name, email, subject, body, created_at) VALUES (?,?,?,?,?)', name, email, subject, message, nowIso());
    const id = Number(r.lastInsertRowid);
    const to = (settings.get('contact_email') || '').trim();
    if (mailer.configured() && to) {
      mailer.send({
        to, replyTo: email, subject: `[${settings.get('site_title')}] ${subject || 'New message'} (from ${name})`,
        text: `New message from the ${settings.get('site_title')} contact form\n\nName:    ${name}\nEmail:   ${email}\nSubject: ${subject || '(none)'}\nSent:    ${nowIso()}\n\n${message}\n\n--\nReply to this email to answer ${name} directly.`,
      }).then(() => run('UPDATE messages SET emailed = 1 WHERE id = ?', id))
        .catch((e) => run('UPDATE messages SET email_error = ? WHERE id = ?', String(e.message).slice(0, 300), id));
    }
    return reply(201, true, 'Thank you. Your message has been sent.');
  });

  /* ----- donate ----- */
  router.get('/donate', (ctx) => {
    if (gate(ctx)) return;
    moduleOff('enable_donations');
    recordView(ctx, '/donate');
    html(ctx, pages.donate(ctx, { methods: all('SELECT * FROM donation_methods WHERE visible = 1 ORDER BY position, id') }));
  });

  /* ----- reader accounts: pages (the data itself comes from /api/reader/*) ----- */
  const safeNext = (v) => (typeof v === 'string' && /^\/(?!\/)[^\\\s]*$/.test(v) ? v : '');
  const accountsOn = () => { if (!settings.flag('enable_accounts')) throw new HttpError(404, 'This page is not available.'); };
  router.get('/join', (ctx) => {
    if (gate(ctx)) return; accountsOn();
    if (readers.current(ctx)) return redirect(ctx, safeNext(ctx.query.next) || '/journal');
    html(ctx, pages.join(ctx, { next: safeNext(ctx.query.next) }));
  });
  router.get('/signin', (ctx) => {
    if (gate(ctx)) return; accountsOn();
    if (readers.current(ctx)) return redirect(ctx, safeNext(ctx.query.next) || '/journal');
    html(ctx, pages.signin(ctx, { next: safeNext(ctx.query.next) }));
  });
  router.get('/forgot-password', (ctx) => {
    if (gate(ctx)) return; accountsOn();
    html(ctx, pages.forgot(ctx, { emailReady: mailer.configured() && !!resets.safeBase(ctx) }));
  });
  router.get('/reset-password', (ctx) => {
    if (gate(ctx)) return; accountsOn();
    ctx.res.setHeader('Referrer-Policy', 'no-referrer');
    const token = String(ctx.query.token || '');
    html(ctx, pages.reset(ctx, { token, valid: !!resets.find('reader', token) }));
  });
  router.get('/journal', (ctx) => {
    if (gate(ctx)) return; accountsOn();
    if (!readers.current(ctx)) return redirect(ctx, '/signin?next=/journal');
    html(ctx, pages.journal(ctx));
  });

  router.get('/about', (ctx) => {
    if (gate(ctx)) return;
    recordView(ctx, '/about');
    html(ctx, pages.about(ctx));
  });
}

module.exports = { register, notFound, errorPage };
