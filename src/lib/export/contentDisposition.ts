/**
 * 建立含中文檔名的 Content-Disposition 標頭值。
 *
 * 純 `filename="..."` 參數只定義給 ASCII（RFC 6266），直接塞中文在部分
 * 瀏覽器會被靜默轉成亂碼或整段忽略——用 RFC 5987 的 `filename*=UTF-8''`
 * 附加編碼過的版本，兩者並列：新瀏覽器讀 filename*，抓不到的退回 asciiFallback。
 */
export function contentDispositionAttachment(
  filename: string,
  asciiFallback: string,
): string {
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
