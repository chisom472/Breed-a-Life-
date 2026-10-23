'use strict';
const settings = require('../settings');
const { get } = require('../db');
const { layout, postCard, cover, sectionHead, pager, icon, abs, esc } = require('./layout');
const { formatDate, readingTime, truncate, stripHtml, wordCount } = require('../util');

const isSvg = (f) => /\.svg$/i.test(f || '');
const ogFor = (file) => (file && !isSvg(file) ? `/uploads/${file}` : '');
function defaultOg() {
  const id = Number(settings.get('default_og_image_id'));
  if (!id) return '';
  const m = get("SELECT filename FROM media WHERE id = ? AND kind = 'image'", id);
  return m ? ogFor(m.filename) : '';
}

/* ---------- media blocks ---------- */
function videoBlock(v) {
  const thumb = v.source === 'embed' ? `https://i.ytimg.com/vi/${v.embed_id}/hqdefault.jpg` : v.poster ? `/uploads/${v.poster}` : '';
  let player;
  if (v.source === 'embed') {
    player = `<div class="video-frame" data-yt="${esc(v.embed_id)}" data-title="${esc(v.title)}">
      <button class="yt-play" type="button" aria-label="Play video: ${esc(v.title)}">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}<span class="play-badge">${icon('play', 'icon-lg')}</span></button>
      <noscript><a href="https://www.youtube.com/watch?v=${esc(v.embed_id)}" rel="noopener">Watch on YouTube</a></noscript></div>`;
  } else {
    player = `<div class="video-frame"><video controls preload="metadata" playsinline${thumb ? ` poster="${esc(thumb)}"` : ''}><source src="/uploads/${esc(v.filename)}" type="${esc(v.mime || 'video/mp4')}">Your browser cannot play this video. <a href="/uploads/${esc(v.filename)}">Download it</a>.</video></div>`;
  }
  return `<article class="video-card">${player}<div class="video-meta"><h3>${esc(v.title)}</h3>${v.description ? `<p>${esc(v.description)}</p>` : ''}<time datetime="${esc(v.created_at)}">${formatDate(v.created_at)}</time></div></article>`;
}

function galleryItem(m, i) {
  return `<figure class="g-item"><button type="button" class="g-open" data-index="${i}" aria-label="Open ${esc(m.title || 'image')} larger"><img src="/uploads/${esc(m.filename)}" alt="${esc(m.alt || m.title)}" loading="lazy" decoding="async" data-title="${esc(m.title)}" data-desc="${esc(m.description)}"></button>${m.title || m.description ? `<figcaption><strong>${esc(m.title)}</strong>${m.description ? `<span>${esc(m.description)}</span>` : ''}</figcaption>` : ''}</figure>`;
}

