import os
import tempfile
import io
import base64
from flask import Blueprint, request, jsonify
from config import get_llm_config
from llm.client import LLMClient

import_bp = Blueprint("import", __name__)
ALLOWED_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}

PROMPT_EXTRACT_ITINERARY = """你是行程提取助手。從圖片/文件中找出**所有事件**。

每個事件提取：
- title: 簡短標題
- date: 日期（ISO YYYY-MM-DD，根據上下文推斷年份和月份）
- time: 開始時間（HH:MM，如有）
- end_time: 結束時間（如有）
- location: 地點（如有）
- notes: 備註（如有）
- estimated_minutes: 預估時長（分鐘，預設 60）

⚠️ 所有事件都是 "event" 類型。
⚠️ 如果在圖片中看到多天行程，每一天都要分別提取。

只回 JSON 陣列：
[{"title":"","date":"2026-06-20","time":"09:00","end_time":"","location":"","notes":"","estimated_minutes":60}]
"""


def _format_events(result: list) -> list:
    events = []
    for item in result:
        if not isinstance(item, dict):
            continue
        events.append({
            "title": str(item.get("title", "")),
            "date": str(item.get("date", "")),
            "time": str(item.get("time", "") or ""),
            "end_time": str(item.get("end_time", "") or ""),
            "location": str(item.get("location", "") or ""),
            "notes": str(item.get("notes", "") or ""),
            "estimated_minutes": int(item.get("estimated_minutes", 60)),
        })
    return events


def _parse_events_from_text(text: str) -> list:
    cfg = get_llm_config()
    client = LLMClient(cfg)
    prompt = PROMPT_EXTRACT_ITINERARY.replace("從圖片/文件中", "從以下文字中")
    result = client.parse_json(prompt + "\n\n文字內容：\n" + text[:8000])
    if isinstance(result, dict) and "error" in result:
        raise Exception(result["error"])
    if isinstance(result, dict):
        result = [result]
    if not isinstance(result, list):
        return []
    return _format_events(result)


@import_bp.route("/api/import-itinerary-text", methods=["POST"])
def import_itinerary_text():
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()
    if not text or len(text) < 5:
        return jsonify({"error": "請輸入至少 5 個字"}), 400
    try:
        events = _parse_events_from_text(text)
        return jsonify({"events": events})
    except Exception as e:
        return jsonify({"error": f"AI 處理失敗：{str(e)}"}), 500


@import_bp.route("/api/import-itinerary", methods=["POST"])
def import_itinerary():
    if "file" not in request.files:
        return jsonify({"error": "沒有上傳檔案"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "空檔名"}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTS:
        return jsonify({"error": f"不支援的格式：{ext}"}), 400

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    file.save(tmp.name)
    tmp.close()

    try:
        if ext == ".pdf":
            text = ""
            import pdfplumber
            with pdfplumber.open(tmp.name) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t: text += t + "\n"
            if not text.strip():
                return jsonify({"error": "PDF 無法提取文字"}), 400
        else:
            import pytesseract
            from PIL import Image
            img = Image.open(tmp.name)
            text = pytesseract.image_to_string(img, lang="chi_sim+chi_tra+eng")
            if not text.strip():
                return jsonify({"error": "圖片無法提取文字"}), 400

        events = _parse_events_from_text(text)
        return jsonify({"events": events})

    except Exception as e:
        return jsonify({"error": f"AI 處理失敗：{str(e)}"}), 500
    finally:
        os.unlink(tmp.name)
