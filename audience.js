/* Audience: contact inbox, newsletter subscribers, reader accounts. */
(function () {
  'use strict';
  var SX = window.SX, el = SX.el, fmt = SX.fmt;
  function fail(e) { SX.toast(e.message, 'err'); }

  /* ---------- messages ---------- */
  SX.views.messages = function (ctx) {
    ctx.title('Messages'); ctx.actions([]);
    var st = { page: 1, q: '', filter: '' }, view = ctx.view, current = null; SX.clear(view);
    var tabs = el('div'), list = el('div', { class: 'msg-list' }), detail = el('section', { class: 'card' }), pager = el('div');
    function drawTabs() { SX.clear(tabs); tabs.appendChild(SX.tabs([{ key: '', label: 'All' }, { key: 'unread', label: 'Unread' }], st.filter, function (k) { st.filter = k; st.page = 1; drawTabs(); load(); })); }
    drawTabs();
    view.appendChild(el('div', { class: 'toolbar' }, [tabs, el('span', { style: 'flex:1' }), SX.searchBox('Search messages', function (q) { st.q = q; st.page = 1; load(); })]));
    view.appendChild(el('div', { class: 'split' }, [el('div', {}, [el('section', { class: 'card' }, list), pager]), detail]));
    detail.appendChild(SX.empty('Select a message', 'Messages sent through your Contact page appear here.'));

    function open(id) {
      current = id; SX.clear(detail); detail.appendChild(SX.loading());
      SX.api('GET', '/messages/' + id).then(function (d) {
        var m = d.item; SX.clear(detail);
        detail.appendChild(el('div', { class: 'card-h' }, [el('h2', { text: m.subject || '(No subject)' }), el('span', { style: 'flex:1' }),
          el('a', { class: 'btn sm primary', href: 'mailto:' + m.email + '?subject=' + encodeURIComponent('Re: ' + (m.subject || 'Your message')) }, [SX.icon('send'), el('span', { text: 'Reply' })]),
          SX.btn('Mark unread', { sm: true, onClick: function () { SX.api('PUT', '/messages/' + m.id, { is_read: false }).then(function () { load(); }).catch(fail); } }),
          SX.btn('', { sm: true, kind: 'danger', icon: 'trash', title: 'Delete', onClick: function () { SX.confirm({ title: 'Delete this message?', message: 'It cannot be recovered.', confirmText: 'Delete', danger: true }).then(function (ok) { if (ok) SX.api('DELETE', '/messages/' + m.id).then(function () { SX.clear(detail); detail.appendChild(SX.empty('Message deleted')); load(); SX.refreshBadge && SX.refreshBadge(); }).catch(fail); }); } })]));
        detail.appendChild(el('div', { class: 'card-b' }, [el('dl', { class: 'kv', style: 'margin-bottom:14px' }, [el('dt', { text: 'From' }), el('dd', { text: m.name + ' <' + m.email + '>' }), el('dt', { text: 'Received' }), el('dd', { text: fmt.dt(m.created_at) }), el('dt', { text: 'Forwarded to your email' }), el('dd', { text: m.emailed ? 'Yes' : 'No. It is safe here in the dashboard.' })]), el('div', { class: 'msg-body', text: m.body })]));
        SX.refreshBadge && SX.refreshBadge(); load(true);
      }).catch(function (e) { SX.clear(detail); detail.appendChild(SX.empty('Could not open message', e.message)); });
    }
    function load(keep) {
      SX.api('GET', '/messages?page=' + st.page + (st.filter ? '&filter=' + st.filter : '') + (st.q ? '&q=' + encodeURIComponent(st.q) : '')).then(function (d) {
        SX.clear(list); SX.clear(pager);
        if (!d.items.length) list.appendChild(SX.empty(st.q || st.filter ? 'No messages match' : 'No messages yet'));
        d.items.forEach(function (m) {
          list.appendChild(el('button', { type: 'button', class: 'msg-item' + (m.is_read ? '' : ' unread') + (m.id === current ? ' on' : ''), onclick: function () { open(m.id); } }, [
            el('div', { class: 'a' }, [el('span', { class: 'who', text: m.name }), el('span', { class: 'hint', text: fmt.ago(m.created_at) })]), el('div', { class: 's', text: m.subject || '(No subject)' }), el('div', { class: 'p', text: m.snippet })]));
        });
        pager.appendChild(SX.pager(d.page, d.pages, d.total, function (p) { st.page = p; load(); }, 'messages'));
      }).catch(function (e) { SX.clear(list); list.appendChild(SX.empty('Could not load', e.message)); });
    }
    load();
  };

  /* ---------- subscribers ---------- */
  SX.views.subscribers = function (ctx) {
    ctx.title('Subscribers');
    ctx.actions([el('a', { class: 'btn', href: '/api/admin/subscribers/export' }, [SX.icon('download'), el('span', { text: 'Export CSV' })])]);
    var st = { page: 1, q: '' }, sel = {}, view = ctx.view; SX.clear(view);
    var bulk = el('div'), body = el('div'), pager = el('div');
    var email = el('input', { type: 'email', placeholder: 'Add an email address', 'aria-label': 'Email to add', style: 'min-width:260px' });
    view.appendChild(el('div', { class: 'toolbar' }, [SX.searchBox('Search', function (q) { st.q = q; st.page = 1; load(); }), el('span', { style: 'flex:1' }), email,
      SX.btn('Add', { icon: 'plus', onClick: function () { SX.api('POST', '/subscribers', { email: email.value }).then(function () { email.value = ''; SX.toast('Added', 'ok'); load(); }).catch(fail); } })]));
    view.appendChild(bulk); view.appendChild(el('section', { class: 'card' }, body)); view.appendChild(pager);
    function ids() { return Object.keys(sel).map(Number); }
    function drawBulk() {
      SX.clear(bulk); var n = ids().length; if (!n) return;
      bulk.appendChild(el('div', { class: 'bulk' }, [el('b', { text: n + ' selected' }), el('span', { style: 'flex:1' }), SX.btn('Remove', { sm: true, kind: 'danger', icon: 'trash', onClick: function () { SX.confirm({ title: 'Remove ' + n + ' subscriber(s)?', message: 'They will stop being listed here.', confirmText: 'Remove', danger: true }).then(function (ok) { if (ok) SX.api('POST', '/subscribers-bulk', { ids: ids(), action: 'delete' }).then(function () { sel = {}; load(); }).catch(fail); }); } })]));
    }
    function load() {
      SX.api('GET', '/subscribers?page=' + st.page + (st.q ? '&q=' + encodeURIComponent(st.q) : '')).then(function (d) {
        SX.clear(body); SX.clear(pager); drawBulk();
        if (!d.items.length) { body.appendChild(SX.empty('No subscribers yet', 'People who join your newsletter appear here.')); return; }
        body.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 't' }, [el('thead', {}, el('tr', {}, [el('th'), el('th', { text: 'Email' }), el('th', { text: 'Joined' }), el('th')])), el('tbody', {}, d.items.map(function (s) {
          var cb = el('input', { type: 'checkbox', 'aria-label': 'Select ' + s.email, checked: !!sel[s.id] }); cb.addEventListener('change', function () { if (cb.checked) sel[s.id] = 1; else delete sel[s.id]; drawBulk(); });
          return el('tr', {}, [el('td', { style: 'width:34px' }, cb), el('td', { text: s.email }), el('td', { text: fmt.date(s.created_at) }), el('td', { style: 'text-align:right' }, SX.btn('', { sm: true, kind: 'ghost', icon: 'trash', title: 'Remove', onClick: function () { SX.api('DELETE', '/subscribers/' + s.id).then(load).catch(fail); } }))]);
        }))])));
        pager.appendChild(SX.pager(d.page, d.pages, d.total, function (p) { st.page = p; load(); }, 'subscribers'));
      }).catch(function (e) { SX.clear(body); body.appendChild(SX.empty('Could not load', e.message)); });
    }
    load();
  };

  /* ---------- readers ---------- */
  function resetModal(r) {
    var m = SX.modal({ title: 'Help ' + r.name + ' sign in', body: el('div', {}, [
      el('p', { text: 'Reader: ' + r.email, style: 'margin-top:0' }),
      el('p', { class: 'hint', text: 'Readers can also reset their own password from the Sign in page, using whichever email they chose.' }),
      el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Email a reset link' }), el('p', { class: 'hint', text: 'Sends a one-time link (valid 60 minutes) to the email on their account.' }), SX.btn('Send reset link', { icon: 'send', onClick: function () { SX.api('POST', '/readers/' + r.id + '/reset', { mode: 'email' }).then(function (d) { SX.toast('Link sent to ' + d.sent_to, 'ok'); m.close(); }).catch(fail); } })]),
      el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Or give a temporary password' }), el('p', { class: 'hint', text: 'Shown once. Pass it on privately; they should change it after signing in.' }), SX.btn('Create temporary password', { icon: 'key', onClick: function () {
        SX.api('POST', '/readers/' + r.id + '/reset', { mode: 'temp' }).then(function (d) { SX.clear(out); out.appendChild(el('div', { class: 'notice ok' }, [el('div', {}, [el('b', { text: 'Temporary password' }), el('pre', { class: 'code', text: d.temporary_password }), SX.btn('Copy', { sm: true, icon: 'link', onClick: function () { SX.copy(d.temporary_password); } })])])); }).catch(fail); } })]),
      (function () { out = el('div'); return out; })()]) });
    var out;
  }
  SX.views.readers = function (ctx) {
    ctx.title('Readers'); ctx.actions([]);
    var st = { page: 1, q: '' }, view = ctx.view; SX.clear(view);
    var body = el('div'), pager = el('div');
    view.appendChild(el('div', { class: 'notice info' }, [SX.icon('lock'), el('div', { text: 'Readers create accounts only to keep devotion notes and track progress. Their notes are private to them: you see counts here, never the note text.' })]));
    view.appendChild(el('div', { class: 'toolbar' }, SX.searchBox('Search name or email', function (q) { st.q = q; st.page = 1; load(); })));
    view.appendChild(el('section', { class: 'card' }, body)); view.appendChild(pager);
    function load() {
      SX.api('GET', '/readers?page=' + st.page + (st.q ? '&q=' + encodeURIComponent(st.q) : '')).then(function (d) {
        SX.clear(body); SX.clear(pager);
        if (!d.items.length) { body.appendChild(SX.empty('No reader accounts yet', 'Accounts appear when visitors register to take devotion notes.')); return; }
        body.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 't' }, [el('thead', {}, el('tr', {}, ['Reader', 'Devotions', 'Completed', 'Notes', 'Joined', 'Last sign-in', ''].map(function (h) { return el('th', { text: h }); }))), el('tbody', {}, d.items.map(function (r) {
          return el('tr', {}, [el('td', {}, [el('div', { style: 'font-weight:600', text: r.name }), el('div', { class: 'hint', text: r.email })]), el('td', { text: r.devotions }), el('td', { text: r.completed }), el('td', { text: r.notes }), el('td', { text: fmt.date(r.created_at) }), el('td', { text: r.last_login ? fmt.ago(r.last_login) : 'Never' }),
            el('td', { style: 'text-align:right;white-space:nowrap' }, [SX.btn('Password help', { sm: true, icon: 'key', onClick: function () { resetModal(r); } }),
              SX.btn('', { sm: true, kind: 'ghost', icon: 'trash', title: 'Delete account', onClick: function () { SX.confirm({ title: 'Delete ' + r.name + '\'s account?', message: 'Their notes and progress are deleted with it. This cannot be undone.', confirmText: 'Delete account', danger: true }).then(function (ok) { if (ok) SX.api('DELETE', '/readers/' + r.id).then(function () { SX.toast('Account deleted', 'ok'); load(); }).catch(fail); }); } })])]);
        }))])));
        pager.appendChild(SX.pager(d.page, d.pages, d.total, function (p) { st.page = p; load(); }, 'readers'));
      }).catch(function (e) { SX.clear(body); body.appendChild(SX.empty('Could not load', e.message)); });
    }
    load();
  };
})();
