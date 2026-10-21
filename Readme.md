# Breed a Life

A full-stack Christian blog: public website, reader accounts for devotion notes, and an owner dashboard.
**No dependencies.** It runs on Node.js 22.13+ alone (no `npm install` needed).

## Run it
```
cp .env.example .env      # edit SITE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
npm start                 # or: node --disable-warning=ExperimentalWarning server.js
```
Site: http://localhost:3000   Dashboard: http://localhost:3000/admin (user `admin`).
If ADMIN_PASSWORD is empty, a random password is printed once in the console.

## What is included
- Public: home, reflections (blog), Pictures, Videos, About, Contact, Give, newsletter, RSS, sitemap, robots, JSON-LD and Open Graph SEO.
- Readers: reading never needs an account. An account is only for private devotion notes and progress (percent read, completed, day streaks). Notes can be **downloaded** (.txt, .md, PDF) and **shared** (device share sheet, WhatsApp, email, copy) from the notes panel and the journal. Sharing is always the reader's own action.
- Dashboard (`/admin`): overview with 30-day chart, posts editor (SEO preview, scheduling, cover), pictures and videos (upload your own files, YouTube optional, delete anything), messages inbox, readers, subscribers, giving options, settings, database browser/editor, read-only SQL console, backups, activity log.
- Contact page sends to cyrilchisom51@gmail.com (change under Settings > General) and always saves messages in the dashboard.

## Email, password resets
Readers and the owner can reset passwords with **any email they choose** (readers set it in their account, the owner under Dashboard > Settings > Account).
For emails to be sent, turn on email: Dashboard > Settings > Email (or SMTP_* values in `.env`).
Gmail: server `smtp.gmail.com`, SSL/TLS 465, your address as username, and a Google **App Password**.
Also set the real **Site address** (SITE_URL) so reset links point to your domain.
Without email, the owner reset link is printed in the server console, and you can run `npm run reset-password` on the server at any time.

## Giving
The Give page shows options you add in the dashboard (payment links from your own provider such as Paystack, Flutterwave, PayPal, Stripe, or bank details). The site does not process payments itself.

## Backups and deploying
- Back up `data/` (database) and `uploads/` (files). Dashboard > Database > Download backup gives the database.
- Run behind HTTPS (Caddy, Nginx or a host that provides it) and set `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `SITE_URL=https://…`.
- Keep `data/secret.key` private: it encrypts the saved mail password.
