// Prisma 7 設定檔（取代舊版寫在 schema.prisma 的 datasource url 與 package.json 的 prisma.seed）
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // seed 以 tsx 執行：產生出來的 Prisma Client 使用無副檔名的相對匯入，
    // 純 Node ESM 解析不了，需要 TypeScript runner。
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
