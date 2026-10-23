'use strict';
// Reader accounts: optional, used only for devotion notes and progress.
const crypto = require('crypto');
const config = require('./config');
const { get, run } = require('./db');
const { sha256, nowIso } = require('./util');

const COOKIE = 'sx_reader';

function createSession(readerId, ip, userAgent, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const days = remember ? 30 : 1;
  run('INSERT INTO reader_sessions (token_hash, reader_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)',
    sha256(token), readerId, nowIso(), new Date(Date.now() + days * 86400000).toISOString(), ip || '', String(userAgent || '').slice(0, 200));
  return { token, days };
}

function fromToken(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = get(`SELECT r.id, r.name, r.email, s.expires_at, s.token_hash FROM reader_sessions s JOIN readers r ON r.id = s.reader_id WHERE s.token_hash = ?`, sha256(token));
  if (!row) return null;
  if (row.expires_at < nowIso()) { run('DELETE FROM reader_sessions WHERE token_hash = ?', row.token_hash); return null; }
  return { id: row.id, name: row.name, email: row.email, tokenHash: row.token_hash };
}

/** Cached per request. Safe to call from templates. */
function current(ctx) {
  if (ctx._reader !== undefined) return ctx._reader;
  ctx._reader = fromToken((ctx.cookies || {})[COOKIE]);
  return ctx._reader;
}

const destroy = (token) => { if (token) run('DELETE FROM reader_sessions WHERE token_hash = ?', sha256(token)); };
const destroyOthers = (readerId, keepHash) => run('DELETE FROM reader_sessions WHERE reader_id = ? AND token_hash != ?', readerId, keepHash);
const purgeExpired = () => run('DELETE FROM reader_sessions WHERE expires_at < ?', nowIso());

// SameSite=Lax so a reader following a link from another site is still recognised.
// State-changing requests are protected separately (same-origin check + custom header).
function cookieHeader(token, days) {
  const p = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(days * 86400)}`];
  if (config.secureCookies) p.push('Secure');
  return p.join('; ');
}
function clearCookieHeader() {
  const p = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (config.secureCookies) p.push('Secure');
  return p.join('; ');
}

module.exports = { COOKIE, createSession, fromToken, current, destroy, destroyOthers, purgeExpired, cookieHeader, clearCookieHeader };
