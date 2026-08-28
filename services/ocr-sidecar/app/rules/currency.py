"""幣別擷取：對 raw_text 全文掃描，不看行位置。"""

import re

HIGH_CODE = 0.95
HIGH_SYMBOL = 0.9
MEDIUM_GUESS = 0.5

# \b 在 Python re 裡數字也算 \w，字母緊接數字（JPY1000）本來就沒有邊界；
# Unicode 模式下中日文字元同樣算 \w，字母緊接中日文（日本円JPY）也沒有
# 邊界——兩種都是 OCR 常見的無空格排版。改成只排除「緊鄰 ASCII 字母」，
# 數字／中日文字元前後都視為合法邊界，兩種情形都能正確比對到
_ISO_CODE_PATTERN = re.compile(r"(?<![A-Za-z])(JPY|TWD|USD|EUR|KRW)(?![A-Za-z])")
_JPY_SYMBOL_PATTERN = re.compile(r"円|¥|￥")
_JAPANESE_CHAR_PATTERN = re.compile(r"[぀-ヿ一-鿿]")


def extract_currency(raw_text: str) -> dict:
    code_match = _ISO_CODE_PATTERN.search(raw_text)
    if code_match:
        code = code_match.group(1)
        # 這支 sidecar 鎖定的是日本境內消費（見模組文件與 CLAUDE.md 範圍）。
        # 非 JPY 的 ISO 代碼裸字串更可能是 DCC（動態貨幣轉換）參考金額、
        # 免稅標籤上的外幣對照價，而不是這筆交易真正的幣別——只有 JPY
        # 給高信心，其餘代碼降到跟「純靠日文字猜 JPY」同一檔，確保它自己
        # 過不了下游「confidence >= 0.6 可跳過 Gemini」門檻
        confidence = HIGH_CODE if code == "JPY" else MEDIUM_GUESS
        return {"value": code, "confidence": confidence}

    if _JPY_SYMBOL_PATTERN.search(raw_text):
        return {"value": "JPY", "confidence": HIGH_SYMBOL}

    # 純靠有日文字元猜 JPY，屬「不確定下的預設值」而非真的辨識到幣別，
    # 故只給 MEDIUM——確保它自己過不了下游「confidence >= 0.6 可跳過 Gemini」門檻，
    # 只用來替人工確認 UI 先預填一個合理值。
    if _JAPANESE_CHAR_PATTERN.search(raw_text):
        return {"value": "JPY", "confidence": MEDIUM_GUESS}

    return {"value": None, "confidence": 0.0}
