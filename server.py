#!/usr/bin/env python3
"""Local-only HTTP server for the Loan Leverage Planner."""

from __future__ import annotations

import json
import mimetypes
import sqlite3
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from database import DB_PATH, connect, initialize_db, load_state, refresh_notifications, save_state

ROOT = Path(__file__).resolve().parent
APP_HTML = ROOT / "Loan Leverage Planner.html"
HOST = "127.0.0.1"
PORT = 8000
MAX_BODY = 64 * 1024 * 1024
REQUIRED_TABLES = {"app_settings", "trade_history", "change_log", "notifications"}


def validate_database(path):
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        result = db.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise ValueError("The uploaded database failed SQLite's integrity check.")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not REQUIRED_TABLES.issubset(tables):
            raise ValueError("This is not a Loan Leverage Planner database backup.")
    finally:
        db.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "LoanPlannerLocal/1.2"

    def send_json(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid request length.") from exc
        if length < 0 or length > MAX_BODY:
            raise ValueError("Request is too large (maximum 64 MB).")
        return self.rfile.read(length)

    def read_json(self):
        return json.loads(self.read_body() or b"{}")

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
                rows = db.execute("""SELECT alert_key,title,message,severity,due_date FROM notifications
                    WHERE active=1 AND dismissed=0
                    ORDER BY CASE severity WHEN 'danger' THEN 0 ELSE 1 END,due_date""").fetchall()
                return self.send_json(200, {"alerts": [dict(row) for row in rows]})
        if path == "/api/backup":
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            with connect() as db:
                db.execute("PRAGMA wal_checkpoint(FULL)")
                with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                    temp_path = Path(tmp.name)
                try:
                    target = sqlite3.connect(temp_path)
                    db.backup(target)
                    target.close()
                    data = temp_path.read_bytes()
                finally:
                    temp_path.unlink(missing_ok=True)
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.sqlite3")
            self.send_header("Content-Disposition", 'attachment; filename="loan_planner_backup.sqlite3"')
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return self.wfile.write(data)
        if path in ("/", "/index.html"):
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
            if path == "/api/backup":
                raw = self.read_body()
                if not raw.startswith(b"SQLite format 3\x00"):
                    return self.send_json(400, {"error": "Upload a SQLite backup exported by this app."})
                DB_PATH.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=DB_PATH.parent, suffix=".sqlite3", delete=False) as tmp:
                    tmp.write(raw)
                    temp_path = Path(tmp.name)
                try:
                    validate_database(temp_path)
                    # No database connections are held between requests. Remove old WAL files
                    # before atomically replacing the main database.
                    for suffix in ("-wal", "-shm"):
                        Path(str(DB_PATH) + suffix).unlink(missing_ok=True)
                    temp_path.replace(DB_PATH)
                    initialize_db()
                finally:
                    temp_path.unlink(missing_ok=True)
                return self.send_json(200, {"ok": True})

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
