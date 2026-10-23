(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* mobile navigation */
  var toggle = $('.nav-toggle'), nav = $('#site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* newsletter */
  $$('[data-subscribe]').forEach(function (form) {
    var msg = $('.subscribe-msg', form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button', form);
      btn.disabled = true;
      fetch('/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify({ email: form.email.value, website: form.website.value })
      }).then(function (r) { return r.json(); }).then(function (d) {
        msg.textContent = d.message || 'Thank you.';
        if (d.ok) form.email.value = '';
      }).catch(function () { msg.textContent = 'Something went wrong. Please try again.'; })
        .then(function () { btn.disabled = false; });
    });
  });
  if (/[?&]subscribed=/.test(location.search)) {
    var m = $('.subscribe-msg');
    if (m) m.textContent = /subscribed=1/.test(location.search) ? 'Thank you. You are subscribed.' : 'That address could not be added. Please try again.';
  }

  /* YouTube click-to-load (no third-party requests until played) */
  $$('[data-yt]').forEach(function (frame) {
    var btn = $('.yt-play', frame);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(frame.getAttribute('data-yt')) + '?autoplay=1&rel=0';
      f.title = frame.getAttribute('data-title') || 'Video';
      f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.replaceChildren(f);
    });
  });

  /* reading progress */
  var bar = $('.read-progress span'), post = $('.post .prose');
  if (bar && post) {
    var tick = false;
    var update = function () {
      var r = post.getBoundingClientRect();
      var total = r.height - window.innerHeight * 0.6;
      var done = Math.min(1, Math.max(0, (-r.top + window.innerHeight * 0.2) / Math.max(total, 1)));
      bar.style.width = (done * 100).toFixed(1) + '%';
      tick = false;
    };
    window.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* copy link */
  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var url = b.getAttribute('data-copy');
      var done = function () { var t = b.textContent; b.textContent = 'Copied'; setTimeout(function () { b.textContent = t; }, 1600); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done); else { window.prompt('Copy this link', url); }
    });
  });

  /* gallery lightbox */
  var lb = $('[data-lightbox]');
  if (lb) {
    var items = $$('.g-open'), idx = 0, lastFocus = null;
    var img = $('[data-lb-img]', lb), cap = $('[data-lb-cap]', lb);
    var show = function (i) {
      idx = (i + items.length) % items.length;
      var src = $('img', items[idx]);
      img.src = src.currentSrc || src.src;
      img.alt = src.alt;
      cap.textContent = '';
      if (src.dataset.title) { var s = document.createElement('strong'); s.textContent = src.dataset.title; cap.appendChild(s); }
      if (src.dataset.desc) cap.appendChild(document.createTextNode(src.dataset.desc));
    };
    var open = function (i) { lastFocus = document.activeElement; lb.hidden = false; document.body.style.overflow = 'hidden'; show(i); $('[data-lb-close]', lb).focus(); };
    var close = function () { lb.hidden = true; document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); };
    items.forEach(function (b, i) { b.addEventListener('click', function () { open(i); }); });
    $('[data-lb-close]', lb).addEventListener('click', close);
    $('[data-lb-prev]', lb).addEventListener('click', function () { show(idx - 1); });
    $('[data-lb-next]', lb).addEventListener('click', function () { show(idx + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(idx - 1);
      else if (e.key === 'ArrowRight') show(idx + 1);
    });
  }
})();