/* ---------- pages ---------- */
function home(ctx, { featured, latest, images, videos }) {
  const s = settings.getAll();
  const base = settings.baseUrl(ctx);
  const heroVerse = s.hero_verse ? `<aside class="verse-card" aria-label="Featured scripture"><p class="verse-text">${esc(s.hero_verse)}</p>${s.hero_verse_ref ? `<p class="verse-ref">${esc(s.hero_verse_ref)}</p>` : ''}</aside>` : '';

  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow eyebrow-light">${esc(s.hero_eyebrow)}</p>
      <h1>${esc(s.hero_title)}</h1>
      <p class="lede">${esc(s.hero_lede)}</p>
      <div class="hero-actions"><a class="btn btn-gold" href="/blog">Read the reflections</a>${s.enable_gallery === '1' ? '<a class="btn btn-ghost" href="/gallery">View the gallery</a>' : ''}</div>
    </div>
    ${heroVerse}
  </div>
</section>

${featured || latest.length ? `<section class="section"><div class="wrap">
  ${sectionHead('Latest', 'Recent reflections', '/blog', 'All reflections')}
  ${featured ? postCard(featured, { large: true }) : ''}
  ${latest.length ? `<div class="card-grid">${latest.map((p) => postCard(p)).join('')}</div>` : ''}
</div></section>` : `<section class="section"><div class="wrap empty"><h2>No reflections yet</h2><p>New writing will appear here as soon as it is published.</p></div></section>`}

${images.length ? `<section class="section section-tint"><div class="wrap">
  ${sectionHead('Illustrated', 'From the gallery', '/gallery', 'Open the gallery')}
  <div class="strip">${images.map((m) => `<a class="strip-item" href="/gallery"><img src="/uploads/${esc(m.filename)}" alt="${esc(m.alt || m.title)}" loading="lazy"></a>`).join('')}</div>
</div></section>` : ''}

${videos.length ? `<section class="section"><div class="wrap">
  ${sectionHead('Watch', 'Teaching & sermons', '/videos', 'All videos')}
  <div class="video-grid">${videos.map(videoBlock).join('')}</div>
</div></section>` : ''}`;

  return layout(ctx, {
    title: '', path: '/', active: 'home', body,
    description: s.site_description,
    image: ogFor(featured && featured.cover_filename) || defaultOg(),
    jsonld: [{ '@context': 'https://schema.org', '@type': 'Blog', name: s.site_title, url: base + '/', description: s.site_description }],
  });
}

function blog(ctx, { posts, total, page, pages, q, category, tag, categories }) {
  const s = settings.getAll();
  const qs = (p) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q); if (category) u.set('category', category); if (tag) u.set('tag', tag); if (p > 1) u.set('page', p);
    const str = u.toString();
    return '/blog' + (str ? '?' + str : '');
  };
  const heading = q ? `Results for "${q}"` : category ? category : tag ? `Tagged "${tag}"` : 'Reflections';
  const body = `
<section class="page-head"><div class="wrap">
  <p class="eyebrow">The journal</p><h1>${esc(heading)}</h1>
  <p class="lede-dark">${q || category || tag ? `${total} ${total === 1 ? 'reflection' : 'reflections'} found.` : 'Bible-rooted writing, one passage at a time.'}</p>
  <form class="search" role="search" action="/blog" method="get"><label class="sr" for="q">Search reflections</label><input id="q" name="q" type="search" value="${esc(q || '')}" placeholder="Search by title, topic or tag">${category ? `<input type="hidden" name="category" value="${esc(category)}">` : ''}<button type="submit" class="btn">${icon('search')}<span class="sr">Search</span></button></form>
  ${categories.length ? `<ul class="chips"><li><a href="/blog"${!category ? ' aria-current="true"' : ''}>All</a></li>${categories.map((c) => `<li><a href="/blog?category=${encodeURIComponent(c)}"${category === c ? ' aria-current="true"' : ''}>${esc(c)}</a></li>`).join('')}</ul>` : ''}
</div></section>
<section class="section"><div class="wrap">
  ${posts.length ? `<div class="card-grid">${posts.map((p) => postCard(p)).join('')}</div>${pager(page, pages, qs)}` : `<div class="empty"><h2>Nothing found</h2><p>${q ? 'Try a different word, or ' : ''}<a href="/blog">browse all reflections</a>.</p></div>`}
</div></section>`;
  return layout(ctx, {
    title: q ? `Search: ${q}` : category ? `${category} reflections` : tag ? `Reflections tagged ${tag}` : 'Reflections',
    description: category ? `Christian reflections on ${category}. ${s.site_description}` : 'Bible-rooted devotional reflections on sin, grace, obedience and redemption.',
    path: '/blog' + (page > 1 ? `?page=${page}` : ''), active: 'blog', body,
    robots: q ? 'noindex, follow' : undefined,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Reflections', url: settings.baseUrl(ctx) + '/blog' }],
  });
}

function post(ctx, { p, prev, next, related }) {
  const s = settings.getAll();
  const base = settings.baseUrl(ctx);
  const tags = p.tags ? p.tags.split(',') : [];
  const url = `${base}/post/${p.slug}`;
  const minutes = readingTime(p.content);
  const coverUrl = p.cover_filename ? `/uploads/${p.cover_filename}` : '';
  const description = p.seo_description || truncate(p.excerpt || stripHtml(p.content), 158);
  const devotion = p.status === 'published' && settings.flag('enable_accounts');
  const share = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(p.title)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const mail = `mailto:?subject=${encodeURIComponent(p.title)}&body=${encodeURIComponent(url)}`;

  const body = `
<div class="read-progress" aria-hidden="true"><span></span></div>
<article class="post" itemscope itemtype="https://schema.org/BlogPosting">
  <header class="post-head wrap-narrow">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/blog">Reflections</a>${p.category ? `<span aria-hidden="true">/</span><a href="/blog?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a>` : ''}</nav>
    <h1 itemprop="headline">${esc(p.title)}</h1>
    ${p.excerpt ? `<p class="standfirst">${esc(truncate(p.excerpt, 280))}</p>` : ''}
    <p class="byline"><time datetime="${esc(p.published_at)}" itemprop="datePublished">${formatDate(p.published_at)}</time><span aria-hidden="true">·</span>${minutes} min read<span aria-hidden="true">·</span>${esc(s.author_name)}</p>
  </header>
  ${coverUrl ? `<figure class="post-cover"><img src="${esc(coverUrl)}" alt="${esc(p.cover_alt || p.title)}" itemprop="image" decoding="async"></figure>` : ''}
  <div class="prose wrap-narrow" itemprop="articleBody">${p.content}</div>
  <footer class="post-foot wrap-narrow">
    ${tags.length ? `<ul class="tags" aria-label="Tags">${tags.map((t) => `<li><a href="/blog?tag=${encodeURIComponent(t)}">${esc(t)}</a></li>`).join('')}</ul>` : ''}
    ${devotion ? `<section class="dev-card" data-dev-card aria-label="Devotion notes and progress"></section>` : ''}
    <div class="share"><span class="eyebrow">Share this reflection</span><div><a href="${share}" target="_blank" rel="noopener">X</a><a href="${fb}" target="_blank" rel="noopener">Facebook</a><a href="${mail}">Email</a><button type="button" data-copy="${esc(url)}">${icon('link')} Copy link</button></div></div>
  </footer>
</article>
${devotion ? devotionDrawer(p) : ''}
${prev || next ? `<nav class="wrap post-nav" aria-label="More reflections">${prev ? `<a class="pn pn-prev" href="/post/${esc(prev.slug)}" rel="prev"><span class="eyebrow">Newer</span><strong>${esc(prev.title)}</strong></a>` : '<span></span>'}${next ? `<a class="pn pn-next" href="/post/${esc(next.slug)}" rel="next"><span class="eyebrow">Older</span><strong>${esc(next.title)}</strong></a>` : '<span></span>'}</nav>` : ''}
${related.length ? `<section class="section section-tint"><div class="wrap">${sectionHead('Keep reading', 'Related reflections')}<div class="card-grid">${related.map((r) => postCard(r)).join('')}</div></div></section>` : ''}`;

  return layout(ctx, {
    title: p.seo_title || p.title, description, path: `/post/${p.slug}`, active: 'blog', type: 'article', body,
    image: ogFor(p.cover_filename) || defaultOg(), keywords: [...tags, p.category].filter(Boolean).join(', ') || undefined,
    publishedTime: p.published_at, modifiedTime: p.updated_at, tags,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title.slice(0, 110), description,
        image: coverUrl && !isSvg(p.cover_filename) ? [abs(base, coverUrl)] : undefined,
        datePublished: p.published_at, dateModified: p.updated_at,
        author: { '@type': 'Person', name: s.author_name }, publisher: { '@type': 'Organization', name: s.site_title, url: base + '/' },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url }, keywords: tags.join(', ') || undefined, articleSection: p.category || undefined,
        wordCount: wordCount(p.content), inLanguage: 'en',
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' },
          { '@type': 'ListItem', position: 2, name: 'Reflections', item: base + '/blog' },
          { '@type': 'ListItem', position: 3, name: p.title, item: url },
        ],
      },
    ],
  });
}

