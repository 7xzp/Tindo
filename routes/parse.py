from flask import Blueprint, request, jsonify
from config import get_llm_config
from llm.client import LLMClient
from llm.prompts import PROMPT_PARSE_INPUT, PROMPT_RECOMMEND_SLOT, PROMPT_REFINE_PARSE
from datetime import datetime, timezone, timedelta

LOCAL_TZ = timezone(timedelta(hours=8))

parse_bp = Blueprint("parse", __name__)


@parse_bp.route("/api/parse", methods=["POST"])
def parse_input():
    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    tz = data.get("timezone", "Asia/Hong_Kong")
    if not text:
        return jsonify({"error": "請輸入文字"}), 400

    try:
        cfg = get_llm_config()
        client = LLMClient(cfg)
        now = datetime.now(LOCAL_TZ).strftime("%Y-%m-%dT%H:%M:%S+08:00")
        prompt = PROMPT_PARSE_INPUT.format(current_time=now, input_text=text, timezone=tz)
        result = client.parse_json(prompt)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": f"AI 服務未設定：{str(e)}"}), 503
    except Exception as e:
        return jsonify({"error": f"AI 服務暫時不可用：{str(e)}"}), 503


@parse_bp.route("/api/recommend-slot", methods=["POST"])
def recommend_slot():
    """AI 推薦最佳時段"""
    data = request.get_json(silent=True) or {}
    task = data.get("task", {})
    existing = data.get("existing_tasks", [])
    date = data.get("date", "")

    # 整理已有行程
    lines = []
    for t in existing:
        t_str = t.get("scheduled_time", "?")
        dur = t.get("estimated_minutes", 60)
        lines.append(f"  {t_str} — {t.get('title','?')} ({dur}m, {t.get('event_type','ddl')})")
    schedule_text = "\n".join(lines) if lines else "（無任何行程，全天自由）"

    prompt = PROMPT_RECOMMEND_SLOT.format(
        date=date,
        title=task.get("title", ""),
        estimated_minutes=task.get("estimated_minutes", 60),
        urgency=task.get("urgency", 3),
        workload=task.get("workload", 2),
        event_type=task.get("event_type", "ddl"),
        existing_schedule=schedule_text,
    )

    try:
        cfg = get_llm_config()
        client = LLMClient(cfg)
        result = client.parse_json(prompt)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        return jsonify({"error": f"AI 服務暫時不可用：{str(e)}"}), 503


@parse_bp.route("/api/refine-parse", methods=["POST"])
def refine_parse():
    body = request.get_json(silent=True) or {}
    current = body.get("current") or {}
    raw_input = body.get("raw_input", "")
    correction = (body.get("correction") or "").strip()

    if not correction:
        return jsonify({"error": "請輸入修改指示"}), 400

    try:
        import json as _json
        cfg = get_llm_config()
        client = LLMClient(cfg)
        now = datetime.now(LOCAL_TZ).strftime("%Y-%m-%d %H:%M (週%w)")
        prompt = PROMPT_REFINE_PARSE.format(
            now=now,
            current=_json.dumps(current, ensure_ascii=False, indent=2),
            raw_input=raw_input or "(無原始輸入)",
            correction=correction,
        )
        raw = client.chat([{"role": "user", "content": prompt}])
        data = _extract_json(raw)
        if data.get("event_type") not in ("ddl", "event"):
            data["event_type"] = current.get("event_type", "ddl")
        return jsonify(data)
    except ValueError as e:
        return jsonify({"error": f"AI 服務未設定：{str(e)}"}), 503
    except Exception as e:
        return jsonify({"error": f"AI 修改失敗：{str(e)}"}), 500


@parse_bp.route("/api/analyze-conflict", methods=["POST"])
def analyze_conflict():
    """AI 分析：這天排這個任務會有衝突或太累嗎"""
    body = request.get_json(silent=True) or {}
    date = body.get("date", "")
    task_title = body.get("task_title", "")
    task_minutes = body.get("task_minutes", 60)
    existing = body.get("existing_tasks", [])

    lines = []
    for t in existing:
        lines.append(f"  {t.get('scheduled_time','?')} {t.get('title','?')} ({t.get('estimated_minutes',60)}m)")
    schedule_text = "\n".join(lines) if lines else "當天無其他排程"

    prompt = f"""你是時間衝突分析助手。分析這天是否適合排入這個任務。

日期：{date}
新任務：{task_title}（{task_minutes} 分鐘）

當天已有行程：
{schedule_text}

分析：
1. 是否有時間衝突（新任務和既有任務重疊）？
2. 當天總負荷多大？排完後會不會太累？
3. 建議：適合 / 勉強可以 / 不建議

只回 JSON：
{{{{"conflict": true|false, "total_minutes": <數字>, "fatigue_level": "低"|"中"|"高", "advice": "簡短建議（30字內）"}}}}
"""
    try:
        cfg = get_llm_config()
        client = LLMClient(cfg)
        raw = client.chat([{"role": "user", "content": prompt}])
        data = _extract_json(raw)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 503


def _extract_json(raw: str) -> dict:
    import json as _json
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(l for l in lines if not l.strip().startswith("```"))
    s = raw.find("{")
    e = raw.rfind("}")
    if s >= 0 and e > s:
        return _json.loads(raw[s:e+1])
    return _json.loads(raw)
