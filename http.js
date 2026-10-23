'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript)|image\/svg)/;

/* ---------- routing ---------- */
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handlers) {
    const keys = [];
    const src = pattern.replace(/\/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; });
    this.routes.push({ method, regex: new RegExp('^' + src + '/?$'), keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, h); }
  post(p, ...h) { this.add('POST', p, h); }
  put(p, ...h) { this.add('PUT', p, h); }
  delete(p, ...h) { this.add('DELETE', p, h); }
  async dispatch(ctx) {
    let pathMatched = false;
    const method = ctx.method === 'HEAD' ? 'GET' : ctx.method;
    for (const r of this.routes) {
      const m = r.regex.exec(ctx.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      ctx.params = {};
      r.keys.forEach((k, i) => { try { ctx.params[k] = decodeURIComponent(m[i + 1]); } catch { ctx.params[k] = m[i + 1]; } });
      for (const h of r.handlers) { await h(ctx); if (ctx.res.writableEnded || ctx.res.headersSent) return true; }
      return true;
    }
    if (pathMatched) throw new HttpError(405, 'Method not allowed.');
    return false;
  }
}

/* ---------- responses ---------- */
function acceptsGzip(req) { return /\bgzip\b/.test(req.headers['accept-encoding'] || ''); }

function send(ctx, status, body, headers = {}) {
  const { req, res } = ctx;
  let data = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  const type = headers['Content-Type'] || '';
  const h = { ...headers };
  if (data.length > 1024 && COMPRESSIBLE.test(type) && acceptsGzip(req)) {
    data = zlib.gzipSync(data, { level: 6 });
    h['Content-Encoding'] = 'gzip';
    h.Vary = 'Accept-Encoding';
  }
  h['Content-Length'] = data.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : data);
}

const NO_STORE = 'no-store';
function json(ctx, data, status = 200) {
  send(ctx, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': NO_STORE });
}
function html(ctx, markup, status = 200, extra = {}) {
  send(ctx, status, markup, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': extra['Cache-Control'] || 'no-cache', ...extra });
}
function text(ctx, body, type = 'text/plain; charset=utf-8', status = 200, extra = {}) {
  send(ctx, status, body, { 'Content-Type': type, 'Cache-Control': 'public, max-age=300', ...extra });
}
function redirect(ctx, location, status = 302) {
  ctx.res.writeHead(status, { Location: location, 'Content-Length': 0 });
  ctx.res.end();
}

/* ---------- request body ---------- */
async function readBody(req, limit = 2 * 1048576) {
  const declared = Number(req.headers['content-length']);
  if (declared && declared > limit) throw new HttpError(413, 'Request body is too large.');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request body is too large.');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function readJson(ctx, limit) {
  if (ctx.body !== undefined) return ctx.body;
  const type = ctx.req.headers['content-type'] || '';
  if (!/application\/json/i.test(type)) throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
  const raw = await readBody(ctx.req, limit);
  try { ctx.body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
  if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw new HttpError(400, 'Expected a JSON object.');
  return ctx.body;
}

/* ---------- static files with Range support ---------- */
async function sendFile(ctx, filePath, opts = {}) {
  const { req, res } = ctx;
  let st;
  try { st = await fs.promises.stat(filePath); } catch { throw new HttpError(404, 'Not found.'); }
  if (!st.isFile()) throw new HttpError(404, 'Not found.');

  const ext = path.extname(filePath).toLowerCase();
  const type = opts.type || MIME[ext] || 'application/octet-stream';
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Last-Modified': st.mtime.toUTCString(),
    ETag: etag,
    'Cache-Control': opts.cache || 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    ...(opts.headers || {}),
  };
  if (opts.download) headers['Content-Disposition'] = `attachment; filename="${opts.download}"`;

  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }

  let start = 0;
  let end = st.size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range) && st.size > 0) {
    const [a, b] = range.slice(6).split('-');
    if (a === '' && b !== '') { start = Math.max(0, st.size - parseInt(b, 10)); }
    else { start = parseInt(a, 10); if (b !== '') end = Math.min(end, parseInt(b, 10)); }
    if (!(start <= end) || start >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }

  const gz = status === 200 && COMPRESSIBLE.test(type) && st.size > 1024 && st.size < 2 * 1048576 && acceptsGzip(req);
  if (gz) { headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; }
  else headers['Content-Length'] = end - start + 1;

  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filePath, { start, end });
  await new Promise((resolve) => {
    pipeline(...(gz ? [stream, zlib.createGzip({ level: 6 }), res] : [stream, res]), () => resolve());
  });
}

/** Serve a file from inside `root`, refusing any path that escapes it. */
async function sendFromDir(ctx, root, relative, opts) {
  let rel;
  try { rel = decodeURIComponent(relative); } catch { throw new HttpError(400, 'Bad path.'); }
  if (rel.includes('\0')) throw new HttpError(400, 'Bad path.');
  const full = path.resolve(root, '.' + path.sep + rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new HttpError(404, 'Not found.');
  if (path.basename(full).startsWith('.')) throw new HttpError(404, 'Not found.');
  return sendFile(ctx, full, opts);
}

function clientIp(req) {
  if (config.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

module.exports = { HttpError, Router, send, json, html, text, redirect, readBody, readJson, sendFile, sendFromDir, clientIp, MIME };
