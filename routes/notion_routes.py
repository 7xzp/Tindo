from flask import Blueprint, jsonify, request
from config import get_notion_config
from notion_sync import NotionSync
import database as db
from datetime import datetime
import json

notion_bp = Blueprint("notion", __name__)


@notion_bp.route("/api/notion/test", methods=["POST"])
def test_notion():
    cfg = get_notion_config()
    sync = NotionSync(cfg)
    ok, msg = sync.test_connection()
    return jsonify({"ok": ok, "message": msg})


@notion_bp.route("/api/notion/sync-preview", methods=["GET"])
def sync_preview():
    cfg = get_notion_config()
    sync = NotionSync(cfg)
    if not sync.client:
        return jsonify({"error": "未設定"}), 400
    try:
        sync._load_schema()
        response = sync.client.databases.query(database_id=cfg["database_id"], page_size=100)
        notion_count = len(response.get("results", []))
        local_count = len(db.get_tasks_to_push())
        first_sync = not db.get_setting("first_sync_done")
        return jsonify({
            "notion_count": notion_count,
            "local_to_push": local_count,
            "first_sync": first_sync,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@notion_bp.route("/api/notion/sync", methods=["POST"])
def sync_notion():
    cfg = get_notion_config()
    sync = NotionSync(cfg)
    if not sync.client:
        return jsonify({"error": "未設定"}), 400

    body = request.get_json() or {}
    confirmed = body.get("confirmed", False)

    first_sync = not db.get_setting("first_sync_done")
    if first_sync and not confirmed:
        return jsonify({
            "error": "first_sync_requires_confirmation",
            "message": "第一次同步會在 Notion 上寫入 Tindo ID 欄位，請使用者確認後再執行"
        }), 400

    try:
        pull_result = sync.pull_from_notion()
        push_result = sync.push_to_notion()

        has_error = bool(pull_result.get("errors") or push_result.get("errors"))
        db.set_setting("last_sync_at", datetime.now().isoformat())
        db.set_setting("last_sync_result", "error" if has_error else "ok")
        db.set_setting("last_sync_detail", json.dumps({"pull": pull_result, "push": push_result}))

        if first_sync and not has_error:
            db.set_setting("first_sync_done", "true")

        return jsonify({"pull": pull_result, "push": push_result})
    except Exception as e:
        db.set_setting("last_sync_at", datetime.now().isoformat())
        db.set_setting("last_sync_result", f"error: {str(e)}")
        return jsonify({"error": str(e)}), 500


@notion_bp.route("/api/notion/toggle-sync", methods=["POST"])
def toggle_sync():
    data = request.get_json() or {}
    enabled = data.get("enabled", False)
    db.set_setting("sync_enabled", "true" if enabled else "false")
    return jsonify({"ok": True, "sync_enabled": enabled})


@notion_bp.route("/api/notion/status", methods=["GET"])
def notion_status():
    cfg = get_notion_config()
    return jsonify({
        "sync_enabled": cfg.get("sync_enabled", False),
        "last_sync_at": db.get_setting("last_sync_at"),
        "last_sync_result": db.get_setting("last_sync_result"),
    })


@notion_bp.route("/api/notion/conflicts", methods=["GET"])
def list_conflicts():
    conn = db.get_conn()
    try:
        rows = conn.execute("SELECT * FROM tasks WHERE sync_status='sync_conflict'").fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@notion_bp.route("/api/tasks/reset-sync-status", methods=["POST"])
def reset_sync_status():
    conn = db.get_conn()
    try:
        conn.execute("UPDATE tasks SET sync_status='unsynced'")
        conn.commit()
        return jsonify({"ok": True, "message": "已 reset，下次 sync 會全部 re-push"})
    finally:
        conn.close()
