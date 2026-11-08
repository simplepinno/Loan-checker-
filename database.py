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


def _initialize_base():
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
            CREATE TABLE IF NOT EXISTS security_trades (
                id TEXT PRIMARY KEY, trade_date TEXT NOT NULL, security TEXT NOT NULL, side TEXT NOT NULL,
                payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_security_trades_date
                ON security_trades(trade_date DESC, created_at DESC);
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


def initialize_db():
    """Create tables, add plan support, and move a single-plan database into plan 'p1'."""
    _initialize_base()
    with connect() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS plans (
                id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', params TEXT NOT NULL, closed TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
        for table in ("trade_history", "security_trades"):
            columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
            if "plan_id" not in columns:
                db.execute(f"ALTER TABLE {table} ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'p1'")
        db.execute("CREATE INDEX IF NOT EXISTS idx_history_plan ON trade_history(plan_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_trades_plan ON security_trades(plan_id)")
        if not db.execute("SELECT 1 FROM plans LIMIT 1").fetchone():
            old = db.execute("SELECT payload FROM app_settings WHERE id=1").fetchone()
            if old:
                now = iso_now()
                db.execute("INSERT INTO plans(id,label,params,closed,sort_order,created_at,updated_at) VALUES('p1','',?,NULL,0,?,?)",
                           (old["payload"], now, now))
                db.execute("INSERT OR REPLACE INTO app_meta(key,value) VALUES('active_plan','p1')")


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
    rows = db.execute("SELECT id,label,params,closed FROM plans ORDER BY sort_order,created_at").fetchall()
    if not rows:
        return None
    plans = []
    for row in rows:
        entries = [json.loads(r["payload"]) for r in db.execute(
            "SELECT payload FROM trade_history WHERE plan_id=? ORDER BY trade_date DESC,created_at DESC", (row["id"],))]
        trades = [json.loads(r["payload"]) for r in db.execute(
            "SELECT payload FROM security_trades WHERE plan_id=? ORDER BY trade_date DESC,created_at DESC", (row["id"],))]
        plans.append({"id": row["id"], "label": row["label"], "params": json.loads(row["params"]),
                      "closed": json.loads(row["closed"]) if row["closed"] else None,
                      "entries": entries, "trades": trades})
    meta = db.execute("SELECT value FROM app_meta WHERE key='active_plan'").fetchone()
    active = meta["value"] if meta and any(p["id"] == meta["value"] for p in plans) else plans[0]["id"]
    return {"v": 2, "activeId": active, "plans": plans}


def save_state(state):
    if not isinstance(state, dict):
        raise ValueError("Expected an object containing plans.")
    if "plans" not in state:  # older single-plan payload
        params = state.get("params")
        if not isinstance(params, dict):
            raise ValueError("Expected params to be an object.")
        state = {"activeId": "p1", "plans": [{"id": "p1", "label": "", "params": params, "closed": None,
                                              "entries": state.get("entries", []), "trades": state.get("trades", [])}]}
    plans = state.get("plans")
    if not isinstance(plans, list) or not plans:
        raise ValueError("Expected a list of plans.")
    if len(plans) > 200:
        raise ValueError("A maximum of 200 plans is supported.")
    for plan in plans:
        if not isinstance(plan, dict) or not isinstance(plan.get("params"), dict):
            raise ValueError("Each plan needs an id and params.")
        if not isinstance(plan.get("entries", []), list) or not isinstance(plan.get("trades", []), list):
            raise ValueError("Plan entries and trades must be lists.")
        if len(plan.get("entries", [])) > 5000 or len(plan.get("trades", [])) > 5000:
            raise ValueError("A maximum of 5,000 entries and 5,000 trades per plan is supported.")

    now = iso_now()
    with connect() as db:
        plan_ids, entry_ids, trade_ids = set(), set(), set()
        for order, plan in enumerate(plans):
            plan_id = str(plan.get("id") or "").strip()[:60]
            if not plan_id:
                continue
            plan_ids.add(plan_id)
            label = str(plan.get("label") or "")[:80]
            params_json = json.dumps(plan["params"], separators=(",", ":"), sort_keys=True)
            closed = plan.get("closed")
            closed_json = json.dumps(closed, separators=(",", ":"), sort_keys=True) if isinstance(closed, dict) else None
            old = db.execute("SELECT label,params,closed FROM plans WHERE id=?", (plan_id,)).fetchone()
            if not old:
                db.execute("INSERT INTO plans(id,label,params,closed,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                           (plan_id, label, params_json, closed_json, order, now, now))
            elif (old["label"], old["params"], old["closed"]) != (label, params_json, closed_json):
                db.execute("UPDATE plans SET label=?,params=?,closed=?,sort_order=?,updated_at=? WHERE id=?",
                           (label, params_json, closed_json, order, now, plan_id))
            else:
                db.execute("UPDATE plans SET sort_order=? WHERE id=?", (order, plan_id))
            if not old or (old["label"], old["params"], old["closed"]) != (label, params_json, closed_json):
                db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('plan',?,?,?)",
                           (plan_id, json.dumps({"label": label, "params": plan["params"], "closed": closed}, separators=(",", ":")), now))
            sync_entries(db, plan_id, plan.get("entries", []), now, entry_ids)
            sync_trades(db, plan_id, plan.get("trades", []), now, trade_ids)

        # Deleted items stay in the audit log but leave the active tables.
        for row in db.execute("SELECT id,payload FROM trade_history").fetchall():
            if row["id"] not in entry_ids:
                db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('trade_deleted',?,?,?)",
                           (row["id"], row["payload"], now))
                db.execute("DELETE FROM trade_history WHERE id=?", (row["id"],))
        for row in db.execute("SELECT id,payload FROM security_trades").fetchall():
            if row["id"] not in trade_ids:
                db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('security_trade_deleted',?,?,?)",
                           (row["id"], row["payload"], now))
                db.execute("DELETE FROM security_trades WHERE id=?", (row["id"],))
        for row in db.execute("SELECT id,params,closed,label FROM plans").fetchall():
            if row["id"] not in plan_ids:
                db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('plan_deleted',?,?,?)",
                           (row["id"], json.dumps({"label": row["label"], "params": row["params"], "closed": row["closed"]}), now))
                db.execute("DELETE FROM plans WHERE id=?", (row["id"],))
        active = str(state.get("activeId") or "")
        if active not in plan_ids:
            active = next(iter(plan_ids), "")
        db.execute("INSERT OR REPLACE INTO app_meta(key,value) VALUES('active_plan',?)", (active,))
        refresh_notifications(db)


