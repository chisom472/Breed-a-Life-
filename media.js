/* Pictures and Videos libraries, plus the picture picker used by the post editor. */
(function () {
  'use strict';
  var SX = window.SX, el = SX.el, fmt = SX.fmt;

  function uploadFiles(kind, files, list, done) {
    Array.prototype.forEach.call(files, function (file) {
      var bar = el('i'), name = el('span', { text: file.name }), st = el('span', { class: 'hint', text: 'Uploading…' });
      var row = el('div', { class: 'up' }, [el('div', { class: 'top2' }, [name, st]), el('div', { class: 'progress' }, bar)]);
      list.appendChild(row);
      var fd = new FormData(); fd.append('file', file, file.name);
      SX.upload('/media/upload?kind=' + kind, fd, function (p) { bar.style.width = Math.round(p * 100) + '%'; st.textContent = Math.round(p * 100) + '%'; })
        .then(function (d) { bar.style.width = '100%'; st.textContent = 'Done'; row.style.borderColor = 'var(--ok)'; setTimeout(function () { row.remove(); }, 1800); done(d); })
        .catch(function (e) { st.textContent = e.message; st.style.color = 'var(--bad)'; row.style.borderColor = 'var(--bad)'; SX.toast(file.name + ': ' + e.message, 'err'); });
    });
  }

  function dropzone(kind, list, done) {
    var accept = kind === 'image' ? 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml' : 'video/mp4,video/webm,video/quicktime,video/ogg';
    var inp = el('input', { type: 'file', accept: accept, multiple: true });
    var dz = el('label', { class: 'dropzone', tabindex: 0 }, [SX.icon('upload'), el('b', { text: kind === 'image' ? 'Drop pictures here or click to choose' : 'Drop videos here or click to choose' }),
      el('span', { class: 'hint', text: kind === 'image' ? 'JPG, PNG, WebP, GIF, AVIF or SVG. You can select many at once.' : 'MP4 or WebM works best on every device. Large files can take a while.' }), inp]);
    inp.addEventListener('change', function () { if (inp.files.length) uploadFiles(kind, inp.files, list, done); inp.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) uploadFiles(kind, e.dataTransfer.files, list, done); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    return dz;
  }

  function thumb(m) {
    var box = el('div', { class: 'mthumb' });
    if (m.thumb) box.appendChild(el('img', { src: m.thumb, alt: '', loading: 'lazy' })); else box.appendChild(SX.icon(m.kind === 'video' ? 'video' : 'image'));
    if (m.kind === 'video') box.appendChild(el('span', { class: 'play' }, SX.icon('play')));
    return box;
  }

  function editModal(m, after) {
    var title = el('input', { type: 'text', value: m.title || '', maxlength: 200 });
    var alt = el('input', { type: 'text', value: m.alt || '', maxlength: 300 });
    var desc = el('textarea', { rows: 3, maxlength: 1000, text: m.description || '' }); desc.value = m.description || '';
    var vis = SX.switchRow('Show on the website', 'Hidden items stay in your library but visitors cannot see them.', m.visible, function () {});
    var preview = el('div', { class: 'preview-box' });
    if (m.kind === 'image') preview.appendChild(el('img', { src: m.url, alt: m.alt || '' }));
    else if (m.source === 'embed') preview.appendChild(el('img', { src: m.thumb, alt: '' }));
    else { var v = el('video', { controls: true, preload: 'metadata', src: m.url }); if (m.poster_url) v.setAttribute('poster', m.poster_url); preview.appendChild(v); }
    var info = el('p', { class: 'hint', text: [m.kind === 'video' ? (m.source === 'embed' ? 'YouTube video' : 'Uploaded video') : 'Picture', m.size ? fmt.bytes(m.size) : '', 'Added ' + fmt.date(m.created_at), m.used ? 'Used in ' + m.used + ' post' + (m.used === 1 ? '' : 's') : ''].filter(Boolean).join(' · ') });
    var body = el('div', {}, [preview, info, SX.field('Title', title, null, 'm-title'), m.kind === 'image' ? SX.field('Description for screen readers (alt text)', alt, 'Short and plain: what is in the picture?', 'm-alt') : null, SX.field('Caption / description', desc, null, 'm-desc'), vis.node]);
    if (m.kind === 'video' && m.source === 'upload') {
      var pin = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', style: 'display:none' });
      var pbtn = SX.btn(m.poster ? 'Change thumbnail' : 'Add thumbnail', { sm: true, icon: 'image', onClick: function () { pin.click(); } });
      pin.addEventListener('change', function () {
        if (!pin.files[0]) return; var fd = new FormData(); fd.append('file', pin.files[0]);
        SX.upload('/media/' + m.id + '/poster', fd).then(function (d) { SX.toast('Thumbnail saved', 'ok'); modal.close(); after(); }).catch(function (e) { SX.toast(e.message, 'err'); });
      });
      body.appendChild(el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Video thumbnail' }), el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [pbtn, pin,
        m.poster ? SX.btn('Remove thumbnail', { sm: true, onClick: function () { SX.api('DELETE', '/media/' + m.id + '/poster').then(function () { modal.close(); after(); }).catch(function (e) { SX.toast(e.message, 'err'); }); } }) : null]), el('p', { class: 'hint', text: 'Shown before the video plays.' })]));
    }
    var modal = SX.modal({
      title: m.kind === 'video' ? 'Edit video' : 'Edit picture', size: 'wide', body: body,
      actions: [
        { text: 'Delete', kind: 'danger', icon: 'trash', onClick: function () {
          SX.confirm({ title: 'Delete this ' + m.kind + '?', message: 'It will be removed from your library and from the website for good.' + (m.used ? ' It is used in ' + m.used + ' post(s), where it will show as missing.' : ''), confirmText: 'Delete', danger: true }).then(function (ok) {
            if (ok) SX.api('DELETE', '/media/' + m.id).then(function () { SX.toast('Deleted', 'ok'); modal.close(); after(); }).catch(function (e) { SX.toast(e.message, 'err'); });
          }); } },
        { text: 'Cancel', onClick: function () { modal.close(); } },
        { text: 'Save', kind: 'primary', onClick: function () {
          SX.api('PUT', '/media/' + m.id, { title: title.value, alt: m.kind === 'image' ? alt.value : undefined, description: desc.value, visible: vis.input.checked })
            .then(function () { SX.toast('Saved', 'ok'); modal.close(); after(); }).catch(function (e) { SX.toast(e.message, 'err'); }); } }]
    });
  }

  function embedModal(after) {
    var url = el('input', { type: 'url', placeholder: 'https://www.youtube.com/watch?v=…' }), title = el('input', { type: 'text', maxlength: 200 }), desc = el('textarea', { rows: 3, maxlength: 1000 });
    var modal = SX.modal({ title: 'Add a YouTube video', body: el('div', {}, [SX.field('YouTube link', url, null, 'e-url'), SX.field('Title', title, null, 'e-title'), SX.field('Description (optional)', desc, null, 'e-desc'), el('p', { class: 'hint', text: 'You do not need YouTube. Use "Upload" to add your own video files.' })]),
      actions: [{ text: 'Cancel', onClick: function () { modal.close(); } }, { text: 'Add video', kind: 'primary', onClick: function () {
        SX.api('POST', '/media/embed', { url: url.value, title: title.value, description: desc.value }).then(function () { SX.toast('Video added', 'ok'); modal.close(); after(); }).catch(function (e) { SX.toast(e.message, 'err'); }); } }] });
  }

  function library(kind) {
    return function (ctx) {
      var label = kind === 'image' ? 'Pictures' : 'Videos';
      ctx.title(label);
      var state = { page: 1, q: '', visible: '' }, sel = {};
      var view = ctx.view; SX.clear(view);
      var uploads = el('div', { class: 'uploads' }), grid = el('div'), bulk = el('div'), pager = el('div');
      ctx.actions(kind === 'video' ? [SX.btn('Add YouTube link', { icon: 'link', onClick: function () { embedModal(load); } })] : []);
      view.appendChild(dropzone(kind, uploads, function () { state.page = 1; load(); })); view.appendChild(el('div', { style: 'height:14px' })); view.appendChild(uploads);
      var vsel = el('select', { 'aria-label': 'Filter by visibility', style: 'width:auto' }, [el('option', { value: '', text: 'All' }), el('option', { value: '1', text: 'Visible' }), el('option', { value: '0', text: 'Hidden' })]);
      vsel.addEventListener('change', function () { state.visible = vsel.value; state.page = 1; load(); });
      view.appendChild(el('div', { class: 'toolbar' }, [SX.searchBox('Search ' + label.toLowerCase(), function (q) { state.q = q; state.page = 1; load(); }), vsel]));
      view.appendChild(bulk); view.appendChild(grid); view.appendChild(pager);

      function ids() { return Object.keys(sel).map(Number); }
      function drawBulk() {
        SX.clear(bulk); var n = ids().length; if (!n) return;
        function act(a, msg) { SX.api('POST', '/media-bulk', { ids: ids(), action: a }).then(function () { sel = {}; SX.toast(msg, 'ok'); load(); }).catch(function (e) { SX.toast(e.message, 'err'); }); }
        bulk.appendChild(el('div', { class: 'bulk' }, [el('b', { text: n + ' selected' }), el('span', { style: 'flex:1' }), SX.btn('Show', { sm: true, onClick: function () { act('show', 'Now visible'); } }), SX.btn('Hide', { sm: true, onClick: function () { act('hide', 'Now hidden'); } }),
          SX.btn('Delete', { sm: true, kind: 'danger', icon: 'trash', onClick: function () { SX.confirm({ title: 'Delete ' + n + ' item(s)?', message: 'They will be removed permanently.', confirmText: 'Delete', danger: true }).then(function (ok) { if (ok) act('delete', 'Deleted'); }); } }),
          SX.btn('Clear', { sm: true, kind: 'ghost', onClick: function () { sel = {}; drawBulk(); SX.$$('.mcard', grid).forEach(function (c) { c.classList.remove('sel'); var cb = c.querySelector('.pick'); if (cb) cb.checked = false; }); } })]));
      }
      function load() {
        var qs = '?kind=' + kind + '&page=' + state.page + (state.q ? '&q=' + encodeURIComponent(state.q) : '') + (state.visible !== '' ? '&visible=' + state.visible : '');
        SX.api('GET', '/media' + qs).then(function (d) {
          SX.clear(grid); SX.clear(pager); drawBulk();
          if (!d.items.length) { grid.appendChild(SX.empty(state.q ? 'Nothing matches that search' : 'No ' + label.toLowerCase() + ' yet', state.q ? '' : 'Upload your first one above.')); return; }
          var g = el('div', { class: 'mgrid' });
          d.items.forEach(function (m) {
            var cb = el('input', { type: 'checkbox', class: 'pick', 'aria-label': 'Select ' + (m.title || 'item'), checked: !!sel[m.id] });
            var card = el('div', { class: 'mcard' + (sel[m.id] ? ' sel' : ''), tabindex: 0, role: 'button', 'aria-label': 'Edit ' + (m.title || 'item') }, [cb,
              el('div', { class: 'tags' }, [!m.visible ? el('span', { class: 'chip warn', text: 'Hidden' }) : null, m.source === 'embed' ? el('span', { class: 'chip info', text: 'YouTube' }) : null]), thumb(m),
              el('div', { class: 'mbody' }, [el('div', { class: 'n', text: m.title || 'Untitled' }), el('div', { class: 'm', text: [m.size ? fmt.bytes(m.size) : '', fmt.date(m.created_at)].filter(Boolean).join(' · ') })])]);
            cb.addEventListener('click', function (e) { e.stopPropagation(); if (cb.checked) sel[m.id] = 1; else delete sel[m.id]; card.classList.toggle('sel', cb.checked); drawBulk(); });
            card.addEventListener('click', function () { editModal(m, load); });
            card.addEventListener('keydown', function (e) { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editModal(m, load); } });
            g.appendChild(card);
          });
          grid.appendChild(g); pager.appendChild(SX.pager(d.page, d.pages, d.total, function (p) { state.page = p; load(); }, label.toLowerCase()));
        }).catch(function (e) { SX.clear(grid); grid.appendChild(SX.empty('Could not load', e.message)); });
      }
      load();
    };
  }
  SX.views.pictures = library('image');
  SX.views.videos = library('video');

  /* Picker used by the post editor: choose an existing picture or upload a new one. */
  SX.pickImage = function (onPick) {
    var grid = el('div', { class: 'mgrid' }), uploads = el('div', { class: 'uploads' }), modal;
    function load() {
      SX.clear(grid); grid.appendChild(SX.loading());
      SX.api('GET', '/media?kind=image&per=60').then(function (d) {
        SX.clear(grid);
        if (!d.items.length) { grid.appendChild(SX.empty('No pictures yet', 'Upload one above.')); return; }
        d.items.forEach(function (m) { grid.appendChild(el('button', { type: 'button', class: 'mcard', style: 'text-align:left;padding:0', 'aria-label': 'Use ' + (m.title || 'picture'), onclick: function () { modal.close(); onPick(m); } }, [thumb(m), el('div', { class: 'mbody' }, el('div', { class: 'n', text: m.title || 'Untitled' }))])); });
      });
    }
    modal = SX.modal({ title: 'Choose a picture', size: 'xl', body: el('div', {}, [dropzone('image', uploads, function (d) { if (d.items && d.items[0]) { modal.close(); onPick(d.items[0]); } }), el('div', { style: 'height:12px' }), uploads, grid]) });
    load();
  };
})();
