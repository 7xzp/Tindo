-- 移除 reminder 類型，attend 改名 event
UPDATE tasks SET event_type = 'ddl' WHERE event_type = 'reminder';
UPDATE tasks SET event_type = 'event' WHERE event_type = 'attend';
