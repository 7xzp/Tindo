from flask import Blueprint, request, jsonify
import database as db
from datetime import datetime, timezone, timedelta

LOCAL_TZ = timezone(timedelta(hours=8))

tasks_bp = Blueprint("tasks", __name__)


@tasks_bp.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json(silent=True) or {}
    required = ["title", "event_type"]
    for k in required:
        if k not in data:
            return jsonify({"error": f"缺少必要欄位：{k}"}), 400

    task_data = {
        "title": data["title"],
        "event_type": data["event_type"],
        "source": data.get("source", "manual"),
        "raw_content": data.get("raw_content", ""),
        "description": data.get("description"),
        "deadline": data.get("deadline"),
        "scheduled_date": data.get("scheduled_date"),
        "scheduled_time": data.get("scheduled_time"),
        "estimated_minutes": data.get("estimated_minutes"),
        "urgency": data.get("urgency"),
        "workload": data.get("workload"),
        "ai_summary": data.get("ai_summary"),
        "status": data.get("status", "pending"),
        "decision": data.get("decision"),
    }
    task_id = db.create_task(task_data)
    return jsonify({"ok": True, "id": task_id}), 201


@tasks_bp.route("/api/tasks", methods=["GET"])
def list_tasks():
    status = request.args.get("status")
    event_type = request.args.get("event_type")
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")
    tasks = db.get_tasks(
        status=status,
        event_type=event_type,
        date_from=date_from,
        date_to=date_to,
    )
    return jsonify(tasks)


@tasks_bp.route("/api/tasks/by-date-range", methods=["GET"])
def tasks_by_date_range():
    date_from = request.args.get("date_from") or request.args.get("start", "")
    date_to = request.args.get("date_to") or request.args.get("end", "")
    if not date_from or not date_to:
        return jsonify({"error": "需要 date_from(start) 和 date_to(end)"}), 400

    tasks = db.get_tasks_by_date_range(date_from, date_to)

    # 按日期分组
    from collections import defaultdict
    import datetime as dt

    today = dt.date.today()

    days = defaultdict(list)
    for t in tasks:
        d = t.get("scheduled_date")
        if d:
            days[d].append(t)

    result = []
    current = date_from
    while current <= date_to:
        weekday_map = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]
        d_obj = dt.date.fromisoformat(current)
        wd = weekday_map[d_obj.weekday()]
        day_tasks = sorted(
            days.get(current, []),
            key=lambda x: (
                x.get("scheduled_time") or "99:99",
                -(x.get("urgency") or 0),
            ),
        )
        total = sum((t.get("estimated_minutes") or 0) for t in day_tasks)
        result.append({
            "date": current,
            "weekday": wd,
            "is_today": current == today.isoformat(),
            "tasks": [{
                "id": t["id"],
                "title": t["title"],
                "scheduled_time": t.get("scheduled_time"),
                "estimated_minutes": t.get("estimated_minutes"),
                "event_type": t.get("event_type", "ddl"),
                "urgency": t.get("urgency", 3),
            } for t in day_tasks],
            "total_minutes": total,
        })
        current = _add_days(current, 1)

    return jsonify({"days": result})


@tasks_bp.route("/api/tasks/<int:task_id>", methods=["GET"])
def get_task(task_id):
    task = db.get_task(task_id)
    if not task:
        return jsonify({"error": "找不到任務"}), 404
    return jsonify(task)


@tasks_bp.route("/api/tasks/<int:task_id>", methods=["PATCH"])
def update_task(task_id):
    data = request.get_json(silent=True) or {}
    ok = db.update_task(task_id, data)
    if not ok:
        return jsonify({"error": "找不到任務"}), 404
    return jsonify({"ok": True})


@tasks_bp.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    ok = db.delete_task(task_id)
    if not ok:
        return jsonify({"error": "找不到任務"}), 404
    return jsonify({"ok": True})


@tasks_bp.route("/api/tasks/<int:task_id>/schedule", methods=["POST"])
def schedule_task(task_id):
    data = request.get_json(silent=True) or {}
    scheduled_date = data.get("scheduled_date")
    scheduled_time = data.get("scheduled_time")
    minutes = data.get("estimated_minutes")
    if not scheduled_date:
        return jsonify({"error": "需要 scheduled_date"}), 400

    update = {
        "scheduled_date": scheduled_date,
        "scheduled_time": scheduled_time,
        "status": "scheduled",
        "decision": "do",
    }
    if minutes is not None:
        update["estimated_minutes"] = int(minutes)

    ok = db.update_task(task_id, update)
    if not ok:
        return jsonify({"error": "排程失敗，任務不存在"}), 400
    return jsonify({"ok": True})


@tasks_bp.route("/api/tasks/unsure", methods=["GET"])
def list_unsure_tasks():
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE status IN ('unsure') "
            "OR (status='decided' AND scheduled_date IS NULL) "
            "OR decision='skip' "
            "ORDER BY CASE WHEN decision='skip' THEN 0 ELSE 1 END, created_at DESC"
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@tasks_bp.route("/api/tasks/<int:task_id>/tinder-decide", methods=["POST"])
def tinder_decide(task_id):
    body = request.get_json() or {}
    decision = body.get("decision")

    if decision == "do":
        task = db.get_task(task_id)
        update = {"status": "decided", "decision": "do"}
        if task and task.get("event_type") == "event" and task.get("deadline"):
            dl = task["deadline"]
            if "T" in dl:
                parts = dl.split("T")
                update["scheduled_date"] = parts[0]
                update["scheduled_time"] = parts[1][:5] if len(parts) > 1 else None
            else:
                update["scheduled_date"] = dl
        db.update_task(task_id, update)
    elif decision == "skip":
        db.update_task(task_id, {"decision": "skip"})
    elif decision == "archive":
        # 不處理：保持 decided 狀態，留在待排程池
        db.update_task(task_id, {"status": "decided", "decision": "skip"})

    return jsonify({"ok": True})


def _add_days(date_str: str, n: int) -> str:
    d = datetime.fromisoformat(date_str)
    return (d + timedelta(days=n)).strftime("%Y-%m-%d")
