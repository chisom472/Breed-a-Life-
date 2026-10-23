'use strict';
// Streaming multipart/form-data parser. Files are streamed to disk, never buffered in memory.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

class UploadError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseHeaders(raw) {
  const headers = {};
  for (const line of raw.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}
function dispositionParam(disposition, name) {
  const re = new RegExp(`${name}\\*?=(?:"((?:[^"\\\\]|\\\\.)*)"|([^;]*))`, 'i');
  const m = disposition.match(re);
  if (!m) return null;
  return (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]).trim();
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    if (stream.write(chunk)) return resolve();
    const onDrain = () => { stream.off('error', onErr); resolve(); };
    const onErr = (e) => { stream.off('drain', onDrain); reject(e); };
    stream.once('drain', onDrain);
    stream.once('error', onErr);
  });
}
function endStream(stream) {
  return new Promise((resolve, reject) => { stream.once('error', reject); stream.end(resolve); });
}

/**
 * @param req            incoming request
 * @param opts.maxFileBytes   hard cap per file
 * @param opts.maxFiles       max number of files
 * @returns {{fields: Object, files: Array<{field, filename, path, size, mimeHint}>, cleanup: Function}}
 */
async function parseMultipart(req, opts = {}) {
  const maxFileBytes = opts.maxFileBytes || config.maxVideoBytes;
  const maxFiles = opts.maxFiles || 20;
  const maxFieldBytes = 256 * 1024;

  const ct = req.headers['content-type'] || '';
  const bm = ct.match(/^multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!bm) throw new UploadError(400, 'Expected multipart/form-data.');
  const boundary = bm[1] || bm[2];
  if (boundary.length > 200) throw new UploadError(400, 'Invalid multipart boundary.');

  const declared = Number(req.headers['content-length']);
  if (declared && declared > maxFileBytes * maxFiles + 1048576) throw new UploadError(413, 'Upload is too large.');

  fs.mkdirSync(config.tmpDir, { recursive: true });

  const first = Buffer.from('--' + boundary);
  const delim = Buffer.from('\r\n--' + boundary);
  const fields = {};
  const files = [];
  let state = 0; // 0 preamble, 4 after-boundary, 1 headers, 2 body, 3 done
  let buf = Buffer.alloc(0);
  let sink = null; // current part

  const cleanup = () => { for (const f of files) fs.rm(f.path, { force: true }, () => {}); };

  const beginPart = (headersRaw) => {
    const headers = parseHeaders(headersRaw);
    const disp = headers['content-disposition'] || '';
    const name = dispositionParam(disp, 'name') || '';
    const filename = dispositionParam(disp, 'filename');
    if (filename !== null && filename !== undefined) {
      if (files.length >= maxFiles) throw new UploadError(400, `Too many files (max ${maxFiles}).`);
      if (!filename) { sink = { skip: true }; return; } // empty file input
      const tmp = path.join(config.tmpDir, crypto.randomBytes(12).toString('hex') + '.part');
      const entry = { field: name, filename: path.basename(filename.replace(/\\/g, '/')), path: tmp, size: 0, mimeHint: headers['content-type'] || '' };
      files.push(entry);
      sink = { file: entry, stream: fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 }) };
      sink.stream.on('error', () => {});
    } else {
      sink = { field: name, chunks: [], size: 0 };
    }
  };

  const writeBody = async (data) => {
    if (!data.length || !sink || sink.skip) return;
    if (sink.file) {
      sink.file.size += data.length;
      if (sink.file.size > maxFileBytes) throw new UploadError(413, `"${sink.file.filename}" exceeds the ${Math.round(maxFileBytes / 1048576)} MB limit.`);
      await writeChunk(sink.stream, data);
    } else {
      sink.size += data.length;
      if (sink.size > maxFieldBytes) throw new UploadError(413, 'A form field is too large.');
      sink.chunks.push(Buffer.from(data));
    }
  };

  const endPart = async () => {
    if (!sink) return;
    if (sink.file) await endStream(sink.stream);
    else if (!sink.skip) fields[sink.field] = Buffer.concat(sink.chunks).toString('utf8');
    sink = null;
  };

  try {
    for await (const chunk of req) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (state === 3) { buf = Buffer.alloc(0); break; }
        if (state === 0) {
          const i = buf.indexOf(first);
          if (i < 0) { buf = buf.subarray(Math.max(0, buf.length - first.length)); break; }
          buf = buf.subarray(i + first.length); state = 4; continue;
        }
        if (state === 4) {
          if (buf.length < 2) break;
          if (buf[0] === 45 && buf[1] === 45) { state = 3; continue; }
          if (buf[0] === 13 && buf[1] === 10) { buf = buf.subarray(2); state = 1; continue; }
          throw new UploadError(400, 'Malformed multipart body.');
        }
        if (state === 1) {
          const i = buf.indexOf('\r\n\r\n');
          if (i < 0) { if (buf.length > 16384) throw new UploadError(400, 'Malformed multipart headers.'); break; }
          beginPart(buf.subarray(0, i).toString('utf8'));
          buf = buf.subarray(i + 4); state = 2; continue;
        }
        if (state === 2) {
          const i = buf.indexOf(delim);
          if (i >= 0) { await writeBody(buf.subarray(0, i)); await endPart(); buf = buf.subarray(i + delim.length); state = 4; continue; }
          const keep = delim.length - 1;
          if (buf.length > keep) { await writeBody(buf.subarray(0, buf.length - keep)); buf = buf.subarray(buf.length - keep); }
          break;
        }
      }
    }
    if (state !== 3) throw new UploadError(400, 'Upload was interrupted or incomplete.');
  } catch (err) {
    if (sink && sink.stream) sink.stream.destroy();
    cleanup();
    throw err;
  }
  return { fields, files, cleanup };
}

module.exports = { parseMultipart, UploadError };