def sync_entries(db, plan_id, entries, now, valid_ids):
    """Store a plan's dated daily logs."""
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
        old = db.execute("SELECT payload,created_at,plan_id FROM trade_history WHERE id=?", (entry_id,)).fetchone()
        created_at = old["created_at"] if old else now
        if not old or old["payload"] != payload or old["plan_id"] != plan_id:
            db.execute("""INSERT INTO trade_history
                (id,trade_date,market_value,cost_basis,cash,installments_paid,payload,created_at,updated_at,plan_id)
                VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                trade_date=excluded.trade_date,market_value=excluded.market_value,
                cost_basis=excluded.cost_basis,cash=excluded.cash,
                installments_paid=excluded.installments_paid,payload=excluded.payload,
                updated_at=excluded.updated_at,plan_id=excluded.plan_id""",
                (entry_id, trade_date.isoformat(), safe_number(entry.get("value")),
                 safe_number(entry.get("basis")), safe_number(entry.get("cash")),
                 max(0, min(3, int(safe_number(entry.get("paid"))))), payload, created_at, now, plan_id))
            db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('trade',?,?,?)",
                       (entry_id, payload, now))
        valid_ids.add(entry_id)


def sync_trades(db, plan_id, trades, now, valid_ids):
    """Store a plan's individual security buys and sells."""
    for original in trades:
        if not isinstance(original, dict):
            continue
        trade = dict(original)
        trade_id = str(trade.get("id") or "")
        trade_date = valid_date(trade.get("date"))
        security = str(trade.get("security") or "").strip()[:40]
        side = "sell" if trade.get("side") == "sell" else "buy"
        if not trade_id or not trade_date or not security:
            continue
        trade.update({"id": trade_id, "security": security, "side": side})
        payload = json.dumps(trade, separators=(",", ":"), sort_keys=True)
        old = db.execute("SELECT payload,created_at,plan_id FROM security_trades WHERE id=?", (trade_id,)).fetchone()
        if not old or old["payload"] != payload or old["plan_id"] != plan_id:
            db.execute("""INSERT INTO security_trades(id,trade_date,security,side,payload,created_at,updated_at,plan_id)
                VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET trade_date=excluded.trade_date,
                security=excluded.security,side=excluded.side,payload=excluded.payload,
                updated_at=excluded.updated_at,plan_id=excluded.plan_id""",
                (trade_id, trade_date.isoformat(), security, side, payload, old["created_at"] if old else now, now, plan_id))
            db.execute("INSERT INTO change_log(entity,entity_id,payload,changed_at) VALUES('security_trade',?,?,?)",
                       (trade_id, payload, now))
        valid_ids.add(trade_id)


