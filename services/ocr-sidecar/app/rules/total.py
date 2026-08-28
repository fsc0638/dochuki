"""總金額擷取：優先找關鍵字錨定的價格，找不到才退而求其次抓全文最大數字。"""

import re

from app.schema import OcrLine

HIGH = 0.9
MEDIUM = 0.5
LOW = 0.2

TOTAL_KEYWORDS = ["合計", "お会計", "ご請求額", "合計金額", "お買上げ合計"]
_TOTAL_KEYWORD_PATTERN = re.compile(
    "|".join(re.escape(kw) for kw in TOTAL_KEYWORDS) + r"|\btotal\b", re.IGNORECASE
)
# 「N%対象合計」這類稅率內訳小計行也含「合計」二字，但那是某個稅率底下的
# 小計、不是收據總額——比對到關鍵字的同時若也命中這個樣式，該行不當作
# 總額候選（否則「bottom-most 取最下面那行」的慣例會誤選到印在總額下方的
# 稅率內訳而非真正的總額）
_BREAKDOWN_LINE_PATTERN = re.compile(r"[%％]\s*対象")

# 千分位版本（1,234）與無千分位版本（1234）分成兩個分支——原本用
# \d{1,3}(?:,\d{3})* 單一分支想兩種都吃，但沒有逗號時 \d{1,3} 只貪婪吃到
# 前 3 位就滿足了，(?:,\d{3})* 允許零次重複、不會強迫它往後吃，導致「1234」
# 被截斷成「123」——4 位以上、沒有千分位逗號的金額會悄悄掉尾數
PRICE_TOKEN_PATTERN = re.compile(r"[¥￥]?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:円)?")
# 附幣別標記的版本——「合計 6点 ¥3,260」這種「關鍵字+件數+金額」是常見的
# 日本 POS 收據格式，沒有標記的 PRICE_TOKEN_PATTERN 會把「6点」的「6」誤認
# 成金額（比 ¥3,260 更早出現）。_first_price 優先找有 ¥/￥ 前綴或 円 後綴
# 的數字，兩種都找不到才退回不看標記的寬鬆版本
_YEN_PREFIXED_PATTERN = re.compile(r"[¥￥]\s?(\d{1,3}(?:,\d{3})+|\d+)")
_YEN_SUFFIXED_PATTERN = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+)円")


def _contains_keyword(text: str) -> bool:
    return bool(_TOTAL_KEYWORD_PATTERN.search(text)) and not _BREAKDOWN_LINE_PATTERN.search(text)


def _first_price(text: str) -> float | None:
    for pattern in (_YEN_PREFIXED_PATTERN, _YEN_SUFFIXED_PATTERN, PRICE_TOKEN_PATTERN):
        match = pattern.search(text)
        if match:
            return float(match.group(1).replace(",", ""))
    return None


def extract_total(lines: list[OcrLine]) -> dict:
    keyword_lines = [(i, line) for i, line in enumerate(lines) if _contains_keyword(line.text)]

    matches: list[tuple[float, float]] = []  # (y, amount)
    for i, line in keyword_lines:
        amount = _first_price(line.text)
        if amount is None and i + 1 < len(lines):
            amount = _first_price(lines[i + 1].text)
        if amount is not None:
            matches.append((line.y, amount))

    if matches:
        matches.sort(key=lambda m: m[0])
        best_y, best_amount = matches[-1]
        confidence = HIGH if len(matches) == 1 else MEDIUM
        return {"value": best_amount, "confidence": confidence}

    # 沒有關鍵字命中,退而求其次抓全文最大的價格樣式數字
    all_amounts = [
        float(m.group(1).replace(",", "")) for m in PRICE_TOKEN_PATTERN.finditer("\n".join(l.text for l in lines))
    ]
    if all_amounts:
        return {"value": max(all_amounts), "confidence": LOW}

    return {"value": None, "confidence": 0.0}
