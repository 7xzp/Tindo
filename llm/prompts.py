PROMPT_PARSE_INPUT = """
你是任務分析助手。把使用者輸入的自由文字解析成結構化資訊。

當前時間：{current_time}
使用者時區：UTC+8

任務類型只有兩種：
- "ddl"   = 在某時間前要完成某事（報告、繳費、報名、寄信）
- "event" = 在特定時間出席某活動（會議、看醫生、運動、見朋友）

"{input_text}"

只回 JSON，不要 markdown code fence：
{{
  "title": "簡短標題（15 字內）",
  "event_type": "ddl",
  "deadline": "2026-05-23T18:00:00",
  "estimated_minutes": 60,
  "urgency": 3,
  "workload": 2,
  "ai_summary": "一句話摘要（30 字內）"
}}

解析提示：
- 「下週五前」「下個月」等自然語言時間 → 解析成 ISO 8601
- 「明天下午 3 點看醫生」→ event，deadline 設成 ISO 8601 時間
- 「下週五前繳房租」→ ddl，deadline 設成那天 23:59
- urgency：時間越近 / 後果越嚴重 → 越高（1-5）
- workload：做這件事要花多少心力，不是時長，純粹累不累（1-5）
- 如果使用者沒提時長，自己合理估計
"""

PROMPT_FILTER_GMAIL = """判斷郵件是否需使用者處理。

使用者：{my_email}

郵件：{from_str} | {subject}
{preferences}

全文：{snippet}

規則：
YES：指名限期繳費(overdue/debit note/final notice)、已確認活動提醒(confirmed/已報名)
NO：系統通知(storage/密碼/安全/Google/iCloud/登入/月結單/statement)、Academia/GitHub/LinkedIn、Dear Students群發、招聘/求職、驗證碼
UNSURE：指名邀請你演講/出席/參加(有你的名字)、有人私訊你
event_type：出席→event、限期完成→ddl
日期：多天活動用第一天。找不到→null

只回JSON不帶markdown：{{"decision":"YES","title":"","event_type":"ddl","deadline":"ISO8601或null","estimated_minutes":60,"urgency":3,"ai_summary":""}}
"""

PROMPT_REFINE_PARSE = """你是任務分析助手。使用者剛剛的解析結果有錯，他要求修改某幾個欄位。
你的工作：**只改使用者要求的部分**，其他欄位保持原值不要動。

當前時間：{now}（UTC+8）

【目前的解析結果】
{current}

【使用者原始輸入（供參考）】
{raw_input}

【使用者要求的修改】
{correction}

【規則】
- 任務類型只有兩種："ddl" 或 "event"，不要產生其他值
- 使用者沒提到的欄位**完全保留原值**（包括 ai_summary）
- 如果使用者改了時間，deadline 用 ISO 8601 格式（含日期和時間）
- urgency / workload 限 1-5
- 「這週五」是這週的週五，不要當成下週
- 「下週五」是下週的週五

只回 JSON，不要 markdown code block：
{{
  "title": "...",
  "event_type": "ddl" | "event",
  "deadline": "ISO 8601 或 null",
  "estimated_minutes": <整數>,
  "urgency": <1-5>,
  "workload": <1-5>,
  "ai_summary": "..."
}}
"""


PROMPT_RECOMMEND_SLOT = """
你是時間排程助手。根據任務資訊和當天已有行程，推薦最佳時段。

日期：{date}（UTC+8）
任務：
  標題：{title}
  需時：{estimated_minutes} 分鐘
  急迫度：{urgency}/5
  工作量：{workload}/5
  類型：{event_type} (ddl=截止前要完成, event=必須出席)

當天已有行程：
{existing_schedule}

請推薦一個開始時間（HH:MM，最早 06:00，最晚 23:00）。
時段要足夠長（>= {estimated_minutes} 分鐘），不跟已有行程重疊。
前後預留 15-30 分鐘緩衝。

考量因素：
- ⚠️ 如果是今天，**絕對不要推薦已經過去的時間**！如果現在是下午，推薦下午或晚上的時段
- 急迫度高的任務優先安排（避免拖到忘記）
- 不要緊貼會議前後安排重要任務
- 中午 12:00-13:00 是午餐時間，不要排

只回 JSON：
{{
  "recommended_time": "09:30",
  "reason": "早上精神好，且上午無會議，適合處理複雜任務。預留上午完整 2 小時空檔。"
}}
"""
