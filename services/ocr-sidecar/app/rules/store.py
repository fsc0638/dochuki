"""店名擷取：收據店名幾乎必然出現在最上方，故只看前 3 個非空行。"""

import re

from app.rules.datetime_rule import matches_date_pattern
from app.schema import OcrLine

HIGH = 0.9
LOW = 0.3

_NAME_CHAR_PATTERN = re.compile(r"[぀-ヿ一-鿿A-Za-z]")
_BARE_PRICE_PATTERN = re.compile(r"^[¥￥]?\s?\d[\d,]*\s?(円)?$")

# 收據上常見的通用文件標題字樣——不是店名，是文件類型標籤，常印在第一行；
# 不排除的話會被誤判成店名，真正的店名（通常在第二三行）反而抓不到
_GENERIC_TITLE_WORDS = {"領収書", "領収証", "レシート", "御買上票", "お買い上げ票", "納品書", "請求書"}


def _is_store_name_candidate(text: str) -> bool:
    stripped = text.strip()
    if stripped in _GENERIC_TITLE_WORDS:
        return False
    if not (2 <= len(stripped) <= 40):
        return False
    if not _NAME_CHAR_PATTERN.search(stripped):
        return False
    if matches_date_pattern(stripped):
        return False
    if _BARE_PRICE_PATTERN.match(stripped):
        return False
    return True


def extract_store(lines: list[OcrLine]) -> dict:
    non_empty = [line for line in lines if line.text.strip()]
    if not non_empty:
        return {"value": None, "confidence": 0.0}

    window = non_empty[:3]
    for line in window:
        if _is_store_name_candidate(line.text):
            return {"value": line.text, "confidence": HIGH}

    # 前三行沒有任何一行通過店名樣式檢查——回傳第一行原文只是給確認頁一個
    # 起點，不是真的驗證過的店名，信心分數比照這個事實壓低（原本用跟 HIGH
    # 同量級的 flat MEDIUM，把「完全沒過濾」講成「中等信心」並不誠實）
    return {"value": non_empty[0].text, "confidence": LOW}
