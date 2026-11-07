# Loan Leverage Planner — local app

The project separates the browser frontend, local HTTP backend, and SQLite data layer:

- `Loan Leverage Planner.html` — planner UI and calculations
- `local-app.js` — dedicated Trade history tab, filters, CSV and database backup tools, notifications, and API connection
- `server.py` — local web server and JSON API
- `database.py` — SQLite schema, persistence, audit log, and alert calculations
- `data/loan_planner.sqlite3` — created automatically for local data (not committed)

## Run locally

Requires Python 3.9+; no extra packages are needed. From the project folder run `python server.py` (or `python3 server.py` / `py server.py`), then open <http://127.0.0.1:8000/>. Keep the server running while using the app. It binds to this computer only.

## Trade history

Open the **Trade history** tab to see tracker records newest first. Search values and set **From date** / **To date** to filter a date range. **Export CSV** exports the currently filtered records. The table shows dated tracker snapshots entered by you; the app is not connected to a broker and does not verify actual trade executions. Estimated results use current plan assumptions.

Use the existing **Tracker** tab to add dated records. Removed records leave active history but remain represented in the audit log.

## SQLite database backup and restore

- **Export database** downloads a complete SQLite backup as `loan_planner_backup.sqlite3`.
- **Import database** validates a backup and replaces the current local database. Import is destructive: it replaces all current settings/history/alerts. Export a backup first and select only a trusted backup file. The app reloads after a successful import.
- You can also back up `data/loan_planner.sqlite3` after stopping the server. Keep backup files private; database contents are not encrypted.

## Notifications and privacy

The in-app panel checks installments due within three days or overdue, loan maturity, and watch/stop thresholds based on the latest saved tracker record. It refreshes while the app is open but cannot notify while the app/browser is closed. Notifications are reminders, not verified lender due dates. A standalone `file://` HTML copy has separate browser storage and does not automatically migrate its data. Google Fonts are optional; fallback fonts work offline.