function gallery(ctx, { images }) {
  const base = settings.baseUrl(ctx);
  const body = `
<section class="page-head"><div class="wrap"><p class="eyebrow">Illustrated</p><h1>Gallery</h1><p class="lede-dark">Images to sit with. Select any picture to view it larger.</p></div></section>
<section class="section"><div class="wrap">
  ${images.length ? `<div class="g-grid" data-gallery>${images.map(galleryItem).join('')}</div>` : '<div class="empty"><h2>No images yet</h2><p>Pictures will appear here once they are added.</p></div>'}
</div></section>
<div class="lightbox" data-lightbox hidden role="dialog" aria-modal="true" aria-label="Image viewer">
  <button type="button" class="lb-btn lb-close" data-lb-close aria-label="Close">${icon('x')}</button>
  <button type="button" class="lb-btn lb-prev" data-lb-prev aria-label="Previous image">${icon('left')}</button>
  <figure class="lb-fig"><img alt="" data-lb-img><figcaption data-lb-cap></figcaption></figure>
  <button type="button" class="lb-btn lb-next" data-lb-next aria-label="Next image">${icon('right')}</button>
</div>`;
  return layout(ctx, {
    title: 'Gallery', description: 'A gallery of Christian illustrations and images to accompany Scripture reading and reflection.',
    path: '/gallery', active: 'gallery', body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'ImageGallery', name: 'Gallery', url: base + '/gallery',
      associatedMedia: images.slice(0, 30).map((m) => ({ '@type': 'ImageObject', contentUrl: base + '/uploads/' + m.filename, name: m.title, description: m.description || undefined, uploadDate: m.created_at })),
    }],
  });
}

