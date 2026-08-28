from app.rules.tax import HIGH, MEDIUM, extract_tax


def test_consumption_tax_with_rate_and_price_is_high(make_lines):
    lines = make_lines([("消費税 8% ¥80", 0.9)])
    result = extract_tax(lines)
    assert result["confidence"] == HIGH
    assert len(result["value"]) == 1
    entry = result["value"][0]
    assert entry["rate"] == 0.08
    assert entry["amount"] == 80.0


def test_uchizei_alone_with_no_rate_is_medium_and_no_fabricated_rate(make_lines):
    lines = make_lines([("内税", 0.9)])
    result = extract_tax(lines)
    assert result["confidence"] == MEDIUM
    assert result["value"] == []


def test_uchizei_with_rate_on_same_line_reuses_it(make_lines):
    lines = make_lines([("内税 対象8%商品", 0.9)])
    result = extract_tax(lines)
    assert result["confidence"] == MEDIUM
    modes = [e["mode"] for e in result["value"]]
    assert "內稅(税込)" in modes
    assert result["value"][0]["rate"] == 0.08


def test_mixed_rates_pick_the_rate_near_each_keyword_not_the_first_in_document(make_lines):
    # 10%對象的品項印在前面、8%對象＋內稅印在後面——若稅率搜尋沒有限定在
    # 關鍵字附近的窗口，會誤把文件裡第一個出現的 10% 配給內稅（應為 8%）
    lines = make_lines([("10%対象 (税抜) ¥1,000", 0.9), ("8%対象 (税込) ¥540", 0.9)])
    result = extract_tax(lines)
    by_mode = {e["mode"]: e["rate"] for e in result["value"]}
    assert by_mode["內稅(税込)"] == 0.08
    assert by_mode["外稅(税抜)"] == 0.1


def test_rate_pattern_does_not_match_inside_larger_percentage(make_lines):
    # 服務費 18% 不該被誤讀成消費稅 8%；手續費 110% 不該被誤讀成 10%——
    # 兩行各自的稅率窗口內都沒有真正的 8%/10%，正確結果是完全不建立
    # entry（沒有證據就不捏造），而不是把 18%/110% 誤讀成 8%/10%
    lines = make_lines([("サービス料18% 内税", 0.9), ("手数料110% 外税", 0.9)])
    result = extract_tax(lines)
    assert result["value"] == []
    assert result["confidence"] == MEDIUM


def test_no_tax_keywords_returns_empty(make_lines):
    lines = make_lines([("店名", 0.9), ("合計 ¥500", 0.9)])
    result = extract_tax(lines)
    assert result["value"] == []
    assert result["confidence"] == 0.0
