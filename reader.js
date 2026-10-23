'use strict';
// Optional reader accounts. Used ONLY for devotion notes and progress tracking.
const database = require('../db');
const { all, get, run, tx } = database;
const auth = require('../auth');
const readers = require('../readers');
const resets = require('../resets');
const mailer = require('../mailer');
const settings = require('../settings');
const { HttpError, json, readJson, send } = require('../http');
const U = require('../util');

const loginIp = auth.createLimiter(10, 15 * 60 * 1000);
const loginEmail = auth.createLimiter(8, 15 * 60 * 1000);
const joinIp = auth.createLimiter(6, 60 * 60 * 1000);
const forgotIp = auth.createLimiter(6, 60 * 60 * 1000);
const forgotEmail = auth.createLimiter(3, 60 * 60 * 1000);
const resetIp = auth.createLimiter(10, 60 * 60 * 1000);
const noteLimit = auth.createLimiter(240, 60 * 1000);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PW = 8;
const MAX_NOTE = 20000;

function csrf(ctx) {
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && ctx.req.headers['x-requested-with'] !== 'sx-reader') throw new HttpError(403, 'Missing required request header.');
}
function guard(ctx) {
  const r = readers.current(ctx);
  if (!r) throw new HttpError(401, 'Please sign in to keep notes and track your progress.');
  csrf(ctx);
  ctx.reader = r;
}
const str = (v, max, label) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > max) throw new HttpError(422, `${label} must be ${max} characters or fewer.`);
  return s;
};
function localDay(ctx, offset = 0) {
  const off = U.clamp(U.toInt(ctx.req.headers['x-tz-offset'], 0), -840, 840);
  return new Date(Date.now() - off * 60000 + offset * 86400000).toISOString().slice(0, 10);
}
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function computeStreaks(days, today) {
  const set = new Set(days);
  let current = 0;
  let cursor = set.has(today) ? today : set.has(addDays(today, -1)) ? addDays(today, -1) : null;
  while (cursor && set.has(cursor)) { current += 1; cursor = addDays(cursor, -1); }
  let longest = 0; let runLen = 0; let prev = null;
  for (const d of [...set].sort()) { runLen = prev && addDays(prev, 1) === d ? runLen + 1 : 1; longest = Math.max(longest, runLen); prev = d; }
  return { current, longest };
}

const publishedPost = (id) => get("SELECT id, title, slug FROM posts WHERE id = ? AND status = 'published' AND published_at <= ?", U.toInt(id), U.nowIso());
function upsertEntry(readerId, post) {
  const now = U.nowIso();
  run(`INSERT INTO reader_entries (reader_id, post_id, post_title, post_slug, body, percent, last_read_at, created_at, updated_at)
       VALUES (?,?,?,?, '', 0, ?, ?, ?)
       ON CONFLICT(reader_id, post_id) DO UPDATE SET post_title = excluded.post_title, post_slug = excluded.post_slug, last_read_at = excluded.last_read_at`,
  readerId, post.id, post.title, post.slug, now, now, now);
  return get('SELECT * FROM reader_entries WHERE reader_id = ? AND post_id = ?', readerId, post.id);
}
const markDay = (readerId, day) => run('INSERT OR IGNORE INTO reader_days (reader_id, day) VALUES (?, ?)', readerId, day);
const entryOut = (e) => e && ({ id: e.id, post_id: e.post_id, title: e.post_title, slug: e.post_slug, body: e.body, percent: e.percent, completed: !!e.completed_at, completed_at: e.completed_at, updated_at: e.updated_at, last_read_at: e.last_read_at });

function mailAsync(to, subject, text, label) {
  if (!mailer.configured()) return;
  mailer.send({ to, subject, text }).catch((e) => database.logActivity('system', 'email.failed', `${label}: ${e.message}`));
}

