/* Posts: list with filters and bulk actions, and the writing studio. */
(function () {
  'use strict';
  var SX = window.SX, el = SX.el, fmt = SX.fmt;
  var STATE = { published: ['ok', 'Published'], scheduled: ['info', 'Scheduled'], draft: ['', 'Draft'] };

  /* ---------- list ---------- */
  SX.views.posts = function (ctx) {
    ctx.title('Posts');
    ctx.actions([SX.btn('New post', { kind: 'primary', icon: 'plus', onClick: function () { location.hash = '#/posts/new'; } })]);
    var st = { page: 1, q: '', status: '' }, sel = {}, view = ctx.view; SX.clear(view);
    var tabs = el('div'), bulk = el('div'), body = el('div'), pager = el('div');
    var tabItems = [{ key: '', label: 'All' }, { key: 'published', label: 'Published' }, { key: 'scheduled', label: 'Scheduled' }, { key: 'draft', label: 'Drafts' }];
    function drawTabs() { SX.clear(tabs); tabs.appendChild(SX.tabs(tabItems, st.status, function (k) { st.status = k; st.page = 1; drawTabs(); load(); })); }
    drawTabs();
    view.appendChild(el('div', { class: 'toolbar' }, [tabs, el('span', { style: 'flex:1' }), SX.searchBox('Search posts', function (q) { st.q = q; st.page = 1; load(); })]));
    view.appendChild(bulk); view.appendChild(el('section', { class: 'card' }, body)); view.appendChild(pager);

    function ids() { return Object.keys(sel).map(Number); }
    function drawBulk() {
      SX.clear(bulk); var n = ids().length; if (!n) return;
      function act(a, msg) { SX.api('POST', '/posts-bulk', { ids: ids(), action: a }).then(function () { sel = {}; SX.toast(msg, 'ok'); load(); }).catch(function (e) { SX.toast(e.message, 'err'); }); }
      bulk.appendChild(el('div', { class: 'bulk' }, [el('b', { text: n + ' selected' }), el('span', { style: 'flex:1' }), SX.btn('Publish', { sm: true, onClick: function () { act('publish', 'Published'); } }), SX.btn('Move to drafts', { sm: true, onClick: function () { act('draft', 'Moved to drafts'); } }),
        SX.btn('Delete', { sm: true, kind: 'danger', icon: 'trash', onClick: function () { SX.confirm({ title: 'Delete ' + n + ' post(s)?', message: 'This cannot be undone. Readers\' private notes about them are kept.', confirmText: 'Delete', danger: true }).then(function (ok) { if (ok) act('delete', 'Deleted'); }); } })]));
    }
    function load() {
      var qs = '?page=' + st.page + (st.status ? '&status=' + st.status : '') + (st.q ? '&q=' + encodeURIComponent(st.q) : '');
      SX.api('GET', '/posts' + qs).then(function (d) {
        SX.clear(body); SX.clear(pager); drawBulk();
        if (!d.items.length) { body.appendChild(SX.empty(st.q || st.status ? 'No posts match' : 'No posts yet', st.q || st.status ? '' : 'Write your first reflection.', st.q || st.status ? null : SX.btn('New post', { kind: 'primary', icon: 'plus', onClick: function () { location.hash = '#/posts/new'; } }))); return; }
        var all = el('input', { type: 'checkbox', 'aria-label': 'Select all posts on this page' });
        all.addEventListener('change', function () { d.items.forEach(function (p) { if (all.checked) sel[p.id] = 1; else delete sel[p.id]; }); SX.$$('tbody input[type=checkbox]', body).forEach(function (c) { c.checked = all.checked; }); drawBulk(); });
        var rows = d.items.map(function (p) {
          var cb = el('input', { type: 'checkbox', 'aria-label': 'Select ' + p.title, checked: !!sel[p.id] });
          cb.addEventListener('change', function () { if (cb.checked) sel[p.id] = 1; else delete sel[p.id]; drawBulk(); });
          var s = STATE[p.state];
          return el('tr', {}, [el('td', { style: 'width:34px' }, cb),
            el('td', { class: 'title' }, [el('a', { href: '#/posts/' + p.id, text: p.title }), p.featured ? el('span', { class: 'chip warn', style: 'margin-left:8px', text: 'Featured' }) : null, el('div', { class: 'hint', text: p.category || 'No category' })]),
            el('td', {}, el('span', { class: 'chip ' + s[0], text: s[1] })), el('td', { text: fmt.num(p.views) }), el('td', { text: fmt.date(p.published_at || p.updated_at) }),
            el('td', { style: 'text-align:right;white-space:nowrap' }, [
              p.state === 'published' ? el('a', { class: 'btn sm ghost', href: '/post/' + p.slug, target: '_blank', rel: 'noopener', 'aria-label': 'View ' + p.title }, SX.icon('ext')) : null,
              SX.btn('', { sm: true, kind: 'ghost', icon: 'edit', title: 'Edit', onClick: function () { location.hash = '#/posts/' + p.id; } }),
              SX.btn('', { sm: true, kind: 'ghost', icon: 'trash', title: 'Delete', onClick: function () { SX.confirm({ title: 'Delete "' + p.title + '"?', message: 'This post will be removed for good, including its link.', confirmText: 'Delete', danger: true }).then(function (ok) { if (ok) SX.api('DELETE', '/posts/' + p.id).then(function () { delete sel[p.id]; SX.toast('Post deleted', 'ok'); load(); }).catch(function (e) { SX.toast(e.message, 'err'); }); }); } })])]);
        });
        body.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 't' }, [el('thead', {}, el('tr', {}, [el('th', {}, all), el('th', { text: 'Title' }), el('th', { text: 'Status' }), el('th', { text: 'Views' }), el('th', { text: 'Date' }), el('th')])), el('tbody', {}, rows)])));
        pager.appendChild(SX.pager(d.page, d.pages, d.total, function (p) { st.page = p; load(); }, 'posts'));
      }).catch(function (e) { SX.clear(body); body.appendChild(SX.empty('Could not load posts', e.message)); });
    }
    load();
  };

  /* ---------- editor ---------- */
  function counter(input, max) {
    var c = el('div', { class: 'counter' });
    function u() { var n = input.value.length; c.textContent = n + ' / ' + max; c.classList.toggle('over', n > max); }
    input.addEventListener('input', u); u(); return c;
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  SX.views.post = function (ctx) {
    var id = ctx.params[0] === 'new' ? null : Number(ctx.params[0]);
    ctx.title(id ? 'Edit post' : 'New post');
    var view = ctx.view; SX.clear(view); view.appendChild(SX.loading());
    var load = id ? SX.api('GET', '/posts/' + id) : Promise.resolve({ post: { title: '', slug: '', excerpt: '', content: '', category: '', tags: [], status: 'draft', featured: 0, seo_title: '', seo_description: '', published_at: null }, cover: null });
    return load.then(function (d) {
      var p = d.post, cover = d.cover, dirty = false, saving = false, sourceMode = false;
      SX.clear(view);
      function touch() { dirty = true; }
      SX.dirtyGuard = function () { return dirty; };

      var title = el('input', { type: 'text', class: 'title-input', placeholder: 'Post title', value: p.title, maxlength: 200, 'aria-label': 'Post title' });
      var editor = el('div', { class: 'editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Post body' }); editor.innerHTML = p.content || '<p><br></p>';   // sanitised by the server on save; your own content
      var source = el('textarea', { class: 'source', hidden: true, 'aria-label': 'HTML source' });
      var tools = el('div', { class: 'etools', role: 'toolbar', 'aria-label': 'Formatting' });
      function cmd(c, v) { editor.focus(); document.execCommand(c, false, v || null); touch(); }
      function tool(label, title, fn, bold) { var b = el('button', { type: 'button', title: title, 'aria-label': title, text: label, style: bold ? '' : 'font-weight:500', onmousedown: function (e) { e.preventDefault(); }, onclick: fn }); tools.appendChild(b); return b; }
      function sep() { tools.appendChild(el('span', { class: 'sep' })); }
      tool('B', 'Bold', function () { cmd('bold'); }, 1); tool('I', 'Italic', function () { cmd('italic'); }, 0); sep();
      tool('H2', 'Heading', function () { cmd('formatBlock', 'h2'); }, 1); tool('H3', 'Subheading', function () { cmd('formatBlock', 'h3'); }, 1); tool('¶', 'Normal paragraph', function () { cmd('formatBlock', 'p'); }, 0); sep();
      tool('• List', 'Bulleted list', function () { cmd('insertUnorderedList'); }); tool('1. List', 'Numbered list', function () { cmd('insertOrderedList'); }); sep();
      tool('“ Quote', 'Quote', function () { cmd('formatBlock', 'blockquote'); });
      tool('✝ Scripture', 'Scripture quote with reference', function () {
        var ref = window.prompt('Scripture reference, for example John 3:16 (KJV)'); if (ref === null) return; var sel = window.getSelection().toString() || 'Type the verse here.';
        cmd('insertHTML', '<blockquote><p>' + esc(sel) + '</p><cite>' + esc(ref) + '</cite></blockquote><p><br></p>');
      }); sep();
      tool('Link', 'Add link', function () { var u = window.prompt('Link address (https://…)'); if (u) { if (!/^(https?:\/\/|mailto:|\/)/i.test(u)) u = 'https://' + u; cmd('createLink', u); } });
      tool('Picture', 'Insert picture', function () { var r = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0).cloneRange() : null; SX.pickImage(function (m) { editor.focus(); if (r) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } cmd('insertHTML', '<p><img src="' + esc(m.url) + '" alt="' + esc(m.alt || m.title || '') + '"></p>'); }); });
      tool('―', 'Divider', function () { cmd('insertHorizontalRule'); }); tool('Clear', 'Remove formatting', function () { cmd('removeFormat'); cmd('formatBlock', 'p'); });
      var srcBtn = tool('</>', 'Edit HTML source', function () {
        sourceMode = !sourceMode;
        if (sourceMode) { source.value = editor.innerHTML; } else { editor.innerHTML = source.value; }
        source.hidden = !sourceMode; editor.hidden = sourceMode; srcBtn.classList.toggle('on', sourceMode);
      });
      editor.addEventListener('input', touch); source.addEventListener('input', touch); title.addEventListener('input', touch);
      editor.addEventListener('paste', function (e) { e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });

      /* side panel fields */
      var status = el('select', {}, [el('option', { value: 'draft', text: 'Draft (only you can see it)' }), el('option', { value: 'published', text: 'Published' })]); status.value = p.status;
      var when = el('input', { type: 'datetime-local', value: fmt.localInput(p.published_at) });
      var featured = SX.switchRow('Feature on the home page', null, p.featured, touch);
      var category = el('input', { type: 'text', value: p.category || '', maxlength: 60, list: 'cats' });
      var tags = el('input', { type: 'text', value: (p.tags || []).join(', '), placeholder: 'grace, obedience, Genesis' });
      var excerpt = el('textarea', { rows: 3, maxlength: 500 }); excerpt.value = p.excerpt || '';
      var slug = el('input', { type: 'text', value: p.slug || '', placeholder: 'created from the title' });
      var seoT = el('input', { type: 'text', value: p.seo_title || '', maxlength: 120, placeholder: 'Defaults to the post title' });
      var seoD = el('textarea', { rows: 3, maxlength: 300 }); seoD.value = p.seo_description || '';
      [status, when, category, tags, excerpt, slug, seoT, seoD].forEach(function (x) { x.addEventListener('input', touch); x.addEventListener('change', touch); });
      var coverBox = el('div', { class: 'cover-box' });
      function drawCover() {
        SX.clear(coverBox);
        if (cover) { coverBox.appendChild(el('img', { src: cover.url, alt: '' })); coverBox.appendChild(el('div', { style: 'display:flex;gap:8px;padding:10px' }, [SX.btn('Change', { sm: true, onClick: pickCover }), SX.btn('Remove', { sm: true, onClick: function () { cover = null; touch(); drawCover(); } })])); }
        else coverBox.appendChild(el('div', { class: 'ph' }, [el('p', { text: 'No cover picture', style: 'margin:0 0 8px' }), SX.btn('Choose a picture', { sm: true, icon: 'image', onClick: pickCover })]));
      }
      function pickCover() { SX.pickImage(function (m) { cover = m; touch(); drawCover(); }); }
      drawCover();

      var serp = el('div', { class: 'serp' });
      function drawSerp() {
        var base = location.origin, s = slug.value || (title.value || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        SX.clear(serp); serp.appendChild(el('div', { class: 'u', text: base + '/post/' + s }));
        serp.appendChild(el('div', { class: 'h', text: (seoT.value || title.value || 'Post title').slice(0, 65) }));
        serp.appendChild(el('div', { class: 'd', text: (seoD.value || excerpt.value || editor.textContent.trim()).slice(0, 160) }));
      }
      [title, slug, seoT, seoD, excerpt].forEach(function (x) { x.addEventListener('input', drawSerp); }); editor.addEventListener('input', SX.debounce(drawSerp, 400)); drawSerp();

      function card(heading, kids) { return el('section', { class: 'card side-card' }, [el('div', { class: 'card-h' }, el('h2', { text: heading })), el('div', { class: 'card-b' }, kids)]); }
      var cats = el('datalist', { id: 'cats' });
      var side = el('div', {}, [
        card('Publish', [SX.field('Status', status, null, 'p-status'), SX.field('Publish date', when, 'Leave empty to publish now. A future date schedules the post.', 'p-when'), featured.node]),
        card('Cover picture', [coverBox]),
        card('Details', [SX.field('Category', category, null, 'p-cat'), cats, SX.field('Tags', tags, 'Separate with commas.', 'p-tags'), SX.field('Short summary', excerpt, 'Shown on cards and in search results.', 'p-ex'), SX.field('Web address ending', slug, 'Letters, numbers and dashes.', 'p-slug')]),
        card('Search engine appearance', [serp, el('div', { style: 'height:12px' }), SX.field('SEO title', seoT, null, 'p-st'), counter(seoT, 120), SX.field('SEO description', seoD, 'About 150 characters works best.', 'p-sd'), counter(seoD, 300)])
      ]);
      SX.api('GET', '/posts?page=1').then(function (r) { var seen = {}; r.items.forEach(function (x) { if (x.category && !seen[x.category]) { seen[x.category] = 1; cats.appendChild(el('option', { value: x.category })); } }); }).catch(function () {});

      var msg = el('div', { class: 'msg', role: 'status' });
      function save(goBack) {
        if (saving) return; saving = true;
        var html = sourceMode ? source.value : editor.innerHTML;
        var body = { title: title.value, content: html, status: status.value, published_at: when.value ? new Date(when.value).toISOString() : null, cover_id: cover ? cover.id : null, category: category.value, tags: tags.value, excerpt: excerpt.value, slug: slug.value, featured: featured.input.checked, seo_title: seoT.value, seo_description: seoD.value };
        msg.className = 'msg'; msg.textContent = 'Saving…';
        SX.api(id ? 'PUT' : 'POST', '/posts' + (id ? '/' + id : ''), body).then(function (r) {
          dirty = false; saving = false; SX.toast(status.value === 'published' ? 'Saved and published' : 'Saved as draft', 'ok'); msg.textContent = '';
          if (goBack) location.hash = '#/posts'; else if (!id) location.hash = '#/posts/' + r.post.id; else { slug.value = r.post.slug; p = r.post; drawSerp(); drawActions(); }
        }).catch(function (e) { saving = false; msg.className = 'msg err'; msg.textContent = e.message; SX.toast(e.message, 'err'); });
      }
      function drawActions() {
        ctx.actions([
          id && p.status === 'published' ? el('a', { class: 'btn', href: '/post/' + p.slug, target: '_blank', rel: 'noopener' }, [SX.icon('ext'), el('span', { text: 'View' })]) : null,
          id ? el('a', { class: 'btn', href: '/post/' + p.slug + '?preview=1', target: '_blank', rel: 'noopener' }, [SX.icon('eye'), el('span', { text: 'Preview' })]) : null,
          SX.btn('Save', { kind: 'primary', onClick: function () { save(false); } }), SX.btn('Save and close', { onClick: function () { save(true); } })]);
      }
      drawActions();
      view.appendChild(el('div', { class: 'editor-grid' }, [el('div', {}, [title, el('div', { style: 'height:14px' }), tools, editor, source, msg, id ? el('div', { style: 'margin-top:18px' }, SX.btn('Delete this post', { kind: 'danger', icon: 'trash', onClick: function () { SX.confirm({ title: 'Delete "' + p.title + '"?', message: 'This post will be removed for good.', confirmText: 'Delete', danger: true }).then(function (ok) { if (ok) SX.api('DELETE', '/posts/' + id).then(function () { dirty = false; SX.toast('Post deleted', 'ok'); location.hash = '#/posts'; }).catch(function (e) { SX.toast(e.message, 'err'); }); }); } })) : null]), side]));
      editor.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(false); } });
      document.addEventListener('keydown', function onk(e) { if (!document.body.contains(title)) { document.removeEventListener('keydown', onk); return; } if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(false); } });
    });
  };
})();
