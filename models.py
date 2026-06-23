from dataclasses import dataclass
from typing import Optional


@dataclass
class Task:
    id: Optional[int] = None
    title: str = ""
    description: Optional[str] = None
    source: str = "manual"
    source_id: Optional[str] = None
    event_type: str = "ddl"
    deadline: Optional[str] = None
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    estimated_minutes: Optional[int] = None
    urgency: Optional[int] = None
    workload: Optional[int] = None
    status: str = "pending"
    decision: Optional[str] = None
    ai_summary: Optional[str] = None
    raw_content: Optional[str] = None
    notion_page_id: Optional[str] = None
    notion_synced_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    sync_status: str = "unsynced"
    notion_last_edited_time: Optional[str] = None

    @classmethod
    def from_row(cls, row: dict) -> "Task":
        return cls(**{k: row.get(k) for k in cls.__dataclass_fields__ if k in row or True})