function videos(ctx, { videos: list }) {
  const base = settings.baseUrl(ctx);
  const body = `
<section class="page-head"><div class="wrap"><p class="eyebrow">Watch</p><h1>Videos</h1><p class="lede-dark">Teaching, sermons and short studies.</p></div></section>
<section class="section"><div class="wrap">
  ${list.length ? `<div class="video-grid">${list.map(videoBlock).join('')}</div>` : '<div class="empty"><h2>No videos yet</h2><p>Videos will appear here once they are added.</p></div>'}
</div></section>`;
  return layout(ctx, {
    title: 'Videos', description: 'Christian teaching and sermon videos on Scripture, the fall of man, grace and redemption.',
    path: '/videos', active: 'videos', body,
    jsonld: list.slice(0, 30).map((v) => ({
      '@context': 'https://schema.org', '@type': 'VideoObject', name: v.title, description: v.description || v.title, uploadDate: v.created_at,
      thumbnailUrl: v.source === 'embed' ? `https://i.ytimg.com/vi/${v.embed_id}/hqdefault.jpg` : v.poster ? base + '/uploads/' + v.poster : undefined,
      ...(v.source === 'embed' ? { embedUrl: `https://www.youtube-nocookie.com/embed/${v.embed_id}` } : { contentUrl: base + '/uploads/' + v.filename }),
    })),
  });
}

function about(ctx) {
  const s = settings.getAll();
  const body = `
<section class="page-head"><div class="wrap"><p class="eyebrow">About</p><h1>Why &ldquo;${esc(s.site_title)}&rdquo;</h1></div></section>
<section class="section"><div class="wrap-narrow prose">${s.about_html}${s.contact_email ? `<p>Write to us at <a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>.</p>` : ''}</div></section>`;
  return layout(ctx, { title: 'About', description: truncate(stripHtml(s.about_html), 158) || s.site_description, path: '/about', active: 'about', body });
}

function message(ctx, { status, heading, text }) {
  const body = `<section class="section message"><div class="wrap-narrow center"><p class="eyebrow">${status}</p><h1>${esc(heading)}</h1><p class="lede-dark">${esc(text)}</p><p><a class="btn" href="/">Return home</a></p></div></section>`;
  return layout(ctx, { title: `${heading}`, description: text, body, robots: 'noindex, nofollow' });
}

function maintenance(ctx) {
  const s = settings.getAll();
  const body = `<section class="section message"><div class="wrap-narrow center"><p class="eyebrow">Back soon</p><h1>${esc(s.site_title)}</h1><p class="lede-dark">${esc(s.maintenance_message)}</p></div></section>`;
  return layout(ctx, { title: 'Back soon', description: s.maintenance_message, body, robots: 'noindex, nofollow' });
}


/* ---------- devotion notes drawer (content is filled in by /assets/js/reader.js) ---------- */
function devotionDrawer(p) {
  return `<button type="button" class="dev-fab" data-dev-open aria-controls="devotion" aria-expanded="false">${icon('note')}<span>Devotion notes</span></button>
<aside class="devotion" id="devotion" data-post-id="${p.id}" hidden role="dialog" aria-modal="false" aria-labelledby="dev-title">
  <div class="dev-head"><div><p class="eyebrow">Private to you</p><h2 id="dev-title">My devotion</h2></div><button type="button" class="dev-close" data-dev-close aria-label="Close notes">${icon('x')}</button></div>
  <div class="dev-body" data-dev-body><p class="muted">Loading&hellip;</p></div>
</aside>`;
}

