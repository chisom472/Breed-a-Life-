'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv(path.join(root, '.env'));

const env = process.env;
const num = (key, fallback) => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const siteUrl = (env.SITE_URL || '').replace(/\/+$/, '');
const smtpPort = num('SMTP_PORT', 465);
const uploadDir = path.resolve(root, env.UPLOAD_DIR || 'uploads');

module.exports = {
  root,
  port: num('PORT', 3000),
  host: env.HOST || '0.0.0.0',
  siteUrl,
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  uploadDir,
  tmpDir: path.join(uploadDir, '.tmp'),
  publicDir: path.join(root, 'public'),
  adminDir: path.join(root, 'admin'),
  seedDir: path.join(root, 'seed'),
  adminUser: env.ADMIN_USER || 'admin',
  adminEmail: env.ADMIN_EMAIL || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : siteUrl.startsWith('https://'),
  trustProxy: env.TRUST_PROXY === 'true',
  maxImageBytes: num('MAX_IMAGE_MB', 20) * 1048576,
  maxVideoBytes: num('MAX_VIDEO_MB', 1024) * 1048576,
  sessionDays: num('SESSION_DAYS', 14),
  smtp: {
    host: env.SMTP_HOST || '',
    port: smtpPort,
    secure: env.SMTP_SECURE || (smtpPort === 465 ? 'tls' : 'starttls'), // tls | starttls | none (none is for local testing only)
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || env.SMTP_USER || '',
  },
};
