import json
import os
from typing import Any, Dict

SETTINGS_PATH = os.path.join(os.path.dirname(__file__), "settings.json")


def _read_settings() -> Dict[str, Any]:
    if not os.path.exists(SETTINGS_PATH):
        return {}
    with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_llm_config() -> Dict[str, Any]:
    s = _read_settings()
    llm = s.get("llm", {})
    provider = llm.get("provider", "deepseek")
    provider_cfg = llm.get(provider, {})
    return {
        "provider": provider,
        "api_key": provider_cfg.get("api_key", ""),
        "base_url": provider_cfg.get("base_url", "https://api.deepseek.com"),
        "model": provider_cfg.get("model", "deepseek-chat"),
    }


def get_server_config() -> Dict[str, Any]:
    s = _read_settings()
    server = s.get("server", {})
    return {
        "host": server.get("host", "127.0.0.1"),
        "port": server.get("port", 5088),
    }


def get_gmail_config() -> Dict[str, Any]:
    s = _read_settings()
    gmail = s.get("gmail", {})
    try:
        import database as db
        ui_enabled = db.get_setting("gmail_sync_enabled") == "true"
    except Exception:
        ui_enabled = False
    return {
        "client_id": gmail.get("client_id", ""),
        "client_secret": gmail.get("client_secret", ""),
        "redirect_uri": gmail.get("redirect_uri", "http://localhost:5088/oauth/gmail-callback"),
        "scopes": gmail.get("scopes", [
            "openid",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/userinfo.email",
        ]),
        "sync_enabled": ui_enabled,
        "sync_interval_seconds": gmail.get("sync_interval_seconds", 1800),
        "max_emails_per_pull": gmail.get("max_emails_per_pull", 20),
        "lookback_days": gmail.get("lookback_days", 14),
    }


def get_notion_config() -> Dict[str, Any]:
    s = _read_settings()
    notion = s.get("notion", {})
    token = notion.get("token", "")
    database_id = notion.get("database_id", "")
    # 從 DB settings_kv 讀使用者開關狀態
    try:
        import database as db
        ui_enabled = db.get_setting("sync_enabled") == "true"
    except Exception:
        ui_enabled = True  # 首次預設開
    return {
        "token": token,
        "database_id": database_id,
        "sync_enabled": ui_enabled and bool(token) and bool(database_id),
        "sync_interval_seconds": notion.get("sync_interval_seconds", 300),
    }
