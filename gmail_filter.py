import re


def _extract_domain(from_str: str) -> str:
    m = re.search(r'@([\w.-]+)', from_str or "")
    return m.group(1).lower() if m else ""


SKIP_DOMAINS = {
    # 社群
    "linkedin.com", "facebookmail.com", "twitter.com", "instagram.com",
    # 開發
    "github.com", "gitlab.com",
    # 購物/旅遊
    "amazon.com", "amazon.co.jp", "taobao.com", "jd.com", "trip.com",
    "sf-express.com", "dhl.com", "fedex.com",
    # 訂閱/行銷
    "mailchimp.com", "medium.com", "substack.com",
    # 支付
    "paypal.com", "alipay.com",
    # 釣魚/詐騙常見域名
    "ccsend.com", "telenet.be",
    # foodpanda
    "foodpanda.hk", "info.foodpanda.hk",
}

SKIP_SENDERS = {
    "noreply", "no-reply", "do-not-reply", "donotreply",
    "notification", "notifications", "alert", "alerts",
    "info@", "admin@", "support@",
}


def quick_filter(email: dict) -> tuple:
    sender = (email.get("from") or "").lower()
    subject = (email.get("subject") or "").lower()
    domain = _extract_domain(email.get("from") or "")

    # 使用者自訂的「以後不處理」模式
    import database as db
    patterns = db.get_reject_patterns()
    for p in patterns:
        ps = (p.get("sender") or "").lower()
        pk = (p.get("subject_keyword") or "").lower()
        if ps and ps in sender:
            return False, f"user-reject-sender:{ps}"
        if pk and pk in subject:
            return False, f"user-reject-subject:{pk}"

    # 域名黑名單
    for d in SKIP_DOMAINS:
        if domain == d or domain.endswith("." + d):
            return False, f"skip-domain:{d}"

    # 寄件人前綴
    for s in SKIP_SENDERS:
        if sender.startswith(s) or (s.endswith("@") and s in sender):
            return False, f"skip-sender:{s}"

    # 主題關鍵字過濾
    skip_subjects = [
        r"unsubscribe", r"取消訂閱", r"退訂",
        r"verification code", r"驗證碼",
        r"order confirm", r"shipping",
        r"weekly digest", r"newsletter",
        r"security", r"安全", r"密碼", r"password", r"登入", r"sign-in",
        r"月結單", r"statement", r"戶口對賬",
        r"儲存空間", r"storage",
        r"狂賞", r"優惠", r"限時", r"降價", r"promo", r"discount",
        r"\[ad\]", r"\[廣告\]",
        r"mentioned", r"提及",  # Academia spam
        r"OpenRouter", r"Uber",
    ]
    for p in skip_subjects:
        if re.search(p, subject):
            return False, f"skip-subject:{p}"

    # 寄件人關鍵字
    skip_sender_patterns = [
        r"academia", r"uber", r"agoda", r"ubisoft",
        r"保誠", r"prudential",
        r"no-?reply", r"noreply",
    ]
    for p in skip_sender_patterns:
        if re.search(p, sender):
            return False, f"skip-sender:{p}"

    # Gmail 分類
    label_ids = email.get("label_ids", [])
    if "SPAM" in label_ids:
        return False, "Gmail Spam"

    # 內容太短 → 純通知，跳過
    snippet = email.get("snippet", "")
    body = email.get("body_text", "")
    total_len = len(snippet) + len(body)
    if total_len < 30:
        return False, "content-too-short"

    return True, "通過"
