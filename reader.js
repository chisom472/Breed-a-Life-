/* Breed a Life: forms, reader accounts, devotion notes and journal. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var signedIn = document.body.getAttribute('data-reader') === '1';

  function api(method, url, body, opts) {
    var init = {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sx-reader', 'X-TZ-Offset': String(new Date().getTimezoneOffset()) }
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (opts && opts.keepalive) init.keepalive = true;
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
        return d;
      });
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function safeNext(v) { return typeof v === 'string' && /^\/(?!\/)[^\\\s]*$/.test(v) ? v : ''; }
  function setMsg(form, text, kind) {
    var m = $('.form-msg', form);
    if (!m) return;
    m.textContent = text || '';
    m.className = 'form-msg' + (kind ? ' is-' + kind : '');
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return ''; }
  }

  /* ---------------- account + contact forms ---------------- */

  /* ---------- download & share notes (all client-side; sharing is always the reader's own action) ---------- */
  var SITE = (document.querySelector('meta[property="og:site_name"]') || {}).content || 'Breed a Life';
  function slugName(t) { return (String(t || 'notes').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'notes').slice(0, 60); }
  function stamp() { return new Date().toISOString().slice(0, 10); }
  function noteText(items, fmt) {
    var md = fmt === 'md', out = [];
    items.forEach(function (it) {
      var url = it.slug ? location.origin + '/post/' + it.slug : '';
      var head = it.title || 'Untitled devotion';
      var sub = SITE + (it.date ? ' · ' + it.date : '');
      out.push((md ? '## ' + head : head.toUpperCase() + '\n' + new Array(Math.min(head.length, 60) + 1).join('=')) + '\n' + (md ? '*' + sub + '*' : sub) + '\n\n' + (it.body || '(No notes written yet.)') + (url ? '\n\nRead the reflection: ' + url : ''));
    });
    var title = items.length === 1 ? '' : (md ? '# My devotion notes' : 'MY DEVOTION NOTES') + '\n' + SITE + ' · ' + stamp() + '\n\n';
    return title + out.join(md ? '\n\n---\n\n' : '\n\n----------\n\n') + '\n';
  }
  function saveFile(name, mime, content) {
    var a = document.createElement('a'), url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function printPdf(items) {
    var f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    var d = f.contentWindow.document;
    var body = items.map(function (it) {
      return '<section><h2>' + esc(it.title || 'Untitled devotion') + '</h2><p class="m">' + esc(SITE + (it.date ? ' · ' + it.date : '')) + '</p><div class="n">' + esc(it.body || '(No notes written yet.)') + '</div>' + (it.slug ? '<p class="u">' + esc(location.origin + '/post/' + it.slug) + '</p>' : '') + '</section>';
    }).join('');
    d.open();
    d.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(items.length === 1 ? (items[0].title || 'Devotion notes') : 'My devotion notes') + '</title><style>body{font:12pt/1.6 Georgia,serif;color:#111;margin:0}h1{font-size:20pt;margin:0 0 4pt;color:#17297a}h2{font-size:15pt;margin:0 0 2pt;color:#17297a}.m,.u{color:#666;font-size:10pt;margin:0 0 8pt}.n{white-space:pre-wrap;margin:0 0 6pt}section{padding:0 0 14pt;margin:0 0 14pt;border-bottom:1px solid #ddd;break-inside:avoid-page}@page{margin:18mm}</style></head><body>' + (items.length > 1 ? '<h1>My devotion notes</h1><p class="m">' + esc(SITE) + ' · ' + stamp() + '</p>' : '') + body + '</body></html>');
    d.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { f.remove(); }, 2000); }, 250);
  }
  /** Build a "Download / Share" menu. getItems() returns [{title, slug, body, date}]. */
  function shareMenu(getItems, opts) {
    opts = opts || {};
    var wrap = el('div', { class: 'share' });
    var btn = el('button', { type: 'button', class: opts.btnClass || 'btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', text: opts.label || 'Download or share' });
    var pop = el('div', { class: 'share-pop', role: 'menu', hidden: '' });
    var note = el('p', { class: 'share-note', role: 'status', 'aria-live': 'polite' });
    function items() { return (getItems() || []).filter(function (x) { return x && (x.body || '').trim(); }); }
    function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function say(t) { note.textContent = t; }
    function item(label, fn, hint) {
      var b = el('button', { type: 'button', role: 'menuitem', class: 'share-item' }, [el('span', { text: label }), hint ? el('small', { text: hint }) : null]);
      b.addEventListener('click', function () {
        var list = items();
        if (!list.length) { say('Write a note first, then you can download or share it.'); return; }
        fn(list);
      });
      pop.appendChild(b);
    }
    var one = function (l) { return l.length === 1; };
    var base = function (l) { return one(l) ? slugName(l[0].title) : 'breed-a-life-notes-' + stamp(); };
    pop.appendChild(el('p', { class: 'share-h', text: 'Download' }));
    item('Text file (.txt)', function (l) { saveFile(base(l) + '.txt', 'text/plain', noteText(l, 'txt')); close(); }, 'Opens anywhere');
    item('Markdown (.md)', function (l) { saveFile(base(l) + '.md', 'text/markdown', noteText(l, 'md')); close(); }, 'For note apps');
    item('PDF', function (l) { printPdf(l); close(); }, 'Choose "Save as PDF"');
    pop.appendChild(el('p', { class: 'share-h', text: 'Share' }));
    if (navigator.share) item('Share…', function (l) {
      navigator.share({ title: one(l) ? l[0].title : 'My devotion notes', text: noteText(l, 'txt') }).then(close).catch(function () {});
    }, 'Use your device share sheet');
    item('WhatsApp', function (l) { window.open('https://wa.me/?text=' + encodeURIComponent(noteText(l, 'txt')), '_blank', 'noopener'); close(); });
    item('Email', function (l) { location.href = 'mailto:?subject=' + encodeURIComponent(one(l) ? (l[0].title || 'My devotion notes') : 'My devotion notes') + '&body=' + encodeURIComponent(noteText(l, 'txt').slice(0, 1800)); close(); }, 'Opens your mail app');
    item('Copy to clipboard', function (l) {
      var t = noteText(l, 'txt');
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { say('Copied.'); }).catch(function () { say('Copy is not available here. Use Text file instead.'); });
    });
    pop.appendChild(note);
    btn.addEventListener('click', function (e) { e.stopPropagation(); say(''); var show = pop.hidden; pop.hidden = !show; btn.setAttribute('aria-expanded', show ? 'true' : 'false'); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
    wrap.appendChild(btn); wrap.appendChild(pop);
    return wrap;
  }

  $$('[data-reader-form]').forEach(function (form) {
    var kind = form.getAttribute('data-reader-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type="submit"]', form);
      var v = function (n) { return form.elements[n] ? form.elements[n].value : ''; };
      setMsg(form, '');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var req;
      if (kind === 'join') req = api('POST', '/api/reader/register', { name: v('name'), email: v('email'), password: v('password'), website: v('website') });
      else if (kind === 'signin') req = api('POST', '/api/reader/login', { email: v('email'), password: v('password'), remember: form.elements.remember ? form.elements.remember.checked : true });
      else if (kind === 'forgot') req = api('POST', '/api/reader/forgot', { email: v('email') });
      else if (kind === 'reset') {
        if (v('password') !== v('confirm')) { setMsg(form, 'The two passwords do not match.', 'error'); return; }
        req = api('POST', '/api/reader/reset', { token: form.getAttribute('data-token'), password: v('password') });
      } else if (kind === 'contact') {
        req = fetch('/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v('name'), email: v('email'), subject: v('subject'), message: v('message'), website: v('website') }) })
          .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message || 'Your message could not be sent.'); return d; }); });
      } else return;
      btn.disabled = true;
      req.then(function (d) {
        if (kind === 'join' || kind === 'signin') { location.href = safeNext(form.getAttribute('data-next')) || '/journal'; return; }
        if (kind === 'reset') { setMsg(form, 'Your password has been changed. Taking you to sign in…', 'ok'); setTimeout(function () { location.href = '/signin'; }, 1500); return; }
        if (kind === 'contact') form.reset();
        setMsg(form, d.message || 'Done.', 'ok');
        btn.disabled = false;
      }).catch(function (err) { setMsg(form, err.message, 'error'); btn.disabled = false; });
    });
  });

  /* ---------------- devotion notes (post pages) ---------------- */
  var drawer = $('#devotion');
  if (drawer) initDevotion(drawer);

  function initDevotion(drawer) {
    var postId = drawer.getAttribute('data-post-id');
    var fab = $('[data-dev-open]'), body = $('[data-dev-body]', drawer), card = $('[data-dev-card]');
    var lastFocus = null;
    function open() { lastFocus = document.activeElement; drawer.hidden = false; fab.setAttribute('aria-expanded', 'true'); var t = $('textarea', drawer) || $('a, button', body); if (t) t.focus(); }
    function close() { drawer.hidden = true; fab.setAttribute('aria-expanded', 'false'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    fab.addEventListener('click', function () { drawer.hidden ? open() : close(); });
    $('[data-dev-close]', drawer).addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !drawer.hidden) close(); });
    document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-dev-toggle]'); if (t) { e.preventDefault(); open(); } });

    var here = location.pathname;
    var nextQ = '?next=' + encodeURIComponent(here);

    function invite(container, compact) {
      container.textContent = '';
      container.appendChild(el('h2', { text: 'Keep notes. Track your progress.' }));
      container.appendChild(el('p', { text: 'Create a free account to write private notes beside each reflection and to see your devotion streak grow. Reading everything else stays open to everyone.' }));
      container.appendChild(el('div', { class: 'row' }, [
        el('a', { class: 'btn btn-gold', href: '/join' + nextQ, text: 'Create free account' }),
        el('a', { class: 'btn', href: '/signin' + nextQ, text: 'Sign in' })
      ]));
    }

    if (!signedIn) {
      if (card) invite(card, false);
      body.textContent = '';
      var wrap = el('div', { class: 'dev-card' }); invite(wrap, true); body.appendChild(wrap);
      return;
    }

    /* signed in */
    var state = { entry: null, dirty: false, timer: null, saving: false, lastPct: 0, lastSent: 0, sentAt: 0 };
    var ta = el('textarea', { id: 'dev-note', maxlength: '20000', placeholder: 'What is God showing you? Write a prayer, a question, or a verse to remember.', 'aria-describedby': 'dev-status' });
    var status = el('p', { class: 'dev-status', id: 'dev-status', role: 'status', 'aria-live': 'polite' });
    var pctText = el('b', { text: '0%' });
    var barFill = el('i');
    var bar = el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Reading progress' }, [barFill]);
    var doneBtn = el('button', { class: 'btn', type: 'button' });
    var cardBtn = null;

    body.textContent = '';
    body.appendChild(el('div', {}, [el('label', { for: 'dev-note', text: 'Notes for this devotion' }), ta, status]));
    body.appendChild(el('div', { class: 'dev-progress' }, [el('span', { text: 'Reading progress' }), pctText, bar]));
    body.appendChild(doneBtn);
    var h1 = document.querySelector('h1');
    var postTitle = h1 ? h1.textContent.trim() : document.title;
    var postSlug = (location.pathname.match(/^\/post\/([^\/?#]+)/) || [])[1] || '';
    body.appendChild(el('div', { class: 'dev-share' }, [shareMenu(function () { return [{ title: postTitle, slug: postSlug, body: ta.value, date: fmtDate(new Date().toISOString()) }]; }, { label: 'Download or share my notes', btnClass: 'btn btn-gold' })]));
    body.appendChild(el('div', { class: 'dev-links' }, [el('a', { href: '/journal', text: 'Open my journal' })]));

    function say(text, err) { status.textContent = text || ''; status.className = 'dev-status' + (err ? ' is-error' : ''); }
    function paint() {
      var e = state.entry, done = !!(e && e.completed), pct = e ? e.percent : 0;
      barFill.style.width = pct + '%'; pctText.textContent = pct + '%'; bar.setAttribute('aria-valuenow', String(pct)); bar.classList.toggle('is-done', done);
      doneBtn.textContent = done ? 'Completed. Tap to undo' : 'Mark devotion complete';
      doneBtn.className = 'btn ' + (done ? 'btn-done' : 'btn-gold');
      if (card) {
        card.textContent = '';
        card.appendChild(el('h2', { text: done ? 'Devotion complete' : 'Finished reading?' }));
        card.appendChild(el('p', { text: done ? 'Well done. Your progress has been saved to your journal.' : 'Mark this devotion complete and write down what stood out to you.' }));
        cardBtn = el('button', { class: 'btn ' + (done ? 'btn-done' : 'btn-gold'), type: 'button', text: done ? 'Completed. Tap to undo' : 'Mark complete', onclick: toggleDone });
        card.appendChild(el('div', { class: 'row' }, [cardBtn, el('button', { class: 'btn', type: 'button', 'data-dev-toggle': '', text: 'Open my notes' })]));
      }
    }
    function handle(err) {
      if (err.status === 401) { say('Your session has ended. Please sign in again to keep saving.', true); signedIn = false; }
      else say(err.message, true);
    }
    function save() {
      clearTimeout(state.timer);
      if (!state.dirty || state.saving) return;
      state.saving = true; state.dirty = false; say('Saving…');
      api('PUT', '/api/reader/entry/' + postId + '/note', { body: ta.value }).then(function (d) {
        state.entry = d.entry; state.saving = false;
        say(state.dirty ? 'Saving…' : 'Saved at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        if (state.dirty) save();
      }).catch(function (err) { state.saving = false; state.dirty = true; handle(err); });
    }
    ta.addEventListener('input', function () { state.dirty = true; say('Unsaved changes…'); clearTimeout(state.timer); state.timer = setTimeout(save, 900); });
    ta.addEventListener('blur', save);
    window.addEventListener('pagehide', function () {
      if (state.dirty) { api('PUT', '/api/reader/entry/' + postId + '/note', { body: ta.value }, { keepalive: true }).catch(function () {}); }
    });
    function toggleDone() {
      var want = !(state.entry && state.entry.completed);
      api('PUT', '/api/reader/entry/' + postId + '/complete', { completed: want }).then(function (d) { state.entry = d.entry; paint(); say(want ? 'Marked complete.' : 'Marked as not complete.'); }).catch(handle);
    }
    doneBtn.addEventListener('click', toggleDone);

    /* reading progress: highest point of the article the reader has scrolled past */
    var prose = $('.post .prose');
    function currentPct() {
      if (!prose) return 0;
      var r = prose.getBoundingClientRect();
      if (r.height <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round(((window.innerHeight - r.top) / r.height) * 100)));
    }
    var ticking = false;
    function track() {
      ticking = false;
      var p = currentPct();
      if (p > state.lastPct) state.lastPct = p;
      var e = state.entry;
      if (!signedIn || (e && e.completed)) return;
      var enough = state.lastPct >= state.lastSent + 5 || (state.lastPct === 100 && state.lastSent < 100);
      if (enough && Date.now() - state.sentAt > 2500) {
        state.sentAt = Date.now(); state.lastSent = state.lastPct;
        api('PUT', '/api/reader/entry/' + postId + '/progress', { percent: state.lastPct }).then(function (d) { state.entry = d.entry; paint(); }).catch(function () {});
      }
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(track); } }, { passive: true });

    api('GET', '/api/reader/entry/' + postId).then(function (d) {
      state.entry = d.entry;
      if (d.entry) { ta.value = d.entry.body || ''; state.lastPct = state.lastSent = d.entry.percent; }
      paint(); track();
    }).catch(function (err) { paint(); handle(err); });
  }

  /* ---------------- journal page ---------------- */
  var jroot = $('[data-journal]');
  if (jroot) initJournal(jroot);

  function initJournal(root) {
    api('GET', '/api/reader/journal').then(function (d) { render(root, d); }).catch(function (err) {
      root.textContent = '';
      if (err.status === 401) { location.href = '/signin?next=/journal'; return; }
      root.appendChild(el('p', { class: 'empty', text: err.message }));
    });
  }

  function render(root, d) {
    var s = d.stats;
    var greeting = $('[data-j-greeting]');
    if (greeting) greeting.textContent = 'Welcome, ' + d.reader.name + '. Your notes and progress are private to you.';
    root.textContent = '';

    var stats = el('div', { class: 'j-stats' });
    [[s.completed, 'Completed' + (s.available ? ' of ' + s.available : '')], [Math.max(0, s.started - s.completed), 'In progress'], [s.notes, 'Notes written'], [s.current_streak, 'Day streak'], [s.longest_streak, 'Longest streak']].forEach(function (x) {
      stats.appendChild(el('div', { class: 'j-stat' }, [el('b', { text: String(x[0]) }), el('span', { text: x[1] })]));
    });
    root.appendChild(stats);

    var active = {}; d.active_days.forEach(function (x) { active[x] = true; });
    var heat = el('div', { class: 'heat', role: 'img', 'aria-label': 'Days you wrote a note or completed a devotion in the last 12 weeks: ' + d.active_days.length });
    for (var i = 83; i >= 0; i--) {
      var t = new Date(d.today + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - i);
      var key = t.toISOString().slice(0, 10);
      heat.appendChild(el('i', { class: (active[key] ? 'on' : '') + (i === 0 ? ' today' : ''), title: key + (active[key] ? ': active' : '') }));
    }
    root.appendChild(el('section', { class: 'j-panel' }, [el('h2', { text: 'The last 12 weeks' }), heat, el('p', { class: 'heat-legend', text: 'A gold square marks a day you wrote a note or completed a devotion. ' + s.total_days + ' active ' + (s.total_days === 1 ? 'day' : 'days') + ' in total.' })]));

    /* entries */
    var filter = 'all', query = '';
    var list = el('div', { class: 'j-list' });
    var tools = el('div', { class: 'j-tools' });
    var chips = el('div', { class: 'chips' });
    [['all', 'All'], ['done', 'Completed'], ['progress', 'In progress'], ['notes', 'With notes']].forEach(function (f) {
      var b = el('button', { type: 'button', 'aria-pressed': f[0] === 'all' ? 'true' : 'false', text: f[1], onclick: function () { filter = f[0]; $$('button', chips).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); draw(); } });
      chips.appendChild(b);
    });
    var search = el('input', { type: 'search', placeholder: 'Search your notes', 'aria-label': 'Search your notes' });
    search.addEventListener('input', function () { query = search.value.trim().toLowerCase(); draw(); });
    tools.appendChild(chips); tools.appendChild(search);

    function draw() {
      list.textContent = '';
      var rows = d.entries.filter(function (e) {
        if (filter === 'done' && !e.completed) return false;
        if (filter === 'progress' && e.completed) return false;
        if (filter === 'notes' && !e.has_note) return false;
        if (query && (e.title + ' ' + e.body).toLowerCase().indexOf(query) < 0) return false;
        return true;
      });
      if (!rows.length) {
        list.appendChild(el('div', { class: 'empty' }, [
          el('h3', { text: d.entries.length ? 'Nothing matches' : 'Your journal is empty' }),
          el('p', {}, d.entries.length ? ['Try a different filter or search.'] : ['Open any reflection and choose “Devotion notes” to begin. ', el('a', { href: '/blog', text: 'Browse reflections' }), '.'])
        ]));
        return;
      }
      rows.forEach(function (e) { list.appendChild(entry(e)); });
    }

    function entry(e) {
      var title = e.slug ? el('a', { href: '/post/' + e.slug, text: e.title || 'Untitled devotion' }) : document.createTextNode(e.title || 'Untitled devotion');
      var node = el('article', { class: 'j-entry' + (e.completed ? ' is-done' : '') });
      node.appendChild(el('h3', {}, [title]));
      var meta = el('div', { class: 'j-meta' }, [
        el('span', { class: 'chip ' + (e.completed ? 'chip-done' : ''), text: e.completed ? 'Completed' : e.percent + '% read' }),
        e.removed ? el('span', { class: 'chip chip-gone', text: 'Post no longer available' }) : null,
        el('span', { text: 'Last read ' + fmtDate(e.last_read_at) })
      ]);
      node.appendChild(meta);
      if (e.has_note) {
        var note = el('div', { class: 'j-note', text: e.body });
        node.appendChild(note);
      }
      var actions = el('div', { class: 'j-actions' });
      if (e.has_note) actions.appendChild(shareMenu(function () { return [{ title: e.title, slug: e.slug, body: e.body, date: fmtDate(e.last_read_at) }]; }, { btnClass: 'link-btn', label: 'Download or share' }));
      if (e.slug) actions.appendChild(el('a', { href: '/post/' + e.slug, text: e.has_note ? 'Open devotion and edit notes' : 'Open devotion' }));
      var del = el('button', { class: 'link-btn danger', type: 'button', text: 'Delete entry' });
      del.addEventListener('click', function () {
        if (del.getAttribute('data-sure') !== '1') { del.textContent = 'Click again to delete notes and progress'; del.setAttribute('data-sure', '1'); setTimeout(function () { del.textContent = 'Delete entry'; del.removeAttribute('data-sure'); }, 4000); return; }
        api('DELETE', '/api/reader/entries/' + e.id).then(function () { d.entries = d.entries.filter(function (x) { return x.id !== e.id; }); draw(); }).catch(function (err) { del.textContent = err.message; });
      });
      actions.appendChild(del);
      node.appendChild(actions);
      return node;
    }

    var allBar = el('div', { class: 'j-allbar' }, [shareMenu(function () { return d.entries.filter(function (e) { return e.has_note; }).map(function (e) { return { title: e.title, slug: e.slug, body: e.body, date: fmtDate(e.last_read_at) }; }); }, { label: 'Download or share all notes' })]);
    root.appendChild(el('h2', { text: 'Your devotions', style: 'margin-bottom:1rem' }));
    root.appendChild(allBar); root.appendChild(tools); root.appendChild(list); draw();

    /* account */
    var acct = el('section', { class: 'j-panel j-account', style: 'margin-top:2.5rem' }, [el('h2', { text: 'Your account' })]);
    acct.appendChild(el('p', { class: 'muted', text: 'Signed in as ' + d.reader.email }));

    function formBlock(summary, fields, submitText, handler, danger) {
      var f = el('form', { novalidate: true });
      fields.forEach(function (x) {
        f.appendChild(el('div', { class: 'field', style: 'margin-bottom:.8rem' }, [el('label', { for: 'acc-' + x.n, text: x.l }), el('input', { id: 'acc-' + x.n, name: x.n, type: x.t || 'text', value: x.v || '', autocomplete: x.a || 'off', maxlength: '200' })]));
      });
      var msg = el('p', { class: 'form-msg', role: 'alert', 'aria-live': 'polite' });
      f.appendChild(el('button', { class: 'btn ' + (danger ? '' : 'btn-gold'), type: 'submit', text: submitText }));
      f.appendChild(msg);
      f.addEventListener('submit', function (ev) {
        ev.preventDefault(); msg.textContent = ''; msg.className = 'form-msg';
        var vals = {}; fields.forEach(function (x) { vals[x.n] = f.elements[x.n].value; });
        handler(vals).then(function (text) { msg.textContent = text || 'Saved.'; msg.className = 'form-msg is-ok'; }).catch(function (err) { msg.textContent = err.message; msg.className = 'form-msg is-error'; });
      });
      acct.appendChild(el('details', {}, [el('summary', { text: summary }), f]));
    }
    formBlock('Change your name', [{ n: 'name', l: 'Name', v: d.reader.name, a: 'given-name' }], 'Save name', function (v) { return api('PUT', '/api/reader/account', { name: v.name }).then(function () { return 'Name saved.'; }); });
    formBlock('Change your email address', [{ n: 'email', l: 'New email address', t: 'email', v: d.reader.email, a: 'email' }, { n: 'current_password', l: 'Current password', t: 'password', a: 'current-password' }], 'Save email', function (v) { return api('PUT', '/api/reader/account', { email: v.email, current_password: v.current_password }).then(function () { return 'Email updated. Password resets will now go to this address.'; }); });
    formBlock('Change your password', [{ n: 'current_password', l: 'Current password', t: 'password', a: 'current-password' }, { n: 'new_password', l: 'New password (8+ characters)', t: 'password', a: 'new-password' }], 'Save password', function (v) { return api('PUT', '/api/reader/account', { current_password: v.current_password, new_password: v.new_password }).then(function () { return 'Password changed. Other devices were signed out.'; }); });
    acct.appendChild(el('details', {}, [el('summary', { text: 'Export or sign out' }), el('p', { style: 'margin-top:1rem' }, [el('a', { class: 'btn', href: '/api/reader/export', download: '', text: 'Download my notes (.md)' }), ' ', el('button', { class: 'btn', type: 'button', text: 'Sign out', onclick: function () { api('POST', '/api/reader/logout').then(function () { location.href = '/'; }); } })])]));
    formBlock('Delete my account', [{ n: 'password', l: 'Confirm with your password', t: 'password', a: 'current-password' }], 'Permanently delete my account and notes', function (v) { return api('DELETE', '/api/reader/account', { password: v.password }).then(function () { location.href = '/'; return 'Deleted.'; }); }, true);
    root.appendChild(acct);
  }
})();
