'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { randomHex } = require('./util');

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.tmpDir, { recursive: true });

const SVG_DANGER = /<script|<foreignObject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:|<!ENTITY|<link|<meta|xlink:href\s*=\s*["']\s*(?!#)/i;

function readHead(file, bytes = 4096) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(bytes); const n = fs.readSync(fd, b, 0, bytes, 0); return b.subarray(0, n); }
  finally { fs.closeSync(fd); }
}

/** Identify a file by its real contents. Never trusts the extension or client MIME type. */
function detect(file) {
  const h = readHead(file);
  if (h.length < 12) return null;
  const ascii = (a, b) => h.toString('latin1', a, b);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: '.jpg' };
  if (h[0] === 0x89 && ascii(1, 4) === 'PNG') return { kind: 'image', mime: 'image/png', ext: '.png' };
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { kind: 'image', mime: 'image/gif', ext: '.gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: '.webp' };
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', mime: 'image/avif', ext: '.avif' };
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return null; // HEIC photos are not browser-safe
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', ext: '.mov' };
    return { kind: 'video', mime: 'video/mp4', ext: '.mp4' };
  }
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return { kind: 'video', mime: 'video/webm', ext: '.webm' };
  if (ascii(0, 4) === 'OggS') return { kind: 'video', mime: 'video/ogg', ext: '.ogv' };
  const text = h.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)?(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)) {
    const full = fs.readFileSync(file, 'utf8');
    if (full.length > 5 * 1048576 || SVG_DANGER.test(full)) return { rejected: 'This SVG contains scripts or external references and was rejected.' };
    return { kind: 'image', mime: 'image/svg+xml', ext: '.svg' };
  }
  return null;
}

/**
 * Validate a temp upload and move it into the uploads folder.
 * @param {string} tmpPath
 * @param {{allow?: 'image'|'video'|'any'}} opts
 */
function store(tmpPath, opts = {}) {
  const allow = opts.allow || 'any';
  const info = detect(tmpPath);
  if (!info) throw new Error('Unsupported file type. Use JPG, PNG, GIF, WebP, AVIF, SVG, MP4, WebM, MOV or OGV.');
  if (info.rejected) throw new Error(info.rejected);
  if (allow !== 'any' && info.kind !== allow) throw new Error(`Expected ${allow === 'image' ? 'an image' : 'a video'}, got a ${info.kind}.`);
  const size = fs.statSync(tmpPath).size;
  const limit = info.kind === 'image' ? config.maxImageBytes : config.maxVideoBytes;
  if (size > limit) throw new Error(`${info.kind === 'image' ? 'Images' : 'Videos'} are limited to ${Math.round(limit / 1048576)} MB.`);
  const filename = randomHex(12) + info.ext;
  fs.renameSync(tmpPath, path.join(config.uploadDir, filename));
  return { filename, kind: info.kind, mime: info.mime, size };
}

function pathFor(filename) {
  const base = path.basename(String(filename || ''));
  if (!base || base !== filename || base.startsWith('.')) return null;
  return path.join(config.uploadDir, base);
}
function remove(filename) {
  const p = pathFor(filename);
  if (p) { try { fs.rmSync(p, { force: true }); } catch { /* ignore */ } }
}
function sizeOf(filename) {
  const p = pathFor(filename);
  try { return p ? fs.statSync(p).size : 0; } catch { return 0; }
}

function youtubeId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/); if (m) id = m[1]; }
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

function purgeTemp() {
  try {
    for (const f of fs.readdirSync(config.tmpDir)) {
      const p = path.join(config.tmpDir, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.rmSync(p, { force: true });
    }
  } catch { /* ignore */ }
}

module.exports = { detect, store, remove, pathFor, sizeOf, youtubeId, purgeTemp };
