#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "[1/3] 建立虛擬環境..."
    python3 -m venv venv
fi

source venv/bin/activate

echo "[2/3] 安裝依賴..."
pip install -q -r requirements.txt

if [ ! -f "settings.json" ]; then
    echo "首次執行，請先複製 settings.json.example 為 settings.json 並填入 API key"
    cp settings.json.example settings.json
    echo "已建立 settings.json，請編輯後重新執行"
    exit 1
fi

echo "[3/3] 啟動 Tindo..."
python3 app.py
