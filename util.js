'use strict';
const crypto = require('crypto');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')' };

function decodeEntities(str) {
  return String(str)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] !== undefined ? NAMED[n.toLowerCase()] : m));
}
function safeChar(code) {
  try { return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; } catch { return ''; }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slugify(text, max = 80) {
  const s = String(text || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/, '');
}

function stripHtml(html) {
  return decodeEntities(String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|figure)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ').trim();
}

function truncate(text, max = 160) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-\u2013\u2014]+$/, '') + '\u2026';
}

function wordCount(html) {
  const t = stripHtml(html);
  return t ? t.split(/\s+/).length : 0;
}
function readingTime(html) {
  return Math.max(1, Math.round(wordCount(html) / 220));
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : DATE_FMT.format(d);
}

function nowIso() { return new Date().toISOString(); }
function randomHex(bytes = 12) { return crypto.randomBytes(bytes).toString('hex'); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i];
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function toInt(v, d = 0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }

function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw).replace(/\s+/g, ' ').trim().slice(0, 40);
    const k = t.toLowerCase();
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
    if (out.length >= 12) break;
  }
  return out;
}

module.exports = {
  decodeEntities, escapeHtml, slugify, stripHtml, truncate, wordCount, readingTime,
  formatDate, nowIso, randomHex, sha256, formatBytes, parseCookies, csvCell, clamp, toInt, normalizeTags,
};
