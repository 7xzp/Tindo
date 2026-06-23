import sqlite3
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

DB_DIR = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DB_DIR, "tindo.db")
MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")


def _ensure_data_dir():
    os.makedirs(DB_DIR, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    _ensure_data_dir()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _applied_migrations(conn: sqlite3.Connection) -> set:
    try:
        rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
        return {r["version"] for r in rows}
    except Exception:
        return set()


def _run_migration(conn: sqlite3.Connection, version: str, sql: str):
    conn.executescript(sql)
    conn.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        (version, datetime.now().isoformat()),
    )
    conn.commit()


def run_migrations():
    conn = get_conn()
    try:
        applied = _applied_migrations(conn)
        if not os.path.isdir(MIGRATIONS_DIR):
            return
        for fname in sorted(os.listdir(MIGRATIONS_DIR)):
            if not fname.endswith(".sql"):
                continue
            version = fname.split("_")[0]
            if version in applied:
                continue
            fpath = os.path.join(MIGRATIONS_DIR, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                sql = f.read()
            _run_migration(conn, version, sql)
    finally:
        conn.close()


# ── CRUD ──────────────────────────────────────────────────


def create_task(data: Dict[str, Any]) -> int:
    conn = get_conn()
    try:
        now = datetime.now().isoformat()
        cols = []
        vals = []
        placeholders = []
        for k, v in data.items():
            cols.append(k)
            vals.append(v)
            placeholders.append("?")
        cols.extend(["created_at", "updated_at"])
        vals.extend([now, now])
        placeholders.extend(["?", "?"])
        sql = f"INSERT INTO tasks ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
        cur = conn.execute(sql, vals)
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def get_tasks(
    status: Optional[str] = None,
    event_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> List[dict]:
    conn = get_conn()
    try:
        wheres = []
        params = []
        if status:
            wheres.append("status = ?")
            params.append(status)
        if event_type:
            wheres.append("event_type = ?")
            params.append(event_type)
        if date_from:
            wheres.append("(scheduled_date >= ? OR deadline >= ?)")
            params.extend([date_from, date_from])
        if date_to:
            wheres.append("(scheduled_date <= ? OR deadline <= ?)")
            params.extend([date_to, date_to])
        sql = "SELECT * FROM tasks"
        if wheres:
            sql += " WHERE " + " AND ".join(wheres)
        sql += " ORDER BY COALESCE(scheduled_date, deadline), scheduled_time ASC"
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_task(task_id: int) -> Optional[dict]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_task(task_id: int, data: Dict[str, Any]) -> bool:
    conn = get_conn()
    try:
        data = {**data, "updated_at": datetime.now().isoformat()}
        sets = ", ".join(f"{k} = ?" for k in data)
        vals = list(data.values()) + [task_id]
        cur = conn.execute(f"UPDATE tasks SET {sets} WHERE id = ?", vals)
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_task(task_id: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_tasks_by_date_range(date_from: str, date_to: str) -> List[dict]:
    conn = get_conn()
    try:
        rows = conn.execute(
            """SELECT * FROM tasks
            WHERE scheduled_date >= ? AND scheduled_date <= ?
            ORDER BY scheduled_date, scheduled_time ASC, urgency DESC""",
            (date_from, date_to),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def schedule_task(task_id: int, scheduled_date: str, scheduled_time: Optional[str] = None) -> bool:
    task = get_task(task_id)
    if not task:
        return False
    if task["status"] not in ("pending", "unsure", "decided"):
        return False
    data = {
        "scheduled_date": scheduled_date,
        "scheduled_time": scheduled_time,
        "status": "scheduled",
        "decision": "do",
    }
    return update_task(task_id, data)


# ── helpers for settings_kv ───────────────────────────────


def get_setting(key: str) -> Optional[str]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT value FROM settings_kv WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None
    finally:
        conn.close()


def set_setting(key: str, value: str):
    conn = get_conn()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO settings_kv (key, value) VALUES (?, ?)",
            (key, value),
        )
        conn.commit()
    finally:
        conn.close()


def log_decision(source: str, source_id: str, decision: str, sender: str, subject: str):
    conn = get_conn()
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS decision_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT, source_id TEXT, decision TEXT,
            sender TEXT, subject TEXT, created_at TEXT
        )""")
        conn.execute(
            "INSERT INTO decision_log (source, source_id, decision, sender, subject, created_at) VALUES (?,?,?,?,?,?)",
            (source, source_id, decision, sender, subject, datetime.now().isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def get_recent_decisions(limit: int = 5) -> list:
    conn = get_conn()
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS decision_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT, source_id TEXT, decision TEXT,
            sender TEXT, subject TEXT, created_at TEXT
        )""")
        rows = conn.execute(
            "SELECT decision, sender, subject FROM decision_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def add_reject_pattern(sender: str, subject: str):
    conn = get_conn()
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS reject_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT, subject_keyword TEXT, created_at TEXT
        )""")
        keyword = _extract_keyword(subject)
        conn.execute(
            "INSERT OR IGNORE INTO reject_patterns (sender, subject_keyword, created_at) VALUES (?,?,?)",
            (sender, keyword, datetime.now().isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def get_reject_patterns() -> list:
    conn = get_conn()
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS reject_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT, subject_keyword TEXT, created_at TEXT
        )""")
        rows = conn.execute("SELECT sender, subject_keyword FROM reject_patterns").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _extract_keyword(subject: str) -> str:
    import re
    s = subject.lower()
    s = re.sub(r'[\[\(（【].*?[\]\)）】]', '', s)  # 去括號
    s = re.sub(r'[0-9/%$#@!&*\-]+', '', s)  # 去數字符號
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:80]


def task_exists_by_title(title: str) -> bool:
    conn = get_conn()
    try:
        row = conn.execute("SELECT 1 FROM tasks WHERE title=? LIMIT 1", (title,)).fetchone()
        return row is not None
    finally:
        conn.close()


def task_exists_by_source_id(source: str, source_id: str) -> bool:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT 1 FROM tasks WHERE source=? AND source_id=? LIMIT 1",
            (source, source_id),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


# ── Notion sync helpers (Phase 2) ──────────────────────────


def get_tasks_to_push() -> List[dict]:
    conn = get_conn()
    try:
        rows = conn.execute(
            """SELECT * FROM tasks
            WHERE sync_status IN ('unsynced', 'sync_failed')
               OR (notion_page_id IS NOT NULL
                   AND updated_at > COALESCE(notion_synced_at, '1900-01-01'))
            """
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def mark_task_synced(task_id: int, notion_page_id: str, notion_last_edited_time: str):
    conn = get_conn()
    try:
        conn.execute(
            """UPDATE tasks SET
                sync_status='synced',
                notion_page_id=?,
                notion_synced_at=?,
                notion_last_edited_time=?
            WHERE id=?""",
            (notion_page_id, datetime.now().isoformat(), notion_last_edited_time, task_id),
        )
        conn.commit()
    finally:
        conn.close()


def get_task_by_notion_page_id(page_id: str) -> Optional[dict]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE notion_page_id = ?", (page_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()
