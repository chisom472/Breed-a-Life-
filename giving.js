/* Giving: manage the options shown on the public Give page. */
(function () {
  'use strict';
  var SX = window.SX, el = SX.el;
  function fail(e) { SX.toast(e.message, 'err'); }

  function form(item, after) {
    var it = item || { label: '', url: '', details: '', note: '', visible: 1 };
    var label = el('input', { type: 'text', value: it.label, maxlength: 80, placeholder: 'e.g. Card or bank transfer' });
    var url = el('input', { type: 'url', value: it.url || '', placeholder: 'https://… (payment link)' });
    var details = el('textarea', { rows: 4, maxlength: 1000, placeholder: 'Account name, number, bank, or any instructions' }); details.value = it.details || '';
    var note = el('input', { type: 'text', value: it.note || '', maxlength: 300, placeholder: 'Optional short note' });
    var vis = SX.switchRow('Show on the Give page', null, it.visible !== 0, function () {});
    var m = SX.modal({ title: item ? 'Edit giving option' : 'Add a giving option', body: el('div', {}, [
      SX.field('Name', label, null, 'g-label'), SX.field('Payment link', url, 'From your own payment provider, such as a Paystack, Flutterwave, PayPal or Stripe payment page.', 'g-url'),
      SX.field('Account details', details, 'Use this instead of, or beside, a link. Only what you type here is shown.', 'g-det'), SX.field('Note', note, null, 'g-note'), vis.node]),
      actions: [{ text: 'Cancel', onClick: function () { m.close(); } }, { text: 'Save', kind: 'primary', onClick: function () {
        SX.api(item ? 'PUT' : 'POST', '/donations' + (item ? '/' + item.id : ''), { label: label.value, url: url.value, details: details.value, note: note.value, visible: vis.input.checked }).then(function () { SX.toast('Saved', 'ok'); m.close(); after(); }).catch(fail); } }] });
  }

  SX.views.giving = function (ctx) {
    ctx.title('Giving');
    ctx.actions([SX.btn('Add option', { kind: 'primary', icon: 'plus', onClick: function () { form(null, load); } })]);
    var view = ctx.view; SX.clear(view);
    var list = el('div'), items = [];
    view.appendChild(el('div', { class: 'notice info' }, [SX.icon('heart'), el('div', { text: 'Donations are voluntary and go straight to you through the options below. This site does not process payments itself, so no card details ever touch it.' })]));
    view.appendChild(el('section', { class: 'card' }, list));

    var intro = el('textarea', { rows: 4, maxlength: 1200 }), use = el('textarea', { rows: 4, maxlength: 800 });
    var save = SX.btn('Save text', { kind: 'primary', onClick: function () { SX.api('PUT', '/settings', { donate_intro: intro.value, donate_use: use.value }).then(function () { SX.toast('Give page text saved', 'ok'); }).catch(fail); } });
    view.appendChild(el('section', { class: 'card', style: 'margin-top:18px' }, [el('div', { class: 'card-h' }, el('h2', { text: 'Give page wording' })), el('div', { class: 'card-b' }, [
      SX.field('Introduction', intro, null, 'g-intro'), SX.field('How gifts are used', use, 'One item per line.', 'g-use'), save])]));
    SX.api('GET', '/settings').then(function (d) { intro.value = d.settings.donate_intro || ''; use.value = d.settings.donate_use || ''; }).catch(fail);

    function persistOrder() { SX.api('POST', '/donations-order', { ids: items.map(function (i) { return i.id; }) }).then(load).catch(fail); }
    function load() {
      SX.api('GET', '/donations').then(function (d) {
        items = d.items; SX.clear(list);
        if (!items.length) { list.appendChild(SX.empty('No giving options yet', 'Add a payment link or your account details so readers can give.', SX.btn('Add option', { kind: 'primary', icon: 'plus', onClick: function () { form(null, load); } }))); return; }
        list.appendChild(el('ul', { class: 'list' }, items.map(function (i, n) {
          return el('li', {}, [el('div', { style: 'flex:1;min-width:0' }, [el('div', { class: 't', text: i.label }), el('div', { class: 'hint', text: [i.url, i.details && i.details.split('\n')[0]].filter(Boolean).join(' · ') })]),
            i.visible ? el('span', { class: 'chip ok', text: 'Visible' }) : el('span', { class: 'chip', text: 'Hidden' }),
            SX.btn('', { sm: true, kind: 'ghost', icon: 'up', title: 'Move up', disabled: n === 0, onClick: function () { items.splice(n - 1, 0, items.splice(n, 1)[0]); persistOrder(); } }),
            SX.btn('', { sm: true, kind: 'ghost', icon: 'down', title: 'Move down', disabled: n === items.length - 1, onClick: function () { items.splice(n + 1, 0, items.splice(n, 1)[0]); persistOrder(); } }),
            SX.btn('', { sm: true, kind: 'ghost', icon: 'edit', title: 'Edit', onClick: function () { form(i, load); } }),
            SX.btn('', { sm: true, kind: 'ghost', icon: 'trash', title: 'Delete', onClick: function () { SX.confirm({ title: 'Delete "' + i.label + '"?', message: 'It will disappear from the Give page.', confirmText: 'Delete', danger: true }).then(function (ok) { if (ok) SX.api('DELETE', '/donations/' + i.id).then(load).catch(fail); }); } })]);
        })));
      }).catch(function (e) { SX.clear(list); list.appendChild(SX.empty('Could not load', e.message)); });
    }
    load();
  };
})();
