/**
 * 登入／註冊後的導向目的地過濾。
 *
 * `?next=` 直接來自網址列，不過濾的話 `?next=https://evil.example` 會變成
 * 開放轉址——攻擊者可以拿我們的網域當跳板做釣魚，使用者看到的是熟悉的
 * 網域、點下去卻到了別處。
 *
 * 只放行「單一 `/` 開頭」的站內路徑。要擋掉的幾種寫法：
 *   - `https://evil.example`  絕對網址
 *   - `//evil.example`        protocol-relative，瀏覽器會補上目前的協定
 *   - `/\evil.example`        某些瀏覽器把反斜線當斜線處理
 *   - 前面夾雜控制字元或空白的變形
 */
export const DEFAULT_REDIRECT = "/trips";

export function safeNext(next: unknown): string {
  if (typeof next !== "string") return DEFAULT_REDIRECT;

  // 先去掉所有空白與控制字元——`\n//evil.example` 這類變形光靠 startsWith
  // 擋不住，瀏覽器解析網址時會把它們忽略掉
  const cleaned = next.replace(/[\u0000-\u0020\u007f]/g, "");
  if (cleaned === "") return DEFAULT_REDIRECT;

  if (!cleaned.startsWith("/")) return DEFAULT_REDIRECT;
  // 第二個字元是 / 或 \ 都視為要跳出本站
  if (cleaned[1] === "/" || cleaned[1] === "\\") return DEFAULT_REDIRECT;

  return cleaned;
}
