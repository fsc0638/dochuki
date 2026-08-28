"""判斷收據是單一定額消費（single_charge）還是逐項列品（itemized）。

single_charge 是唯一會讓下游跳過 Gemini 複核的分類，所以 OCR 品質不可信時
（mean confidence 過低）一律不能落在 single_charge——寧可誤判成 itemized/unknown
多花一次 Gemini 呼叫，也不能漏判成 single_charge 少一次覆核。
"""

from app.rules.datetime_rule import strip_date_patterns
from app.rules.total import PRICE_TOKEN_PATTERN, TOTAL_KEYWORDS
from app.schema import OcrLine

MEAN_CONFIDENCE_THRESHOLD = 0.5

HEADER_FOOTER_KEYWORDS = TOTAL_KEYWORDS + ["小計", "釣り", "お預り"]

SINGLE_CHARGE_INDICATIVE_KEYWORDS = ["タクシー", "駐車場", "自動販売機", "入場券", "駐輪場"]

SINGLE_CHARGE_HIGH = 0.8
SINGLE_CHARGE_LOW = 0.6
ITEMIZED_BASE = 0.6
ITEMIZED_STEP = 0.1
ITEMIZED_MAX = 0.9
ITEMIZED_MAX_EXTRA_TOKENS = 3


def _is_header_footer_line(text: str) -> bool:
    return any(kw in text for kw in HEADER_FOOTER_KEYWORDS)


def classify_charge_type(lines: list[OcrLine]) -> dict:
    raw_text = "\n".join(line.text for line in lines)
    body_text = "\n".join(line.text for line in lines if not _is_header_footer_line(line.text))
    # 日期本身是一串數字（2026年08月24日 12:34），不挖掉的話幾乎每張收據
    # 都會因為印著日期而被誤數出好幾個「金額」token，讓 <=1 的 single_charge
    # 門檻形同虛設——見 datetime_rule.strip_date_patterns 的說明
    price_token_count = len(PRICE_TOKEN_PATTERN.findall(strip_date_patterns(body_text)))

    if not lines:
        mean_confidence = 0.0
    else:
        mean_confidence = sum(line.confidence for line in lines) / len(lines)

    if mean_confidence < MEAN_CONFIDENCE_THRESHOLD:
        return {"type": "unknown", "confidence": 0.0, "price_token_count": price_token_count}

    if price_token_count <= 1:
        has_indicative_keyword = any(kw in raw_text for kw in SINGLE_CHARGE_INDICATIVE_KEYWORDS)
        confidence = SINGLE_CHARGE_HIGH if has_indicative_keyword else SINGLE_CHARGE_LOW
        return {"type": "single_charge", "confidence": confidence, "price_token_count": price_token_count}

    extra_tokens = min(price_token_count - 2, ITEMIZED_MAX_EXTRA_TOKENS)
    confidence = min(ITEMIZED_BASE + extra_tokens * ITEMIZED_STEP, ITEMIZED_MAX)
    return {"type": "itemized", "confidence": confidence, "price_token_count": price_token_count}
