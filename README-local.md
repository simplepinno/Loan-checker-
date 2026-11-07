# Loan Leverage Planner — local SQLite version

This adds a small local server and SQLite database to the existing single-file planner. It keeps the current planner UI and tracker, while storing settings and tracker history on your computer. The tracker entries are the app's dated records of market value, cost basis, cash, and installments paid.

## Run it

1. Install Python 3.9 or newer (no third-party packages are needed).
2. Put `server.py`, `local-app.js`, and `Loan Leverage Planner.html` in the same folder (or clone/download this repository).
3. Open a terminal in that folder and run:

   ```bash
   python server.py
   ```

   On some systems, use `python3 server.py` or `py server.py`.
4. Open <http://127.0.0.1:8000/> in your browser. Keep the terminal/server running while using the app.

The SQLite file `loan_planner.sqlite3` is created in the same folder. It contains current settings, dated tracker history, a change log, and notification state. Use the existing **Tracker** tab to add and review past dated entries; the existing **Remove** action removes an entry from active history but its prior version remains in the change log.

## In-app notifications

The notification panel appears above the planner tabs. It checks for loan installments due within three days or overdue, loan maturity, and the watch/stop thresholds based on the latest tracker entry. Notifications refresh while the app is open and can be dismissed. This is intentionally in-app only: it does not notify you while the app/browser is closed, and it is not a substitute for checking your lender's actual due dates or account.

## Data and privacy

- The server binds to `127.0.0.1` only; it is not exposed to your network by default.
- The database is local to this computer and is not encrypted. Protect the file and make backups if you need them.
- Copy `loan_planner.sqlite3` (and its `-wal`/`-shm` files, if present, after stopping the server) to back up your data.
- Data previously stored by a `file://` copy of the HTML is isolated by the browser from `http://127.0.0.1`; it will not automatically migrate. The first run starts with the planner's defaults unless there is already local browser state for the server origin.
- Google Fonts remain an optional internet resource; the planner's fallback fonts work without them.
