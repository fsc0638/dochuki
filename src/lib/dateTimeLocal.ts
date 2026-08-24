/**
 * `<input type="datetime-local">` 要 `YYYY-MM-DDTHH:mm`，用本機時間部件組出。
 *
 * ★ 已知限制：datetime-local 不帶時區資訊，這裡用「執行這段程式碼那台機器」
 * 的本機時區組字串——本機（單機／單一時區使用情境）沒問題，未來若要支援
 * 跨時區的公開服務，付款時間的時區處理需要重新設計（見 CLAUDE.md 進度日誌）。
 */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
