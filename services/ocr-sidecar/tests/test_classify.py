from app.rules.classify import classify_charge_type


def test_single_price_with_indicative_keyword_is_high_confidence(make_lines):
    lines = make_lines([("自動販売機", 0.9), ("¥150", 0.9)])
    result = classify_charge_type(lines)
    assert result["type"] == "single_charge"
    assert result["confidence"] == 0.8


def test_single_price_without_indicative_keyword_is_low_confidence(make_lines):
    lines = make_lines([("何かのお店", 0.9), ("¥500", 0.9)])
    result = classify_charge_type(lines)
    assert result["type"] == "single_charge"
    assert result["confidence"] == 0.6


def test_multi_item_lines_are_itemized(make_lines):
    lines = make_lines(
        [
            ("店名", 0.9),
            ("おにぎり ¥150", 0.9),
            ("お茶 ¥120", 0.9),
            ("パン ¥200", 0.9),
            ("合計 ¥470", 0.9),
        ]
    )
    result = classify_charge_type(lines)
    assert result["type"] == "itemized"
    assert result["price_token_count"] == 3
    assert result["confidence"] == 0.7


def test_single_charge_receipt_with_printed_date_is_not_misclassified_as_itemized(make_lines):
    # 日期本身含好幾組數字（2026年08月24日 12:34），不排除的話會被誤數成
    # 好幾個「金額」token，讓幾乎每張印著日期的收據（幾乎是全部）都過不了
    # single_charge 的 <=1 門檻——這是對抗式審查抓到最嚴重的一個問題
    lines = make_lines(
        [
            ("○○タクシー", 0.9),
            ("2026年08月24日 12:34", 0.9),
            ("¥1,200", 0.9),
        ]
    )
    result = classify_charge_type(lines)
    assert result["type"] == "single_charge"
    assert result["price_token_count"] == 1


def test_boundary_mean_confidence_exactly_at_threshold_does_not_force_unknown(make_lines):
    lines = make_lines([("自動販売機", 0.5), ("¥150", 0.5)])
    result = classify_charge_type(lines)
    assert result["type"] != "unknown"


def test_low_mean_confidence_forces_unknown_regardless_of_price_count(make_lines):
    lines = make_lines(
        [
            ("おにぎり ¥150", 0.2),
            ("お茶 ¥120", 0.2),
            ("パン ¥200", 0.2),
        ]
    )
    result = classify_charge_type(lines)
    assert result["type"] == "unknown"
    assert result["confidence"] == 0.0
    assert result["price_token_count"] == 3
