from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import base64


class GmailClient:
    def __init__(self, credentials):
        self.service = build("gmail", "v1", credentials=credentials)

    def get_me(self) -> dict:
        return self.service.users().getProfile(userId="me").execute()

    def list_recent_messages(self, lookback_days: int = 14, max_count: int = 20) -> list:
        from datetime import datetime, timedelta, timezone

        since = datetime.now(timezone.utc) - timedelta(days=lookback_days)
        query = f"after:{int(since.timestamp())}"
        try:
            resp = self.service.users().messages().list(
                userId="me", q=query, maxResults=max_count,
            ).execute()
        except HttpError as e:
            raise Exception(f"Gmail list error: {e}")

        message_ids = resp.get("messages", [])
        results = []
        for m in message_ids:
            try:
                msg = self.service.users().messages().get(
                    userId="me", id=m["id"], format="full",
                ).execute()
                headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
                body_text = _extract_body(msg.get("payload", {}))
                results.append({
                    "id": m["id"],
                    "thread_id": msg.get("threadId"),
                    "from": headers.get("From", ""),
                    "to": headers.get("To", ""),
                    "cc": headers.get("Cc", ""),
                    "subject": headers.get("Subject", ""),
                    "date": headers.get("Date", ""),
                    "snippet": msg.get("snippet", ""),
                    "body_text": body_text,
                    "label_ids": msg.get("labelIds", []),
                })
            except HttpError:
                continue
        return results

    def trash_message(self, msg_id: str):
        try:
            self.service.users().messages().trash(userId="me", id=msg_id).execute()
            return True
        except HttpError:
            return False


def _extract_body(payload: dict) -> str:
    parts = []
    if payload.get("mimeType") == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            try:
                parts.append(base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace"))
            except Exception:
                pass
    for p in payload.get("parts", []):
        parts.append(_extract_body(p))
    return "\n".join(parts).strip()
