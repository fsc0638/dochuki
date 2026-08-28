from app.rules.store import HIGH, LOW, extract_store


def test_clean_first_line_is_high(make_lines):
    lines = make_lines([("道中記商店", 0.9), ("2024/03/15", 0.9), ("合計 ¥500", 0.9)])
    result = extract_store(lines)
    assert result["value"] == "道中記商店"
    assert result["confidence"] == HIGH


def test_first_line_is_date_falls_through_to_second_line(make_lines):
    lines = make_lines([("2024/03/15", 0.9), ("道中記商店", 0.9), ("合計 ¥500", 0.9)])
    result = extract_store(lines)
    assert result["value"] == "道中記商店"
    assert result["confidence"] == HIGH


def test_empty_lines_returns_none(make_lines):
    result = extract_store([])
    assert result["value"] is None
    assert result["confidence"] == 0.0


def test_no_candidate_in_window_falls_back_to_low(make_lines):
    lines = make_lines([("2024/03/15", 0.9), ("¥500", 0.9), ("¥600", 0.9)])
    result = extract_store(lines)
    assert result["value"] == "2024/03/15"
    assert result["confidence"] == LOW


def test_generic_receipt_title_is_skipped_for_real_store_name(make_lines):
    lines = make_lines([("領収書", 0.9), ("2026年8月24日", 0.9), ("株式会社どこかホテル", 0.9)])
    result = extract_store(lines)
    assert result["value"] == "株式会社どこかホテル"
    assert result["confidence"] == HIGH


def test_all_generic_titles_in_window_falls_back_to_low(make_lines):
    lines = make_lines([("領収書", 0.9), ("レシート", 0.9), ("¥500", 0.9)])
    result = extract_store(lines)
    assert result["value"] == "領収書"
    assert result["confidence"] == LOW
