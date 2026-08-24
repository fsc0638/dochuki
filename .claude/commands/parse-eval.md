---
description: 跑收據解析評估並分析錯誤型態
allowed-tools: Bash, Read, Grep, Glob
---
執行 `RUN_PARSE_EVAL=1 pnpm test parse.eval`（P3 落地時發現：測試檔實際檔名為 `tests/parse.eval.ts`，點號分隔，`parse-eval` 連字號字串比對不到；另外評估會真的呼叫 Anthropic API 花錢，改為需要 `RUN_PARSE_EVAL=1` 才會真的執行，見 `fixtures/receipts/README.md`），整理關鍵欄位（total/datetime/currency/tax_rate）錯誤率與品項召回率；對錯誤案例分類（褪色/直書/皺摺/手寫/稅制判讀…），提出提示詞或前處理的具體改進建議，但改動 src/lib/parse/prompt.ts 前先徵求我同意。$ARGUMENTS
