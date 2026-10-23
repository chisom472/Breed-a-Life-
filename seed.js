'use strict';
// First-run seeding. Runs once: deleting seeded content later will never bring it back.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { get, run, tx, logActivity } = require('./db');
const settings = require('./settings');
const { randomHex, nowIso, truncate, stripHtml } = require('./util');

const VIDEOS = [
  { embed_id: 'MzRrOGqr_a0', title: 'Adam in the Garden of Eden: Genesis 2:1-17', description: 'A verse-by-verse study of Adam’s creation and his place in Eden, setting the scene before the Fall.' },
  { embed_id: 'xagGhgXcAmA', title: 'The Fall of Man (Part 1): Genesis 3:1-13', description: 'How sin often looks desirable, and what the serpent’s temptation teaches us about our own.' },
  { embed_id: 'et-vCpWWdQU', title: 'Adam and Eve: The Full Story', description: 'The complete account of the Garden, the serpent and the Fall, the first story in the Bible and the one that changes everything after it.' },
];

function seedContent() {
  const flagged = get("SELECT value FROM settings WHERE key = 'seeded_v1'");
  if (flagged) return;
  const anyContent = get('SELECT (SELECT COUNT(*) FROM posts) + (SELECT COUNT(*) FROM media) AS c').c;
  if (anyContent > 0) { run("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded_v1', '1')"); return; }

  const stamp = Date.parse('2026-07-28T09:00:00Z');
  const imageIds = [];

  tx(() => {
    const index = JSON.parse(fs.readFileSync(path.join(config.seedDir, 'images', 'index.json'), 'utf8'));
    index.forEach((item, i) => {
      const src = path.join(config.seedDir, 'images', item.file);
      const filename = randomHex(12) + '.svg';
      fs.copyFileSync(src, path.join(config.uploadDir, filename));
      const r = run(
        `INSERT INTO media (kind, source, filename, original_name, mime, size, title, alt, description, visible, created_at)
         VALUES ('image','upload',?,?,?,?,?,?,?,1,?)`,
        filename, item.file, 'image/svg+xml', fs.statSync(src).size, item.title, item.title + ' (illustration)', item.description,
        new Date(stamp + (index.length - i) * 1000).toISOString());
      imageIds.push(Number(r.lastInsertRowid));
    });

    VIDEOS.forEach((v, i) => {
      run(
        `INSERT INTO media (kind, source, embed_id, original_name, size, title, description, visible, created_at)
         VALUES ('video','embed',?,?,0,?,?,1,?)`,
        v.embed_id, 'youtube:' + v.embed_id, v.title, v.description, new Date(stamp + (VIDEOS.length - i) * 1000).toISOString());
    });

    const content = fs.readFileSync(path.join(config.seedDir, 'post-independence.html'), 'utf8');
    const excerpt = 'Man’s oldest temptation is not a fruit but a promise: freedom from God’s sovereignty. A walk through Genesis 3, from the serpent’s question to the coats of skin God Himself provided, and what it still means for us today.';
    run(
      `INSERT INTO posts (title, slug, excerpt, content, cover_id, category, tags, status, featured, seo_title, seo_description, views, published_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
      'Independence From God Has Never Turned Out Good For Man', 'independence-from-god-has-never-turned-out-good-for-man',
      excerpt, content, imageIds[0], 'Genesis', 'Genesis,Fall of Man,Sin and Grace,Obedience,Adam and Eve', 'published', 1,
      'Independence From God Has Never Turned Out Good For Man | Genesis 3 Devotional',
      truncate(stripHtml(excerpt), 158),
      new Date(stamp).toISOString(), new Date(stamp).toISOString(), nowIso());

    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded_v1', '1')");
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('default_og_image_id', ?)", String(imageIds[0]));
  });
  settings.invalidate();
  logActivity('system', 'seed', 'Imported the original post, 6 illustrations and 3 videos');
}

module.exports = { seedContent };
