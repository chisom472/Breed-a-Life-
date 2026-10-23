'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');
const database = require('../db');
const { all, get, run, tx, logActivity } = database;
const auth = require('../auth');
const resets = require('../resets');
const mailer = require('../mailer');
const secret = require('../secret');
const media = require('../media');
const settings = require('../settings');
const { sanitizeHtml } = require('../sanitize');
const { parseMultipart, UploadError } = require('../multipart');
const { HttpError, json, readJson, send, sendFile } = require('../http');
const U = require('../util');

const loginIp = auth.createLimiter(10, 15 * 60 * 1000);
const loginUser = auth.createLimiter(10, 15 * 60 * 1000);

/* ---------- helpers ---------- */
function requireAuth(ctx) {
  const user = auth.userFromToken(ctx.cookies[auth.COOKIE]);
  if (!user) throw new HttpError(401, 'Please sign in to continue.');
  ctx.user = user;
  ctx.token = ctx.cookies[auth.COOKIE];
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && ctx.req.headers['x-requested-with'] !== 'sx-admin') {
    throw new HttpError(403, 'Missing required request header.');
  }
}
const actor = (ctx) => ctx.user.username;
const str = (v, max, name = 'Value') => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (s.length > max) throw new HttpError(422, `${name} must be ${max} characters or fewer.`);
  return s;
};
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const pageOf = (q, per) => {
  const page = Math.max(1, U.toInt(q.page, 1));
  return { page, per, offset: (page - 1) * per };
};
const like = (s) => '%' + String(s).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const thumbOf = (m) => (m.source === 'embed' ? `https://i.ytimg.com/vi/${m.embed_id}/hqdefault.jpg` : m.kind === 'image' ? `/uploads/${m.filename}` : m.poster ? `/uploads/${m.poster}` : null);

function mediaOut(m) {
  return {
    ...m,
    url: m.filename ? `/uploads/${m.filename}` : null,
    poster_url: m.poster ? `/uploads/${m.poster}` : null,
    thumb: thumbOf(m),
    embed_url: m.embed_id ? `https://www.youtube.com/watch?v=${m.embed_id}` : null,
  };
}
function mediaUsage(m) {
  if (m.kind !== 'image' && !m.filename) return [];
  const key = m.filename || '';
  const rows = all(
    `SELECT id, title FROM posts WHERE cover_id = ? ${key ? "OR content LIKE ? ESCAPE '\\'" : ''} LIMIT 20`,
    ...(key ? [m.id, like('/uploads/' + key)] : [m.id]));
  return rows;
}

function deleteMedia(row, who) {
  tx(() => {
    run('DELETE FROM media WHERE id = ?', row.id);
    if (settings.get('default_og_image_id') === String(row.id)) settings.update({ default_og_image_id: '' });
  });
  if (row.filename) media.remove(row.filename);
  if (row.poster) media.remove(row.poster);
  logActivity(who, 'media.delete', `${row.kind} "${row.title || row.original_name}"`);
}

function prettyName(name) {
  const base = String(name || 'Untitled').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 120) || 'Untitled';
}

/* ---------- posts ---------- */
const POST_LIST_SQL = `SELECT p.id, p.title, p.slug, p.status, p.category, p.featured, p.views, p.published_at, p.created_at, p.updated_at,
  m.filename AS cover_filename FROM posts p LEFT JOIN media m ON m.id = p.cover_id`;

function postState(p) {
  if (p.status !== 'published') return 'draft';
  return p.published_at && p.published_at > U.nowIso() ? 'scheduled' : 'published';
}
function uniqueSlug(base, excludeId) {
  const root = U.slugify(base) || 'post';
  let slug = root;
  for (let i = 2; get('SELECT id FROM posts WHERE slug = ? AND id != ?', slug, excludeId || 0); i += 1) slug = `${root}-${i}`;
  return slug;
}
function readPost(body, existing) {
  const title = str(U.stripHtml(String(body.title ?? '')), 200, 'Title');
  if (!title) throw new HttpError(422, 'A title is required.');
  const content = sanitizeHtml(typeof body.content === 'string' ? body.content : existing ? existing.content : '');
  if (content.length > 2 * 1024 * 1024) throw new HttpError(422, 'Post content is too large.');
  const status = body.status === 'published' ? 'published' : 'draft';
  let published_at = existing ? existing.published_at : null;
  if (status === 'published') {
    if (body.published_at) {
      const d = new Date(body.published_at);
      if (isNaN(d)) throw new HttpError(422, 'Publish date is not valid.');
      published_at = d.toISOString();
    } else if (!published_at) published_at = U.nowIso();
  }
  let cover_id = null;
  if (body.cover_id !== null && body.cover_id !== undefined && body.cover_id !== '') {
    cover_id = U.toInt(body.cover_id, 0);
    const m = get("SELECT id FROM media WHERE id = ? AND kind = 'image'", cover_id);
    if (!m) throw new HttpError(422, 'The selected cover image no longer exists.');
  }
  const slugInput = str(body.slug, 100, 'Slug');
  const excerpt = str(body.excerpt, 500, 'Excerpt') || U.truncate(U.stripHtml(content), 200);
  return {
    title, content, status, published_at, cover_id, excerpt,
    slug: uniqueSlug(slugInput || title, existing && existing.id),
    category: str(body.category, 60, 'Category'),
    tags: U.normalizeTags(body.tags).join(','),
    featured: bool(body.featured),
    seo_title: str(body.seo_title, 120, 'SEO title'),
    seo_description: str(body.seo_description, 300, 'SEO description'),
  };
}
function postOut(p) {
  return { ...p, tags: p.tags ? p.tags.split(',') : [], state: postState(p) };
}

/* ---------- database browser ---------- */
const SECRET_COLS = { users: ['password_hash'], sessions: ['token_hash'], readers: ['password_hash'], reader_sessions: ['token_hash'], reader_entries: ['body'], password_resets: ['token_hash'] };
const NO_EDIT = new Set(['users', 'sessions', 'readers', 'reader_sessions', 'reader_entries', 'password_resets']);
const NO_DELETE = new Set(['users']);
function tableNames() {
  return all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
}
function requireTable(name) {
  if (!tableNames().includes(name)) throw new HttpError(404, 'Unknown table.');
  return name;
}
const qi = (id) => '"' + String(id).replace(/"/g, '""') + '"';
function columnsOf(table) {
  return all(`PRAGMA table_info(${qi(table)})`).map((c) => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk }));
}
function maskRow(table, row) {
  const hidden = SECRET_COLS[table] || [];
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = hidden.includes(k) ? '••••••••' : typeof v === 'bigint' ? Number(v) : v;
  if (table === 'settings' && /_enc$/.test(String(row.key))) out.value = '••••••••';
  return out;
}

/* ---------- uploads ---------- */
async function withUpload(ctx, opts, fn) {
  let parsed;
  try { parsed = await parseMultipart(ctx.req, opts); }
  catch (e) { if (e instanceof UploadError) throw new HttpError(e.status, e.message); throw e; }
  try { return await fn(parsed); } finally { parsed.cleanup(); }
}

