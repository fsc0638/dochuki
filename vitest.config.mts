import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // 對齊 tsconfig.json 的 paths，讓測試能用 @/lib/money/... 匯入
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // *.eval.ts 供 Phase 2 的解析評估集使用
    include: ["tests/**/*.{test,spec,eval}.ts"],
    // Phase 0 尚無測試檔，之後有了就會實際執行
    passWithNoTests: true,
  },
});
