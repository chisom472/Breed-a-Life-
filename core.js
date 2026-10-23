/* Breed a Life dashboard: shared helpers. Everything hangs off window.SX. */
(function () {
  'use strict';
  var SX = window.SX = { views: {}, user: null };

  /* ---------- DOM helpers (text is always inserted as text, never as HTML) ---------- */
  var PROPS = { value: 1, checked: 1, disabled: 1, selected: 1, multiple: 1, hidden: 1, readOnly: 1, required: 1, indeterminate: 1 };
  SX.el = function (tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (PROPS[k]) n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (function add(list) {
      (list || []).forEach(function (c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) add(c);
        else n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
      });
    })(Array.isArray(kids) ? kids : kids == null ? [] : [kids]);
    return n;
  };
  var el = SX.el;
  SX.$ = function (s, r) { return (r || document).querySelector(s); };
  SX.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  SX.clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); return n; };

  var ICONS = {
    home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.8.7 3 2.3 3 4.7"/>',
    book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 17v3h16v-3"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', out: '<path d="M9 4H5v16h4M15 8l5 4-5 4M20 12H9"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3"/>', play: '<path d="M8 5.5v13l11-6.5z"/>',
    send: '<path d="M4 12 20 4l-4 16-4-6z"/><path d="m12 14 8-10"/>', refresh: '<path d="M20 11a8 8 0 1 0-2 6M20 5v6h-6"/>', warn: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    quote: '<path d="M7 17c-2 0-3-1.3-3-3.5C4 10 6 8 9 7M16 17c-2 0-3-1.3-3-3.5 0-3.5 2-5.5 5-6.5"/>'
  };
  SX.icon = function (name) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';   // static, trusted strings only
    return s;
  };
  SX.btn = function (text, opts) {
    opts = opts || {};
    var b = el('button', { type: opts.type || 'button', class: 'btn ' + (opts.kind || '') + (opts.sm ? ' sm' : ''), onclick: opts.onClick, title: opts.title, disabled: opts.disabled }, [opts.icon ? SX.icon(opts.icon) : null, text ? el('span', { text: text }) : null]);
    return b;
  };

  /* ---------- formatting ---------- */
  var fmt = SX.fmt = {
    date: function (iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); },
    dt: function (iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); },
    num: function (n) { return Number(n || 0).toLocaleString(); },
    bytes: function (n) { n = Number(n || 0); if (!n) return '0 B'; var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024))); return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i]; },
    ago: function (iso) {
      var s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
      if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
      if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago'; return fmt.date(iso);
    },
    localInput: function (iso) { if (!iso) return ''; var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  };
  SX.debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };

  var ACTIONS = {
    'login': 'Signed in', 'login.failed': 'Failed sign-in attempt', 'post.create': 'Created a draft', 'post.publish': 'Published a post', 'post.unpublish': 'Moved a post to drafts', 'post.update': 'Edited a post', 'post.delete': 'Deleted a post',
    'media.upload': 'Uploaded a file', 'media.embed': 'Added a YouTube video', 'media.update': 'Edited a file', 'media.delete': 'Deleted a file', 'media.poster': 'Set a video thumbnail',
    'settings.update': 'Changed settings', 'subscriber.add': 'Added a subscriber', 'subscriber.delete': 'Removed a subscriber', 'db.backup': 'Downloaded a backup', 'db.export': 'Exported the data', 'db.edit': 'Edited a database row', 'db.delete': 'Deleted a database row',
    'account.update': 'Updated account', 'account.password': 'Changed password', 'password.reset': 'Reset password by email', 'reset.requested': 'Password reset requested', 'reset.unavailable': 'Password reset could not be sent', 'email.settings': 'Changed email settings', 'email.test': 'Sent a test email', 'email.failed': 'An email failed to send',
    'message.delete': 'Deleted a message', 'reader.delete': 'Removed a reader', 'reader.reset.email': 'Sent a reader a reset link', 'reader.reset.temp': 'Gave a reader a temporary password', 'donation.add': 'Added a giving option', 'donation.update': 'Edited a giving option', 'donation.delete': 'Removed a giving option', seed: 'Imported starter content', 'admin.created': 'Owner account created'
  };
  SX.actionLabel = function (a) { return ACTIONS[a] || a.replace(/[._]/g, ' '); };

  /* ---------- network ---------- */
  SX.api = function (method, url, body) {
    var init = { method: method, credentials: 'same-origin', headers: { 'X-Requested-With': 'sx-admin' } };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch('/api/admin' + url, init).then(function (r) {
      var json = /json/.test(r.headers.get('content-type') || '');
      return (json ? r.json().catch(function () { return {}; }) : Promise.resolve(null)).then(function (d) {
        if (r.status === 401 && url !== '/login') { location.href = '/admin/login'; throw new Error('Signed out'); }
        if (!r.ok) { var e = new Error((d && d.error) || 'Request failed (' + r.status + ')'); e.status = r.status; e.data = d; throw e; }
        return d;
      });
    });
  };
  SX.upload = function (url, form, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', '/api/admin' + url);
      x.setRequestHeader('X-Requested-With', 'sx-admin');
      x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = function () {
        var d = {}; try { d = JSON.parse(x.responseText); } catch (e) { /* ignore */ }
        if (x.status === 401) { location.href = '/admin/login'; return; }
        if (x.status >= 200 && x.status < 300) return resolve(d);
        var err = new Error(d.error || (d.errors && d.errors[0] && d.errors[0].message) || 'Upload failed (' + x.status + ')'); err.data = d; reject(err);
      };
      x.onerror = function () { reject(new Error('The connection dropped during the upload. Please try again.')); };
      x.send(form);
    });
  };

  /* ---------- feedback ---------- */
  SX.toast = function (msg, kind) {
    var t = el('div', { class: 'toast ' + (kind || '') }, [kind === 'err' ? SX.icon('warn') : kind === 'ok' ? SX.icon('check') : null, el('span', { text: msg })]);
    SX.$('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'err' ? 7000 : 3800);
  };
  SX.modal = function (o) {
    var prev = document.activeElement;
    var close = function (result) { document.removeEventListener('keydown', onKey); ov.remove(); if (prev && prev.focus) prev.focus(); if (o.onClose) o.onClose(result); };
    var onKey = function (e) { if (e.key === 'Escape') close(null); };
    var foot = el('div', { class: 'modal-f' });
    (o.actions || []).forEach(function (a) { foot.appendChild(SX.btn(a.text, { kind: a.kind, icon: a.icon, onClick: function (e) { a.onClick(e, api); } })); });
    var box = el('div', { class: 'modal ' + (o.size || ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, [
      el('div', { class: 'modal-h' }, [el('h2', { text: o.title }), el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: function () { close(null); } }, SX.icon('x'))]),
      el('div', { class: 'modal-b' }, o.body), (o.actions && o.actions.length) ? foot : null
    ]);
    var ov = el('div', { class: 'overlay', onmousedown: function (e) { if (e.target === ov) close(null); } }, box);
    document.body.appendChild(ov); document.addEventListener('keydown', onKey);
    var api = { close: close, el: box, setBusy: function (b) { SX.$$('.modal-f button', box).forEach(function (x) { x.disabled = b; }); } };
    var first = SX.$('input:not([type=hidden]), textarea, select', box); if (first) first.focus();
    return api;
  };
  SX.confirm = function (o) {
    return new Promise(function (resolve) {
      var done = false;
      var m = SX.modal({
        title: o.title || 'Are you sure?', size: '', body: el('div', {}, [el('p', { text: o.message || '', style: 'margin:0' }), o.extra || null]),
        actions: [{ text: 'Cancel', onClick: function () { m.close(false); } }, { text: o.confirmText || 'Confirm', kind: o.danger ? 'danger solid' : 'primary', onClick: function () { m.close(true); } }],
        onClose: function (r) { if (!done) { done = true; resolve(!!r); } }
      });
    });
  };

  /* ---------- reusable UI pieces ---------- */
  SX.loading = function (text) { return el('div', { class: 'loading' }, [el('span', { class: 'spin' }), text || 'Loading…']); };
  SX.empty = function (title, text, action) { return el('div', { class: 'empty' }, [el('h3', { text: title }), text ? el('p', { text: text, style: 'margin:0 0 12px' }) : null, action || null]); };
  SX.field = function (label, input, hint, id) {
    if (id && input.setAttribute) input.setAttribute('id', id);
    return el('div', { class: 'field' }, [label ? el('label', { for: id, text: label }) : null, input, hint ? el('p', { class: 'hint', text: hint }) : null]);
  };
  SX.switchRow = function (title, desc, checked, onChange) {
    var inp = el('input', { type: 'checkbox', checked: !!checked, 'aria-label': title, onchange: function () { onChange && onChange(inp.checked); } });
    return { node: el('div', { class: 'switch-row' }, [el('div', {}, [el('div', { text: title, style: 'font-weight:600' }), desc ? el('div', { class: 'hint', text: desc }) : null]), el('label', { class: 'switch' }, [inp, el('i')])]), input: inp };
  };
  SX.pager = function (page, pages, total, onGo, noun) {
    return el('div', { class: 'pager' }, [el('span', { text: fmt.num(total) + ' ' + (noun || 'items') + (pages > 1 ? ' · page ' + page + ' of ' + pages : '') }),
      pages > 1 ? el('div', { class: 'btns' }, [SX.btn('Previous', { sm: true, disabled: page <= 1, onClick: function () { onGo(page - 1); } }), SX.btn('Next', { sm: true, disabled: page >= pages, onClick: function () { onGo(page + 1); } })]) : null]);
  };
  SX.searchBox = function (placeholder, onInput, value) {
    var i = el('input', { type: 'search', placeholder: placeholder, 'aria-label': placeholder, value: value || '', style: 'min-width:240px' });
    i.addEventListener('input', SX.debounce(function () { onInput(i.value.trim()); }, 300));
    return el('div', { class: 'search' }, [SX.icon('search'), i]);
  };
  SX.tabs = function (items, current, onPick, asLinks) {
    return el('div', { class: 'tabs', role: 'tablist' }, items.map(function (t) {
      return el(asLinks ? 'a' : 'button', { type: asLinks ? null : 'button', href: asLinks ? t.href : null, role: 'tab', class: t.key === current ? 'on' : '', 'aria-selected': t.key === current ? 'true' : 'false', text: t.label, onclick: asLinks ? null : function () { onPick(t.key); } });
    }));
  };
  SX.copy = function (text) {
    var done = function () { SX.toast('Copied to clipboard', 'ok'); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy this:', text); }); else window.prompt('Copy this:', text);
  };
  SX.dirtyGuard = null;   // set by editors; the router asks before leaving
})();
