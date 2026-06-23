from flask import Blueprint, jsonify, request
import database as db

settings_bp = Blueprint("settings", __name__)


@settings_bp.route("/api/settings/server", methods=["GET"])
def get_server_info():
    from config import get_server_config

    cfg = get_server_config()
    return jsonify(cfg)


@settings_bp.route("/api/settings/notion-config", methods=["GET"])
def get_notion_cfg():
    from config import get_notion_config

    cfg = get_notion_config()
    # 隱藏 token
    token = cfg.get("token", "")
    return jsonify({
        "sync_enabled": cfg["sync_enabled"],
        "database_id": cfg.get("database_id", ""),
        "sync_interval_seconds": cfg.get("sync_interval_seconds", 300),
        "token_set": bool(token),
    })


@settings_bp.route("/api/settings/gmail-sync", methods=["POST"])
def set_gmail_sync():
    data = request.get_json() or {}
    enabled = data.get("sync_enabled", False)
    db.set_setting("gmail_sync_enabled", "true" if enabled else "false")
    return jsonify({"ok": True})