/* ---------- account pages ---------- */
const field = (id, label, attrs = '', hint = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" ${attrs}>${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
const hp = '<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">';

function authShell(ctx, { active, eyebrow, title, lede, body, jsonld }) {
  return layout(ctx, {
    title, description: lede, path: ctx.pathname, active, robots: 'noindex, nofollow',
    body: `<section class="page-head"><div class="wrap"><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="lede-dark">${esc(lede)}</p></div></section>
<section class="section"><div class="wrap-narrow auth-wrap">${body}</div></section>`,
  });
}

function join(ctx, { next }) {
  const body = `<form class="form-card" data-reader-form="join" data-next="${esc(next || '')}" novalidate>
  ${field('name', 'Your name <span class="opt">(optional)</span>', 'type="text" autocomplete="given-name" maxlength="60"')}
  ${field('email', 'Email address', 'type="email" autocomplete="email" required maxlength="160"', 'Use any email address you like. It is only used to sign in and to reset your password.')}
  ${field('password', 'Password', 'type="password" autocomplete="new-password" required minlength="8" maxlength="200"', 'At least 8 characters, with a letter and a number.')}
  ${hp}
  <button class="btn btn-gold btn-block" type="submit">Create my free account</button>
  <p class="form-msg" role="alert" aria-live="polite"></p>
</form>
<p class="form-alt">Already have an account? <a href="/signin${next ? `?next=${encodeURIComponent(next)}` : ''}">Sign in</a></p>
<ul class="perks"><li><strong>Private notes.</strong> Write beside any reflection. Only you can read them.</li><li><strong>Your progress.</strong> Mark devotions complete and build a streak.</li><li><strong>Yours to keep.</strong> Export your journal or delete your account at any time.</li></ul>
<p class="fine">Accounts are optional. Reading, watching, browsing and giving never require one.</p>`;
  return authShell(ctx, { active: 'signin', eyebrow: 'Your devotion journal', title: 'Create a free account', lede: 'An account is only needed to keep private notes and track your progress.', body });
}

function signin(ctx, { next }) {
  const body = `<form class="form-card" data-reader-form="signin" data-next="${esc(next || '')}" novalidate>
  ${field('email', 'Email address', 'type="email" autocomplete="email" required maxlength="160"')}
  ${field('password', 'Password', 'type="password" autocomplete="current-password" required maxlength="200"')}
  <div class="form-row"><label class="check"><input type="checkbox" name="remember" checked> Keep me signed in</label><a href="/forgot-password">Forgot your password?</a></div>
  <button class="btn btn-gold btn-block" type="submit">Sign in</button>
  <p class="form-msg" role="alert" aria-live="polite"></p>
</form>
<p class="form-alt">New here? <a href="/join${next ? `?next=${encodeURIComponent(next)}` : ''}">Create a free account</a></p>`;
  return authShell(ctx, { active: 'signin', eyebrow: 'Welcome back', title: 'Sign in', lede: 'Continue your devotion journal where you left off.', body });
}

function forgot(ctx, { emailReady }) {
  const body = `${emailReady ? '' : `<div class="notice notice-warn"><strong>Password emails are not switched on for this site yet.</strong> Please <a href="/contact">contact us</a> and we will help you get back in.</div>`}
<form class="form-card" data-reader-form="forgot" novalidate>
  ${field('email', 'Email address on your account', 'type="email" autocomplete="email" required maxlength="160"', 'We will send a reset link to this address. It works with any email provider.')}
  <button class="btn btn-gold btn-block" type="submit"${emailReady ? '' : ' disabled'}>Send reset link</button>
  <p class="form-msg" role="alert" aria-live="polite"></p>
</form>
<p class="form-alt"><a href="/signin">Back to sign in</a></p>`;
  return authShell(ctx, { active: 'signin', eyebrow: 'Account help', title: 'Reset your password', lede: 'Enter your email and we will send you a link to choose a new password.', body });
}

function reset(ctx, { token, valid }) {
  const body = valid ? `<form class="form-card" data-reader-form="reset" data-token="${esc(token)}" novalidate>
  ${field('password', 'New password', 'type="password" autocomplete="new-password" required minlength="8" maxlength="200"', 'At least 8 characters, with a letter and a number.')}
  ${field('confirm', 'Confirm new password', 'type="password" autocomplete="new-password" required maxlength="200"')}
  <button class="btn btn-gold btn-block" type="submit">Save new password</button>
  <p class="form-msg" role="alert" aria-live="polite"></p>
</form>` : `<div class="notice notice-warn"><strong>This reset link is invalid or has expired.</strong> Links work once and last 60 minutes.</div><p class="form-alt"><a class="btn" href="/forgot-password">Request a new link</a></p>`;
  return authShell(ctx, { active: 'signin', eyebrow: 'Account help', title: 'Choose a new password', lede: 'Pick something you have not used elsewhere.', body });
}

function journal(ctx) {
  const body = `<section class="page-head"><div class="wrap"><p class="eyebrow">Private to you</p><h1>My journal</h1><p class="lede-dark" data-j-greeting>Your notes and progress, all in one place.</p></div></section>
<section class="section"><div class="wrap" data-journal><p class="empty">Loading your journal&hellip;</p></div></section>`;
  return layout(ctx, { title: 'My journal', description: 'Your private devotion notes and progress.', path: '/journal', active: 'journal', robots: 'noindex, nofollow', body });
}

/* ---------- contact & donate ---------- */
function contact(ctx) {
  const s = settings.getAll();
  const base = settings.baseUrl(ctx);
  const sent = ctx.query.sent;
  const body = `
<section class="page-head"><div class="wrap"><p class="eyebrow">Get in touch</p><h1>Contact</h1><p class="lede-dark">${esc(s.contact_intro)}</p></div></section>
<section class="section"><div class="wrap contact-grid">
  <div class="contact-side">
    ${s.contact_email ? `<div class="info-block"><h2>Email</h2><p><a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a></p></div>` : ''}
    <div class="info-block"><h2>What to write about</h2><ul><li>Questions about a reflection or passage</li><li>Prayer requests</li><li>Corrections or suggestions</li><li>Help with your account</li></ul></div>
    <div class="info-block"><h2>Privacy</h2><p>We only use your details to reply to you. Nothing you send here is published or shared.</p></div>
  </div>
  <div>
    ${sent === '1' ? '<div class="notice notice-ok" role="status"><strong>Thank you.</strong> Your message has been sent.</div>' : sent === '0' ? '<div class="notice notice-warn" role="alert">Your message could not be sent. Please check the form and try again.</div>' : ''}
    <form class="form-card" data-reader-form="contact" action="/contact" method="post" novalidate>
      <div class="form-two">${field('name', 'Your name', 'type="text" autocomplete="name" required maxlength="100"')}${field('email', 'Your email', 'type="email" autocomplete="email" required maxlength="200"')}</div>
      ${field('subject', 'Subject <span class="opt">(optional)</span>', 'type="text" maxlength="150"')}
      <div class="field"><label for="message">Message</label><textarea id="message" name="message" rows="8" required minlength="10" maxlength="5000"></textarea></div>
      ${hp}
      <button class="btn btn-gold" type="submit">Send message</button>
      <p class="form-msg" role="alert" aria-live="polite"></p>
    </form>
  </div>
</div></section>`;
  return layout(ctx, {
    title: 'Contact', description: `Contact ${s.site_title}: send a question, prayer request or message.`, path: '/contact', active: 'contact', body,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'ContactPage', name: `Contact ${s.site_title}`, url: base + '/contact' }],
  });
}

