---
description: 跑收據解析評估並分析錯誤型態
allowed-tools: Bash, Read, Grep, Glob
---
執行 `pnpm test parse-eval`，整理關鍵欄位（total/datetime/currency/tax_rate）錯誤率與品項召回率；對錯誤案例分類（褪色/直書/皺摺/手寫/稅制判讀…），提出提示詞或前處理的具體改進建議，但改動 src/lib/parse/prompt.ts 前先徵求我同意。$ARGUMENTS
