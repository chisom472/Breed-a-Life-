/* Dashboard shell: sign-in check, navigation, hash router. */
(function () {
  'use strict';
  var SX = window.SX, el = SX.el;
  var NAV = [
    ['', 'Overview', 'home', 'dashboard'], ['h', 'Content'], ['posts', 'Posts', 'doc', 'posts'], ['pictures', 'Pictures', 'image', 'pictures'], ['videos', 'Videos', 'video', 'videos'],
    ['h', 'Audience'], ['messages', 'Messages', 'mail', 'messages'], ['readers', 'Readers', 'book', 'readers'], ['subscribers', 'Subscribers', 'users', 'subscribers'], ['giving', 'Giving', 'heart', 'giving'],
    ['h', 'Website'], ['settings', 'Settings', 'gear', 'settings'], ['database', 'Database', 'db', 'database']
  ];
  var view = SX.$('#view'), actions = SX.$('#actions'), titleEl = SX.$('#title'), nav = SX.$('#nav'), side = SX.$('#side'), token = 0;

  SX.refreshBadge = function () {
    SX.api('GET', '/messages?filter=unread&page=1').then(function (d) { var b = SX.$('#nav .badge'); if (b) { b.textContent = d.unread; b.hidden = !d.unread; } }).catch(function () {});
  };
  function drawNav(cur) {
    SX.clear(nav);
    NAV.forEach(function (n) {
      if (n[0] === 'h' && n.length === 2) { nav.appendChild(el('h6', { text: n[1] })); return; }
      var a = el('a', { href: '#/' + n[0], class: cur === n[3] ? 'on' : '', 'aria-current': cur === n[3] ? 'page' : null }, [SX.icon(n[2]), el('span', { text: n[1] })]);
      if (n[0] === 'messages') a.appendChild(el('span', { class: 'badge', hidden: true }));
      nav.appendChild(a);
    });
    SX.refreshBadge();
  }
  function route() {
    var hash = location.hash.replace(/^#\/?/, '').split('?')[0], parts = hash.split('/').filter(Boolean).map(decodeURIComponent);
    var key = parts[0] || '', params = parts.slice(1), name = key === '' ? 'dashboard' : key === 'posts' && params.length ? 'post' : key;
    var navKey = key === '' ? 'dashboard' : key;
    var fn = SX.views[name];
    side.classList.remove('open');
    if (!fn) { name = 'dashboard'; navKey = 'dashboard'; fn = SX.views.dashboard; }
    SX.dirtyGuard = null; drawNav(navKey); SX.clear(view); SX.clear(actions); var my = ++token;
    var ctx = { view: view, params: params, title: function (t) { titleEl.textContent = t; document.title = t + ' | Breed a Life'; }, actions: function (nodes) { SX.clear(actions); (nodes || []).forEach(function (n) { if (n) actions.appendChild(n); }); } };
    view.appendChild(SX.loading());
    Promise.resolve().then(function () { return fn(ctx); }).catch(function (e) { if (my === token) { SX.clear(view); view.appendChild(SX.empty('Something went wrong', e.message)); } });
    view.focus({ preventScroll: true }); window.scrollTo(0, 0);
  }
  var lastHash = location.hash;
  window.addEventListener('hashchange', function (e) {
    if (SX.dirtyGuard && SX.dirtyGuard() && !window.confirm('You have unsaved changes. Leave without saving?')) { history.replaceState(null, '', lastHash || '#/'); return; }
    lastHash = location.hash; route();
  });
  window.addEventListener('beforeunload', function (e) { if (SX.dirtyGuard && SX.dirtyGuard()) { e.preventDefault(); e.returnValue = ''; } });

  SX.drawWho = function () {
    var w = SX.$('#who'); SX.clear(w); w.appendChild(SX.icon('lock')); w.appendChild(el('span', { text: SX.user.username }));
  };
  SX.$('#viewsite').appendChild(SX.icon('ext')); SX.$('#viewsite').appendChild(el('span', { text: 'View website' }));
  var lo = SX.$('#logout'); lo.appendChild(SX.icon('out')); lo.appendChild(el('span', { text: 'Sign out' }));
  lo.addEventListener('click', function () { SX.api('POST', '/logout', {}).catch(function () {}).then(function () { location.href = '/admin/login'; }); });
  var mb = SX.$('#menu'); mb.appendChild(SX.icon('menu')); mb.addEventListener('click', function () { side.classList.toggle('open'); });

  SX.api('GET', '/me').then(function (d) { SX.user = d.user; SX.drawWho(); route(); }).catch(function () {});
})();
