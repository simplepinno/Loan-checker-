# Loan Leverage Planner — local app

The project is separated into a browser frontend, a local HTTP backend, and a SQLite data layer:

- `Loan Leverage Planner.html` — existing planner UI and calculations
- `local-app.js` — history table, CSV export, notification panel, and frontend/API connection
- `server.py` — local web server and JSON API
- `database.py` — SQLite schema, persistence, audit log, and alert calculations
- `data/loan_planner.sqlite3` — created automatically when the server starts; your local data

## Run locally

Requires Python 3.9+; no extra packages are required.

1. Open a terminal in the project folder.
2. Start the server with `python server.py` (or `python3 server.py` / `py server.py`).
3. Open <http://127.0.0.1:8000/> in your browser. Keep the server running while using the app.

The server binds to this computer only. The SQLite database is created in `data/` and is not committed to the repository.

## History view

Use **Tracker → History** to see saved daily tracker snapshots in a sortable-by-date (newest first) table. It displays date, market value, cost basis, cash, installments paid, price return, an estimated result, and status. Search filters the records, and **Export CSV** downloads the matching rows. The app records the dated values you enter; it is not connected to a broker and does not import or verify executed orders. The estimated result uses the current plan assumptions and is for tracking only.

The existing Tracker form is where you add new dated records. Remove requires a second click for confirmation. Removed entries leave the active history; their previous content is retained in the SQLite change log.

## Notifications

The in-app panel checks for scheduled installments due within three days or overdue, loan maturity, and watch/stop thresholds based on the latest saved tracker record. It refreshes while the app is open. It cannot alert you while the app/browser is closed, and it is not a substitute for lender due-date information.

## Data, backup, and privacy

- Data stays on this computer and is stored in `data/loan_planner.sqlite3`; it is not encrypted.
- Back up the database file after stopping the server. Keep backups private.
- A standalone `file://` copy has separate browser storage; its old data will not automatically migrate to the local server.
- Google Fonts are optional; fallback fonts work when offline.
