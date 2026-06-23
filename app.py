import threading
import time
import json
from datetime import datetime
from flask import Flask
from database import run_migrations
from config import get_server_config, get_notion_config, get_gmail_config
from routes.views import views_bp
from routes.tasks import tasks_bp
from routes.parse import parse_bp
from routes.settings_routes import settings_bp
from routes.notion_routes import notion_bp
from routes.gmail_routes import gmail_bp
from routes.import_routes import import_bp


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["TEMPLATES_AUTO_RELOAD"] = True

    run_migrations()

    app.register_blueprint(views_bp)
    app.register_blueprint(tasks_bp)
    app.register_blueprint(parse_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(notion_bp)
    app.register_blueprint(gmail_bp)
    app.register_blueprint(import_bp)

    return app


def background_sync_loop():
    import database as db
    while True:
        try:
            # Notion
            notion_cfg = get_notion_config()
            if notion_cfg.get("sync_enabled") and db.get_setting("first_sync_done"):
                try:
                    from notion_sync import NotionSync
                    sync = NotionSync(notion_cfg)
                    sync.pull_from_notion()
                    sync.push_to_notion()
                    db.set_setting("last_notion_sync_at", datetime.now().isoformat())
                    db.set_setting("last_notion_sync_result", "ok")
                except Exception as e:
                    db.set_setting("last_notion_sync_result", f"error: {str(e)}")

            # Gmail
            gmail_cfg = get_gmail_config()
            if gmail_cfg.get("sync_enabled"):
                try:
                    from gmail_processor import GmailProcessor
                    p = GmailProcessor()
                    stats = p.pull_and_process()
                    db.set_setting("last_gmail_sync_at", datetime.now().isoformat())
                    db.set_setting("last_gmail_sync_result", json.dumps(stats))
                except Exception as e:
                    db.set_setting("last_gmail_sync_result", f"error: {str(e)}")

            interval = min(
                notion_cfg.get("sync_interval_seconds", 300),
                gmail_cfg.get("sync_interval_seconds", 1800),
            )
            time.sleep(interval)
        except Exception as e:
            print(f"[Sync thread error] {e}")
            time.sleep(60)


if __name__ == "__main__":
    app = create_app()

    # 背景同步線程
    sync_thread = threading.Thread(target=background_sync_loop, daemon=True)
    sync_thread.start()

    import os
    port = int(os.environ.get("PORT", 5088))
    host = "0.0.0.0" if os.environ.get("RENDER") else get_server_config()["host"]

    print(f"Tindo 已啟動 → http://{host}:{port}")
    app.run(host=host, port=port, debug=False)