module.exports = function register(router) {
  const A = (p) => '/api/admin' + p;
  const guard = requireAuth;

  /* ----- session ----- */
  router.post(A('/login'), async (ctx) => {
    const body = await readJson(ctx, 10 * 1024);
    const ipGate = loginIp.take(ctx.ip);
    const username = str(body.username, 80);
    const userGate = loginUser.take(username.toLowerCase());
    if (!ipGate.allowed || !userGate.allowed) {
      ctx.res.setHeader('Retry-After', Math.max(ipGate.retryAfter, userGate.retryAfter));
      throw new HttpError(429, 'Too many sign-in attempts. Please wait a few minutes and try again.');
    }
    const password = typeof body.password === 'string' ? body.password : '';
    const user = username ? get('SELECT * FROM users WHERE username = ?', username) : null;
    const ok = user ? await auth.verifyPassword(password, user.password_hash) : (await auth.burn(password), false);
    if (!ok) { logActivity('system', 'login.failed', `Failed sign-in for "${username.slice(0, 40)}" from ${ctx.ip}`); throw new HttpError(401, 'That username or password is not correct.'); }
    loginIp.clear(ctx.ip); loginUser.clear(username.toLowerCase());
    const session = auth.createSession(user.id, ctx.ip, ctx.req.headers['user-agent'], !!body.remember);
    run('UPDATE users SET last_login = ? WHERE id = ?', U.nowIso(), user.id);
    ctx.res.setHeader('Set-Cookie', auth.cookieHeader(session.token, body.remember ? session.days : 0));
    logActivity(user.username, 'login', `Signed in from ${ctx.ip}`);
    json(ctx, { ok: true, user: { username: user.username, email: user.email } });
  });

  router.post(A('/logout'), (ctx) => {
    auth.destroySession(ctx.cookies[auth.COOKIE]);
    ctx.res.setHeader('Set-Cookie', auth.clearCookieHeader());
    json(ctx, { ok: true });
  });

  router.get(A('/me'), guard, (ctx) => json(ctx, { user: { id: ctx.user.id, username: ctx.user.username, email: ctx.user.email } }));

  /* ----- dashboard ----- */
  router.get(A('/stats'), guard, (ctx) => {
    const now = U.nowIso();
    const c = get(`SELECT
      COUNT(*) AS total,
      SUM(status = 'published' AND published_at <= ?) AS published,
      SUM(status = 'published' AND published_at > ?) AS scheduled,
      SUM(status = 'draft') AS drafts,
      COALESCE(SUM(views), 0) AS post_views FROM posts`, now, now);
    const m = get(`SELECT SUM(kind = 'image') AS images, SUM(kind = 'video') AS videos, SUM(kind = 'video' AND source = 'upload') AS uploaded_videos,
      COALESCE(SUM(size), 0) AS bytes FROM media`);
    const posterBytes = all('SELECT poster FROM media WHERE poster IS NOT NULL').reduce((n, r) => n + media.sizeOf(r.poster), 0);
    const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const byDay = Object.fromEntries(all('SELECT day, SUM(count) AS c FROM page_views WHERE day >= ? GROUP BY day', since).map((r) => [r.day, r.c]));
    const series = [];
    for (let i = 29; i >= 0; i -= 1) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); series.push({ day: d, views: byDay[d] || 0 }); }
    const subs = get('SELECT COUNT(*) AS total, SUM(created_at >= ?) AS week FROM subscribers', new Date(Date.now() - 7 * 86400000).toISOString());
    json(ctx, {
      posts: { total: c.total, published: c.published || 0, scheduled: c.scheduled || 0, drafts: c.drafts || 0 },
      media: { images: m.images || 0, videos: m.videos || 0, uploaded_videos: m.uploaded_videos || 0, bytes: (m.bytes || 0) + posterBytes },
      views: { total: get('SELECT COALESCE(SUM(count),0) AS c FROM page_views').c, last30: series.reduce((n, d) => n + d.views, 0), series },
      subscribers: { total: subs.total, week: subs.week || 0 },
      messages: get('SELECT COUNT(*) AS total, COALESCE(SUM(is_read = 0), 0) AS unread FROM messages'),
      readers: get('SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= ?), 0) AS week, (SELECT COUNT(*) FROM reader_entries WHERE completed_at IS NOT NULL) AS completed FROM readers', new Date(Date.now() - 7 * 86400000).toISOString()),
      setup: { email: mailer.configured(), recovery_email: !!get('SELECT email FROM users WHERE id = ?', ctx.user.id).email, site_url: !!(settings.get('site_url') || config.siteUrl), donations: get('SELECT COUNT(*) AS c FROM donation_methods').c > 0 },
      top_posts: all(`${POST_LIST_SQL} WHERE p.status = 'published' ORDER BY p.views DESC, p.published_at DESC LIMIT 5`).map(postOut),
      recent_posts: all(`${POST_LIST_SQL} ORDER BY p.updated_at DESC LIMIT 5`).map(postOut),
      activity: all('SELECT * FROM activity ORDER BY id DESC LIMIT 8'),
      top_pages: all('SELECT path, SUM(count) AS views FROM page_views WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 6', since),
      maintenance: settings.flag('maintenance_mode'),
      db_bytes: fs.statSync(database.dbPath).size,
    });
  });

  /* ----- posts ----- */
  router.get(A('/posts'), guard, (ctx) => {
    const { page, per, offset } = pageOf(ctx.query, 15);
    const where = [];
    const params = [];
    const now = U.nowIso();
    const s = ctx.query.status;
    if (s === 'published') { where.push("p.status = 'published' AND p.published_at <= ?"); params.push(now); }
    else if (s === 'scheduled') { where.push("p.status = 'published' AND p.published_at > ?"); params.push(now); }
    else if (s === 'draft') where.push("p.status = 'draft'");
    if (ctx.query.q) { where.push("(p.title LIKE ? ESCAPE '\\' OR p.category LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\')"); const l = like(ctx.query.q); params.push(l, l, l); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = get(`SELECT COUNT(*) AS c FROM posts p ${w}`, ...params).c;
    const rows = all(`${POST_LIST_SQL} ${w} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, ...params, per, offset).map(postOut);
    json(ctx, { items: rows, total, page, pages: Math.max(1, Math.ceil(total / per)) });
  });

  router.get(A('/posts/:id'), guard, (ctx) => {
    const p = get('SELECT * FROM posts WHERE id = ?', U.toInt(ctx.params.id));
    if (!p) throw new HttpError(404, 'Post not found.');
    const cover = p.cover_id ? get('SELECT * FROM media WHERE id = ?', p.cover_id) : null;
    json(ctx, { post: postOut(p), cover: cover ? mediaOut(cover) : null });
  });

  router.post(A('/posts'), guard, async (ctx) => {
    const f = readPost(await readJson(ctx, 4 * 1048576), null);
    const now = U.nowIso();
    const r = run(`INSERT INTO posts (title, slug, excerpt, content, cover_id, category, tags, status, featured, seo_title, seo_description, published_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, f.title, f.slug, f.excerpt, f.content, f.cover_id, f.category, f.tags, f.status, f.featured, f.seo_title, f.seo_description, f.published_at, now, now);
    logActivity(actor(ctx), f.status === 'published' ? 'post.publish' : 'post.create', `"${f.title}"`);
    json(ctx, { post: postOut(get('SELECT * FROM posts WHERE id = ?', r.lastInsertRowid)) }, 201);
  });

  router.put(A('/posts/:id'), guard, async (ctx) => {
    const existing = get('SELECT * FROM posts WHERE id = ?', U.toInt(ctx.params.id));
    if (!existing) throw new HttpError(404, 'Post not found.');
    const f = readPost(await readJson(ctx, 4 * 1048576), existing);
    run(`UPDATE posts SET title=?, slug=?, excerpt=?, content=?, cover_id=?, category=?, tags=?, status=?, featured=?, seo_title=?, seo_description=?, published_at=?, updated_at=? WHERE id=?`,
      f.title, f.slug, f.excerpt, f.content, f.cover_id, f.category, f.tags, f.status, f.featured, f.seo_title, f.seo_description, f.published_at, U.nowIso(), existing.id);
    const verb = existing.status !== 'published' && f.status === 'published' ? 'post.publish' : existing.status === 'published' && f.status === 'draft' ? 'post.unpublish' : 'post.update';
    logActivity(actor(ctx), verb, `"${f.title}"`);
    json(ctx, { post: postOut(get('SELECT * FROM posts WHERE id = ?', existing.id)) });
  });

  router.delete(A('/posts/:id'), guard, (ctx) => {
    const p = get('SELECT id, title FROM posts WHERE id = ?', U.toInt(ctx.params.id));
    if (!p) throw new HttpError(404, 'Post not found.');
    run('DELETE FROM posts WHERE id = ?', p.id);
    logActivity(actor(ctx), 'post.delete', `"${p.title}"`);
    json(ctx, { ok: true });
  });

  router.post(A('/posts-bulk'), guard, async (ctx) => {
    const body = await readJson(ctx);
    const ids = (Array.isArray(body.ids) ? body.ids : []).map((n) => U.toInt(n)).filter(Boolean).slice(0, 200);
    if (!ids.length) throw new HttpError(422, 'Select at least one post.');
    const marks = ids.map(() => '?').join(',');
    let n = 0;
    tx(() => {
      if (body.action === 'delete') n = run(`DELETE FROM posts WHERE id IN (${marks})`, ...ids).changes;
      else if (body.action === 'publish') n = run(`UPDATE posts SET status='published', published_at=COALESCE(published_at, ?), updated_at=? WHERE id IN (${marks})`, U.nowIso(), U.nowIso(), ...ids).changes;
      else if (body.action === 'draft') n = run(`UPDATE posts SET status='draft', updated_at=? WHERE id IN (${marks})`, U.nowIso(), ...ids).changes;
      else throw new HttpError(422, 'Unknown bulk action.');
    });
    logActivity(actor(ctx), `post.bulk.${body.action}`, `${n} post(s)`);
    json(ctx, { ok: true, changed: Number(n) });
  });

  /* ----- media (images & videos) ----- */
  router.get(A('/media'), guard, (ctx) => {
    const { page, per, offset } = pageOf(ctx.query, Math.min(96, U.toInt(ctx.query.per, 48)));
    const where = [];
    const params = [];
    if (ctx.query.kind === 'image' || ctx.query.kind === 'video') { where.push('kind = ?'); params.push(ctx.query.kind); }
    if (ctx.query.visible === '1' || ctx.query.visible === '0') { where.push('visible = ?'); params.push(Number(ctx.query.visible)); }
    if (ctx.query.q) { where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR original_name LIKE ? ESCAPE '\\')"); const l = like(ctx.query.q); params.push(l, l, l); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = get(`SELECT COUNT(*) AS c FROM media ${w}`, ...params).c;
    const items = all(`SELECT * FROM media ${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, per, offset).map((m) => ({ ...mediaOut(m), used: mediaUsage(m).length }));
    json(ctx, { items, total, page, pages: Math.max(1, Math.ceil(total / per)) });
  });

  router.get(A('/media/:id'), guard, (ctx) => {
    const m = get('SELECT * FROM media WHERE id = ?', U.toInt(ctx.params.id));
    if (!m) throw new HttpError(404, 'File not found.');
    json(ctx, { item: mediaOut(m), usage: mediaUsage(m) });
  });

  router.post(A('/media/upload'), guard, async (ctx) => {
    const want = ctx.query.kind === 'image' || ctx.query.kind === 'video' ? ctx.query.kind : 'any';
    await withUpload(ctx, { maxFileBytes: want === 'image' ? config.maxImageBytes : config.maxVideoBytes, maxFiles: 25 }, async ({ fields, files }) => {
      const items = [];
      const errors = [];
      for (const f of files) {
        try {
          const stored = media.store(f.path, { allow: want });
          const title = files.length === 1 && fields.title ? str(fields.title, 200) : prettyName(f.filename);
          const r = run(`INSERT INTO media (kind, source, filename, original_name, mime, size, title, alt, description, visible, created_at)
            VALUES (?, 'upload', ?, ?, ?, ?, ?, ?, ?, 1, ?)`, stored.kind, stored.filename, f.filename.slice(0, 200), stored.mime, stored.size, title, stored.kind === 'image' ? title : '', str(fields.description || '', 1000), U.nowIso());
          items.push(mediaOut(get('SELECT * FROM media WHERE id = ?', r.lastInsertRowid)));
          logActivity(actor(ctx), 'media.upload', `${stored.kind} "${title}" (${U.formatBytes(stored.size)})`);
        } catch (e) { errors.push({ name: f.filename, message: e.message }); }
      }
      if (!files.length) throw new HttpError(422, 'No file was received.');
      json(ctx, { items, errors }, items.length ? 201 : 422);
    });
  });

  router.post(A('/media/embed'), guard, async (ctx) => {
    const body = await readJson(ctx);
    const id = media.youtubeId(body.url);
    if (!id) throw new HttpError(422, 'Enter a valid YouTube link.');
    const title = str(body.title, 200, 'Title') || 'Untitled video';
    const r = run(`INSERT INTO media (kind, source, embed_id, original_name, size, title, description, visible, created_at)
      VALUES ('video','embed',?,?,0,?,?,1,?)`, id, 'youtube:' + id, title, str(body.description, 1000, 'Description'), U.nowIso());
    logActivity(actor(ctx), 'media.embed', `video "${title}"`);
    json(ctx, { item: mediaOut(get('SELECT * FROM media WHERE id = ?', r.lastInsertRowid)) }, 201);
  });

  router.put(A('/media/:id'), guard, async (ctx) => {
    const m = get('SELECT * FROM media WHERE id = ?', U.toInt(ctx.params.id));
    if (!m) throw new HttpError(404, 'File not found.');
    const b = await readJson(ctx);
    run('UPDATE media SET title=?, alt=?, description=?, visible=? WHERE id=?',
      b.title !== undefined ? str(b.title, 200, 'Title') : m.title,
      b.alt !== undefined ? str(b.alt, 300, 'Alt text') : m.alt,
      b.description !== undefined ? str(b.description, 1000, 'Description') : m.description,
      b.visible !== undefined ? bool(b.visible) : m.visible, m.id);
    logActivity(actor(ctx), 'media.update', `${m.kind} "${b.title || m.title}"`);
    json(ctx, { item: mediaOut(get('SELECT * FROM media WHERE id = ?', m.id)) });
  });

  router.delete(A('/media/:id'), guard, (ctx) => {
    const m = get('SELECT * FROM media WHERE id = ?', U.toInt(ctx.params.id));
    if (!m) throw new HttpError(404, 'File not found.');
    const usage = mediaUsage(m);
    deleteMedia(m, actor(ctx));
    json(ctx, { ok: true, was_used_in: usage });
  });

  router.post(A('/media-bulk'), guard, async (ctx) => {
    const b = await readJson(ctx);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((n) => U.toInt(n)).filter(Boolean).slice(0, 200);
    if (!ids.length) throw new HttpError(422, 'Select at least one item.');
    let n = 0;
    if (b.action === 'delete') {
      for (const id of ids) { const m = get('SELECT * FROM media WHERE id = ?', id); if (m) { deleteMedia(m, actor(ctx)); n += 1; } }
    } else if (b.action === 'show' || b.action === 'hide') {
      n = Number(run(`UPDATE media SET visible = ? WHERE id IN (${ids.map(() => '?').join(',')})`, b.action === 'show' ? 1 : 0, ...ids).changes);
      logActivity(actor(ctx), `media.bulk.${b.action}`, `${n} item(s)`);
    } else throw new HttpError(422, 'Unknown bulk action.');
    json(ctx, { ok: true, changed: n });
  });

  router.post(A('/media/:id/poster'), guard, async (ctx) => {
    const m = get("SELECT * FROM media WHERE id = ? AND kind = 'video'", U.toInt(ctx.params.id));
    if (!m) throw new HttpError(404, 'Video not found.');
    await withUpload(ctx, { maxFileBytes: config.maxImageBytes, maxFiles: 1 }, async ({ files }) => {
      if (!files.length) throw new HttpError(422, 'No image was received.');
      let stored;
      try { stored = media.store(files[0].path, { allow: 'image' }); } catch (e) { throw new HttpError(422, e.message); }
      if (m.poster) media.remove(m.poster);
      run('UPDATE media SET poster = ? WHERE id = ?', stored.filename, m.id);
      logActivity(actor(ctx), 'media.poster', `video "${m.title}"`);
      json(ctx, { item: mediaOut(get('SELECT * FROM media WHERE id = ?', m.id)) });
    });
  });

  router.delete(A('/media/:id/poster'), guard, (ctx) => {
    const m = get('SELECT * FROM media WHERE id = ?', U.toInt(ctx.params.id));
    if (!m) throw new HttpError(404, 'Video not found.');
    if (m.poster) media.remove(m.poster);
    run('UPDATE media SET poster = NULL WHERE id = ?', m.id);
    json(ctx, { item: mediaOut(get('SELECT * FROM media WHERE id = ?', m.id)) });
  });

  /* ----- subscribers ----- */
  router.get(A('/subscribers/export'), guard, (ctx) => {
    const rows = all('SELECT email, created_at FROM subscribers ORDER BY created_at DESC');
    const csv = 'email,subscribed_at\n' + rows.map((r) => `${U.csvCell(r.email)},${U.csvCell(r.created_at)}`).join('\n') + '\n';
    send(ctx, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="subscribers.csv"', 'Cache-Control': 'no-store' });
  });
  router.get(A('/subscribers'), guard, (ctx) => {
    const { page, per, offset } = pageOf(ctx.query, 25);
    const w = ctx.query.q ? "WHERE email LIKE ? ESCAPE '\\'" : '';
    const params = ctx.query.q ? [like(ctx.query.q)] : [];
    const total = get(`SELECT COUNT(*) AS c FROM subscribers ${w}`, ...params).c;
    json(ctx, { items: all(`SELECT * FROM subscribers ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, per, offset), total, page, pages: Math.max(1, Math.ceil(total / per)) });
  });
  router.post(A('/subscribers'), guard, async (ctx) => {
    const b = await readJson(ctx);
    const email = str(b.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(422, 'Enter a valid email address.');
    if (get('SELECT id FROM subscribers WHERE email = ?', email)) throw new HttpError(409, 'That email is already subscribed.');
    run('INSERT INTO subscribers (email, created_at) VALUES (?, ?)', email, U.nowIso());
    logActivity(actor(ctx), 'subscriber.add', email);
    json(ctx, { ok: true }, 201);
  });
  router.delete(A('/subscribers/:id'), guard, (ctx) => {
    const s = get('SELECT * FROM subscribers WHERE id = ?', U.toInt(ctx.params.id));
    if (!s) throw new HttpError(404, 'Subscriber not found.');
    run('DELETE FROM subscribers WHERE id = ?', s.id);
    logActivity(actor(ctx), 'subscriber.delete', s.email);
    json(ctx, { ok: true });
  });
  router.post(A('/subscribers-bulk'), guard, async (ctx) => {
    const b = await readJson(ctx);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((n) => U.toInt(n)).filter(Boolean).slice(0, 500);
    if (!ids.length) throw new HttpError(422, 'Select at least one subscriber.');
    const n = Number(run(`DELETE FROM subscribers WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).changes);
    logActivity(actor(ctx), 'subscriber.bulk.delete', `${n} subscriber(s)`);
    json(ctx, { ok: true, changed: n });
  });

  /* ----- settings ----- */
  router.get(A('/settings'), guard, (ctx) => {
    const all_ = settings.getAll();
    json(ctx, { settings: Object.fromEntries(settings.EDITABLE.map((k) => [k, all_[k]])) });
  });
  router.put(A('/settings'), guard, async (ctx) => {
    const b = await readJson(ctx, 512 * 1024);
    const out = {};
    const flags = ['maintenance_mode', 'enable_gallery', 'enable_videos', 'enable_newsletter', 'enable_contact', 'enable_donations', 'enable_accounts'];
    const urls = ['site_url', 'social_x', 'social_facebook', 'social_youtube', 'social_instagram'];
    const limits = {
      site_title: 80, tagline: 160, site_description: 320, site_keywords: 400, author_name: 80, contact_email: 160,
      hero_eyebrow: 80, hero_title: 200, hero_lede: 400, hero_verse: 500, hero_verse_ref: 60, footer_text: 300, footer_ref: 60, maintenance_message: 400, contact_intro: 500, donate_intro: 1200, donate_use: 800,
    };
    for (const [k, v] of Object.entries(b)) {
      if (!settings.EDITABLE.includes(k)) continue;
      if (flags.includes(k)) out[k] = bool(v) ? '1' : '0';
      else if (urls.includes(k)) {
        const s = str(v, 300, k);
        if (s && !/^https?:\/\/[^\s]+$/i.test(s)) throw new HttpError(422, `"${k.replace(/_/g, ' ')}" must be a full web address starting with https://`);
        out[k] = s.replace(/\/+$/, '');
      } else if (k === 'posts_per_page') out[k] = String(U.clamp(U.toInt(v, 9), 3, 30));
      else if (k === 'about_html') out[k] = sanitizeHtml(String(v || '')).slice(0, 20000);
      else if (k === 'default_og_image_id') {
        const id = U.toInt(v, 0);
        out[k] = id && get("SELECT id FROM media WHERE id = ? AND kind = 'image'", id) ? String(id) : '';
      } else if (k === 'contact_email') {
        const s = str(v, 160, 'Contact email');
        if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new HttpError(422, 'Contact email is not valid.');
        out[k] = s;
      } else if (limits[k]) out[k] = str(v, limits[k], k.replace(/_/g, ' '));
    }
    if (out.site_title === '') throw new HttpError(422, 'Site title cannot be empty.');
    settings.update(out);
    logActivity(actor(ctx), 'settings.update', Object.keys(out).join(', ').slice(0, 300));
    json(ctx, { ok: true });
  });

  /* ----- account ----- */
  router.put(A('/account'), guard, async (ctx) => {
    const b = await readJson(ctx);
    const user = get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    if (!(await auth.verifyPassword(typeof b.current_password === 'string' ? b.current_password : '', user.password_hash))) throw new HttpError(403, 'Your current password is not correct.');
    const username = b.username !== undefined ? str(b.username, 40, 'Username') : user.username;
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new HttpError(422, 'Username must be 3-40 letters, numbers, dots, dashes or underscores.');
    const clash = get('SELECT id FROM users WHERE username = ? AND id != ?', username, user.id);
    if (clash) throw new HttpError(409, 'That username is already taken.');
    const email = b.email !== undefined ? str(b.email, 160, 'Email') : user.email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(422, 'Email is not valid.');
    let hash = user.password_hash;
    if (b.new_password) {
      const problem = auth.validatePassword(b.new_password);
      if (problem) throw new HttpError(422, problem);
      hash = await auth.hashPassword(b.new_password);
    }
    run('UPDATE users SET username = ?, email = ?, password_hash = ? WHERE id = ?', username, email, hash, user.id);
    if (email !== user.email && user.email && mailer.configured()) mailer.send({ to: user.email, subject: `Your ${settings.get('site_title')} recovery email was changed`, text: `The recovery email for the dashboard was changed to ${email || '(none)'}.\n\nIf this was not you, reset the dashboard password immediately.` }).catch(() => {});
    if (b.new_password) auth.destroyOtherSessions(user.id, ctx.user.tokenHash);
    logActivity(username, b.new_password ? 'account.password' : 'account.update', 'Account details changed');
    json(ctx, { ok: true, user: { username, email } });
  });
  router.get(A('/account/sessions'), guard, (ctx) => {
    const rows = all('SELECT token_hash, created_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC', ctx.user.id);
    json(ctx, { items: rows.map((r) => ({ created_at: r.created_at, expires_at: r.expires_at, ip: r.ip, user_agent: r.user_agent, current: r.token_hash === ctx.user.tokenHash })) });
  });
  router.delete(A('/account/sessions'), guard, (ctx) => {
    auth.destroyOtherSessions(ctx.user.id, ctx.user.tokenHash);
    logActivity(actor(ctx), 'account.sessions', 'Signed out all other devices');
    json(ctx, { ok: true });
  });

  /* ----- owner password reset (works with any recovery email you choose) ----- */
  const forgotIp = auth.createLimiter(6, 60 * 60 * 1000);
  const forgotAcct = auth.createLimiter(3, 60 * 60 * 1000);
  const resetIp = auth.createLimiter(10, 60 * 60 * 1000);

  router.post(A('/forgot'), async (ctx) => {
    const b = await readJson(ctx, 4 * 1024);
    const ident = str(b.identifier, 160).toLowerCase();
    if (!ident) throw new HttpError(422, 'Enter your username or recovery email.');
    if (!forgotIp.take(ctx.ip).allowed) throw new HttpError(429, 'Too many reset requests. Please try again in an hour.');
    const generic = { ok: true, message: 'If that matches the owner account, a reset link has been sent to its recovery email. It stays valid for 60 minutes.' };
    const user = get("SELECT * FROM users WHERE username = ? COLLATE NOCASE OR (email != '' AND lower(email) = ?)", ident, ident);
    if (user && forgotAcct.take('u' + user.id).allowed) {
      if (!user.email) {
        logActivity('system', 'reset.unavailable', 'Owner password reset requested but no recovery email is set. Run: npm run reset-password');
        console.warn('[Breed a Life] Password reset requested but the owner account has no recovery email. Run: npm run reset-password');
      } else {
        const base = resets.safeBase(ctx);
        if (!base) {
          logActivity('system', 'reset.unavailable', 'Reset blocked: set SITE_URL (or Settings > Site address) so links point to your real domain.');
          console.warn('[Breed a Life] Reset blocked: set SITE_URL in .env so reset links use your real domain.');
        } else {
          const token = resets.issue('admin', user.id, user.email);
          const link = `${base}/admin/reset?token=${token}`;
          if (mailer.configured()) {
            mailer.send({ to: user.email, subject: `Reset your ${settings.get('site_title')} dashboard password`, text: `Hello ${user.username},\n\nA password reset was requested for the ${settings.get('site_title')} dashboard.\nUse the link below within ${resets.LIFETIME_MIN} minutes:\n\n${link}\n\nIf you did not ask for this, ignore this email. Your password has not changed.` })
              .catch((e) => logActivity('system', 'email.failed', `owner reset: ${e.message}`));
          } else {
            console.log(`\n[Breed a Life] Email delivery is not set up, so the owner reset link is shown here (valid ${resets.LIFETIME_MIN} min):\n${link}\n`);
          }
          logActivity('system', 'reset.requested', `Owner password reset link issued for "${user.username}"`);
        }
      }
    }
    json(ctx, generic);
  });

  router.post(A('/reset'), async (ctx) => {
    if (!resetIp.take(ctx.ip).allowed) throw new HttpError(429, 'Too many attempts. Please try again later.');
    const b = await readJson(ctx, 4 * 1024);
    const row = resets.find('admin', b.token);
    if (!row) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one from the sign-in page.');
    const problem = auth.validatePassword(b.password);
    if (problem) throw new HttpError(422, problem);
    const user = get('SELECT * FROM users WHERE id = ?', row.account_id);
    if (!user) throw new HttpError(400, 'This reset link is invalid or has expired.');
    const hash = await auth.hashPassword(b.password);
    tx(() => {
      run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
      run('DELETE FROM sessions WHERE user_id = ?', user.id);
      resets.markUsed(row.id);
    });
    logActivity(user.username, 'password.reset', 'Owner password reset using an emailed link');
    if (mailer.configured() && user.email) mailer.send({ to: user.email, subject: `Your ${settings.get('site_title')} dashboard password was changed`, text: 'The dashboard password was just changed using a reset link. If this was not you, reset it again immediately.' }).catch(() => {});
    json(ctx, { ok: true });
  });

  /* ----- email delivery (SMTP) ----- */
  router.get(A('/email'), guard, (ctx) => {
    const c = mailer.cfg();
    const me = get('SELECT email FROM users WHERE id = ?', ctx.user.id);
    json(ctx, { host: c.host, port: c.port, secure: c.secure, user: c.user, from: c.from, pass_set: !!c.pass, source: c.source, configured: mailer.configured(), recovery_email: me.email, site_url_ok: !!resets.safeBase(ctx) });
  });

  router.put(A('/email'), guard, async (ctx) => {
    const b = await readJson(ctx, 8 * 1024);
    const host = str(b.host, 200, 'Mail server').toLowerCase();
    if (host && !/^[a-z0-9.-]+$/.test(host)) throw new HttpError(422, 'The mail server should look like smtp.gmail.com.');
    const port = U.toInt(b.port, 465);
    if (port < 1 || port > 65535) throw new HttpError(422, 'Port must be between 1 and 65535.');
    const secure = ['tls', 'starttls', 'none'].includes(b.secure) ? b.secure : 'tls';
    const user = str(b.user, 200, 'Username');
    const from = str(b.from, 200, 'From address') || user;
    if (host && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(from)) throw new HttpError(422, 'Enter the email address messages should be sent from.');
    settings.update({ smtp_host: host, smtp_port: String(port), smtp_secure: secure, smtp_user: user, smtp_from: host ? from : '' });
    if (b.clear_password || !host) settings.setRaw('smtp_pass_enc', '');
    else if (typeof b.pass === 'string' && b.pass) settings.setRaw('smtp_pass_enc', secret.encrypt(b.pass));
    logActivity(actor(ctx), 'email.settings', host ? `Mail server set to ${host}:${port}` : 'Dashboard mail settings cleared');
    json(ctx, { ok: true });
  });

  router.post(A('/email/test'), guard, async (ctx) => {
    const b = await readJson(ctx, 4 * 1024);
    const to = str(b.to, 200, 'Recipient') || get('SELECT email FROM users WHERE id = ?', ctx.user.id).email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw new HttpError(422, 'Enter an email address to send the test to.');
    if (!mailer.configured()) throw new HttpError(422, 'Fill in the mail server details and save them first.');
    try {
      await Promise.race([mailer.send({ to, subject: `${settings.get('site_title')}: test email`, text: 'This is a test message from your Breed a Life dashboard. If you can read it, email delivery is working, and password resets and contact messages will reach you.' }), new Promise((_, rej) => setTimeout(() => rej(new Error('The mail server did not respond in time.')), 25000))]);
    } catch (e) { throw new HttpError(422, `Could not send: ${e.message}`); }
    logActivity(actor(ctx), 'email.test', `Test email sent to ${to}`);
    json(ctx, { ok: true, to });
  });

  /* ----- inbox (contact form messages) ----- */
  router.get(A('/messages'), guard, (ctx) => {
    const { page, per, offset } = pageOf(ctx.query, 20);
    const where = []; const params = [];
    if (ctx.query.filter === 'unread') where.push('is_read = 0');
    if (ctx.query.q) { where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')"); const l = like(ctx.query.q); params.push(l, l, l, l); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = get(`SELECT COUNT(*) AS c FROM messages ${w}`, ...params).c;
    const items = all(`SELECT id, name, email, subject, substr(body, 1, 160) AS snippet, is_read, emailed, created_at FROM messages ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, per, offset);
    json(ctx, { items, total, page, pages: Math.max(1, Math.ceil(total / per)), unread: get('SELECT COUNT(*) AS c FROM messages WHERE is_read = 0').c });
  });
  router.get(A('/messages/:id'), guard, (ctx) => {
    const m = get('SELECT * FROM messages WHERE id = ?', U.toInt(ctx.params.id));
    if (!m) throw new HttpError(404, 'Message not found.');
    if (!m.is_read) run('UPDATE messages SET is_read = 1 WHERE id = ?', m.id);
    json(ctx, { item: { ...m, is_read: 1 } });
  });
  router.put(A('/messages/:id'), guard, async (ctx) => {
    const m = get('SELECT id FROM messages WHERE id = ?', U.toInt(ctx.params.id));
    if (!m) throw new HttpError(404, 'Message not found.');
    run('UPDATE messages SET is_read = ? WHERE id = ?', bool((await readJson(ctx)).is_read), m.id);
    json(ctx, { ok: true });
  });
  router.delete(A('/messages/:id'), guard, (ctx) => {
    const n = Number(run('DELETE FROM messages WHERE id = ?', U.toInt(ctx.params.id)).changes);
    if (!n) throw new HttpError(404, 'Message not found.');
    logActivity(actor(ctx), 'message.delete', `Message #${ctx.params.id}`);
    json(ctx, { ok: true });
  });
  router.post(A('/messages-bulk'), guard, async (ctx) => {
    const b = await readJson(ctx);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((n) => U.toInt(n)).filter(Boolean).slice(0, 200);
    if (!ids.length) throw new HttpError(422, 'Select at least one message.');
    const marks = ids.map(() => '?').join(',');
    let n = 0;
    if (b.action === 'delete') { n = Number(run(`DELETE FROM messages WHERE id IN (${marks})`, ...ids).changes); logActivity(actor(ctx), 'message.bulk.delete', `${n} message(s)`); }
    else if (b.action === 'read' || b.action === 'unread') n = Number(run(`UPDATE messages SET is_read = ? WHERE id IN (${marks})`, b.action === 'read' ? 1 : 0, ...ids).changes);
    else throw new HttpError(422, 'Unknown bulk action.');
    json(ctx, { ok: true, changed: n });
  });

  /* ----- readers (accounts created by visitors; their notes stay private) ----- */
  router.get(A('/readers'), guard, (ctx) => {
    const { page, per, offset } = pageOf(ctx.query, 25);
    const w = ctx.query.q ? "WHERE r.email LIKE ? ESCAPE '\\' OR r.name LIKE ? ESCAPE '\\'" : '';
    const params = ctx.query.q ? [like(ctx.query.q), like(ctx.query.q)] : [];
    const total = get(`SELECT COUNT(*) AS c FROM readers r ${w}`, ...params).c;
    const items = all(`SELECT r.id, r.name, r.email, r.created_at, r.last_login,
        (SELECT COUNT(*) FROM reader_entries e WHERE e.reader_id = r.id) AS devotions,
        (SELECT COUNT(*) FROM reader_entries e WHERE e.reader_id = r.id AND e.completed_at IS NOT NULL) AS completed,
        (SELECT COUNT(*) FROM reader_entries e WHERE e.reader_id = r.id AND e.body != '') AS notes
      FROM readers r ${w} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, ...params, per, offset);
    json(ctx, { items, total, page, pages: Math.max(1, Math.ceil(total / per)) });
  });
  router.delete(A('/readers/:id'), guard, (ctx) => {
    const r = get('SELECT id, email FROM readers WHERE id = ?', U.toInt(ctx.params.id));
    if (!r) throw new HttpError(404, 'Reader not found.');
    run('DELETE FROM readers WHERE id = ?', r.id);
    logActivity(actor(ctx), 'reader.delete', r.email);
    json(ctx, { ok: true });
  });
  router.post(A('/readers/:id/reset'), guard, async (ctx) => {
    const r = get('SELECT * FROM readers WHERE id = ?', U.toInt(ctx.params.id));
    if (!r) throw new HttpError(404, 'Reader not found.');
    const mode = (await readJson(ctx)).mode;
    if (mode === 'email') {
      const base = resets.safeBase(ctx);
      if (!mailer.configured()) throw new HttpError(422, 'Email delivery is not set up yet (Settings > Email). Use a temporary password instead.');
      if (!base) throw new HttpError(422, 'Set your Site address in Settings first so the link points to your domain.');
      const token = resets.issue('reader', r.id, r.email);
      await mailer.send({ to: r.email, subject: `Reset your ${settings.get('site_title')} password`, text: `Hello ${r.name},\n\nUse the link below within ${resets.LIFETIME_MIN} minutes to choose a new password:\n\n${base}/reset-password?token=${token}\n\nIf you did not expect this, you can ignore it.` }).catch((e) => { throw new HttpError(422, `Could not send: ${e.message}`); });
      logActivity(actor(ctx), 'reader.reset.email', r.email);
      return json(ctx, { ok: true, sent_to: r.email });
    }
    const temp = require('crypto').randomBytes(9).toString('base64url') + '7a';
    run('UPDATE readers SET password_hash = ? WHERE id = ?', await auth.hashPassword(temp), r.id);
    run('DELETE FROM reader_sessions WHERE reader_id = ?', r.id);
    logActivity(actor(ctx), 'reader.reset.temp', r.email);
    json(ctx, { ok: true, temporary_password: temp });
  });

  /* ----- giving options (shown on the Donate page) ----- */
  function readDonation(b) {
    const label = str(b.label, 80, 'Name');
    if (!label) throw new HttpError(422, 'Give this option a name, for example "Card or bank (Paystack)".');
    const url = str(b.url, 500, 'Link');
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw new HttpError(422, 'The payment link must start with https://');
    const details = str(b.details, 1000, 'Details');
    if (!url && !details) throw new HttpError(422, 'Add a payment link, account details, or both.');
    return { label, url, details, note: str(b.note, 300, 'Note'), visible: b.visible === undefined ? 1 : bool(b.visible) };
  }
  router.get(A('/donations'), guard, (ctx) => json(ctx, { items: all('SELECT * FROM donation_methods ORDER BY position, id') }));
  router.post(A('/donations'), guard, async (ctx) => {
    const d = readDonation(await readJson(ctx));
    const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM donation_methods').p;
    const r = run('INSERT INTO donation_methods (label, url, details, note, visible, position, created_at) VALUES (?,?,?,?,?,?,?)', d.label, d.url, d.details, d.note, d.visible, pos, U.nowIso());
    logActivity(actor(ctx), 'donation.add', d.label);
    json(ctx, { item: get('SELECT * FROM donation_methods WHERE id = ?', r.lastInsertRowid) }, 201);
  });
  router.put(A('/donations/:id'), guard, async (ctx) => {
    const ex = get('SELECT * FROM donation_methods WHERE id = ?', U.toInt(ctx.params.id));
    if (!ex) throw new HttpError(404, 'Giving option not found.');
    const d = readDonation({ ...ex, ...(await readJson(ctx)) });
    run('UPDATE donation_methods SET label=?, url=?, details=?, note=?, visible=? WHERE id=?', d.label, d.url, d.details, d.note, d.visible, ex.id);
    logActivity(actor(ctx), 'donation.update', d.label);
    json(ctx, { item: get('SELECT * FROM donation_methods WHERE id = ?', ex.id) });
  });
  router.delete(A('/donations/:id'), guard, (ctx) => {
    const ex = get('SELECT label FROM donation_methods WHERE id = ?', U.toInt(ctx.params.id));
    if (!ex) throw new HttpError(404, 'Giving option not found.');
    run('DELETE FROM donation_methods WHERE id = ?', U.toInt(ctx.params.id));
    logActivity(actor(ctx), 'donation.delete', ex.label);
    json(ctx, { ok: true });
  });
  router.post(A('/donations-order'), guard, async (ctx) => {
    const ids = ((await readJson(ctx)).ids || []).map((n) => U.toInt(n)).filter(Boolean);
    tx(() => ids.forEach((id, i) => run('UPDATE donation_methods SET position = ? WHERE id = ?', i + 1, id)));
    json(ctx, { ok: true });
  });

  /* ----- activity ----- */
  router.get(A('/activity'), guard, (ctx) => {
    const { page, per, offset } = pageOf(ctx.query, 30);
    const total = get('SELECT COUNT(*) AS c FROM activity').c;
    json(ctx, { items: all('SELECT * FROM activity ORDER BY id DESC LIMIT ? OFFSET ?', per, offset), total, page, pages: Math.max(1, Math.ceil(total / per)) });
  });

  /* ----- database browser ----- */
  router.get(A('/db/overview'), guard, (ctx) => {
    const tables = tableNames().map((name) => ({ name, rows: get(`SELECT COUNT(*) AS c FROM ${qi(name)}`).c, columns: columnsOf(name), editable: !NO_EDIT.has(name), deletable: !NO_DELETE.has(name) }));
    let walBytes = 0;
    try { walBytes = fs.statSync(database.dbPath + '-wal').size; } catch { /* no wal yet */ }
    let uploadsBytes = 0;
    let uploadsCount = 0;
    for (const f of fs.readdirSync(config.uploadDir)) {
      if (f.startsWith('.')) continue;
      try { uploadsBytes += fs.statSync(path.join(config.uploadDir, f)).size; uploadsCount += 1; } catch { /* ignore */ }
    }
    json(ctx, {
      tables, sqlite_version: get('SELECT sqlite_version() AS v').v, node_version: process.version,
      db_bytes: fs.statSync(database.dbPath).size, wal_bytes: walBytes, uploads_bytes: uploadsBytes, uploads_count: uploadsCount,
      db_file: path.basename(database.dbPath), uptime_seconds: Math.round(process.uptime()),
    });
  });

  router.get(A('/db/backup'), guard, async (ctx) => {
    const tmp = path.join(config.tmpDir, `backup-${U.randomHex(6)}.db`);
    database.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    logActivity(actor(ctx), 'db.backup', 'Downloaded a database backup');
    const stamp = new Date().toISOString().slice(0, 10);
    try { await sendFile(ctx, tmp, { cache: 'no-store', type: 'application/octet-stream', download: `breed-a-life-${stamp}.db` }); }
    finally { fs.rm(tmp, { force: true }, () => {}); }
  });

  router.get(A('/db/export'), guard, (ctx) => {
    const dump = { exported_at: U.nowIso(), tables: {} };
    for (const name of tableNames()) {
      if (name === 'sessions' || name === 'reader_sessions' || name === 'password_resets') continue;
      dump.tables[name] = all(`SELECT * FROM ${qi(name)}`).map((r) => maskRow(name, r));
    }
    logActivity(actor(ctx), 'db.export', 'Exported all tables as JSON');
    send(ctx, 200, JSON.stringify(dump, null, 2), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="breed-a-life-export-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' });
  });

  router.get(A('/db/tables/:name'), guard, (ctx) => {
    const table = requireTable(ctx.params.name);
    const columns = columnsOf(table);
    const { page, per, offset } = pageOf(ctx.query, U.clamp(U.toInt(ctx.query.per, 25), 5, 100));
    const params = [];
    let w = '';
    if (ctx.query.q) {
      const secret = SECRET_COLS[table] || [];
      const searchable = columns.filter((c) => !secret.includes(c.name));
      w = 'WHERE ' + searchable.map((c) => `CAST(${qi(c.name)} AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ');
      searchable.forEach(() => params.push(like(ctx.query.q)));
    }
    const sortCol = columns.find((c) => c.name === ctx.query.sort);
    const secretSort = sortCol && (SECRET_COLS[table] || []).includes(sortCol.name);
    const order = sortCol && !secretSort ? `${qi(sortCol.name)} ${ctx.query.dir === 'asc' ? 'ASC' : 'DESC'}` : 'rowid DESC';
    const total = get(`SELECT COUNT(*) AS c FROM ${qi(table)} ${w}`, ...params).c;
    const rows = all(`SELECT rowid AS _rowid_, * FROM ${qi(table)} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, per, offset).map((r) => maskRow(table, r));
    json(ctx, { table, columns, rows, total, page, per, pages: Math.max(1, Math.ceil(total / per)), editable: !NO_EDIT.has(table), deletable: !NO_DELETE.has(table), secret: SECRET_COLS[table] || [] });
  });

  router.put(A('/db/tables/:name/rows/:rowid'), guard, async (ctx) => {
    const table = requireTable(ctx.params.name);
    if (NO_EDIT.has(table)) throw new HttpError(403, `The ${table} table is protected. Use the Account page instead.`);
    const rowid = U.toInt(ctx.params.rowid);
    const existing = get(`SELECT rowid AS _rowid_, * FROM ${qi(table)} WHERE rowid = ?`, rowid);
    if (!existing) throw new HttpError(404, 'Row not found.');
    const values = (await readJson(ctx, 4 * 1048576)).values;
    if (!values || typeof values !== 'object') throw new HttpError(422, 'Nothing to update.');
    const columns = columnsOf(table);
    const sets = [];
    const params = [];
    for (const [k, raw] of Object.entries(values)) {
      const col = columns.find((c) => c.name === k);
      if (!col) throw new HttpError(422, `Unknown column "${k}".`);
      if (col.pk && col.type.toUpperCase() === 'INTEGER') continue;
      let v = raw;
      if (v === '' && !col.notnull) v = null;
      if (v !== null && /INT/i.test(col.type) && v !== '') { const n = Number(v); if (!Number.isFinite(n)) throw new HttpError(422, `"${k}" must be a number.`); v = n; }
      if (table === 'posts' && k === 'content') v = sanitizeHtml(String(v ?? ''));
      sets.push(`${qi(k)} = ?`); params.push(v);
    }
    if (!sets.length) return json(ctx, { ok: true });
    try { run(`UPDATE ${qi(table)} SET ${sets.join(', ')} WHERE rowid = ?`, ...params, rowid); }
    catch (e) { throw new HttpError(422, `The database rejected that change: ${e.message}`); }
    if (table === 'settings') settings.invalidate();
    logActivity(actor(ctx), 'db.edit', `${table} row ${rowid}`);
    const fresh = get(`SELECT rowid AS _rowid_, * FROM ${qi(table)} WHERE rowid = ?`, rowid);
    json(ctx, { ok: true, row: maskRow(table, fresh) });
  });

  router.delete(A('/db/tables/:name/rows/:rowid'), guard, (ctx) => {
    const table = requireTable(ctx.params.name);
    if (NO_DELETE.has(table)) throw new HttpError(403, 'The admin account cannot be deleted from here.');
    const rowid = U.toInt(ctx.params.rowid);
    const row = get(`SELECT rowid AS _rowid_, * FROM ${qi(table)} WHERE rowid = ?`, rowid);
    if (!row) throw new HttpError(404, 'Row not found.');
    if (table === 'media') deleteMedia(row, actor(ctx));
    else {
      run(`DELETE FROM ${qi(table)} WHERE rowid = ?`, rowid);
      if (table === 'settings') settings.invalidate();
      logActivity(actor(ctx), 'db.delete', `${table} row ${rowid}`);
    }
    json(ctx, { ok: true });
  });

  router.post(A('/db/query'), guard, async (ctx) => {
    const b = await readJson(ctx, 64 * 1024);
    let sql = String(b.sql || '').trim().replace(/;+\s*$/, '');
    if (!sql) throw new HttpError(422, 'Enter a query.');
    if (sql.includes(';')) throw new HttpError(422, 'Run one statement at a time.');
    if (!/^(select|with|explain|pragma\s+(table_info|table_list|index_list|foreign_key_list|database_list))\b/i.test(sql)) throw new HttpError(422, 'The console is read-only. Start with SELECT, WITH, EXPLAIN or PRAGMA table_info.');
    if (/\b(users|readers|sessions|reader_sessions|reader_entries|password_resets|password_hash|token_hash|settings)\b/i.test(sql)) throw new HttpError(403, 'Accounts, sessions, private reader notes and settings cannot be queried from the console. Use the table browser for settings.');
    const isSelect = /^(select|with)\b/i.test(sql);
    const t0 = Date.now();
    let rows;
    try { rows = database.readOnly().prepare(isSelect ? `SELECT * FROM (${sql}) LIMIT 501` : sql).all(); }
    catch (e) { throw new HttpError(422, e.message); }
    const truncated = rows.length > 500;
    rows = rows.slice(0, 500).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
    json(ctx, { columns: rows.length ? Object.keys(rows[0]) : [], rows, truncated, ms: Date.now() - t0 });
  });
};
