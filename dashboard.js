/* Overview: setup checklist, key numbers, 30-day views chart, top posts, recent activity. */
(function () {
  'use strict';
  var SX = window.SX, el = SX.el, fmt = SX.fmt;

  function statCard(label, value, sub, href, icon) {
    return el(href ? 'a' : 'div', { class: 'stat', href: href || null }, [
      el('div', { class: 'k' }, [SX.icon(icon), label]), el('div', { class: 'v', text: value }), sub ? el('div', { class: 's', text: sub }) : null]);
  }

  /* One series, one colour: a bar per day. Hover or focus a bar for the exact number; "Table" gives the same data as text. */
  function chart(series) {
    var W = 720, H = 220, L = 38, R = 8, T = 10, B = 26, iw = W - L - R, ih = H - T - B;
    var max = Math.max.apply(null, series.map(function (d) { return d.views; }).concat([1]));
    var step = max <= 5 ? 1 : Math.pow(10, Math.floor(Math.log10(max / 4))) * (max / 4 > 5 * Math.pow(10, Math.floor(Math.log10(max / 4))) ? 5 : max / 4 > 2 * Math.pow(10, Math.floor(Math.log10(max / 4))) ? 2 : 1);
    var top = Math.ceil(max / step) * step;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Page views per day for the last 30 days');
    function node(n, a, t) { var e = document.createElementNS(NS, n); Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); if (t != null) e.textContent = t; svg.appendChild(e); return e; }
    for (var v = 0; v <= top; v += step) {
      var y = T + ih - (v / top) * ih;
      node('line', { class: 'grid', x1: L, x2: W - R, y1: y, y2: y });
      node('text', { class: 'axis', x: L - 6, y: y + 4, 'text-anchor': 'end' }, fmt.num(v));
    }
    var bw = iw / series.length, tip = el('div', { class: 'tip', hidden: true });
    var wrap = el('div', { class: 'chart' }, [svg, tip]);
    series.forEach(function (d, i) {
      var h = (d.views / top) * ih, x = L + i * bw;
      node('rect', { class: 'bar', x: x + bw * 0.16, width: bw * 0.68, y: T + ih - h, height: Math.max(h, d.views ? 1.5 : 0), rx: 2 });
      var label = new Date(d.day + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
      if (i % 5 === 0 || i === series.length - 1) node('text', { class: 'axis', x: x + bw / 2, y: H - 7, 'text-anchor': 'middle' }, label);
      var hit = node('rect', { class: 'hit', x: x, width: bw, y: T, height: ih, tabindex: 0, 'aria-label': label + ': ' + d.views + ' views' });
      var show = function () {
        tip.hidden = false; SX.clear(tip); tip.appendChild(el('b', { text: fmt.num(d.views) + (d.views === 1 ? ' view' : ' views') })); tip.appendChild(document.createTextNode(label));
        var pct = (x + bw / 2) / W * 100; tip.style.left = Math.min(Math.max(pct, 8), 92) + '%'; tip.style.top = Math.max(0, (T + ih - h) / H * 100 - 4) + '%';
      };
      hit.addEventListener('mouseenter', show); hit.addEventListener('focus', show);
      hit.addEventListener('mouseleave', function () { tip.hidden = true; }); hit.addEventListener('blur', function () { tip.hidden = true; });
    });
    return wrap;
  }

  function table(series) {
    return el('div', { class: 'table-wrap', style: 'max-height:260px;overflow:auto' }, el('table', { class: 't' }, [
      el('thead', {}, el('tr', {}, [el('th', { text: 'Day' }), el('th', { text: 'Page views' })])),
      el('tbody', {}, series.slice().reverse().map(function (d) { return el('tr', {}, [el('td', { text: d.day }), el('td', { text: fmt.num(d.views) })]); }))]));
  }

  SX.views.dashboard = function (ctx) {
    ctx.title('Overview');
    return SX.api('GET', '/stats').then(function (s) {
      var root = ctx.view; SX.clear(root);
      ctx.actions([SX.btn('New post', { kind: 'primary', icon: 'plus', onClick: function () { location.hash = '#/posts/new'; } })]);
      if (s.maintenance) root.appendChild(el('div', { class: 'notice' }, [SX.icon('warn'), el('div', {}, [el('b', { text: 'Maintenance mode is on. ' }), 'Visitors currently see a "back soon" page. ', el('a', { href: '#/settings/features', text: 'Turn it off' })])]));

      var todo = [];
      if (!s.setup.site_url) todo.push(['Set your site address', 'Reset links and the sitemap need your real domain.', '#/settings/general']);
      if (!s.setup.email) todo.push(['Turn on email', 'Needed for the contact form, password resets and test messages.', '#/settings/email']);
      if (!s.setup.recovery_email) todo.push(['Add a recovery email', 'Lets you reset the dashboard password with any email you choose.', '#/settings/account']);
      if (!s.setup.donations) todo.push(['Add a giving option', 'The Give page has nothing to show until you add one.', '#/giving']);
      if (todo.length) root.appendChild(el('div', { class: 'notice info' }, [SX.icon('list'), el('div', {}, [el('b', { text: 'Finish setting up' }), el('ul', {}, todo.map(function (t) { return el('li', {}, [el('a', { href: t[2], text: t[0] }), ' – ' + t[1]]); }))])]));

      root.appendChild(el('div', { class: 'stats' }, [
        statCard('Page views (30 days)', fmt.num(s.views.last30), fmt.num(s.views.total) + ' all time', null, 'eye'),
        statCard('Posts', fmt.num(s.posts.published), s.posts.drafts + ' drafts' + (s.posts.scheduled ? ' · ' + s.posts.scheduled + ' scheduled' : ''), '#/posts', 'doc'),
        statCard('Pictures and videos', fmt.num(s.media.images) + ' / ' + fmt.num(s.media.videos), fmt.bytes(s.media.bytes) + ' stored', '#/pictures', 'image'),
        statCard('Messages', fmt.num(s.messages.total), s.messages.unread + ' unread', '#/messages', 'mail'),
        statCard('Readers with accounts', fmt.num(s.readers.total), s.readers.completed + ' devotions completed', '#/readers', 'book'),
        statCard('Subscribers', fmt.num(s.subscribers.total), s.subscribers.week + ' this week', '#/subscribers', 'users'),
        statCard('Database', fmt.bytes(s.db_bytes), 'View, back up or edit', '#/database', 'db'),
        statCard('New readers this week', fmt.num(s.readers.week), 'Notes stay private to them', '#/readers', 'users')]));

      var holder = el('div', { class: 'card-b' }, chart(s.views.series));
      var mode = 'chart';
      var toggle = SX.btn('Table', { sm: true, onClick: function () { mode = mode === 'chart' ? 'table' : 'chart'; toggle.lastChild.textContent = mode === 'chart' ? 'Table' : 'Chart'; SX.clear(holder); holder.appendChild(mode === 'chart' ? chart(s.views.series) : table(s.views.series)); } });
      var views = el('section', { class: 'card' }, [el('div', { class: 'card-h' }, [el('h2', { text: 'Page views, last 30 days' }), el('span', { style: 'flex:1' }), toggle]), holder]);

      var top = el('section', { class: 'card' }, [el('div', { class: 'card-h' }, el('h2', { text: 'Most read posts' })),
        s.top_posts.length ? el('ul', { class: 'list' }, s.top_posts.map(function (p) { return el('li', {}, [el('a', { class: 't', href: '#/posts/' + p.id, text: p.title }), el('span', { style: 'flex:1' }), el('span', { class: 'chip', text: fmt.num(p.views) + ' views' })]); })) : SX.empty('No posts yet')]);
      var pages = el('section', { class: 'card' }, [el('div', { class: 'card-h' }, el('h2', { text: 'Busiest pages (30 days)' })),
        s.top_pages.length ? el('ul', { class: 'list' }, s.top_pages.map(function (p) { return el('li', {}, [el('span', { class: 't', text: p.path }), el('span', { style: 'flex:1' }), el('span', { class: 'chip', text: fmt.num(p.views) })]); })) : SX.empty('No visits recorded yet')]);
      var act = el('section', { class: 'card' }, [el('div', { class: 'card-h' }, [el('h2', { text: 'Recent activity' }), el('span', { style: 'flex:1' }), el('a', { href: '#/database/activity', text: 'See all' })]),
        el('ul', { class: 'list' }, s.activity.map(function (a) { return el('li', {}, [el('div', { style: 'flex:1;min-width:0' }, [el('div', { class: 't', text: SX.actionLabel(a.action) }), el('div', { class: 'hint', text: (a.detail || '') + (a.detail ? ' · ' : '') + a.actor })]), el('span', { class: 'hint', text: fmt.ago(a.ts) })]); }))]);
      root.appendChild(el('div', { class: 'cols' }, [el('div', { class: 'stack' }, [views, top]), el('div', { class: 'stack' }, [pages, act])]));
    });
  };
})();