function donate(ctx, { methods }) {
  const s = settings.getAll();
  const uses = String(s.donate_use || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const card = (m) => `<article class="give-card">
  <h3>${esc(m.label)}</h3>
  ${m.note ? `<p class="give-note">${esc(m.note)}</p>` : ''}
  ${m.details ? `<pre class="give-details" tabindex="0">${esc(m.details)}</pre><button type="button" class="btn btn-sm" data-copy="${esc(m.details)}">${icon('link')} Copy details</button>` : ''}
  ${m.url ? `<a class="btn btn-gold" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">Give with ${esc(m.label)} ${icon('arrow')}</a>` : ''}
</article>`;
  const body = `
<section class="page-head"><div class="wrap"><p class="eyebrow">Support the work</p><h1>Give</h1><p class="lede-dark">${esc(s.donate_intro)}</p></div></section>
<section class="section"><div class="wrap give-layout">
  <aside class="verse-card verse-card-flat"><p class="verse-text">Every man according as he purposeth in his heart, so let him give; not grudgingly, or of necessity: for God loveth a cheerful giver.</p><p class="verse-ref">2 Corinthians 9:7</p></aside>
  <div>
    ${methods.length ? `<div class="give-grid">${methods.map(card).join('')}</div>` : `<div class="notice"><strong>Giving options are being set up.</strong> Please check back soon, or <a href="/contact">write to us</a> if you would like to help in another way.</div>`}
    ${uses.length ? `<div class="info-block give-use"><h2>Where your gift goes</h2><ul>${uses.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}
    <p class="fine">Giving is entirely voluntary. Reading and every other part of this site stay free. Questions about giving? <a href="/contact">Get in touch</a>.</p>
  </div>
</div></section>`;
  return layout(ctx, { title: 'Give', description: 'Support Breed a Life with a voluntary gift. Every reflection stays free to read.', path: '/donate', active: 'donate', body });
}

module.exports = { home, blog, post, gallery, videos, about, message, maintenance, join, signin, forgot, reset, journal, contact, donate };

