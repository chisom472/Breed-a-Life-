'use strict';
// Encrypts small secrets (the SMTP password) so a copied database file does not expose them.
// The key lives in data/secret.key, next to but separate from the database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const keyFile = path.join(config.dataDir, 'secret.key');
function key() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  return fs.readFileSync(keyFile);
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(blob) {
  try {
    const raw = Buffer.from(String(blob || ''), 'base64');
    if (raw.length < 29) return '';
    const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
}
module.exports = { encrypt, decrypt };
