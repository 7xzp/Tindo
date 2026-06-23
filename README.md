# Tindo

个人任务排程助手。AI 驱动的日程管理：Gmail 邮件自动筛选 → Tinder 式抉择 → TodoList + 月历视图。

## 功能

- **三视区切换**：月历（1）/ 代办（2）/ 抉择（3），键盘快捷键
- **AI 解析**：自然语言输入 → DeepSeek 结构化任务（标题、时间、急迫度、工作量）
- **Gmail 整合**：OAuth 授权 → 本机规则初筛 → AI 判断 → YES 直接入 TodoList / UNSURE 进 Tinder / NO 自动过滤
- **Tinder 抉择**：邀请类（去不去？）、DDL 类（要处理吗？）、跳过类（再想想），三池切换
- **Notion 双相同步**：本机 SQLite ↔ Notion database，冲突自动建副本
- **渐进放大月历**：今天超大格 → 后 3 天 → 后 5 天 → 按月排版，任务勾选框 + 间隔标签
- **导入行程**：粘贴文字或上传 PDF/图片 → AI 自动提取所有事件 → 一键加入月历
- **排程 modal**：6 天卡片选日期 + 时间轴选时段 + AI 建议最佳时间

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.9 + Flask |
| 数据库 | SQLite（WAL mode） |
| AI | DeepSeek API（OpenAI 兼容） |
| 前端 | 原生 HTML + CSS + Vanilla JS |
| Gmail | Google API（OAuth 2.0） |
| Notion | notion-client SDK |
| OCR | pytesseract + pdfplumber |

## 快速开始

```bash
git clone https://github.com/7xzp/Tindo.git
cd Tindo
cp settings.json.example settings.json
# 编辑 settings.json，填入 DeepSeek API key
./start.sh
```

浏览器打开 `http://127.0.0.1:5088`

### Gmail 整合

1. 在 Google Cloud Console 创建 OAuth 2.0 凭证
2. 填入 `settings.json` 的 `gmail` 区块
3. `/settings` → 连接 Gmail → 授权

### Notion 整合

1. 在 Notion 创建 database "Tindo Tasks"
2. 创建 Internal integration → 拿到 token
3. Connect integration 到 database
4. 填入 `settings.json` 的 `notion` 区块

## 项目结构

```
Tindo/
├── app.py              # Flask 入口 + 背景同步
├── config.py           # settings.json 读写
├── database.py         # SQLite + migration + CRUD
├── models.py           # dataclass
├── routes/             # API 路由
├── llm/                # AI 抽象层
├── static/             # CSS + JS
├── templates/          # HTML 模板
├── migrations/         # DB migration
├── gmail_auth.py       # Gmail OAuth
├── gmail_client.py     # Gmail API 客户端
├── gmail_filter.py     # 本机规则初筛
├── gmail_processor.py  # AI 筛选流水线
├── notion_sync.py      # Notion 双相同步
└── start.sh            # 一键启动
```

## 数据安全

- `settings.json`、`data/`、`venv/` 已在 `.gitignore` 中
- 无任何用户数据、API key、Gmail token 会出现在仓库中
