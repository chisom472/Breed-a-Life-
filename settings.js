/* Settings: General, Homepage, Features, Email, Account. */
(function () {
  'use strict';
  var SX = window.SX, el = SX.el, fmt = SX.fmt;
  function fail(e) { SX.toast(e.message, 'err'); }
  var TABS = [{ key: 'general', label: 'General' }, { key: 'homepage', label: 'Homepage' }, { key: 'features', label: 'Features' }, { key: 'email', label: 'Email' }, { key: 'account', label: 'Account' }];

  function card(title, kids, foot) { return el('section', { class: 'card', style: 'margin-bottom:18px' }, [el('div', { class: 'card-h' }, el('h2', { text: title })), el('div', { class: 'card-b' }, kids), foot ? el('div', { class: 'card-b', style: 'border-top:1px solid var(--line);padding-top:12px' }, foot) : null]); }

  /* Build inputs from definitions; returns { nodes, values() } */
  function fields(defs, s) {
    var inputs = {}, nodes = defs.map(function (d) {
      var inp = d.type === 'textarea' ? el('textarea', { rows: d.rows || 3, maxlength: d.max }) : el('input', { type: d.type || 'text', maxlength: d.max, placeholder: d.ph || '' });
      inp.value = s[d.key] == null ? '' : s[d.key]; inputs[d.key] = inp;
      return SX.field(d.label, inp, d.hint, 's-' + d.key);
    });
    return { nodes: nodes, values: function () { var o = {}; Object.keys(inputs).forEach(function (k) { o[k] = inputs[k].value; }); return o; } };
  }
  function saveBtn(getValues, done) {
    return SX.btn('Save changes', { kind: 'primary', onClick: function (e) {
      var b = e.currentTarget; b.disabled = true;
      SX.api('PUT', '/settings', getValues()).then(function () { SX.toast('Settings saved', 'ok'); if (done) done(); }).catch(fail).then(function () { b.disabled = false; });
    } });
  }

  function general(box, s) {
    var soc = fields([{ key: 'social_youtube', label: 'YouTube', type: 'url' }, { key: 'social_facebook', label: 'Facebook', type: 'url' }, { key: 'social_instagram', label: 'Instagram', type: 'url' }, { key: 'social_x', label: 'X (Twitter)', type: 'url' }], s);
    var ogId = s.default_og_image_id || '', ogName = el('span', { class: 'hint', text: ogId ? 'Picture #' + ogId : 'None chosen' });
    var og = el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [SX.btn('Choose picture', { sm: true, icon: 'image', onClick: function () { SX.pickImage(function (m) { ogId = String(m.id); ogName.textContent = m.title || 'Picture #' + m.id; }); } }), SX.btn('Clear', { sm: true, onClick: function () { ogId = ''; ogName.textContent = 'None chosen'; } }), ogName]);
    var f2 = fields([
      { key: 'site_title', label: 'Site name', max: 80 }, { key: 'tagline', label: 'Tagline', max: 160 },
      { key: 'site_description', label: 'Site description (shown in Google)', type: 'textarea', max: 320, hint: 'About 150 characters. Describe the blog in a sentence.' },
      { key: 'site_keywords', label: 'Keywords', type: 'textarea', max: 400, hint: 'Comma-separated topics, for example: Christian blog, Bible devotional.' },
      { key: 'author_name', label: 'Author name', max: 80 },
      { key: 'site_url', label: 'Site address', type: 'url', ph: 'https://www.yourdomain.org', hint: 'Your real web address. Needed for password-reset links, the sitemap and sharing previews.' },
      { key: 'contact_email', label: 'Send contact messages to', type: 'email', hint: 'Messages from your Contact page are emailed here and always saved in Messages.' },
      { key: 'posts_per_page', label: 'Posts per page', type: 'number' }], s);
    box.appendChild(card('Your website', f2.nodes));
    box.appendChild(card('Social links', soc.nodes));
    box.appendChild(card('Default sharing picture', [el('p', { class: 'hint', text: 'Used when a link to your site is shared and the page has no cover picture.' }), og]));
    box.appendChild(saveBtn(function () { var v = Object.assign({}, f2.values(), soc.values(), { default_og_image_id: ogId }); return v; }));
  }

  function homepage(box, s) {
    var hero = fields([{ key: 'hero_eyebrow', label: 'Small heading above the title', max: 80 }, { key: 'hero_title', label: 'Main headline', max: 200 }, { key: 'hero_lede', label: 'Introduction', type: 'textarea', max: 400 },
      { key: 'hero_verse', label: 'Featured verse', type: 'textarea', max: 500 }, { key: 'hero_verse_ref', label: 'Verse reference', max: 60 }], s);
    var foot = fields([{ key: 'footer_text', label: 'Footer verse', type: 'textarea', max: 300 }, { key: 'footer_ref', label: 'Footer verse reference', max: 60 }], s);
    var about = fields([{ key: 'about_html', label: 'About page text (HTML)', type: 'textarea', rows: 10, hint: 'Use paragraphs like <p>…</p>. Scripts and unsafe markup are removed automatically.' }], s);
    box.appendChild(card('Homepage', hero.nodes)); box.appendChild(card('Footer', foot.nodes)); box.appendChild(card('About page', about.nodes));
    box.appendChild(saveBtn(function () { return Object.assign({}, hero.values(), foot.values(), about.values()); }));
  }

  function features(box, s) {
    var vals = {}, defs = [['enable_gallery', 'Pictures page', 'The public gallery of pictures.'], ['enable_videos', 'Videos page', 'The public page of videos.'], ['enable_newsletter', 'Newsletter sign-up', 'Shows the subscribe form.'],
      ['enable_contact', 'Contact page', 'Lets visitors send you a message.'], ['enable_donations', 'Give page', 'Shows the voluntary giving page and menu button.'], ['enable_accounts', 'Reader accounts', 'Lets readers create accounts for devotion notes and progress. Reading never needs an account.']];
    var rows = defs.map(function (d) { vals[d[0]] = s[d[0]] === '1'; return SX.switchRow(d[1], d[2], vals[d[0]], function (v) { vals[d[0]] = v; }).node; });
    var maint = SX.switchRow('Maintenance mode', 'Visitors see a "back soon" page. You can still use the dashboard and preview posts.', s.maintenance_mode === '1', function (v) { vals.maintenance_mode = v; });
    vals.maintenance_mode = s.maintenance_mode === '1';
    var t = fields([{ key: 'maintenance_message', label: 'Maintenance message', max: 400 }, { key: 'contact_intro', label: 'Contact page introduction', type: 'textarea', max: 500 }], s);
    box.appendChild(card('Sections', rows)); box.appendChild(card('Maintenance', [maint.node, t.nodes[0]])); box.appendChild(card('Contact page', [t.nodes[1]]));
    box.appendChild(saveBtn(function () { return Object.assign({}, vals, t.values()); }));
  }

  function email(box) {
    box.appendChild(SX.loading());
    SX.api('GET', '/email').then(function (c) {
      SX.clear(box);
      box.appendChild(el('div', { class: 'notice ' + (c.configured ? 'ok' : '') }, [SX.icon(c.configured ? 'check' : 'warn'), el('div', {}, [el('b', { text: c.configured ? 'Email is on. ' : 'Email is not set up yet. ' }), c.configured ? 'Contact messages, password resets and notices can be sent.' : 'Without it, the contact form still saves every message in your dashboard, and readers cannot receive password-reset emails.'])]));
      if (!c.site_url_ok) box.appendChild(el('div', { class: 'notice' }, [SX.icon('warn'), el('div', {}, ['Set your ', el('a', { href: '#/settings/general', text: 'Site address' }), ' so reset links point to your real domain.'])]));
      var host = el('input', { type: 'text', value: c.host || '', placeholder: 'smtp.gmail.com' }), port = el('input', { type: 'number', value: c.port || 465 });
      var sec = el('select', {}, [el('option', { value: 'tls', text: 'SSL/TLS (port 465)' }), el('option', { value: 'starttls', text: 'STARTTLS (port 587)' }), el('option', { value: 'none', text: 'None (local testing only)' })]); sec.value = c.secure || 'tls';
      var user = el('input', { type: 'text', value: c.user || '', autocomplete: 'off' }), pass = el('input', { type: 'password', placeholder: c.pass_set ? 'Saved. Leave empty to keep it.' : '', autocomplete: 'new-password' }), from = el('input', { type: 'email', value: c.from || '' });
      var msg = el('div', { class: 'msg' });
      box.appendChild(card('Mail server', [el('p', { class: 'hint', text: 'Use any email provider. For Gmail: server smtp.gmail.com, SSL/TLS, port 465, your Gmail address as username, and an App Password (Google Account > Security > 2-Step Verification > App passwords), not your normal password.' }),
        el('div', { class: 'row2' }, [SX.field('Mail server', host, null, 'e-host'), SX.field('Port', port, null, 'e-port')]), SX.field('Security', sec, null, 'e-sec'),
        el('div', { class: 'row2' }, [SX.field('Username', user, null, 'e-user'), SX.field('Password', pass, 'Stored encrypted on your server.', 'e-pass')]), SX.field('Send emails from', from, 'Usually the same as the username.', 'e-from'), msg],
        [SX.btn('Save mail settings', { kind: 'primary', onClick: function () { SX.api('PUT', '/email', { host: host.value, port: port.value, secure: sec.value, user: user.value, pass: pass.value, from: from.value }).then(function () { SX.toast('Mail settings saved', 'ok'); email(SX.clear(box)); }).catch(fail); } }),
          el('span', { style: 'margin-left:8px' }), c.pass_set ? SX.btn('Clear saved settings', { onClick: function () { SX.api('PUT', '/email', { host: '', clear_password: true }).then(function () { SX.toast('Cleared', 'ok'); email(SX.clear(box)); }).catch(fail); } }) : null]));
      var to = el('input', { type: 'email', value: c.recovery_email || '', placeholder: 'any email address' });
      box.appendChild(card('Send a test email', [SX.field('Send to', to, 'Any address you can open. Save the settings above first.', 't-to')], [SX.btn('Send test', { icon: 'send', onClick: function () { SX.api('POST', '/email/test', { to: to.value }).then(function (d) { SX.toast('Test sent to ' + d.to, 'ok'); }).catch(fail); } })]));
    }).catch(function (e) { SX.clear(box); box.appendChild(SX.empty('Could not load', e.message)); });
  }

  function account(box) {
    box.appendChild(SX.loading());
    Promise.all([SX.api('GET', '/me'), SX.api('GET', '/account/sessions')]).then(function (r) {
      var u = r[0].user, ses = r[1].items; SX.clear(box);
      var name = el('input', { type: 'text', value: u.username, autocomplete: 'username' }), mail = el('input', { type: 'email', value: u.email || '', placeholder: 'any email you can open' });
      var np = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Leave empty to keep your current password' }), cur = el('input', { type: 'password', autocomplete: 'current-password' });
      var msg = el('div', { class: 'msg' });
      box.appendChild(card('Your sign-in details', [
        el('p', { class: 'hint', text: 'The recovery email can be any address you choose. If you forget your password, the reset link is sent there from the sign-in page. Change it any time.' }),
        SX.field('Username', name, null, 'a-user'), SX.field('Recovery email', mail, null, 'a-mail'), SX.field('New password', np, 'At least 10 characters.', 'a-new'),
        SX.field('Current password (required to save)', cur, null, 'a-cur'), msg],
        [SX.btn('Save account', { kind: 'primary', onClick: function () {
          var body = { username: name.value, email: mail.value, current_password: cur.value }; if (np.value) body.new_password = np.value;
          SX.api('PUT', '/account', body).then(function () { SX.toast('Account updated', 'ok'); cur.value = ''; np.value = ''; if (SX.user) { SX.user.username = name.value; SX.user.email = mail.value; } if (SX.drawWho) SX.drawWho(); }).catch(function (e) { msg.className = 'msg err'; msg.textContent = e.message; });
        } })]));
      box.appendChild(card('Where you are signed in', [el('ul', { class: 'list', style: 'margin:-6px -18px' }, ses.map(function (x) { return el('li', {}, [el('div', { style: 'flex:1;min-width:0' }, [el('div', { class: 't', text: (x.current ? 'This device' : 'Another device') + (x.ip ? ' · ' + x.ip : '') }), el('div', { class: 'hint', text: (x.user_agent || '').slice(0, 90) + ' · signed in ' + fmt.ago(x.created_at) })]), x.current ? el('span', { class: 'chip ok', text: 'Current' }) : null]); }))],
        ses.length > 1 ? [SX.btn('Sign out other devices', { onClick: function () { SX.api('DELETE', '/account/sessions').then(function () { SX.toast('Other devices signed out', 'ok'); account(SX.clear(box)); }).catch(fail); } })] : null));
    }).catch(function (e) { SX.clear(box); box.appendChild(SX.empty('Could not load', e.message)); });
  }

  SX.views.settings = function (ctx) {
    var tab = ctx.params[0] || 'general'; if (!TABS.some(function (t) { return t.key === tab; })) tab = 'general';
    ctx.title('Settings'); ctx.actions([]);
    var view = ctx.view; SX.clear(view);
    view.appendChild(el('div', { class: 'toolbar' }, SX.tabs(TABS.map(function (t) { return { key: t.key, label: t.label, href: '#/settings/' + t.key }; }), tab, null, true)));
    var box = el('div', { style: 'max-width:820px' }); view.appendChild(box);
    if (tab === 'email') return email(box);
    if (tab === 'account') return account(box);
    box.appendChild(SX.loading());
    return SX.api('GET', '/settings').then(function (d) { SX.clear(box); ({ general: general, homepage: homepage, features: features })[tab](box, d.settings); });
  };
})();
