from app.rules.total import HIGH, LOW, MEDIUM, extract_total


def test_keyword_with_price_same_line_is_high(make_lines):
    lines = make_lines([("店名", 0.9), ("合計 ¥1,234", 0.9)])
    result = extract_total(lines)
    assert result["value"] == 1234.0
    assert result["confidence"] == HIGH


def test_price_without_keyword_anywhere_is_low(make_lines):
    lines = make_lines([("店名", 0.9), ("1,234", 0.9)])
    result = extract_total(lines)
    assert result["value"] == 1234.0
    assert result["confidence"] == LOW


def test_conflicting_keyword_matches_take_bottom_most(make_lines):
    lines = make_lines(
        [
            ("小計", 0.9),
            ("合計 ¥1,000", 0.9),
            ("お会計 ¥1,200", 0.9),
        ]
    )
    result = extract_total(lines)
    assert result["value"] == 1200.0
    assert result["confidence"] == MEDIUM


def test_keyword_with_price_on_next_line(make_lines):
    lines = make_lines([("合計", 0.9), ("¥900", 0.9)])
    result = extract_total(lines)
    assert result["value"] == 900.0
    assert result["confidence"] == HIGH


def test_nothing_found_returns_none(make_lines):
    lines = make_lines([("店名", 0.9), ("ありがとうございました", 0.9)])
    result = extract_total(lines)
    assert result["value"] is None
    assert result["confidence"] == 0.0


def test_four_digit_total_without_thousands_separator_is_not_truncated(make_lines):
    lines = make_lines([("店名", 0.9), ("合計 ¥1234", 0.9)])
    result = extract_total(lines)
    assert result["value"] == 1234.0
    assert result["confidence"] == HIGH


def test_five_digit_total_without_thousands_separator_is_not_truncated(make_lines):
    lines = make_lines([("店名", 0.9), ("合計 12345円", 0.9)])
    result = extract_total(lines)
    assert result["value"] == 12345.0
    assert result["confidence"] == HIGH


def test_item_count_before_amount_does_not_win_over_marked_amount(make_lines):
    # 日本 POS 常見格式「合計 N点 ¥金額」——沒有標記的寬鬆比對會把「6点」的
    # 「6」誤認成金額，比 ¥3,260 更早出現
    lines = make_lines([("コンビニ", 0.9), ("合計 6点 ¥3,260", 0.9)])
    result = extract_total(lines)
    assert result["value"] == 3260.0
    assert result["confidence"] == HIGH


def test_subtotal_does_not_match_total_keyword(make_lines):
    # Total 印在 Subtotal 上面——若「total」的比對沒有詞界、把 Subtotal 也
    # 誤認成候選行，bottom-most-wins 會選到印在下面的 Subtotal（10.0）而非
    # 真正的 Total（12.0）
    lines = make_lines([("Total $12.00", 0.9), ("Subtotal $10.00", 0.9)])
    result = extract_total(lines)
    assert result["value"] == 12.0
    assert result["confidence"] == HIGH


def test_tax_rate_breakdown_line_is_excluded_from_total_candidates(make_lines):
    # 「N%対象合計」是稅率內訳小計，不是收據總額——即使印在真正總額下方，
    # bottom-most-wins 也不該選到它
    lines = make_lines([("合計 ¥3,260", 0.9), ("（内訳）", 0.9), ("8%対象合計 ¥1,080", 0.9)])
    result = extract_total(lines)
    assert result["value"] == 3260.0
    assert result["confidence"] == HIGH
