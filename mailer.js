'use strict';
// Minimal SMTP client (no dependencies). Supports implicit TLS (465), STARTTLS (587) and plain (local testing).
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const config = require('./config');
const settings = require('./settings');
const secret = require('./secret');

/** Effective SMTP settings: the dashboard wins, then environment variables. */
function cfg() {
  const s = settings.getAll();
  if (s.smtp_host) {
    return { host: s.smtp_host.trim(), port: Number(s.smtp_port) || 465, secure: s.smtp_secure || 'tls', user: s.smtp_user || '', pass: secret.decrypt(s.smtp_pass_enc), from: (s.smtp_from || s.smtp_user || '').trim(), source: 'dashboard' };
  }
  return { ...config.smtp, source: config.smtp.host ? 'environment' : 'none' };
}
const configured = () => { const c = cfg(); return !!(c.host && c.from); };
const oneLine = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const address = (s) => oneLine(s).replace(/[<>"]/g, '');

class Replies {
  constructor(sock) {
    this.sock = sock; this.buf = ''; this.waiters = []; this.error = null;
    sock.on('data', (d) => { this.buf += d.toString('utf8'); this.pump(); });
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => this.fail(new Error('SMTP connection closed unexpectedly')));
  }
  fail(e) { this.error = this.error || e; while (this.waiters.length) this.waiters.shift().rej(this.error); }
  pump() {
    while (this.waiters.length) {
      const lines = this.buf.split('\r\n');
      const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
      if (end < 0) return;
      const block = lines.slice(0, end + 1);
      this.buf = lines.slice(end + 1).join('\r\n');
      this.waiters.shift().res({ code: Number(block[end].slice(0, 3)), lines: block });
    }
  }
  next() {
    return new Promise((res, rej) => { if (this.error) return rej(this.error); this.waiters.push({ res, rej }); this.pump(); });
  }
}

function connect({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const sock = secure === 'tls' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.setTimeout(20000, () => sock.destroy(new Error('SMTP connection timed out')));
    sock.once('error', reject);
    sock.once(secure === 'tls' ? 'secureConnect' : 'connect', () => { sock.off('error', reject); resolve(sock); });
  });
}

function buildMessage({ from, fromName, to, subject, text, replyTo }) {
  const body = (b64(text).match(/.{1,76}/g) || []).join('\r\n');
  const headers = [
    `From: ${fromName ? `"${oneLine(fromName).replace(/"/g, '')}" ` : ''}<${address(from)}>`,
    `To: <${address(to)}>`,
    replyTo ? `Reply-To: <${address(replyTo)}>` : null,
    `Subject: ${encodeHeader(oneLine(subject))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${(address(from).split('@')[1] || 'localhost')}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

async function send({ to, subject, text, replyTo, fromName }) {
  if (!configured()) throw new Error('Email delivery is not configured.');
  const { host, port, user, pass, from, secure } = cfg();
  let sock = await connect({ host, port, secure });
  let rx = new Replies(sock);
  const say = async (line, ok) => {
    sock.write(line + '\r\n');
    const r = await rx.next();
    if (!ok.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.lines[r.lines.length - 1].slice(4)}`);
    return r;
  };
  try {
    const hello = await rx.next();
    if (hello.code !== 220) throw new Error(`SMTP greeting failed (${hello.code})`);
    let ehlo = await say('EHLO breedalife.local', [250]);
    if (secure === 'starttls') {
      await say('STARTTLS', [220]);
      sock.removeAllListeners('data'); sock.removeAllListeners('close'); sock.removeAllListeners('error');
      sock = tls.connect({ socket: sock, servername: host });
      await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
      rx = new Replies(sock);
      ehlo = await say('EHLO breedalife.local', [250]);
    }
    if (user) {
      const caps = ehlo.lines.join(' ').toUpperCase();
      if (/AUTH[^\r\n]*\bPLAIN\b/.test(caps) && !/AUTH[^\r\n]*\bLOGIN\b/.test(caps)) {
        await say('AUTH PLAIN ' + b64(`\0${user}\0${pass}`), [235]);
      } else {
        await say('AUTH LOGIN', [334]);
        await say(b64(user), [334]);
        await say(b64(pass), [235]);
      }
    }
    await say(`MAIL FROM:<${address(from)}>`, [250]);
    await say(`RCPT TO:<${address(to)}>`, [250, 251]);
    await say('DATA', [354]);
    const msg = buildMessage({ from, fromName, to, subject, text, replyTo }).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    await say(msg + '\r\n.', [250]);
    try { sock.write('QUIT\r\n'); } catch { /* ignore */ }
  } finally {
    sock.setTimeout(0);
    setTimeout(() => sock.destroy(), 500).unref();
  }
}

module.exports = { configured, cfg, send, buildMessage };