module.exports = function register(router) {
  const R = (p) => '/api/reader' + p;

  /* ----- accounts ----- */
  router.post(R('/register'), async (ctx) => {
    csrf(ctx);
    if (!settings.flag('enable_accounts')) throw new HttpError(403, 'New accounts are not being accepted right now.');
    const b = await readJson(ctx, 10 * 1024);
    if (b.website) return json(ctx, { ok: true }); // honeypot
    const gate = joinIp.take(ctx.ip);
    if (!gate.allowed) throw new HttpError(429, 'Too many sign-up attempts. Please try again later.');
    const email = str(b.email, 160, 'Email').toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(422, 'Enter a valid email address.');
    const problem = auth.validatePassword(b.password, MIN_PW);
    if (problem) throw new HttpError(422, problem);
    const name = str(b.name, 60, 'Name') || email.split('@')[0].slice(0, 60);
    if (get('SELECT id FROM readers WHERE email = ?', email)) throw new HttpError(409, 'An account with that email already exists. Try signing in, or reset your password.');
    const r = run('INSERT INTO readers (email, name, password_hash, created_at, last_login) VALUES (?,?,?,?,?)', email, name, await auth.hashPassword(b.password), U.nowIso(), U.nowIso());
    const session = readers.createSession(r.lastInsertRowid, ctx.ip, ctx.req.headers['user-agent'], b.remember !== false);
    ctx.res.setHeader('Set-Cookie', readers.cookieHeader(session.token, session.days));
    json(ctx, { ok: true, reader: { name, email } }, 201);
  });

  router.post(R('/login'), async (ctx) => {
    csrf(ctx);
    const b = await readJson(ctx, 10 * 1024);
    const email = str(b.email, 160, 'Email').toLowerCase();
    const g1 = loginIp.take(ctx.ip); const g2 = loginEmail.take(email);
    if (!g1.allowed || !g2.allowed) {
      ctx.res.setHeader('Retry-After', Math.max(g1.retryAfter, g2.retryAfter));
      throw new HttpError(429, 'Too many sign-in attempts. Please wait a few minutes and try again.');
    }
    const password = typeof b.password === 'string' ? b.password : '';
    const reader = email ? get('SELECT * FROM readers WHERE email = ?', email) : null;
    const ok = reader ? await auth.verifyPassword(password, reader.password_hash) : (await auth.burn(password), false);
    if (!ok) throw new HttpError(401, 'That email or password is not correct.');
    loginIp.clear(ctx.ip); loginEmail.clear(email);
    run('UPDATE readers SET last_login = ? WHERE id = ?', U.nowIso(), reader.id);
    const session = readers.createSession(reader.id, ctx.ip, ctx.req.headers['user-agent'], b.remember !== false);
    ctx.res.setHeader('Set-Cookie', readers.cookieHeader(session.token, session.days));
    json(ctx, { ok: true, reader: { name: reader.name, email: reader.email } });
  });

  router.post(R('/logout'), (ctx) => {
    csrf(ctx);
    readers.destroy(ctx.cookies[readers.COOKIE]);
    ctx.res.setHeader('Set-Cookie', readers.clearCookieHeader());
    json(ctx, { ok: true });
  });

  router.get(R('/me'), (ctx) => {
    const r = readers.current(ctx);
    json(ctx, { reader: r ? { name: r.name, email: r.email } : null });
  });

  /* ----- forgot / reset password (works with ANY email address the reader signed up with) ----- */
  router.post(R('/forgot'), async (ctx) => {
    csrf(ctx);
    const b = await readJson(ctx, 4 * 1024);
    const email = str(b.email, 160, 'Email').toLowerCase();
    const generic = { ok: true, message: 'If an account exists for that email address, a reset link is on its way. It stays valid for 60 minutes.' };
    if (!EMAIL_RE.test(email)) throw new HttpError(422, 'Enter a valid email address.');
    const g1 = forgotIp.take(ctx.ip); const g2 = forgotEmail.take(email);
    if (!g1.allowed || !g2.allowed) throw new HttpError(429, 'Too many reset requests. Please try again in an hour.');
    const reader = get('SELECT * FROM readers WHERE email = ?', email);
    if (reader) {
      const base = resets.safeBase(ctx);
      if (!mailer.configured()) database.logActivity('system', 'reset.unavailable', 'A reader asked for a password reset but email delivery is not set up (Dashboard > Settings > Email).');
      else if (!base) database.logActivity('system', 'reset.unavailable', 'Password reset blocked: set your Site URL in Dashboard > Settings so reset links point to your real domain.');
      else {
        const token = resets.issue('reader', reader.id, reader.email);
        const site = settings.get('site_title');
        mailAsync(reader.email, `Reset your ${site} password`,
          `Hello ${reader.name},\n\nSomeone asked to reset the password for your ${site} account.\nUse the link below within ${resets.LIFETIME_MIN} minutes to choose a new password:\n\n${base}/reset-password?token=${token}\n\nIf you did not ask for this, you can ignore this email. Your password has not been changed.\n\n${site}`, 'reader reset');
      }
    }
    json(ctx, generic); // identical response whether or not the account exists
  });

  router.post(R('/reset'), async (ctx) => {
    csrf(ctx);
    if (!resetIp.take(ctx.ip).allowed) throw new HttpError(429, 'Too many attempts. Please try again later.');
    const b = await readJson(ctx, 4 * 1024);
    const row = resets.find('reader', b.token);
    if (!row) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
    const problem = auth.validatePassword(b.password, MIN_PW);
    if (problem) throw new HttpError(422, problem);
    const reader = get('SELECT id, email FROM readers WHERE id = ?', row.account_id);
    if (!reader) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
    const hash = await auth.hashPassword(b.password);
    tx(() => {
      run('UPDATE readers SET password_hash = ? WHERE id = ?', hash, reader.id);
      run('DELETE FROM reader_sessions WHERE reader_id = ?', reader.id);
      resets.markUsed(row.id);
    });
    mailAsync(reader.email, `Your ${settings.get('site_title')} password was changed`, `The password for your ${settings.get('site_title')} account was just changed.\n\nIf this was not you, request another reset right away.`, 'reader reset notice');
    json(ctx, { ok: true });
  });

  /* ----- devotion entry (note + progress) ----- */
  router.get(R('/entry/:postId'), guard, (ctx) => {
    const post = publishedPost(ctx.params.postId);
    if (!post) throw new HttpError(404, 'That devotion is not available.');
    json(ctx, { entry: entryOut(get('SELECT * FROM reader_entries WHERE reader_id = ? AND post_id = ?', ctx.reader.id, post.id)) });
  });

  router.put(R('/entry/:postId/note'), guard, async (ctx) => {
    if (!noteLimit.take(String(ctx.reader.id)).allowed) throw new HttpError(429, 'You are saving too quickly. Please wait a moment.');
    const post = publishedPost(ctx.params.postId);
    if (!post) throw new HttpError(404, 'That devotion is not available.');
    const b = await readJson(ctx, 64 * 1024);
    const body = typeof b.body === 'string' ? b.body.replace(/\r\n/g, '\n').slice(0, MAX_NOTE) : '';
    const entry = upsertEntry(ctx.reader.id, post);
    run('UPDATE reader_entries SET body = ?, updated_at = ? WHERE id = ?', body, U.nowIso(), entry.id);
    if (body.trim()) markDay(ctx.reader.id, localDay(ctx));
    json(ctx, { entry: entryOut(get('SELECT * FROM reader_entries WHERE id = ?', entry.id)) });
  });

  router.put(R('/entry/:postId/progress'), guard, async (ctx) => {
    const post = publishedPost(ctx.params.postId);
    if (!post) throw new HttpError(404, 'That devotion is not available.');
    const b = await readJson(ctx, 2 * 1024);
    const pct = U.clamp(U.toInt(b.percent, 0), 0, 100);
    const entry = upsertEntry(ctx.reader.id, post);
    if (pct > entry.percent) run('UPDATE reader_entries SET percent = ? WHERE id = ?', pct, entry.id);
    json(ctx, { entry: entryOut(get('SELECT * FROM reader_entries WHERE id = ?', entry.id)) });
  });

  router.put(R('/entry/:postId/complete'), guard, async (ctx) => {
    const post = publishedPost(ctx.params.postId);
    if (!post) throw new HttpError(404, 'That devotion is not available.');
    const b = await readJson(ctx, 2 * 1024);
    const entry = upsertEntry(ctx.reader.id, post);
    if (b.completed === false) run('UPDATE reader_entries SET completed_at = NULL WHERE id = ?', entry.id);
    else { run('UPDATE reader_entries SET completed_at = COALESCE(completed_at, ?), percent = 100 WHERE id = ?', U.nowIso(), entry.id); markDay(ctx.reader.id, localDay(ctx)); }
    json(ctx, { entry: entryOut(get('SELECT * FROM reader_entries WHERE id = ?', entry.id)) });
  });

  router.delete(R('/entries/:id'), guard, (ctx) => {
    const e = get('SELECT id FROM reader_entries WHERE id = ? AND reader_id = ?', U.toInt(ctx.params.id), ctx.reader.id);
    if (!e) throw new HttpError(404, 'Entry not found.');
    run('DELETE FROM reader_entries WHERE id = ?', e.id);
    json(ctx, { ok: true });
  });

  /* ----- journal ----- */
  router.get(R('/journal'), guard, (ctx) => {
    const id = ctx.reader.id;
    const today = localDay(ctx);
    const days = all('SELECT day FROM reader_days WHERE reader_id = ? ORDER BY day DESC', id).map((r) => r.day);
    const streak = computeStreaks(days, today);
    const c = get(`SELECT COUNT(*) AS started, COALESCE(SUM(completed_at IS NOT NULL), 0) AS completed, COALESCE(SUM(body != ''), 0) AS notes FROM reader_entries WHERE reader_id = ?`, id);
    const available = get("SELECT COUNT(*) AS c FROM posts WHERE status = 'published' AND published_at <= ?", U.nowIso()).c;
    const entries = all(
      `SELECT e.id, e.post_id, e.post_title, e.post_slug, e.body, e.percent, e.completed_at, e.last_read_at, e.updated_at, p.slug AS live_slug, m.filename AS cover
       FROM reader_entries e LEFT JOIN posts p ON p.id = e.post_id LEFT JOIN media m ON m.id = p.cover_id
       WHERE e.reader_id = ? ORDER BY e.last_read_at DESC LIMIT 300`, id).map((e) => ({
      id: e.id, title: e.post_title, slug: e.live_slug || null, percent: e.percent, completed: !!e.completed_at, completed_at: e.completed_at,
      last_read_at: e.last_read_at, updated_at: e.updated_at, has_note: !!e.body, preview: U.truncate(e.body.replace(/\s+/g, ' '), 220), note_length: e.body.length,
      body: e.body, cover: e.cover && !/\.svg$/i.test(e.cover) ? '/uploads/' + e.cover : e.cover ? '/uploads/' + e.cover : null, removed: !e.live_slug,
    }));
    const horizon = addDays(today, -83);
    json(ctx, {
      reader: { name: ctx.reader.name, email: ctx.reader.email },
      stats: { started: c.started, completed: c.completed, notes: c.notes, available, current_streak: streak.current, longest_streak: streak.longest, total_days: days.length },
      active_days: days.filter((d) => d >= horizon), today, entries,
    });
  });

  router.get(R('/export'), guard, (ctx) => {
    const rows = all('SELECT * FROM reader_entries WHERE reader_id = ? ORDER BY created_at ASC', ctx.reader.id);
    const site = settings.get('site_title');
    let out = `# My ${site} journal\n\nExported ${new Date().toISOString().slice(0, 10)} for ${ctx.reader.name}\n\n`;
    for (const e of rows) {
      out += `## ${e.post_title || 'Untitled devotion'}\n\n`;
      out += `Last read: ${U.formatDate(e.last_read_at)}${e.completed_at ? ` | Completed: ${U.formatDate(e.completed_at)}` : ` | Progress: ${e.percent}%`}\n\n`;
      out += e.body ? `${e.body}\n\n` : '_No notes written._\n\n';
      out += '---\n\n';
    }
    send(ctx, 200, out, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="my-journal-${new Date().toISOString().slice(0, 10)}.md"`, 'Cache-Control': 'no-store' });
  });

  /* ----- account settings ----- */
  router.put(R('/account'), guard, async (ctx) => {
    const b = await readJson(ctx, 10 * 1024);
    const reader = get('SELECT * FROM readers WHERE id = ?', ctx.reader.id);
    const name = b.name !== undefined ? str(b.name, 60, 'Name') : reader.name;
    if (!name) throw new HttpError(422, 'Please enter a name.');
    const email = b.email !== undefined ? str(b.email, 160, 'Email').toLowerCase() : reader.email;
    const emailChanged = email !== reader.email;
    const passwordChanged = !!b.new_password;
    if (emailChanged || passwordChanged) {
      if (!(await auth.verifyPassword(typeof b.current_password === 'string' ? b.current_password : '', reader.password_hash))) throw new HttpError(403, 'Your current password is not correct.');
    }
    if (emailChanged) {
      if (!EMAIL_RE.test(email)) throw new HttpError(422, 'Enter a valid email address.');
      if (get('SELECT id FROM readers WHERE email = ? AND id != ?', email, reader.id)) throw new HttpError(409, 'That email is already used by another account.');
    }
    let hash = reader.password_hash;
    if (passwordChanged) {
      const problem = auth.validatePassword(b.new_password, MIN_PW);
      if (problem) throw new HttpError(422, problem);
      hash = await auth.hashPassword(b.new_password);
    }
    run('UPDATE readers SET name = ?, email = ?, password_hash = ? WHERE id = ?', name, email, hash, reader.id);
    if (passwordChanged) readers.destroyOthers(reader.id, ctx.reader.tokenHash);
    if (emailChanged) mailAsync(reader.email, `Your ${settings.get('site_title')} email address was changed`, `The email address on your ${settings.get('site_title')} account was changed to ${email}.\n\nIf this was not you, reset your password immediately.`, 'email change notice');
    json(ctx, { ok: true, reader: { name, email } });
  });

  router.delete(R('/account'), guard, async (ctx) => {
    const b = await readJson(ctx, 4 * 1024);
    const reader = get('SELECT * FROM readers WHERE id = ?', ctx.reader.id);
    if (!(await auth.verifyPassword(typeof b.password === 'string' ? b.password : '', reader.password_hash))) throw new HttpError(403, 'That password is not correct.');
    run('DELETE FROM readers WHERE id = ?', reader.id); // cascades to sessions, notes, progress
    ctx.res.setHeader('Set-Cookie', readers.clearCookieHeader());
    json(ctx, { ok: true });
  });
};
