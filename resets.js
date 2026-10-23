'use strict';
// Single-use, expiring password-reset tokens. Only a SHA-256 hash of each token is stored.
const { get, run } = require('./db');
const { randomHex, sha256, nowIso } = require('./util');
const settings = require('./settings');
const config = require('./config');

const LIFETIME_MIN = 60;

function issue(kind, accountId, email) {
  run('UPDATE password_resets SET used_at = ? WHERE kind = ? AND account_id = ? AND used_at IS NULL', nowIso(), kind, accountId);
  const token = randomHex(32);
  run('INSERT INTO password_resets (kind, account_id, email, token_hash, created_at, expires_at) VALUES (?,?,?,?,?,?)',
    kind, accountId, email, sha256(token), nowIso(), new Date(Date.now() + LIFETIME_MIN * 60000).toISOString());
  return token;
}
function find(kind, token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const row = get('SELECT * FROM password_resets WHERE token_hash = ? AND kind = ?', sha256(token), kind);
  if (!row || row.used_at || row.expires_at < nowIso()) return null;
  return row;
}
const markUsed = (id) => run('UPDATE password_resets SET used_at = ? WHERE id = ?', nowIso(), id);
const purge = () => run('DELETE FROM password_resets WHERE expires_at < ?', new Date(Date.now() - 86400000).toISOString());

/**
 * Base address for links inside emails. Never trusts the Host header of an anonymous request
 * (that would allow "password reset poisoning"). Returns null when no safe address is known.
 */
function safeBase(ctx) {
  const set = (settings.get('site_url') || config.siteUrl || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s]+$/i.test(set)) return set;
  const host = (ctx.req && ctx.req.headers.host) || '';
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  return null;
}

module.exports = { issue, find, markUsed, purge, safeBase, LIFETIME_MIN };
