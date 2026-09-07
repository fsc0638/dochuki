import { z } from "zod";

/**
 * 帳號系統的輸入驗證（P7.1）。依專案慣例，zod 是唯一的資料驗證來源，
 * API 邊界全部過這裡。
 */

/**
 * email 一律正規化成小寫並去除前後空白後再存。沒有這一步的話，
 * 「Foo@x.com」與「foo@x.com」會因為 @unique 是區分大小寫的而變成兩個帳號，
 * 使用者自己也分不清是哪一個。
 */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("請輸入有效的電子郵件地址")
  .max(254, "電子郵件地址過長"); // RFC 5321 的實務上限

/**
 * 密碼長度下限取 10。OWASP 的建議下限是 8，這裡多兩碼是因為這個服務記的是
 * 金額與分帳結果，被冒用的後果不只是「看到資料」。
 *
 * 上限 200 純粹是防呆：scrypt 對長輸入沒有 bcrypt 那種 72 byte 截斷問題，
 * 但沒有上限等於讓人可以送 10MB 的字串進來逼伺服器算雜湊。
 */
export const PasswordSchema = z
  .string()
  .min(10, "密碼至少 10 個字元")
  .max(200, "密碼過長");

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "請輸入顯示名稱")
  .max(50, "顯示名稱過長");

export const SignupSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: DisplayNameSchema,
});
export type SignupInput = z.infer<typeof SignupSchema>;

/**
 * 登入時**不套用** PasswordSchema 的長度規則——密碼政策是註冊當下的事。
 * 拿它來擋登入會讓「你的密碼太短」變成一個可以探測的訊號，而且政策日後
 * 調嚴時舊帳號會直接登不進來。這裡只擋明顯的濫用長度。
 */
export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, "請輸入密碼").max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;
