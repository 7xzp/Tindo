from notion_client import Client
from typing import Tuple
from datetime import datetime, timezone, timedelta
import database as db
import time

LOCAL_TZ = timezone(timedelta(hours=8))  # UTC+8


class NotionSync:
    def __init__(self, config: dict):
        self.token = config.get("token", "")
        self.database_id = config.get("database_id", "")
        self.client = Client(auth=self.token) if self.token else None
        self.schema = {}

    def _load_schema(self):
        if not self.client:
            return
        db_obj = self.client.databases.retrieve(database_id=self.database_id)
        props = db_obj.get("properties", {})
        self.schema = {name: prop.get("type") for name, prop in props.items()}

    def test_connection(self) -> Tuple[bool, str]:
        if not self.token or not self.database_id:
            return False, "尚未設定 token 或 database_id"
        try:
            self._load_schema()
            required_props = {
                "Name": ["title"],
                "Status": ["select", "status"],
                "Event Type": ["select"],
                "Deadline": ["date"],
                "Scheduled": ["date"],
                "Urgency": ["number"],
                "Workload": ["number"],
                "Estimated Minutes": ["number"],
                "Source": ["select"],
                "AI Summary": ["rich_text"],
                "Tindo ID": ["number"],
            }
            missing = []
            wrong_type = []
            for name, accepted_types in required_props.items():
                if name not in self.schema:
                    missing.append(name)
                elif self.schema[name] not in accepted_types:
                    wrong_type.append(f"{name}（應為 {'/'.join(accepted_types)}，實際 {self.schema[name]}）")
            if missing:
                return False, f"Notion database 缺欄位：{', '.join(missing)}"
            if wrong_type:
                return False, f"欄位類型不對：{', '.join(wrong_type)}"
            return True, "連線正常"
        except Exception as e:
            return False, f"Notion API 錯誤：{str(e)}"

    # ── task → Notion ─────────────────────

    def _to_iso_with_tz(self, date_str, time_str=None, tz_offset="+08:00"):
        if not date_str:
            return None
        if "T" in date_str:
            if "+" not in date_str and "Z" not in date_str:
                return date_str + tz_offset
            return date_str
        if time_str:
            parts = time_str.split(":")
            hh = parts[0].zfill(2)
            mm = parts[1][:2] if len(parts) >= 2 else "00"
            return f"{date_str}T{hh}:{mm}:00{tz_offset}"
        return date_str

    def _make_status_prop(self, value: str) -> dict:
        field_type = self.schema.get("Status", "select")
        if field_type == "status":
            return {"status": {"name": value}}
        return {"select": {"name": value}}

    def task_to_notion_props(self, task: dict) -> dict:
        props = {
            "Name": {"title": [{"text": {"content": task.get("title", "")}}]},
            "Status": self._make_status_prop(task.get("status", "pending")),
            "Event Type": {"select": {"name": task.get("event_type", "ddl")}},
            "Source": {"select": {"name": task.get("source", "manual")}},
            "Tindo ID": {"number": task.get("id")},
        }
        if task.get("deadline"):
            dl = task["deadline"]
            if "T" in dl and "+" not in dl and "Z" not in dl:
                dl = dl + "+08:00"
            props["Deadline"] = {"date": {"start": dl}}
        if task.get("scheduled_date"):
            scheduled = self._to_iso_with_tz(task["scheduled_date"], task.get("scheduled_time"))
            props["Scheduled"] = {"date": {"start": scheduled}}
        if task.get("urgency") is not None:
            props["Urgency"] = {"number": task["urgency"]}
        if task.get("workload") is not None:
            props["Workload"] = {"number": task["workload"]}
        if task.get("estimated_minutes") is not None:
            props["Estimated Minutes"] = {"number": task["estimated_minutes"]}
        if task.get("ai_summary"):
            props["AI Summary"] = {"rich_text": [{"text": {"content": task["ai_summary"]}}]}
        return props

    # ── Notion → task ─────────────────────

    def notion_page_to_task(self, page: dict) -> dict:
        props = page.get("properties", {})

        def _title(prop):
            items = prop.get("title", [])
            return items[0]["plain_text"] if items else ""

        def _select(prop):
            val = prop.get("select") or prop.get("status")
            return val.get("name") if val else None

        def _number(prop):
            return prop.get("number")

        def _date(prop):
            d = prop.get("date")
            if not d or not d.get("start"):
                return None
            start = d["start"]
            if "T" not in start:
                return start
            try:
                dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=LOCAL_TZ)
                dt_local = dt.astimezone(LOCAL_TZ)
                return dt_local.strftime("%Y-%m-%dT%H:%M:%S")
            except Exception:
                return start

        def _rich_text(prop):
            items = prop.get("rich_text", [])
            return items[0]["plain_text"] if items else ""

        scheduled = _date(props.get("Scheduled", {}))
        scheduled_date = None
        scheduled_time = None
        if scheduled:
            if "T" in scheduled:
                scheduled_date, time_part = scheduled.split("T", 1)
                scheduled_time = time_part[:5]
            else:
                scheduled_date = scheduled

        return {
            "notion_page_id": page["id"],
            "notion_last_edited_time": page.get("last_edited_time"),
            "title": _title(props.get("Name", {})),
            "status": _select(props.get("Status", {})) or "pending",
            "event_type": _select(props.get("Event Type", {})) or "ddl",
            "source": _select(props.get("Source", {})) or "notion",
            "deadline": _date(props.get("Deadline", {})),
            "scheduled_date": scheduled_date,
            "scheduled_time": scheduled_time,
            "urgency": _number(props.get("Urgency", {})),
            "workload": _number(props.get("Workload", {})),
            "estimated_minutes": _number(props.get("Estimated Minutes", {})),
            "ai_summary": _rich_text(props.get("AI Summary", {})),
            "tindo_id_in_notion": _number(props.get("Tindo ID", {})),
        }

    # ── Pull / Push / 衝突 ───────────────

    def pull_from_notion(self) -> dict:
        if not self.client:
            return {"error": "未設定 Notion"}
        if not self.schema:
            self._load_schema()

        pulled_new = 0
        pulled_updated = 0
        conflicts_created = 0
        errors = []

        has_more = True
        start_cursor = None

        while has_more:
            try:
                kwargs = {"database_id": self.database_id, "page_size": 100}
                if start_cursor:
                    kwargs["start_cursor"] = start_cursor
                response = self.client.databases.query(**kwargs)

                for page in response.get("results", []):
                    try:
                        notion_data = self.notion_page_to_task(page)
                        tindo_id_in_notion = notion_data.pop("tindo_id_in_notion", None)
                        notion_last_edited = page["last_edited_time"]

                        existing = None
                        if tindo_id_in_notion:
                            existing = db.get_task(tindo_id_in_notion)
                        if not existing:
                            existing = db.get_task_by_notion_page_id(page["id"])

                        # 舊提醒或舊 attend → 轉成有效型態
                        et = notion_data.get("event_type", "ddl")
                        if et not in ("ddl", "event"):
                            notion_data["event_type"] = "ddl"

                        if not existing:
                            notion_data["source"] = "notion"
                            new_id = db.create_task(notion_data)
                            db.mark_task_synced(new_id, page["id"], notion_last_edited)
                            pulled_new += 1
                            continue

                        local_updated = existing.get("updated_at")
                        last_sync = existing.get("notion_synced_at")
                        stored_last_edited = existing.get("notion_last_edited_time")

                        local_changed = (local_updated and last_sync
                                         and local_updated > last_sync)
                        notion_changed = (stored_last_edited
                                          and notion_last_edited != stored_last_edited)

                        if local_changed and notion_changed:
                            conflict_copy = {**notion_data}
                            conflict_copy["title"] = f"(衝突版本) {notion_data['title']}"
                            conflict_copy["source"] = "notion"
                            conflict_copy["sync_status"] = "sync_conflict"
                            db.create_task(conflict_copy)
                            db.update_task(existing["id"], {"sync_status": "sync_conflict"})
                            conflicts_created += 1
                        elif notion_changed:
                            db.update_task(existing["id"], notion_data)
                            db.mark_task_synced(existing["id"], page["id"], notion_last_edited)
                            pulled_updated += 1

                    except Exception as e:
                        errors.append(f"page {page.get('id', '?')}: {str(e)}")

                has_more = response.get("has_more", False)
                start_cursor = response.get("next_cursor")
            except Exception as e:
                errors.append(f"查詢失敗：{str(e)}")
                break

        return {
            "pulled_new": pulled_new,
            "pulled_updated": pulled_updated,
            "conflicts_created": conflicts_created,
            "errors": errors,
        }

    def push_to_notion(self) -> dict:
        if not self.client:
            return {"error": "未設定 Notion"}
        if not self.schema:
            self._load_schema()

        pushed_new = 0
        pushed_updated = 0
        errors = []

        tasks = db.get_tasks_to_push()
        for task in tasks:
            try:
                if task.get("sync_status") == "sync_conflict":
                    continue

                props = self.task_to_notion_props(task)

                if task.get("notion_page_id"):
                    self.client.pages.update(
                        page_id=task["notion_page_id"],
                        properties=props,
                    )
                    page_id = task["notion_page_id"]
                else:
                    page = self.client.pages.create(
                        parent={"database_id": self.database_id},
                        properties=props,
                    )
                    page_id = page["id"]

                time.sleep(0.3)
                fresh = self.client.pages.retrieve(page_id=page_id)
                db.mark_task_synced(task["id"], page_id, fresh["last_edited_time"])

                if task.get("notion_page_id"):
                    pushed_updated += 1
                else:
                    pushed_new += 1

            except Exception as e:
                db.update_task(task["id"], {"sync_status": "sync_failed"})
                errors.append(f"task {task['id']}: {str(e)}")

        return {"pushed_new": pushed_new, "pushed_updated": pushed_updated, "errors": errors}
