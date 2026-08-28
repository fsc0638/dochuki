from app.rules.currency import extract_currency


def test_yen_symbol_text_is_high():
    result = extract_currency("合計 1,234円")
    assert result["value"] == "JPY"
    assert result["confidence"] == 0.9


def test_iso_code_is_higher_than_symbol():
    result = extract_currency("Total: 1234 JPY")
    assert result["value"] == "JPY"
    assert result["confidence"] == 0.95
    assert result["confidence"] > 0.9  # 高於單靠 円/¥ 符號判定的 tier


def test_kana_kanji_only_guesses_jpy_at_medium():
    result = extract_currency("スーパーマーケット 合計 千二百三十四")
    assert result["value"] == "JPY"
    assert result["confidence"] == 0.5


def test_no_evidence_returns_none():
    result = extract_currency("Total 1234")
    assert result["value"] is None
    assert result["confidence"] == 0.0


def test_non_jpy_iso_code_is_demoted_to_medium():
    # 日本境內收據上出現的非 JPY 代碼更可能是 DCC 參考金額而非真正的
    # 交易幣別，只有 JPY 給高信心；MEDIUM 過不了下游 0.6 的跳過門檻
    result = extract_currency("Total in USD: $12.34 (參考匯率)")
    assert result["value"] == "USD"
    assert result["confidence"] == 0.5


def test_iso_code_adjacent_to_cjk_with_no_separator_still_matches():
    # \b 在 Python re 對中日文字元不生效（Unicode 模式下 CJK 也算 \w），
    # OCR 常把「日本円JPY」這種無空格排版原樣辨識出來
    result = extract_currency("日本円JPY")
    assert result["value"] == "JPY"
    assert result["confidence"] == 0.95


def test_iso_code_adjacent_to_digit_with_no_separator_still_matches():
    result = extract_currency("JPY1000")
    assert result["value"] == "JPY"
    assert result["confidence"] == 0.95
