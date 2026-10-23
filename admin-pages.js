'use strict';
const path = require('path');
const config = require('../config');
const auth = require('../auth');
const { HttpError, redirect, sendFile, sendFromDir } = require('../http');

module.exports = function register(router) {
  const noindex = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
  const page = (ctx, file) => sendFile(ctx, path.join(config.adminDir, file), { cache: 'no-store', headers: noindex });
  const signedIn = (ctx) => !!auth.userFromToken(ctx.cookies[auth.COOKIE]);

  router.get('/admin', (ctx) => (signedIn(ctx) ? page(ctx, 'index.html') : redirect(ctx, '/admin/login')));
  router.get('/admin/login', (ctx) => (signedIn(ctx) ? redirect(ctx, '/admin') : page(ctx, 'login.html')));
  // Reset pages carry a secret token in the URL, so they must never leak it through the Referer header.
  const resetPage = (ctx, file) => sendFile(ctx, path.join(config.adminDir, file), { cache: 'no-store', headers: { ...noindex, 'Referrer-Policy': 'no-referrer' } });
  router.get('/admin/forgot', (ctx) => resetPage(ctx, 'forgot.html'));
  router.get('/admin/reset', (ctx) => resetPage(ctx, 'reset.html'));
  router.get('/admin/static/:dir/:file', (ctx) => {
    if (!['css', 'js'].includes(ctx.params.dir)) throw new HttpError(404, 'Not found.');
    return sendFromDir(ctx, config.adminDir, `${ctx.params.dir}/${ctx.params.file}`, { cache: 'no-cache', headers: noindex });
  });
};
