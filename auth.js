'use strict';
const crypto = require('crypto');
const config = require('./config');
const { get, run, all } = require('./db');
const { randomHex, sha256, nowIso } = require('./util');

const COOKIE = 'sx_session';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt);
  return `scrypt$${SCRYPT.N}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, n, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || Number(n) !== SCRYPT.N) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltHex, 'hex'));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

// A pre-computed hash so unknown usernames cost the same time as known ones.
let dummyHash = null;
async function burn(password) {
  if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

function createSession(userId, ip, userAgent, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const days = remember ? config.sessionDays : 1;
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)',
    sha256(token), userId, nowIso(), expires, ip || '', String(userAgent || '').slice(0, 200));
  return { token, expires, days };
}

function userFromToken(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = get(
    `SELECT u.id, u.username, u.email, s.expires_at, s.token_hash FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha256(token));
  if (!row) return null;
  if (row.expires_at < nowIso()) { run('DELETE FROM sessions WHERE token_hash = ?', row.token_hash); return null; }
  return { id: row.id, username: row.username, email: row.email, tokenHash: row.token_hash };
}

function destroySession(token) { if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token)); }
function destroyOtherSessions(userId, keepHash) { run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', userId, keepHash); }
function purgeExpired() { run('DELETE FROM sessions WHERE expires_at < ?', nowIso()); }

function cookieHeader(token, days) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (days) parts.push(`Max-Age=${Math.floor(days * 86400)}`);
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}
function clearCookieHeader() {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

// Simple in-memory limiter. Key is usually the client IP.
function createLimiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60000).unref();
  return {
    take(key) {
      const now = Date.now();
      let e = hits.get(key);
      if (!e || e.reset < now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e); }
      e.count += 1;
      return { allowed: e.count <= max, retryAfter: Math.ceil((e.reset - now) / 1000) };
    },
    clear(key) { hits.delete(key); },
  };
}

function validatePassword(pw, min = 10) {
  if (typeof pw !== 'string' || pw.length < min) return `Password must be at least ${min} characters.`;
  if (pw.length > 200) return 'Password is too long.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use at least one letter and one number.';
  return null;
}

async function ensureAdmin() {
  const count = get('SELECT COUNT(*) AS c FROM users').c;
  if (count > 0) return null;
  const generated = !config.adminPassword;
  const password = config.adminPassword || crypto.randomBytes(9).toString('base64url');
  const hash = await hashPassword(password);
  run('INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)', config.adminUser, config.adminEmail, hash, nowIso());
  return { username: config.adminUser, password: generated ? password : null };
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, burn, createSession, userFromToken, destroySession,
  destroyOtherSessions, purgeExpired, cookieHeader, clearCookieHeader, createLimiter, validatePassword, ensureAdmin, randomHex, all,
};
