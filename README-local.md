# Loan Leverage Planner — local app

The project separates the browser frontend, local HTTP backend, and SQLite data layer:

- `Loan Leverage Planner.html` — planner UI and calculations
- `local-app.js` — dedicated Trade history tab, filters, CSV and database backup tools, notifications, and API connection
- `server.py` — local web server and JSON API
- `database.py` — SQLite schema (including the `plans` and `security_trades` tables), persistence, audit log, and alert calculations
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

## Plan inputs

The Plan tab starts with **How much money do you have?** and a **2× / 2.5× / 3×** multiplier; the loan is your money times that multiplier. On **Price test**, type any projected growth percentage (positive or negative) instead of using the quick picks.

## Trades, securities and daily logs

- **+ New trade** (button at the top): save each buy or sell with date, security, quantity, price, amount and notes. Type the **total** your broker charged (paid on a buy, received on a sell) and the fee and its percentage are worked out and stored; leave it empty to estimate the fee from the plan. A sticky "Your plan" strip stays visible on this page, and the tab bar stays pinned too so you can jump to the Plan.
- **Profit/loss** is shown per security, per trade and in total (after fees, before loan interest). Buys show profit/loss at the latest known price; sells show realized profit/loss.
- **Tracker** tab: the daily log lists the securities you hold. Type each current price and market value, cost basis and cash fill in automatically (you can overwrite them). Each log has a notes box and keeps a snapshot of holdings and prices.
- **Trade history** tab: security trades (with total, fee, fee % and P/L) and daily logs, with search, date filters, CSV export and Remove buttons.
- **Notifications** box (above the tab bar): turns red, amber, green or blue with a dot and a count when something needs attention. Tap it to read the alerts. Alerts cover due or overdue installments, loan maturity, cash not covering an installment, negative cash, stop-loss and watch levels (overall and per security), loss past your limit, being in profit, expected gain reached, securities doing well, and stale prices.
- The tab bar scrolls sideways and stays pinned while you scroll the page.

## Multiple loan plans

- The **Loan plan** switcher at the top picks which plan you are working on. **+ New plan** starts a fresh plan with the same rate, term, fees and exit rules but no money, trades or logs. Plans can run together or one at a time; each has its own money, loan, trades, daily logs and alerts.
- A plan is named by its start date and expected payment completion date (start plus the term), for example `7 Nov 2026 → 6 Jan 2027`. Add an optional name on the Plan tab.
- **Close plan** (button next to the switcher, or from the Plans tab): enter the closing date and the money you ended with after selling everything and repaying the loan. The result is that minus your money in, and the plan is marked **Worked**, **Didn't work** or **Break-even**. A closed plan is locked, keeps its result and highlights, and can be reopened.
- When a plan is within 3 days of its end date (or past it) and in profit, the app asks whether to close it. "Not yet" hides the question until tomorrow.
- The **Plans** tab lists every plan with its status, result and highlights (best and weakest security, peak and lowest result, trades and fees, days run versus planned), plus totals across all plans. **Delete** removes a plan and its trades and logs from the app (they stay in the audit log).
- Notifications cover every open plan; with more than one open plan each alert names its plan.
- Existing data is moved into the first plan automatically.
