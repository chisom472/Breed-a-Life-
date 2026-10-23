'use strict';
const { all, run, tx } = require('./db');
const config = require('./config');

const DEFAULTS = {
  site_title: 'Breed a Life',
  tagline: 'Planting the Word. Watering it daily.',
  site_description: 'Breed a Life is a Christian devotional blog: Bible-rooted reflections on sin, grace and new life in Christ, with a gallery of faith illustrations and teaching videos.',
  site_keywords: 'Christian blog, Bible devotional, Genesis, fall of man, Adam and Eve, grace, obedience, KJV Bible study, Christian reflections',
  site_url: '',
  author_name: 'Breed a Life',
  contact_email: 'cyrilchisom51@gmail.com',
  hero_eyebrow: 'A devotional journal',
  hero_title: 'Plant the Word. Water it daily. God gives the growth.',
  hero_lede: 'Reflections on Scripture for the soul that wants less of self and more of God. Read slowly, take notes, and watch a life grow.',
  hero_verse: 'I have planted, Apollos watered; but God gave the increase.',
  hero_verse_ref: '1 Corinthians 3:6',
  about_html: '<p>Scripture describes a trade no one else could offer: Christ took what was ours (sin, shame, the wages of death) and gave what was His, righteousness and everlasting life.</p><p>Breed a Life exists to plant that truth and water it daily, one passage at a time, through writing, image and voice, until new life grows.</p>',
  footer_text: 'And the LORD shall guide thee continually, and thou shalt be like a watered garden.',
  footer_ref: 'Isaiah 58:11',
  social_x: '',
  social_facebook: '',
  social_youtube: '',
  social_instagram: '',
  posts_per_page: '9',
  maintenance_mode: '0',
  maintenance_message: 'We are making a few improvements. Please check back shortly.',
  enable_gallery: '1',
  enable_videos: '1',
  enable_newsletter: '1',
  enable_contact: '1',
  enable_donations: '1',
  enable_accounts: '1',
  contact_intro: 'Questions, prayer requests, corrections, or a word of encouragement? Write to us and we will reply as soon as we can.',
  donate_intro: 'Everything on this site is free to read, and it will stay that way. If these reflections have helped you, you are welcome to support the work with a gift of any size. Giving is entirely voluntary and never expected.',
  smtp_host: '',
  smtp_port: '465',
  smtp_secure: 'tls',
  smtp_user: '',
  smtp_from: '',
  donate_use: 'Hosting and domain costs\nTime for study, writing and editing\nProducing videos and illustrations',
  default_og_image_id: '',
};

// Settings that are safe to read by anonymous visitors are exposed through rendering only.
const EDITABLE = Object.keys(DEFAULTS);

let cached = null;
function getAll() {
  if (!cached) {
    const stored = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
    cached = { ...DEFAULTS, ...stored };
  }
  return cached;
}
function get(key) { return getAll()[key]; }
function flag(key) { return getAll()[key] === '1'; }
function invalidate() { cached = null; }
function setRaw(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value ?? ''));
  invalidate();
}

function update(values) {
  tx(() => {
    for (const [k, v] of Object.entries(values)) {
      if (!EDITABLE.includes(k)) continue;
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v ?? ''));
    }
  });
  invalidate();
}

function baseUrl(ctx) {
  const s = (get('site_url') || '').trim().replace(/\/+$/, '');
  if (s) return s;
  if (config.siteUrl) return config.siteUrl;
  const proto = ctx && ctx.proto ? ctx.proto : 'http';
  const host = ctx && ctx.req && ctx.req.headers.host ? ctx.req.headers.host : `localhost:${config.port}`;
  return `${proto}://${host}`;
}

module.exports = { DEFAULTS, EDITABLE, getAll, get, flag, update, setRaw, invalidate, baseUrl };
