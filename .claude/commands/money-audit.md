---
description: 稽核全 repo 是否違反 CLAUDE.md 金額處理鐵律
allowed-tools: Read, Grep, Glob
---
依 CLAUDE.md「金額處理鐵律」稽核目前程式碼：1) 搜尋任何以 number/float 進行金額運算之處（parseFloat、+、*、toFixed 用於金額）2) 檢查是否所有金額計算都經過 src/lib/money/ 3) 檢查 rateUsed 是否在任何地方被回溯修改 4) 檢查捨入是否一律 HALF_UP。輸出違規清單（檔案:行號:問題:建議修法），無違規則明確說明檢查範圍。
