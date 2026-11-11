# Invoice GoGo

A simple, installable (PWA) invoicing app for freelancers – invoices, estimates, clients, projects, items, expenses, cash flow and reports.
Plain HTML + CSS + vanilla JS, **no build step**. All data stays in your browser (`localStorage`, keys prefixed `igg_`).

Built for James Moriarty (freelance product photography & video, Cornwall) to work alongside the
[Sewing Studio Timesheet](https://sewing-studio-timesheet.netlify.app/): export the timesheet's *Backup JSON* or *CSV*, import it here, pick a date range and turn the hours into an invoice. Imported sessions are remembered so they are never invoiced twice.

## Run
Any static server works, e.g. `python3 -m http.server 8765` then open http://localhost:8765/ . Deploys as-is to Netlify (publish directory = repo root).

## Files
- `index.html`, `style.css`, `app.js` – the app (views, editor, print CSS)
- `logic.js` – pure logic (money in pennies, totals, numbering, overdue, timesheet JSON/CSV parsing) – unit tested in Node
- `sw.js`, `manifest.webmanifest`, `icon*.svg` – PWA. The PNG icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) are generated: `NODE_PATH=<dir with puppeteer-core> node tools/make-icons.js` (they are not in git because the push tool is text-only)
- `tests/logic.test.js` (`TZ=Europe/London node tests/logic.test.js`), `tests/e2e.js` (puppeteer-core + Chrome)
- `samples/` – example timesheet exports in the timesheet app's format

## Notes
- Overdue = a **sent**, unpaid invoice past its due date (drafts never go overdue).
- Income in reports is counted when an invoice is marked **paid** (cash basis). Not tax advice.
- "Download PDF" lazy-loads jsPDF + html2canvas from cdnjs; if offline it falls back to Print / Save as PDF.
- Invoice2go is a trademark of its owner; this project is independent and uses its own name and visuals.
