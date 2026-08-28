from app.rules.datetime_rule import HIGH, MEDIUM, extract_datetime


def test_reiwa_date_only_is_medium(make_lines):
    lines = make_lines([("令和6年3月15日", 0.9)])
    result = extract_datetime(lines)
    assert result["value"].startswith("2024-03-15")
    assert result["confidence"] == MEDIUM


def test_reiwa_gannen_with_time_is_high(make_lines):
    lines = make_lines([("令和元年12月1日 14:30", 0.9)])
    result = extract_datetime(lines)
    assert result["value"] == "2019-12-01T14:30:00+09:00"
    assert result["confidence"] == HIGH


def test_slash_date_only_is_medium(make_lines):
    lines = make_lines([("2024/03/15", 0.9)])
    result = extract_datetime(lines)
    assert result["value"].startswith("2024-03-15")
    assert result["confidence"] == MEDIUM


def test_no_date_anywhere_returns_none(make_lines):
    lines = make_lines([("スーパーマーケット", 0.9), ("合計 ¥500", 0.9)])
    result = extract_datetime(lines)
    assert result["value"] is None
    assert result["confidence"] == 0.0


def test_western_year_date_with_time_is_high(make_lines):
    lines = make_lines([("2024年3月15日 09:05", 0.9)])
    result = extract_datetime(lines)
    assert result["value"] == "2024-03-15T09:05:00+09:00"
    assert result["confidence"] == HIGH


def test_unrelated_date_without_time_does_not_win_over_purchase_datetime_with_time(make_lines):
    # 集點卡效期（無時間）印在交易時間（有時間）上面——原本逐字串找「第一個
    # 命中」會誤採效期；改成優先取「含時間」的那筆才是真正的交易時間
    lines = make_lines(
        [
            ("ポイントカード有効期限 2028/12/31", 0.9),
            ("合計 ¥3,260", 0.9),
            ("2026/08/24 11:30", 0.9),
        ]
    )
    result = extract_datetime(lines)
    assert result["value"] == "2026-08-24T11:30:00+09:00"
    assert result["confidence"] == HIGH


def test_multiple_date_only_matches_take_the_bottom_most(make_lines):
    lines = make_lines([("2026/08/01", 0.9), ("2026/08/24", 0.9)])
    result = extract_datetime(lines)
    assert result["value"].startswith("2026-08-24")
    assert result["confidence"] == MEDIUM
