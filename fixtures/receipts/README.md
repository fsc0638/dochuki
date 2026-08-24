# 收據解析評估集

依 `docs/IMPLEMENTATION.md` §5.4。每張收據照片配一份同名的人工標註 JSON：

```
fixtures/receipts/
├─ 2026-09-13-seven-eleven.jpg
├─ 2026-09-13-seven-eleven.json   # 人工標註的正確答案
├─ 2026-09-14-ryokan.jpg
├─ 2026-09-14-ryokan.json
└─ ...
```

## 標註 JSON 格式

跟 `src/lib/schemas/receipt.ts` 的 `ReceiptParseSchema` 一樣，但**不含
`confidence`**（人工標註本身就是正確答案，沒有信心分數這回事）：

```json
{
  "store": "セブンイレブン新潟駅前店",
  "store_zh": "7-11 新潟車站前店",
  "address": "新潟県新潟市中央区花園1-1",
  "datetime": "2026-09-13T08:15:00+09:00",
  "currency": "JPY",
  "payment_method": "現金",
  "items": [
    { "name_raw": "おにぎり 鮭", "name_zh": "鮭魚飯糰", "qty": 2, "unit_price": 150, "amount": 300, "tax_rate": 0.08, "category": "餐飲" }
  ],
  "subtotal": 458,
  "tax": [{ "rate": 0.08, "amount": 36, "mode": "內稅(税込)" }],
  "total": 458
}
```

## 跑評估

```bash
RUN_PARSE_EVAL=1 pnpm test parse-eval
```

**必須加 `RUN_PARSE_EVAL=1`**——這個檔案每個樣本都會真的呼叫 Anthropic
API、花真的錢，故意不讓它被一般的 `pnpm test` 或不小心打的 `pnpm test parse-eval`
默默執行掉。

## 目前狀態

0 筆樣本。`tests/parse.eval.ts` 已就緒，但沒有真實收據照片就跑不出有意義的
數字——§5.4 的驗收線「30 張實體收據關鍵欄位人工修正率 < 20%」需要真的拍
30 張才能驗，這是目前唯一做不到、需要使用者親自補的部分（見
`CLAUDE.md` 進度日誌）。
