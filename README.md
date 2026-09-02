# AutoParts Workshop Cloud 5.0

Hebrew RTL inventory and sales web application for a vehicle-parts workshop. The same account and data work from Windows, Android and any modern browser.

## What changed from the local HTML edition

- The visual HTML/CSS/JS files remain separate under `web/`.
- Browser `localStorage` is only a cache; Supabase is the authoritative store.
- Email/password sessions are handled by Supabase Auth.
- Every write uses an optimistic revision check, so an old phone cannot overwrite newer computer data.
- PostgreSQL Row Level Security isolates every account's workshop data.
- Daily, manual and pre-restore snapshots are retained in `workshop_backups`.
- JSON export/import and inventory-count CSV downloads remain available.

## One-time Supabase setup

1. Open Supabase Dashboard → **SQL Editor** → **New query**.
2. Paste all of `supabase/SUPABASE_SETUP.sql` and press **Run**.
3. After deployment, open **Authentication → URL Configuration** and set **Site URL** to the deployed HTTPS address.
4. Add the same address plus `/login.html` under **Redirect URLs**.
5. Open the site, choose “create first account”, confirm the email and sign in.

Never place a secret or `service_role` key in `web/js/cloud-config.js`. It accepts only the browser-safe publishable key.

## Local QA

```bash
npm run build
npm test
```

The output is a static, CDN-hostable site in `dist/`.
