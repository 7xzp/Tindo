ALTER TABLE tasks ADD COLUMN sync_status TEXT DEFAULT 'unsynced';
ALTER TABLE tasks ADD COLUMN notion_last_edited_time TEXT;
CREATE INDEX idx_tasks_sync_status ON tasks(sync_status);
