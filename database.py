"""SQLite persistence, tracker history, audit log, and local alerts."""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "loan_planner.sqlite3"


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def initialize_db():
    with connect() as db:
        db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS trade_history (
                id TEXT PRIMARY KEY, trade_date TEXT NOT NULL, market_value REAL NOT NULL,
                cost_basis REAL NOT NULL, cash REAL NOT NULL, installments_paid INTEGER NOT NULL DEFAULT 0,
                payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_trade_history_date
                ON trade_history(trade_date DESC, created_at DESC);
            CREATE TABLE IF NOT EXISTS change_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
                payload TEXT NOT NULL, changed_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notifications (
                alert_key TEXT PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL,
                severity TEXT NOT NULL, due_date TEXT, active INTEGER NOT NULL DEFAULT 1,
                dismissed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
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
    row = db.execute("SELECT payload FROM app_settings WHERE id=1").fetchone()
    params = json.loads(row["payload"]) if row else None
    entries = [json.loads(row["payload"]) for row in db.execute(
        "SELECT payload FROM trade_history ORDER BY trade_date DESC,created_at DESC"
    )]
    return {"params": params, "entries": entries} if params is not None or entries else None


def save_state(state):
    if not isinstance(state, dict):
        raise ValueError("Expected an object containing params and entries.")
    params, entries = state.get("params"), state.get("entries", [])
    if not isinstance(params, dict) or not isinstance(entries, list):
        raise ValueError("Expected params to be an object and entries to be a list.")
    if len(entries) > 5000:
        raise ValueError("A maximum of 5,000 history entries is supported.")

    now = iso_now()
    params_json = json.dumps(params, separators=(",", ":"), sort_keys=True)
    with connect() as db:
        old = db.execute("SELECT payload FROM app_settings WHERE id=1").fetchone()
        if not old or old["payload"] != params_json:
            db.execute("""INSERT INTO app_settings(id,payload,updated_at) VALUES(1,?,?)
                ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at""",
                (params_json, now))
            db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('settings','1',?,?)",
                       (params_json, now))

        valid_ids = set()
        for original in entries:
            if not isinstance(original, dict):
                continue
            entry = dict(original)
            entry_id = str(entry.get("id") or "")
            trade_date = valid_date(entry.get("date"))
            if not entry_id or not trade_date:
                continue
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
                     max(0, min(3, int(safe_number(entry.get("paid"))))), payload, created_at, now))
                db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('trade',?,?,?)",
                           (entry_id, payload, now))
            valid_ids.add(entry_id)

        # Keep deleted entries in the audit log, but remove from the active history.
        existing = db.execute("SELECT id FROM trade_history").fetchall()
        for row in existing:
            if row["id"] not in valid_ids:
                old = db.execute("SELECT payload FROM trade_history WHERE id=?", (row["id"],)).fetchone()
                db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('trade_deleted',?,?,?)",
                           (row["id"], old["payload"], now))
                db.execute("DELETE FROM trade_history WHERE id=?", (row["id"],))
        refresh_notifications(db, params)


def current_alerts(db, params):
    alerts = []
    if not params:
        return alerts
    today = date.today()
    loan = max(0, safe_number(params.get("loan")))
    rate = max(0, safe_number(params.get("rate"))) / 100
    months = max(1, min(3, int(safe_number(params.get("months"), 1))))
    start = valid_date(params.get("start"))
    entries = [json.loads(row["payload"]) for row in db.execute(
        "SELECT payload FROM trade_history ORDER BY trade_date DESC,created_at DESC"
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
                    "message": f"Scheduled amount: {installment:,.2f}. Record payment in Tracker after paying.",
                    "severity": "danger" if days < 0 else "warning", "due_date": due.isoformat()})
        maturity = start + timedelta(days=30 * months)
        if today >= maturity and paid < months:
            alerts.append({"key": f"maturity-{maturity.isoformat()}", "title": "Loan term has ended",
                "message": f"The planned maturity date was {maturity.isoformat()}. Check the outstanding balance and record payments.",
                "severity": "danger", "due_date": maturity.isoformat()})

    if latest:
        value, basis = safe_number(latest.get("value")), safe_number(latest.get("basis"))
        change = (value / basis - 1) * 100 if basis > 0 else None
        stop, watch = max(0, safe_number(params.get("stop"))), max(0, safe_number(params.get("watch")))
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
    db.execute("UPDATE notifications SET active=0,updated_at=?", (now,))
    for alert in current_alerts(db, params):
        db.execute("""INSERT INTO notifications
            (alert_key,title,message,severity,due_date,active,dismissed,updated_at)
            VALUES(?,?,?,?,?,1,0,?) ON CONFLICT(alert_key) DO UPDATE SET
            title=excluded.title,message=excluded.message,severity=excluded.severity,
            due_date=excluded.due_date,active=1,updated_at=excluded.updated_at""",
            (alert["key"], alert["title"], alert["message"], alert["severity"], alert["due_date"], now))
