import { createHash, randomBytes } from "node:crypto";

/**
 * Session token 與邀請券共用的產生／雜湊工具。
 *
 * 兩者都是「持有即身分」的憑證（bearer credential），所以規則一致：
 *   - 原始值只在簽發當下回傳一次，之後任何地方都拿不回來
 *   - 資料庫只存 SHA-256，外洩不等於可以冒用
 *   - 不加 salt——這裡的輸入是 256 bit 的隨機值，不是低熵的密碼，
 *     彩虹表對它沒有意義，加 salt 只會讓「用 tokenHash 查表」變得不可能
 */

const TOKEN_BYTES = 32;

/** 產生一組新的 token（base64url，43 個字元，256 bit 熵） */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** 算出存進 DB 的雜湊。查詢時對使用者送來的 token 做同樣的轉換再比對。 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
