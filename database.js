/* Database: overview and backup, table browser, read-only SQL console, activity log. */
(function () {
  'use strict';
  var SX = window.SX, el = SX.el, fmt = SX.fmt;
  function fail(e) { SX.toast(e.message, 'err'); }
  var TABS = [{ key: 'overview', label: 'Overview' }, { key: 'tables', label: 'Tables' }, { key: 'console', label: 'SQL console' }, { key: 'activity', label: 'Activity log' }];
  function show(v) { if (v === null || v === undefined) return el('span', { class: 'lock', text: 'null' }); var t = String(v); return document.createTextNode(t.length > 160 ? t.slice(0, 160) + '…' : t); }

  function overview(box) {
    box.appendChild(SX.loading());
    SX.api('GET', '/db/overview').then(function (d) {
      SX.clear(box);
      box.appendChild(el('div', { class: 'stats' }, [['Database file', fmt.bytes(d.db_bytes + d.wal_bytes), d.db_file], ['Uploaded files', fmt.bytes(d.uploads_bytes), d.uploads_count + ' files'], ['Tables', String(d.tables.length), 'SQLite ' + d.sqlite_version], ['Server', 'Node ' + d.node_version.replace('v', ''), 'Up ' + Math.round(d.uptime_seconds / 60) + ' min']].map(function (x) {
        return el('div', { class: 'stat' }, [el('div', { class: 'k', text: x[0] }), el('div', { class: 'v', text: x[1] }), el('div', { class: 's', text: x[2] })]); })));
      box.appendChild(el('section', { class: 'card', style: 'margin-bottom:18px' }, [el('div', { class: 'card-h' }, el('h2', { text: 'Back up your website' })), el('div', { class: 'card-b' }, [
        el('p', { style: 'margin-top:0', text: 'A backup is a complete copy of your posts, settings and accounts. Uploaded pictures and videos live in the uploads folder and should be copied too. Do this regularly and keep copies off the server.' }),
        el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [el('a', { class: 'btn primary', href: '/api/admin/db/backup' }, [SX.icon('download'), el('span', { text: 'Download backup (.db)' })]), el('a', { class: 'btn', href: '/api/admin/db/export' }, [SX.icon('download'), el('span', { text: 'Export as JSON' })])]),
        el('p', { class: 'hint', text: 'Passwords, sign-in sessions and readers\' private notes are never included in the JSON export.' })])]));
      box.appendChild(el('section', { class: 'card' }, [el('div', { class: 'card-h' }, el('h2', { text: 'Tables' })), el('div', { class: 'table-wrap' }, el('table', { class: 't' }, [el('thead', {}, el('tr', {}, [el('th', { text: 'Table' }), el('th', { text: 'Rows' }), el('th', { text: 'Columns' })])),
        el('tbody', {}, d.tables.map(function (t) { return el('tr', {}, [el('td', { class: 'title' }, el('a', { href: '#/database/tables/' + t.name, text: t.name })), el('td', { text: fmt.num(t.rows) }), el('td', { class: 'hint', text: t.columns.map(function (c) { return c.name; }).join(', ') })]); }))]))]));
    }).catch(function (e) { SX.clear(box); box.appendChild(SX.empty('Could not load', e.message)); });
  }

  function browser(box, name) {
    var st = { page: 1, q: '', sort: '', dir: 'desc' };
    var body = el('div'), pager = el('div'), head = el('div');
    box.appendChild(head); box.appendChild(el('section', { class: 'card' }, body)); box.appendChild(pager);
    function rowModal(d, row) {
      var inputs = {}, kids = d.columns.map(function (c) {
        var readonly = c.pk && /INT/i.test(c.type) || d.secret.indexOf(c.name) >= 0;
        var v = row[c.name], inp = (typeof v === 'string' && v.length > 80) ? el('textarea', { rows: 6 }) : el('input', { type: 'text' });
        inp.value = v === null || v === undefined ? '' : v; inp.disabled = readonly; inputs[c.name] = inp;
        return SX.field(c.name + ' (' + (c.type || 'any').toLowerCase() + ')' + (readonly ? ' · locked' : ''), inp, null, 'r-' + c.name);
      });
      var m = SX.modal({ title: 'Edit row ' + row._rowid_ + ' in ' + name, size: 'wide', body: el('div', {}, kids), actions: [{ text: 'Cancel', onClick: function () { m.close(); } }, { text: 'Save row', kind: 'primary', onClick: function () {
        var values = {}; d.columns.forEach(function (c) { if (!inputs[c.name].disabled) values[c.name] = inputs[c.name].value; });
        SX.api('PUT', '/db/tables/' + name + '/rows/' + row._rowid_, { values: values }).then(function () { SX.toast('Row saved', 'ok'); m.close(); load(); }).catch(fail); } }] });
    }
    function load() {
      var qs = '?page=' + st.page + (st.q ? '&q=' + encodeURIComponent(st.q) : '') + (st.sort ? '&sort=' + encodeURIComponent(st.sort) + '&dir=' + st.dir : '');
      SX.api('GET', '/db/tables/' + encodeURIComponent(name) + qs).then(function (d) {
        SX.clear(body); SX.clear(pager);
        if (!head.firstChild) {
          head.appendChild(el('div', { class: 'toolbar' }, [el('a', { class: 'btn sm', href: '#/database/tables' }, [SX.icon('up'), el('span', { text: 'All tables' })]), el('b', { text: name }), el('span', { style: 'flex:1' }), SX.searchBox('Search ' + name, function (q) { st.q = q; st.page = 1; load(); })]));
          if (d.secret.length) head.appendChild(el('div', { class: 'notice info' }, [SX.icon('lock'), el('div', { text: 'Private columns (' + d.secret.join(', ') + ') are hidden for security.' })]));
        }
        if (!d.rows.length) { body.appendChild(SX.empty('No rows')); return; }
        var cols = d.columns.map(function (c) { return c.name; });
        var th = cols.map(function (c) { var h = el('th', { class: 'sortable', text: c + (st.sort === c ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''), tabindex: 0, onclick: function () { st.dir = st.sort === c && st.dir === 'desc' ? 'asc' : 'desc'; st.sort = c; load(); } }); return h; });
        body.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 't mono' }, [el('thead', {}, el('tr', {}, [el('th'), th])), el('tbody', {}, d.rows.map(function (r) {
          return el('tr', {}, [el('td', { style: 'white-space:nowrap' }, [d.editable ? SX.btn('', { sm: true, kind: 'ghost', icon: 'edit', title: 'Edit row', onClick: function () { rowModal(d, r); } }) : null,
            d.deletable ? SX.btn('', { sm: true, kind: 'ghost', icon: 'trash', title: 'Delete row', onClick: function () { SX.confirm({ title: 'Delete row ' + r._rowid_ + '?', message: 'This removes the row from "' + name + '" permanently.', confirmText: 'Delete row', danger: true }).then(function (ok) { if (ok) SX.api('DELETE', '/db/tables/' + name + '/rows/' + r._rowid_).then(function () { SX.toast('Row deleted', 'ok'); load(); }).catch(fail); }); } }) : null]),
            cols.map(function (c) { return el('td', { class: 'cell-trunc', title: r[c] == null ? '' : String(r[c]).slice(0, 300) }, show(r[c])); })]);
        }))])));
        pager.appendChild(SX.pager(d.page, d.pages, d.total, function (p) { st.page = p; load(); }, 'rows'));
      }).catch(function (e) { SX.clear(body); body.appendChild(SX.empty('Could not load', e.message)); });
    }
    load();
  }

  function tablesList(box) {
    box.appendChild(SX.loading());
    SX.api('GET', '/db/overview').then(function (d) {
      SX.clear(box);
      box.appendChild(el('section', { class: 'card' }, el('ul', { class: 'list' }, d.tables.map(function (t) { return el('li', {}, [el('a', { class: 't', href: '#/database/tables/' + t.name, text: t.name }), el('span', { style: 'flex:1' }), el('span', { class: 'chip', text: fmt.num(t.rows) + ' rows' }), t.editable ? null : el('span', { class: 'chip warn', text: 'Protected' })]); }))));
    }).catch(function (e) { SX.clear(box); box.appendChild(SX.empty('Could not load', e.message)); });
  }

  function consoleView(box) {
    var sql = el('textarea', { class: 'sql', spellcheck: 'false', 'aria-label': 'SQL query' }); sql.value = 'SELECT id, title, status, views FROM posts ORDER BY views DESC LIMIT 20';
    var out = el('div');
    function run() {
      SX.clear(out); out.appendChild(SX.loading('Running…'));
      SX.api('POST', '/db/query', { sql: sql.value }).then(function (d) {
        SX.clear(out);
        out.appendChild(el('p', { class: 'hint', text: d.rows.length + ' row' + (d.rows.length === 1 ? '' : 's') + (d.truncated ? ' (first 500 shown)' : '') + ' · ' + d.ms + ' ms' }));
        if (!d.rows.length) return;
        out.appendChild(el('section', { class: 'card' }, el('div', { class: 'table-wrap' }, el('table', { class: 't mono' }, [el('thead', {}, el('tr', {}, d.columns.map(function (c) { return el('th', { text: c }); }))), el('tbody', {}, d.rows.map(function (r) { return el('tr', {}, d.columns.map(function (c) { return el('td', { class: 'cell-trunc' }, show(r[c])); })); }))]))));
      }).catch(function (e) { SX.clear(out); out.appendChild(el('div', { class: 'notice bad' }, [SX.icon('warn'), el('div', { text: e.message })])); });
    }
    sql.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
    box.appendChild(el('div', { class: 'notice info' }, [SX.icon('lock'), el('div', { text: 'Read-only. You can look at posts, media, messages and more, but not change anything here, and accounts, settings and private notes are off limits. To edit data use the Tables tab.' })]));
    box.appendChild(el('section', { class: 'card' }, [el('div', { class: 'card-b' }, [sql, el('div', { style: 'margin-top:10px;display:flex;gap:10px;align-items:center' }, [SX.btn('Run query', { kind: 'primary', icon: 'play', onClick: run }), el('span', { class: 'hint', text: 'Ctrl + Enter also runs it' })])])]));
    box.appendChild(el('div', { style: 'height:14px' })); box.appendChild(out);
  }

  function activity(box) {
    var page = 1, body = el('div'), pager = el('div'); box.appendChild(el('section', { class: 'card' }, body)); box.appendChild(pager);
    function load() {
      SX.api('GET', '/activity?page=' + page).then(function (d) {
        SX.clear(body); SX.clear(pager);
        if (!d.items.length) { body.appendChild(SX.empty('Nothing yet')); return; }
        body.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 't' }, [el('thead', {}, el('tr', {}, ['When', 'Who', 'What', 'Details'].map(function (h) { return el('th', { text: h }); }))), el('tbody', {}, d.items.map(function (a) { return el('tr', {}, [el('td', { text: fmt.dt(a.ts), style: 'white-space:nowrap' }), el('td', { text: a.actor }), el('td', { text: SX.actionLabel(a.action) }), el('td', { class: 'cell-trunc', text: a.detail || '' })]); }))])));
        pager.appendChild(SX.pager(d.page, d.pages, d.total, function (p) { page = p; load(); }, 'events'));
      }).catch(function (e) { SX.clear(body); body.appendChild(SX.empty('Could not load', e.message)); });
    }
    load();
  }

  SX.views.database = function (ctx) {
    var tab = ctx.params[0] || 'overview', table = ctx.params[1];
    ctx.title('Database'); ctx.actions([]);
    var view = ctx.view; SX.clear(view);
    view.appendChild(el('div', { class: 'toolbar' }, SX.tabs(TABS.map(function (t) { return { key: t.key, label: t.label, href: '#/database/' + t.key }; }), tab, null, true)));
    var box = el('div'); view.appendChild(box);
    if (tab === 'tables') return table ? browser(box, table) : tablesList(box);
    if (tab === 'console') return consoleView(box);
    if (tab === 'activity') return activity(box);
    overview(box);
  };
})();