def fmt(value):
    return f"{value:,.0f}"


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fmt_date(d):
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def plan_name(plan):
    """A plan is named by its start date and expected payment completion date."""
    params = plan.get("params") or {}
    start = valid_date(params.get("start"))
    months = max(1, min(3, int(safe_number(params.get("months"), 1))))
    base = f"{fmt_date(start)} → {fmt_date(start + timedelta(days=30 * months))}" if start else "Loan plan"
    label = str(plan.get("label") or "").strip()
    return f"{label} ({base})" if label else base


def current_alerts(db, plan, multi=False):
    """Everything worth the user's attention for one open plan: money due, losses, good positions and stale data."""
    alerts = []
    params = plan.get("params")
    if not params:
        return alerts
    plan_id = plan["id"]
    prefix = f"Plan {plan_name(plan)}: " if multi else ""

    def add(key, title, message, severity, due=None):
        alerts.append({"key": f"{plan_id}:{key}", "title": title, "message": prefix + message, "severity": severity, "due_date": due})

    today = date.today()
    loan = max(0, safe_number(params.get("loan")))
    own = max(0, safe_number(params.get("own")))
    rate = max(0, safe_number(params.get("rate"))) / 100
    months = max(1, min(3, int(safe_number(params.get("months"), 1))))
    start = valid_date(params.get("start"))
    sell_fee = max(0, safe_number(params.get("sellFee"))) / 100
    stop = max(0, safe_number(params.get("stop"))) / 100
    watch = max(0, safe_number(params.get("watch"))) / 100
    max_loss = max(0, safe_number(params.get("maxLoss")))
    # The gain you said you expect, after your own haircut, is the "good position" bar.
    target = max(0, safe_number(params.get("expect"))) / 100 * (1 - min(100, max(0, safe_number(params.get("haircut")))) / 100)
    entries = [json.loads(row["payload"]) for row in db.execute(
        "SELECT payload FROM trade_history WHERE plan_id=? ORDER BY trade_date DESC,created_at DESC", (plan_id,)
    )]
    trade_count = db.execute("SELECT COUNT(*) FROM security_trades WHERE plan_id=?", (plan_id,)).fetchone()[0]
    latest = entries[0] if entries else None
    paid = max(0, min(months, int(safe_number(latest.get("paid"))))) if latest else 0
    owed = loan * (1 + rate)
    installment = owed / months
    maturity = start + timedelta(days=30 * months) if start else None
    loan_open = bool(start) and paid < months

    if start:
        for number in range(paid + 1, months + 1):
            due = start + timedelta(days=30 * number)
            days = (due - today).days
            if days <= 3:
                when = "overdue" if days < 0 else ("due today" if days == 0 else f"due in {days} day(s)")
                add(f"installment-{number}-{due.isoformat()}", f"Installment {number} of {months} {when}",
                    f"Scheduled amount: {fmt(installment)}. Record the payment in the Tracker after you pay.",
                    "danger" if days < 0 else "warning", due.isoformat())
        if today >= maturity and paid < months:
            add(f"maturity-{maturity.isoformat()}", "Loan term has ended",
                f"The planned maturity date was {maturity.isoformat()}. Check the outstanding balance and record payments.",
                "danger", maturity.isoformat())

    if latest:
        entry_id = latest.get("id")
        value, basis, cash = safe_number(latest.get("value")), safe_number(latest.get("basis")), safe_number(latest.get("cash"))
        change = value / basis - 1 if basis > 0 else None
        remaining = max(0, owed - paid * installment)
        result = cash + value * (1 - sell_fee) - remaining - own

        if change is not None and change <= -stop:
            add(f"stop-{entry_id}", "Stop-loss threshold reached",
                f"Your holdings are {change * 100:.1f}% against the {stop * 100:.1f}% stop-loss. Review your plan.", "danger")
        elif change is not None and change <= -watch:
            add(f"watch-{entry_id}", "Watch threshold reached",
                f"Your holdings are {change * 100:.1f}% against the {watch * 100:.1f}% watch level.", "warning")
        if max_loss > 0 and result <= -max_loss:
            add(f"maxloss-{entry_id}", "Loss is past your limit",
                f"Selling everything and repaying the loan today would lose about {fmt(-result)}, more than the {fmt(max_loss)} you said you can afford.",
                "danger")
        if maturity and result > 0 and (maturity - today).days <= 3:
            when = "ends today" if today == maturity else (f"ends in {(maturity - today).days} day(s)" if today < maturity else f"ended {(today - maturity).days} day(s) ago")
            add(f"close-{maturity.isoformat()}", "Plan is ready to close?",
                f"This plan {when} and is in profit by about {fmt(result)}. Open it and use Close plan to record the result.", "good", maturity.isoformat())
        if result > 0:
            share = f" ({result / own * 100:.0f}% of your money)" if own > 0 else ""
            add(f"profit-{entry_id}", "You are in profit",
                f"If you sold everything and repaid the loan today you would keep about {fmt(result)}{share}.", "good")
        if target > 0 and change is not None and change >= target:
            add(f"target-{entry_id}", "Expected gain reached",
                f"Your holdings are up {change * 100:.1f}%, past the {target * 100:.1f}% you expected. Consider whether to take profit.", "good")

        if cash < 0:
            add(f"negcash-{entry_id}", "Cash is negative",
                f"Cash is {fmt(cash)}. You may have bought more than your loan and money allow. Check your trades.", "warning")
        if start and paid < months:
            due = start + timedelta(days=30 * (paid + 1))
            days = (due - today).days
            if days <= 7 and cash < installment:
                short = installment - max(cash, 0)
                add(f"cashinst-{paid + 1}-{entry_id}", f"Cash will not cover installment {paid + 1}",
                    f"Cash is {fmt(cash)} but {fmt(installment)} is due in {max(days, 0)} day(s). You may need to sell about {fmt(short / (1 - sell_fee) if sell_fee < 1 else short)} of holdings.",
                    "warning", due.isoformat())

        for holding in latest.get("holdings") or []:
            if not isinstance(holding, dict):
                continue
            name = str(holding.get("security") or "").strip()[:40]
            cost, now_value = safe_number(holding.get("cost")), safe_number(holding.get("value"))
            if not name or cost <= 0:
                continue
            move = now_value / cost - 1
            tag = f"{entry_id}-{name.upper()}"
            if move <= -stop:
                add(f"sec-stop-{tag}", f"{name} hit the stop-loss", f"{name} is {move * 100:.1f}% against your cost. Stop-loss is {stop * 100:.0f}%.", "danger")
            elif move <= -watch:
                add(f"sec-watch-{tag}", f"{name} is falling", f"{name} is {move * 100:.1f}% against your cost. Watch level is {watch * 100:.0f}%.", "warning")
            elif move >= (target if target > 0 else 0.10):
                add(f"sec-gain-{tag}", f"{name} is doing well", f"{name} is up {move * 100:.1f}% on your cost.", "good")

    if loan_open and today <= maturity + timedelta(days=30) and (entries or trade_count):
        last = valid_date(latest.get("date")) if latest else None
        if last is None:
            add("stale-none", "No daily log yet", "You have trades saved but no daily log. Log today's prices in the Tracker.", "info")
        elif (today - last).days >= 2:
            add(f"stale-{last.isoformat()}", "Update your prices",
                f"The last daily log was {(today - last).days} days ago ({last.isoformat()}). Log today's prices so alerts stay accurate.", "info")
    return alerts


def refresh_notifications(db):
    now = iso_now()
    db.execute("UPDATE notifications SET active=0,updated_at=?", (now,))
    open_plans = []
    for row in db.execute("SELECT id,label,params,closed FROM plans ORDER BY sort_order,created_at").fetchall():
        if not row["closed"]:
            open_plans.append({"id": row["id"], "label": row["label"], "params": json.loads(row["params"])})
    for plan in open_plans:
        for alert in current_alerts(db, plan, len(open_plans) > 1):
            db.execute("""INSERT INTO notifications
                (alert_key,title,message,severity,due_date,active,dismissed,updated_at)
                VALUES(?,?,?,?,?,1,0,?) ON CONFLICT(alert_key) DO UPDATE SET
                title=excluded.title,message=excluded.message,severity=excluded.severity,
                due_date=excluded.due_date,active=1,updated_at=excluded.updated_at""",
                (alert["key"], alert["title"], alert["message"], alert["severity"], alert["due_date"], now))
