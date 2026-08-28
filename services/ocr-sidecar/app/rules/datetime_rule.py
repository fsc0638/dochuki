"""日期/時間擷取。輸出一律轉成 ISO 8601 +09:00（收據來源皆為日本境內消費）。"""

import re

from app.schema import OcrLine

HIGH = 0.9
MEDIUM = 0.6

# 三種日期樣式依優先序嘗試，每種皆有「含時間」與「僅日期」兩個 tier。
_REIWA_PATTERN = re.compile(
    r"令和(\d{1,2}|元)年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?"
)
_JP_ERA_PATTERN = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?")
_SLASH_PATTERN = re.compile(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?")

_ALL_DATE_PATTERNS = (_REIWA_PATTERN, _JP_ERA_PATTERN, _SLASH_PATTERN)

REIWA_EPOCH_YEAR = 2018  # 令和元年 = 2019，故西元年 = 2018 + N


def matches_date_pattern(text: str) -> bool:
    return any(pattern.search(text) for pattern in _ALL_DATE_PATTERNS)


def strip_date_patterns(text: str) -> str:
    """把已知日期樣式從文字中挖掉，供 classify.py 數金額樣式 token 時用——
    日期本身也是一串數字（2026年08月24日 12:34 含 5 組數字），不排除的話
    會被 PRICE_TOKEN_PATTERN 誤數成好幾筆「金額」，導致幾乎必印日期的
    單筆消費收據永遠分類不到 single_charge（對抗式審查抓到的問題）。"""
    for pattern in _ALL_DATE_PATTERNS:
        text = pattern.sub(" ", text)
    return text


def _to_iso(year: int, month: int, day: int, hour: str | None, minute: str | None) -> str:
    time_part = f"{int(hour):02d}:{int(minute):02d}:00" if hour and minute else "00:00:00"
    return f"{year:04d}-{month:02d}-{day:02d}T{time_part}+09:00"


def _western_to_iso(match: re.Match) -> str:
    year, month, day, hour, minute = match.groups()
    return _to_iso(int(year), int(month), int(day), hour, minute)


def _reiwa_to_iso(match: re.Match) -> str:
    era_year_raw, month, day, hour, minute = match.groups()
    era_year = 1 if era_year_raw == "元" else int(era_year_raw)
    return _to_iso(REIWA_EPOCH_YEAR + era_year, int(month), int(day), hour, minute)


_PATTERN_CONVERTERS = (
    (_REIWA_PATTERN, _reiwa_to_iso),
    (_JP_ERA_PATTERN, _western_to_iso),
    (_SLASH_PATTERN, _western_to_iso),
)


def extract_datetime(lines: list[OcrLine]) -> dict:
    """逐行找日期樣式，而非直接對合併全文做單一 .search()——同一張收據常
    同時印著不相關的日期（如集點卡效期）與真正的交易時間，兩者若剛好都
    在文字最前面附近，原本「取第一個命中」的寫法會誤採不相關的那個。
    改成收集每個樣式 tier 命中的所有行，優先取「含時間」的，同一 tier 內
    取最下面（y 最大）那筆——跟 total.py 的 bottom-most-wins 慣例一致，
    收據的交易時間通常印在頁尾金額附近。"""
    for pattern, to_iso in _PATTERN_CONVERTERS:
        with_time: list[tuple[float, str]] = []  # (y, iso)
        date_only: list[tuple[float, str]] = []
        for line in lines:
            match = pattern.search(line.text)
            if not match:
                continue
            has_time = match.group(4) is not None and match.group(5) is not None
            (with_time if has_time else date_only).append((line.y, to_iso(match)))

        if with_time:
            with_time.sort(key=lambda m: m[0])
            return {"value": with_time[-1][1], "confidence": HIGH}
        if date_only:
            date_only.sort(key=lambda m: m[0])
            return {"value": date_only[-1][1], "confidence": MEDIUM}

    return {"value": None, "confidence": 0.0}
