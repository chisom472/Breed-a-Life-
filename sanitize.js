'use strict';
// Allow-list HTML sanitiser for post content. Anything not explicitly allowed is removed.
const { decodeEntities } = require('./util');

const VOID = new Set(['br', 'hr', 'img', 'source']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'select', 'svg', 'math']);
const ALLOWED = {
  p: ['class'], br: [], strong: [], b: [], em: [], i: [], u: [], s: [], sup: [], sub: [], mark: [],
  h2: [], h3: [], h4: [], blockquote: ['class'], cite: [], ul: [], ol: [], li: [],
  a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  figure: ['class'], figcaption: [], hr: [], code: [], pre: [],
  video: ['src', 'poster', 'controls', 'preload'],
};
const CLASSES = new Set(['callout', 'lead', 'wide']);
const BOOLEAN_ATTRS = new Set(['controls']);

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeUrl(raw, { media = false } = {}) {
  const decoded = decodeEntities(raw).replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]+/g, '');
  if (!decoded) return null;
  if (decoded.startsWith('//')) return null;
  const scheme = decoded.match(/^([a-z][a-z0-9+.\-]*):/i);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    const ok = media ? ['http', 'https'] : ['http', 'https', 'mailto', 'tel'];
    return ok.includes(s) ? decodeEntities(raw).trim() : null;
  }
  return decodeEntities(raw).trim();
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function sanitizeHtml(input) {
  const html = String(input || '').replace(/\u0000/g, '');
  const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<|[^<]+/g;
  const out = [];
  const stack = [];
  let skip = null; // { tag, depth }
  let m;

  while ((m = tokenRe.exec(html))) {
    const tok = m[0];
    if (tok.startsWith('<!--')) continue;
    const tag = m[1] ? m[1].toLowerCase() : null;

    if (!tag) {
      if (skip) continue;
      out.push(tok === '<' ? '&lt;' : tok.replace(/>/g, '&gt;'));
      continue;
    }
    const closing = tok.startsWith('</');

    if (skip) {
      if (tag === skip.tag) {
        if (closing) { skip.depth -= 1; if (skip.depth === 0) skip = null; }
        else if (!tok.endsWith('/>')) skip.depth += 1;
      }
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !tok.endsWith('/>')) skip = { tag, depth: 1 };
      continue;
    }
    if (!(tag in ALLOWED)) continue; // unwrap: keep inner text

    if (closing) {
      const idx = stack.lastIndexOf(tag);
      if (idx === -1) continue;
      while (stack.length > idx) out.push(`</${stack.pop()}>`);
      continue;
    }

    const attrs = parseAttrs(m[2] || '');
    const parts = [];
    for (const name of ALLOWED[tag]) {
      if (!(name in attrs)) continue;
      let val = attrs[name];
      if (BOOLEAN_ATTRS.has(name)) { parts.push(name); continue; }
      if (name === 'href') { val = safeUrl(val); if (val === null) continue; }
      else if (name === 'src' || name === 'poster') { val = safeUrl(val, { media: true }); if (val === null) continue; }
      else if (name === 'class') {
        val = decodeEntities(val).split(/\s+/).filter((c) => CLASSES.has(c)).join(' ');
        if (!val) continue;
      } else if (name === 'target') { if (val !== '_blank') continue; }
      else if (name === 'width' || name === 'height') { if (!/^\d{1,4}$/.test(val)) continue; }
      else if (name === 'loading') { if (!['lazy', 'eager'].includes(val)) continue; }
      else if (name === 'preload') { if (!['none', 'metadata', 'auto'].includes(val)) continue; }
      else val = decodeEntities(val);
      parts.push(`${name}="${esc(val)}"`);
    }
    if (tag === 'a') {
      if (attrs.target === '_blank') parts.push('rel="noopener noreferrer"');
      else if (parts.some((p) => p.startsWith('href="http'))) parts.push('rel="noopener"');
    }
    if (tag === 'img' && !parts.some((p) => p.startsWith('src='))) continue;
    if (tag === 'video' && !parts.some((p) => p.startsWith('src='))) continue;
    if (tag === 'img' && !parts.some((p) => p.startsWith('loading='))) parts.push('loading="lazy"');

    out.push(`<${tag}${parts.length ? ' ' + parts.filter((p, i, a) => a.indexOf(p) === i).join(' ') : ''}>`);
    if (!VOID.has(tag)) stack.push(tag);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').trim();
}

module.exports = { sanitizeHtml };
