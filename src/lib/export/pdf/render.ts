import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { mediaTypeForPath, receiptStorageDir } from "@/lib/receipts/write";
import type { ReportData } from "@/lib/trips/report";
import { buildReportHtml } from "./template";

/**
 * PDF 產生（render.ts 負責一切 I/O：讀字型檔、讀收據圖檔、驅動 Playwright；
 * template.ts 維持純函式）。
 */

const FONT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fonts",
  "NotoSansCJKtc-Regular.otf",
);

async function loadReceiptImageDataUrls(
  receipts: ReportData["receipts"],
): Promise<Map<string, string>> {
  const dir = receiptStorageDir();
  const entries = await Promise.all(
    receipts.map(async (receipt): Promise<[string, string] | null> => {
      try {
        const buffer = await readFile(path.join(dir, receipt.imagePath));
        const mediaType = mediaTypeForPath(receipt.imagePath);
        return [receipt.receiptId, `data:${mediaType};base64,${buffer.toString("base64")}`];
      } catch {
        // 原圖遺失（例如手動清過 RECEIPT_STORAGE_DIR）：縮圖索引頁改顯示
        // 「原圖遺失」，不讓整份報表因為一張圖讀不到就整個產不出來
        return null;
      }
    }),
  );
  return new Map(entries.filter((entry): entry is [string, string] => entry !== null));
}

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  const receiptImageDataUrls = await loadReceiptImageDataUrls(data.receipts);
  const html = buildReportHtml(data, {
    fontFileUrl: pathToFileURL(FONT_PATH).href,
    receiptImageDataUrls,
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
