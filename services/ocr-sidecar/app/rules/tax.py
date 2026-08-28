"""消費税擷取。稅率與內稅/外稅是兩條獨立證據線，沒有配對到稅率就不捏造 entry。"""

import re

from app.rules.total import PRICE_TOKEN_PATTERN
from app.schema import OcrLine

HIGH = 0.85
MEDIUM = 0.5

CONSUMPTION_TAX_KEYWORD = "消費税"
UCHIZEI_KEYWORDS = ["内税", "税込"]
SOTOZEI_KEYWORDS = ["外税", "税抜"]
UCHIZEI_MODE = "內稅(税込)"
SOTOZEI_MODE = "外稅(税抜)"

# 前面不可以緊接著另一個數字——否則「18%」「28%」…「98%」會被誤判成命中
# 「8%」，「110%」「210%」會被誤判成命中「10%」
_RATE_PATTERN = re.compile(r"(?<!\d)(8|10)[%％]")


def _rate_in_text(text: str) -> tuple[float | None, tuple[int, int] | None]:
    match = _RATE_PATTERN.search(text)
    if not match:
        return None, None
    return int(match.group(1)) / 100, match.span()


def _price_in_text(text: str, exclude_span: tuple[int, int] | None) -> float | None:
    if exclude_span:
        start, end = exclude_span
        text = text[:start] + text[end:]
    match = PRICE_TOKEN_PATTERN.search(text)
    if not match:
        return None
    return float(match.group(1).replace(",", ""))


def _extract_rate_and_amount(window: list[OcrLine]) -> tuple[float | None, float | None]:
    rate: float | None = None
    rate_span: tuple[int, int] | None = None
    rate_line_index: int | None = None
    for i, line in enumerate(window):
        r, span = _rate_in_text(line.text)
        if r is not None:
            rate, rate_span, rate_line_index = r, span, i
            break

    amount: float | None = None
    for i, line in enumerate(window):
        exclude = rate_span if i == rate_line_index else None
        a = _price_in_text(line.text, exclude)
        if a is not None:
            amount = a
            break

    return rate, amount


def _contains_any(lines: list[OcrLine], keywords: list[str]) -> bool:
    return any(kw in line.text for line in lines for kw in keywords)


def _rate_near_keyword(lines: list[OcrLine], keywords: list[str]) -> float | None:
    """在命中 keywords 的那一行本身＋下一行的窗口內找稅率，不是掃全文——
    掃全文會在同時混合 8%/10% 兩種稅率的收據上，把離關鍵字很遠、甚至屬於
    另一個品項的稅率誤配到這個 mode（對抗式審查抓到的問題）。"""
    for i, line in enumerate(lines):
        if not any(kw in line.text for kw in keywords):
            continue
        window = [line] + ([lines[i + 1]] if i + 1 < len(lines) else [])
        for w in window:
            rate, _ = _rate_in_text(w.text)
            if rate is not None:
                return rate
        return None  # 找到關鍵字但鄰近沒有稅率證據——只看第一個命中的行

    return None


def extract_tax(lines: list[OcrLine]) -> dict:
    entries: list[dict] = []
    has_full_entry = False
    has_partial_evidence = False

    for i, line in enumerate(lines):
        if CONSUMPTION_TAX_KEYWORD not in line.text:
            continue
        window = [line] + ([lines[i + 1]] if i + 1 < len(lines) else [])
        rate, amount = _extract_rate_and_amount(window)
        if rate is not None and amount is not None:
            entries.append({"rate": rate, "amount": amount, "mode": None})
            has_full_entry = True

    for keywords, mode in ((UCHIZEI_KEYWORDS, UCHIZEI_MODE), (SOTOZEI_KEYWORDS, SOTOZEI_MODE)):
        if not _contains_any(lines, keywords):
            continue
        has_partial_evidence = True
        rate = _rate_near_keyword(lines, keywords)
        if rate is not None:
            entries.append({"rate": rate, "amount": None, "mode": mode})
        # 找不到任何稅率證據就不建立 entry——寧可漏掉也不捏造 rate

    if has_full_entry:
        confidence = HIGH
    elif has_partial_evidence:
        confidence = MEDIUM
    else:
        confidence = 0.0

    return {"value": entries, "confidence": confidence}
