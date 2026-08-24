import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // 使用者家目錄有游離的 package-lock.json，Next.js 會據此把 workspace root
    // 誤判為 C:\Users\<user>。明確指定專案目錄為根，避免解析到專案外的檔案。
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
