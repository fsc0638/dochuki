---
description: 跑新潟金額迴歸測試並修到全綠
allowed-tools: Bash, Read, Edit, Grep, Glob
---
執行 `pnpm test regression`。若失敗：先讀 tests/money.regression.test.ts 與 src/lib/money/ 找根因（禁止修改測試期望值——期望值來自 CLAUDE.md 迴歸案例，是真實行程的正確答案），修正後重跑直到全綠，最後總結改了什麼與原因。$ARGUMENTS
