CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    source_id TEXT,
    event_type TEXT NOT NULL DEFAULT 'ddl',
    deadline TIMESTAMP,
    scheduled_date DATE,
    scheduled_time TIME,
    estimated_minutes INTEGER,
    urgency INTEGER,
    workload INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    decision TEXT,
    ai_summary TEXT,
    raw_content TEXT,
    notion_page_id TEXT,
    notion_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_scheduled_date ON tasks(scheduled_date);
CREATE INDEX idx_tasks_deadline ON tasks(deadline);
CREATE INDEX idx_tasks_event_type ON tasks(event_type);

CREATE TABLE reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    remind_at TIMESTAMP NOT NULL,
    fired INTEGER DEFAULT 0
);

CREATE TABLE settings_kv (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
