'use strict';
const http = require('http');
const config = require('./src/config');
const { db, run, logActivity } = require('./src/db');
const auth = require('./src/auth');
const media = require('./src/media');
const { seedContent } = require('./src/seed');
const { HttpError, Router, html, json, send, clientIp } = require('./src/http');
const { parseCookies } = require('./src/util');
const settings = require('./src/settings');
const readers = require('./src/readers');
const resets = require('./src/resets');

const router = new Router();
require('./src/routes/admin-api')(router);
require('./src/routes/reader')(router);
require('./src/routes/admin-pages')(router);
const publicSite = require('./src/routes/public');
publicSite.register(router);

function securityHeaders(res, isAdmin) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://i.ytimg.com",
    "media-src 'self' blob:",
    "frame-src https://www.youtube-nocookie.com",
    "connect-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (isAdmin) res.setHeader('Cache-Control', 'no-store');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ctx = {
    req, res, url, method: req.method, pathname: url.pathname.replace(/\/{2,}/g, '/'),
    query: Object.fromEntries(url.searchParams), params: {}, cookies: parseCookies(req.headers.cookie),
    ip: clientIp(req), user: null,
    proto: config.secureCookies || req.headers['x-forwarded-proto'] === 'https' && config.trustProxy ? 'https' : 'http',
  };
  const isAdminArea = ctx.pathname.startsWith('/admin') || ctx.pathname.startsWith('/api/admin');
  securityHeaders(res, isAdminArea);

  if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
  // CSRF defence in depth: state-changing requests must be same-origin.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { /* invalid */ }
      if (!ok) throw new HttpError(403, 'Cross-origin request blocked.');
    }
  }
  const handled = await router.dispatch(ctx);
  if (!handled) await publicSite.notFound(ctx);
}

function onError(ctx, err) {
  const { res } = ctx;
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error(`[${new Date().toISOString()}]`, err);
  if (res.headersSent) { try { res.destroy(); } catch { /* ignore */ } return; }
  const wantsJson = ctx.pathname.startsWith('/api/') || /application\/json/.test(ctx.req.headers.accept || '') && !/text\/html/.test(ctx.req.headers.accept || '');
  if (wantsJson) return json(ctx, { error: status >= 500 ? 'Something went wrong on the server.' : err.message, ...(err.extra || {}) }, status);
  return publicSite.errorPage(ctx, status, status >= 500 ? 'Something went wrong on our side.' : err.message).catch(() => {
    send(ctx, status, 'Error', { 'Content-Type': 'text/plain; charset=utf-8' });
  });
}

const server = http.createServer((req, res) => {
  const ctx = { req, res, pathname: (req.url || '/').split('?')[0], method: req.method };
  // Re-create ctx inside handle(); wrapper keeps a minimal ctx for error rendering.
  handle(req, res).catch((err) => {
    const full = { ...ctx, res, req, proto: 'http' };
    try { onError(full, err); } catch (e) { console.error(e); try { res.end(); } catch { /* ignore */ } }
  });
});
server.requestTimeout = 30 * 60 * 1000;   // allow large video uploads on slow links
server.headersTimeout = 60 * 1000;
server.keepAliveTimeout = 5000;

async function start() {
  const housekeeping = () => { auth.purgeExpired(); readers.purgeExpired(); resets.purge(); media.purgeTemp(); };
  housekeeping();
  setInterval(housekeeping, 3600 * 1000).unref();
  seedContent();
  const created = await auth.ensureAdmin();
  settings.invalidate();

  server.listen(config.port, config.host, () => {
    const line = '='.repeat(64);
    console.log(`\n${line}\n  Breed a Life is running\n  Site:       http://localhost:${config.port}\n  Dashboard:  http://localhost:${config.port}/admin`);
    if (created) {
      console.log(`${line}\n  FIRST-RUN ADMIN ACCOUNT\n  Username:   ${created.username}`);
      console.log(created.password ? `  Password:   ${created.password}\n  (shown once. Change it under Dashboard > Account)` : '  Password:   the ADMIN_PASSWORD from your environment');
      logActivity('system', 'admin.created', `Admin account "${created.username}" created`);
    }
    console.log(`${line}\n`);
  });
}

function shutdown() {
  console.log('\nShutting down...');
  server.close(() => { try { db.close(); } catch { /* ignore */ } process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

start().catch((e) => { console.error(e); process.exit(1); });
