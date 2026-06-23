import json
import time
from openai import OpenAI


class LLMClient:
    def __init__(self, config: dict):
        self.provider = config.get("provider", "deepseek")
        self.model = config.get("model", "deepseek-chat")
        api_key = config.get("api_key", "")
        base_url = config.get("base_url", "https://api.deepseek.com")
        if not api_key:
            raise ValueError("LLM API key 未設定")
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self._last_call_ts = 0.0
        self._min_interval = 3.0  # 每兩次呼叫最少間隔 3 秒,避免 rate limit

    def chat(self, messages: list, response_format: str = "text") -> str:
        self._rate_limit()
        kwargs = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 2048,
        }
        if response_format == "json":
            kwargs["response_format"] = {"type": "json_object"}

        resp = self.client.chat.completions.create(**kwargs)
        self._last_call_ts = time.time()
        return resp.choices[0].message.content or ""

    def parse_json_vision(self, prompt: str, images_base64: list) -> dict:
        """DeepSeek API 暫不支援 image_url 格式，fallback 到純文字（OCR 後）"""
        return {"error": "vision_not_supported", "raw": ""}

    def parse_json(self, prompt: str) -> dict:
        try:
            raw = self._chat_long([{"role": "user", "content": prompt}])
            return self._repair_json(raw)
        except Exception as e:
            return {"error": str(e), "raw": ""}

    def _chat_long(self, messages: list) -> str:
        """長回應用，max_tokens 4096"""
        self._rate_limit()
        kwargs = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 4096,
            "response_format": {"type": "json_object"},
        }
        resp = self.client.chat.completions.create(**kwargs)
        self._last_call_ts = time.time()
        return resp.choices[0].message.content or ""

    def _rate_limit(self):
        elapsed = time.time() - self._last_call_ts
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)

    @staticmethod
    def _repair_json(raw: str) -> dict:
        raw = raw.strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            raw = "\n".join(lines)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
        # 嘗試修復截斷的 JSON 陣列
        s = raw.find("[")
        e = raw.rfind("]")
        if s >= 0 and e > s:
            try:
                return json.loads(raw[s:e+1])
            except json.JSONDecodeError:
                pass
        # 最後嘗試：補上缺失的 ]
        if s >= 0 and e < 0:
            fixed = raw[s:] + "]"
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                pass
        # 嘗試包裝成 dict
        if s >= 0:
            wrapped = '{"events":' + raw[s:e+1] + '}'
            try:
                return json.loads(wrapped)
            except json.JSONDecodeError:
                pass
        return {"error": "JSON 解析失敗", "raw": raw[:200]}
