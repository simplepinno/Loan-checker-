#!/usr/bin/env python3
"""Serve the Loan Leverage Planner locally with SQLite-backed history and alerts."""

from __future__ import annotations

import json
import mimetypes
import sqlite3
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
APP_HTML = ROOT / "Loan Leverage Planner.html"
DB_PATH = ROOT / "loan_planner.sqlite3"
HOST = "127.0.0.1"
PORT = 8000
MAX_BODY = 1_000_000


def connect():
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def initialize_db():
    with connect() as db:
        db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS trade_history (
                id TEXT PRIMARY KEY,
                trade_date TEXT NOT NULL,
                market_value REAL NOT NULL,
                cost_basis REAL NOT NULL,
                cash REAL NOT NULL,
                installments_paid INTEGER NOT NULL DEFAULT 0,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_trade_history_date
                ON trade_history(trade_date DESC, created_at DESC);
            CREATE TABLE IF NOT EXISTS change_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                changed_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notifications (
                alert_key TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                severity TEXT NOT NULL,
                due_date TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                dismissed INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
        """)


def iso_now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def safe_number(value, default=0):
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else default
    except (TypeError, ValueError):
        return default


def valid_date(value):
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def load_state(db):
    row = db.execute("SELECT payload FROM app_settings WHERE id = 1").fetchone()
    params = json.loads(row["payload"]) if row else None
    entries = [json.loads(row["payload"]) for row in db.execute(
        "SELECT payload FROM trade_history ORDER BY trade_date DESC, created_at DESC"
    )]
    return {"params": params, "entries": entries} if params is not None or entries else None


def save_state(state):
    if not isinstance(state, dict):
        raise ValueError("Expected an object containing params and entries.")
    params = state.get("params")
    entries = state.get("entries", [])
    if not isinstance(params, dict) or not isinstance(entries, list):
        raise ValueError("Expected params to be an object and entries to be a list.")
    if len(entries) > 5000:
        raise ValueError("A maximum of 5,000 history entries is supported.")

    now = iso_now()
    params_json = json.dumps(params, separators=(",", ":"), sort_keys=True)
    with connect() as db:
        old = db.execute("SELECT payload FROM app_settings WHERE id = 1").fetchone()
        if not old or old["payload"] != params_json:
            db.execute("INSERT INTO app_settings(id,payload,updated_at) VALUES(1,?,?) "
                       "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
                       (params_json, now))
            db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('settings','1',?,?)",
                       (params_json, now))

        valid_ids = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            entry_id = str(entry.get("id") or "")
            trade_date = valid_date(entry.get("date"))
            if not entry_id or not trade_date:
                continue
            entry = dict(entry)
            entry["id"] = entry_id
            payload = json.dumps(entry, separators=(",", ":"), sort_keys=True)
            old = db.execute("SELECT payload,created_at FROM trade_history WHERE id=?", (entry_id,)).fetchone()
            created_at = old["created_at"] if old else now
            if not old or old["payload"] != payload:
                db.execute("""INSERT INTO trade_history
                    (id,trade_date,market_value,cost_basis,cash,installments_paid,payload,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                    trade_date=excluded.trade_date,market_value=excluded.market_value,
                    cost_basis=excluded.cost_basis,cash=excluded.cash,
                    installments_paid=excluded.installments_paid,payload=excluded.payload,
                    updated_at=excluded.updated_at""",
                    (entry_id, trade_date.isoformat(), safe_number(entry.get("value")),
                     safe_number(entry.get("basis")), safe_number(entry.get("cash")),
                     max(0, min(3, int(safe_number(entry.get("paid")))), payload, created_at, now))
                db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('trade',?,?,?)",
                           (entry_id, payload, now))
            valid_ids.add(entry_id)

        # Keep deleted entries in the audit log, but remove them from the active history.
        existing = db.execute("SELECT id FROM trade_history").fetchall()
        removed = [r["id"] for r in existing if r["id"] not in valid_ids]
        for entry_id in removed:
            old = db.execute("SELECT payload FROM trade_history WHERE id=?", (entry_id,)).fetchone()
            db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('trade_deleted',?,?,?)",
                       (entry_id, old["payload"], now))
            db.execute("DELETE FROM trade_history WHERE id=?", (entry_id,))
        refresh_notifications(db, params)


def current_alerts(db, params):
    alerts = []
    today = date.today()
    if not params:
        return alerts

    loan = max(0, safe_number(params.get("loan")))
    rate = max(0, safe_number(params.get("rate"))) / 100
    months = max(1, min(3, int(safe_number(params.get("months"), 1))))
    start = valid_date(params.get("start"))
    entries = [json.loads(r["payload"]) for r in db.execute(
        "SELECT payload FROM trade_history ORDER BY trade_date DESC, created_at DESC"
    )]
    latest = entries[0] if entries else None
    paid = max(0, min(months, int(safe_number(latest.get("paid"))))) if latest else 0

    if start:
        installment = loan * (1 + rate) / months
        for number in range(paid + 1, months + 1):
            due = start + timedelta(days=30 * number)
            days = (due - today).days
            if days <= 3:
                when = "overdue" if days < 0 else ("due today" if days == 0 else f"due in {days} day(s)")
                alerts.append({"key": f"installment-{number}-{due.isoformat()}",
                    "title": f"Installment {number} of {months} {when}",
                    "message": f"Scheduled amount: {installment:,.2f}. Record the payment in Tracker after paying.",
                    "severity": "danger" if days < 0 else "warning", "due_date": due.isoformat()})

        maturity = start + timedelta(days=30 * months)
        if today >= maturity and paid < months:
            alerts.append({"key": f"maturity-{maturity.isoformat()}", "title": "Loan term has ended",
                "message": f"The planned maturity date was {maturity.isoformat()}. Check the outstanding balance and record payments.",
                "severity": "danger", "due_date": maturity.isoformat()})

    if latest:
        value = safe_number(latest.get("value"))
        basis = safe_number(latest.get("basis"))
        change = (value / basis - 1) * 100 if basis > 0 else None
        stop = max(0, safe_number(params.get("stop")))
        watch = max(0, safe_number(params.get("watch")))
        if change is not None and change <= -stop:
            alerts.append({"key": f"stop-{latest.get('id')}", "title": "Stop-loss threshold reached",
                "message": f"Latest recorded price change is {change:.1f}% versus the {stop:.1f}% stop-loss setting. Review your plan.",
                "severity": "danger", "due_date": None})
        elif change is not None and change <= -watch:
            alerts.append({"key": f"watch-{latest.get('id')}", "title": "Watch threshold reached",
                "message": f"Latest recorded price change is {change:.1f}% versus the {watch:.1f}% watch setting.",
                "severity": "warning", "due_date": None})
    return alerts


def refresh_notifications(db, params):
    now = iso_now()
    alerts = current_alerts(db, params)
    db.execute("UPDATE notifications SET active=0, updated_at=?", (now,))
    for alert in alerts:
        db.execute("""INSERT INTO notifications
            (alert_key,title,message,severity,due_date,active,dismissed,updated_at)
            VALUES(?,?,?,?,?,1,0,?) ON CONFLICT(alert_key) DO UPDATE SET
            title=excluded.title,message=excluded.message,severity=excluded.severity,
            due_date=excluded.due_date,active=1,updated_at=excluded.updated_at""",
            (alert["key"], alert["title"], alert["message"], alert["severity"], alert["due_date"], now))


class Handler(BaseHTTPRequestHandler):
    server_version = "LoanPlannerLocal/1.0"

    def send_json(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > MAX_BODY:
            raise ValueError("Request is too large.")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            with connect() as db:
                return self.send_json(200, {"state": load_state(db)})
        if path == "/api/alerts":
            with connect() as db:
                row = db.execute("SELECT payload FROM app_settings WHERE id=1").fetchone()
                params = json.loads(row["payload"]) if row else None
                refresh_notifications(db, params)
                rows = db.execute("SELECT alert_key,title,message,severity,due_date FROM notifications "
                                  "WHERE active=1 AND dismissed=0 ORDER BY "
                                  "CASE severity WHEN 'danger' THEN 0 ELSE 1 END,due_date").fetchall()
                return self.send_json(200, {"alerts": [dict(r) for r in rows]})
        if path == "/" or path == "/index.html":
            if not APP_HTML.exists():
                return self.send_error(404, "Planner HTML file not found")
            html = APP_HTML.read_text(encoding="utf-8")
            marker = "<script>\n/*CORE-START*/"
            if marker not in html:
                return self.send_error(500, "Could not locate the planner script insertion point")
            html = html.replace(marker, '<script src="/local-app.js"></script>\n' + marker, 1)
            data = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return self.wfile.write(data)
        if path == "/local-app.js":
            return self.serve_file(ROOT / "local-app.js", "application/javascript; charset=utf-8")
        return self.send_error(404)

    def serve_file(self, file_path, content_type=None):
        if not file_path.is_file() or file_path.parent != ROOT:
            return self.send_error(404)
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type or mimetypes.guess_type(file_path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
            if path == "/api/state":
                save_state(body)
                return self.send_json(200, {"ok": True})
            if path == "/api/alerts/dismiss":
                key = str(body.get("key", ""))
                if not key:
                    return self.send_json(400, {"error": "An alert key is required."})
                with connect() as db:
                    db.execute("UPDATE notifications SET dismissed=1 WHERE alert_key=?", (key,))
                return self.send_json(200, {"ok": True})
            return self.send_error(404)
        except (ValueError, json.JSONDecodeError) as error:
            return self.send_json(400, {"error": str(error)})
        except Exception as error:
            print(f"Request failed: {error}")
            return self.send_json(500, {"error": "Local database operation failed."})

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")


def main():
    initialize_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Loan Leverage Planner running at http://{HOST}:{PORT}/")
    print(f"SQLite database: {DB_PATH}")
    print("Press Ctrl+C to stop. The app is bound to this computer only.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
