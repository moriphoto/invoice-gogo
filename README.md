# Invoice GoGo

A simple, installable (PWA) invoicing app for freelancers – invoices, estimates, clients, projects, items, expenses, cash flow and reports.
Vanilla HTML + CSS + JS, **no build step** for the app. v2 adds a PIN lock, cloud sync (Netlify Functions + Netlify Blobs), email-from-Gmail and save-to-Google-Drive.

Built for James Moriarty (freelance product photography & video, Cornwall) to work alongside the
[Sewing Studio Timesheet](https://sewing-studio-timesheet.netlify.app/): export the timesheet's *Backup JSON* or *CSV*, import it here, pick a date range and turn the hours into an invoice. Imported sessions are remembered so they are never invoiced twice.

## How it fits together
- **Browser** keeps a local copy (`localStorage` keys `igg_*`, images in IndexedDB) so it works offline, and syncs it to the server: on load, ~1.5 s after each change, every 45 s, and when the device comes back online. Per-record `updatedAt`, last write wins; deletions are tombstones. Top-bar pill: *Synced / Syncing / Offline · n waiting / Sync problem / Locked*.
- **Server** = one Netlify Function (`netlify/functions/api.mjs`, logic in `netlify/lib/handler.mjs`) under `/api/*`, storing everything in Netlify Blobs (`igg-data`: one blob per collection; `igg-img`: one blob per logo/receipt image; `igg-auth`: PIN hash, signing key, rate-limit counters).
- **Lock**: first visit creates the PIN (salted scrypt hash only). `POST /api/login` returns an HMAC-signed 30-day token; every other route needs it. Failed attempts are rate-limited per IP (5 → 15 min, doubling) with a global brake. Changing the PIN signs every other device out.
- **Gmail / Drive** run entirely in the browser with Google Identity Services (token model) and the Gmail/Drive REST APIs – tokens are never sent to our server. Scopes: `gmail.send`, `drive.file`.
- **PDFs** are drawn directly with jsPDF (vendored in `vendor/`), so they have selectable text and are small enough to email.

## Configuration (Netlify environment variables – all optional)
| Variable | Purpose |
|---|---|
| `IGG_SECRET` | Token-signing key (≥ 32 chars, mark as secret). If unset, a random key is generated once and stored in the private `igg-auth` blob store. Changing it signs all devices out. |
| `IGG_SETUP_CODE` / `IGG_SETUP_CODE_HASH` | If set, creating the *first* PIN also needs this code (stops a stranger claiming a fresh install). `…_HASH` is a scrypt hash made with `hashPin()` in `netlify/lib/handler.mjs`; `netlify/lib/setup-code.mjs` can carry it at deploy time (the committed copy is empty). |
| `IGG_PIN_HASH` | Fix the PIN from the environment instead of the first-run screen. |

Forgot the PIN? In the Netlify UI open *Blobs → igg-auth* and delete the `pin` entry (keep `secret`), then create a new PIN on the sign-in screen.

## Google setup (one-time, ~5 minutes, free)
1. <https://console.cloud.google.com> → project picker → **New project** (“Invoice GoGo”).
2. **APIs & Services → Library**: enable **Gmail API** and **Google Drive API**.
3. **OAuth consent screen / Google Auth Platform**: User type **External**, app name “Invoice GoGo”, your Gmail as support + developer email. Leave publishing status **Testing**. **Audience → Test users → Add users**: add your own Gmail address.
4. **Credentials → Create credentials → OAuth client ID → Web application**. *Authorised JavaScript origins*: `https://invoice-gogo.netlify.app` (no trailing slash, no redirect URIs). Create and copy the **Client ID**.
5. In the app: **Settings → Integrations → Google OAuth Client ID**, paste, **Connect Google**. Choose your account; on “Google hasn't verified this app” click **Advanced → Go to Invoice GoGo** and tick both permissions.

In *Testing* mode Google makes you re-approve about every 7 days. The Client ID is not a secret.

## Develop / test
```
npm install                       # only needed for the Netlify Functions dependency (@netlify/blobs)
node tools/dev-server.mjs 8765    # static app + the real API handler on an in-memory blob store
node tests/server.test.mjs        # API unit tests (auth, rate limit, sync, images)
TZ=Europe/London node tests/logic.test.js
NODE_PATH=<dir with puppeteer-core> TZ=Europe/London node tests/e2e.js         # UI flows
NODE_PATH=<dir with puppeteer-core> TZ=Europe/London node tests/cloud.e2e.js   # lock, 2-device sync, offline, migration, Gmail/Drive (canned Google responses), PDFs
tools/make-deploy-dir.sh /tmp/igg-deploy   # clean deploy folder (no tests / node_modules / secrets)
```
The Google tests use a fake `window.google` and request interception with canned responses as a *test harness*; the app itself never fakes success.

## Files
- `index.html`, `style.css`, `app.js` – the app; `logic.js` – pure logic (money in pennies, totals, numbering, MIME builder, timesheet parsing); `pdf.js` – PDF drawing
- `netlify/functions/api.mjs`, `netlify/lib/handler.mjs` – API; `netlify.toml`
- `sw.js`, `manifest.webmanifest`, `icon*.svg` – PWA (the service worker never caches `/api/`). PNG icons are generated with `tools/make-icons.js` and are not in git (the push tool is text-only).
- `tests/`, `tools/`, `samples/` – tests, dev server, example timesheet exports

## Notes
- Overdue = a **sent**, unpaid invoice past its due date (drafts never go overdue). Income in reports is counted when an invoice is marked **paid** (cash basis). Not tax advice.
- Invoice numbers are allocated locally; two devices creating invoices *while both offline* can end up with the same number – check numbering after working offline on two devices.
- Invoice2go is a trademark of its owner; this project is independent and uses its own name and visuals.
