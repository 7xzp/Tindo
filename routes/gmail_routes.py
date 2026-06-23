from flask import Blueprint, jsonify, request
from config import get_gmail_config
from gmail_auth import GmailAuth

gmail_bp = Blueprint("gmail", __name__)


@gmail_bp.route("/api/gmail/auth-url", methods=["GET"])
def get_auth_url():
    cfg = get_gmail_config()
    auth = GmailAuth(cfg)
    url, state = auth.get_auth_url()
    return jsonify({"auth_url": url})


@gmail_bp.route("/oauth/gmail-callback", methods=["GET"])
def oauth_callback():
    code = request.args.get("code")
    error = request.args.get("error")
    if error:
        return f"<h2>授權失敗</h2><p>{error}</p>", 400
    if not code:
        return "<h2>授權失敗</h2><p>沒收到 code</p>", 400
    cfg = get_gmail_config()
    auth = GmailAuth(cfg)
    try:
        auth.exchange_code(code)
        return """
        <html><body style="font-family:-apple-system;padding:40px;text-align:center;background:#1a1b1e;color:#e4e4e7;">
        <h2 style="color:#4ade80;">Gmail 授權成功</h2>
        <p>可以關閉這個分頁，回 Tindo 設定頁了。</p>
        <script>setTimeout(function(){window.close()},2000)</script>
        </body></html>
        """
    except Exception as e:
        return f"<h2>授權失敗</h2><pre>{e}</pre>", 400


@gmail_bp.route("/api/gmail/preview", methods=["GET"])
def preview_gmail():
    cfg = get_gmail_config()
    auth = GmailAuth(cfg)
    creds = auth.get_credentials()
    if not creds:
        return jsonify({"error": "未授權"}), 401

    from gmail_client import GmailClient
    client = GmailClient(creds)
    me = client.get_me()
    msgs = client.list_recent_messages(
        lookback_days=cfg.get("lookback_days", 14),
        max_count=cfg.get("max_emails_per_pull", 20),
    )

    return jsonify({
        "me": me.get("emailAddress"),
        "total_count": len(msgs),
        "sample": [
            {"from": m["from"], "subject": m["subject"]}
            for m in msgs[:5]
        ],
    })


@gmail_bp.route("/api/gmail/status", methods=["GET"])
def gmail_status():
    cfg = get_gmail_config()
    auth = GmailAuth(cfg)
    return jsonify({
        "is_authenticated": auth.is_authenticated(),
        "sync_enabled": cfg.get("sync_enabled", False),
    })


@gmail_bp.route("/api/gmail/pull", methods=["POST"])
def pull_gmail():
    from gmail_processor import GmailProcessor
    p = GmailProcessor()
    return jsonify(p.pull_and_process())


@gmail_bp.route("/api/gmail/trash-by-source/<path:source_id>", methods=["POST"])
def trash_by_source(source_id):
    cfg = get_gmail_config()
    auth = GmailAuth(cfg)
    creds = auth.get_credentials()
    if not creds:
        return jsonify({"error": "未授權"}), 401
    from gmail_client import GmailClient
    client = GmailClient(creds)
    ok = client.trash_message(source_id)
    return jsonify({"ok": ok})


@gmail_bp.route("/api/gmail/last-sync", methods=["GET"])
def last_gmail_sync():
    import database as db
    return jsonify({
        "at": db.get_setting("last_gmail_sync_at"),
        "result": db.get_setting("last_gmail_sync_result"),
    })


@gmail_bp.route("/api/gmail/reject-pattern", methods=["POST"])
def add_reject_pattern():
    body = request.get_json() or {}
    import database as db
    db.add_reject_pattern(body.get("sender", ""), body.get("subject", ""))
    return jsonify({"ok": True})


@gmail_bp.route("/api/gmail/sign-out", methods=["POST"])
def sign_out():
    cfg = get_gmail_config()
    auth = GmailAuth(cfg)
    auth.sign_out()
    return jsonify({"ok": True})
