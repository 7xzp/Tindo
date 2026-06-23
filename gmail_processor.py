from gmail_client import GmailClient
from gmail_filter import quick_filter
from gmail_auth import GmailAuth
from llm.client import LLMClient
from llm.prompts import PROMPT_FILTER_GMAIL
from config import get_gmail_config, get_llm_config
import database as db
import json


class GmailProcessor:
    def __init__(self):
        self.cfg = get_gmail_config()
        self.auth = GmailAuth(self.cfg)
        self.llm = LLMClient(get_llm_config())

    def pull_and_process(self) -> dict:
        creds = self.auth.get_credentials()
        if not creds:
            return {"error": "Gmail 未授權"}

        client = GmailClient(creds)
        me_data = client.get_me()
        my_email = me_data.get("emailAddress", "")

        emails = client.list_recent_messages(
            lookback_days=self.cfg.get("lookback_days", 14),
            max_count=self.cfg.get("max_emails_per_pull", 20),
        )

        stats = {
            "total": len(emails),
            "quick_filtered": 0,
            "ai_yes": 0, "ai_no": 0, "ai_unsure": 0,
            "errors": [],
        }

        for email in emails:
            try:
                if db.task_exists_by_source_id("gmail", email["id"]):
                    continue
                # 檢查標題重複（防止同一郵件被多次處理）
                if db.task_exists_by_title(email.get("subject", "")[:60]):
                    continue

                passed, reason = quick_filter(email)
                if not passed:
                    stats["quick_filtered"] += 1
                    continue

                # 完整正文 = snippet + body_text
                full_text = (email.get("snippet", "") + "\n" + email.get("body_text", ""))[:3000]

                recent = db.get_recent_decisions(5)
                pref_lines = []
                for r in recent:
                    pref_lines.append(f"- {r['decision']} | from:{r['sender'][:30]} | {r['subject'][:40]}")
                preferences = "\n".join(pref_lines) if pref_lines else "（尚無歷史記錄）"

                prompt = PROMPT_FILTER_GMAIL.format(
                    my_email=my_email,
                    from_str=email.get("from", ""),
                    to_str=email.get("to", ""),
                    cc_str=email.get("cc", ""),
                    subject=email.get("subject", ""),
                    snippet=full_text,
                    date=email.get("date", ""),
                    preferences=preferences,
                )
                result = self.llm.parse_json(prompt)
                decision = result.get("decision", "UNSURE")

                if decision == "NO":
                    stats["ai_no"] += 1
                    db.log_decision("gmail", email["id"], "NO", email.get("from", ""), email.get("subject", ""))
                    # 不刪信，只標記
                    continue

                etype = result.get("event_type")
                if etype not in ("ddl", "event"):
                    etype = "ddl"

                final_deadline = result.get("deadline")
                sched_date = None
                sched_time = None
                if etype == "event" and final_deadline:
                    if "T" in final_deadline:
                        parts = final_deadline.split("T")
                        sched_date = parts[0]
                        sched_time = parts[1][:5] if len(parts) > 1 else None
                    else:
                        sched_date = final_deadline

                task_data = {
                    "title": result.get("title") or email.get("subject", "")[:30],
                    "source": "gmail",
                    "source_id": email["id"],
                    "event_type": etype,
                    "deadline": final_deadline,
                    "scheduled_date": sched_date,
                    "scheduled_time": sched_time,
                    "estimated_minutes": result.get("estimated_minutes") or 30,
                    "urgency": result.get("urgency") or 3,
                    "workload": 2,
                    "ai_summary": result.get("ai_summary", ""),
                    "raw_content": json.dumps({
                        "subject": email.get("subject"),
                        "from": email.get("from"),
                        "snippet": full_text[:1500],
                    }, ensure_ascii=False),
                    # event + YES + 有日期 → 直接進月曆
                    # ddl + YES → 進 unsure（讓使用者選哪天做）
                    "status": "scheduled" if (decision == "YES" and etype == "event" and sched_date) else "unsure",
                    "decision": "do" if decision == "YES" else None,
                }
                db.create_task(task_data)

                if decision == "YES":
                    stats["ai_yes"] += 1
                else:
                    stats["ai_unsure"] += 1

            except Exception as e:
                stats["errors"].append(f"email {email.get('id', '?')}: {e}")

        return stats
