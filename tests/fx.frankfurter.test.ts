import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getDailyRate } from "@/lib/fx/frankfurter";

/**
 * fx/frankfurter.ts 測試。
 *
 * ★ 本檔需要本機 docker compose 的 PostgreSQL 已啟動（`docker compose up -d db`——
 *   docker-compose.yml 還有一個 app 服務是 P5 容器化部署用的，這裡不需要它）
 * ——快取讀寫是這個模組的核心行為，不值得為了「不依賴 DB」而用假的記憶體
 * 快取取代測試對象。這是本專案目前唯一的已知限制：CI 若要跑 `pnpm test`，
 * 需先確保 DB 可連線（尚未設定 CI，此限制留待 P5 收尾時處理）。
 *
 * 每個測試用不重複的假幣別代碼（XT0/XT1…）當 base，避免互相污染，也避免
 * 撞到真實資料。afterAll 統一清除本檔寫入的快取列。
 */

const TEST_QUOTE = "XTQ"; // 虛構代碼，不會撞到真實幣別或既有快取
const usedBases: string[] = [];

function nextBase(): string {
  const base = `XT${usedBases.length}`;
  usedBases.push(base);
  return base;
}

async function cleanupBase(base: string): Promise<void> {
  await prisma.fxRate.deleteMany({ where: { base, quote: TEST_QUOTE } });
}

afterAll(async () => {
  await prisma.fxRate.deleteMany({ where: { quote: TEST_QUOTE } });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe("getDailyRate · 快取 miss 後打 API 並寫入", () => {
  it("成功時回傳 rate 且來源為 api，並把值存進快取", async () => {
    const base = nextBase();
    mockFetchOnce(200, [
      { date: "2026-08-21", base, quote: TEST_QUOTE, rate: 0.20034 },
    ]);

    const result = await getDailyRate({
      base,
      quote: TEST_QUOTE,
      date: "2026-08-21",
    });

    expect(result).not.toBeNull();
    expect(result?.source).toBe("api");
    expect(result?.rate.toString()).toBe("0.20034");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await cleanupBase(base);
  });

  it("同一請求日期第二次呼叫直接吃快取，不再打 API", async () => {
    const base = nextBase();
    mockFetchOnce(200, [
      { date: "2026-08-21", base, quote: TEST_QUOTE, rate: 0.20034 },
    ]);

    const first = await getDailyRate({ base, quote: TEST_QUOTE, date: "2026-08-21" });
    const second = await getDailyRate({ base, quote: TEST_QUOTE, date: "2026-08-21" });

    expect(first?.source).toBe("api");
    expect(second?.source).toBe("cache");
    expect(second?.rate.toString()).toBe("0.20034");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await cleanupBase(base);
  });

  it("★ 假日回退：API 回應的 date 與請求不同，快取鍵仍用【請求日期】存", async () => {
    const base = nextBase();
    // 模擬 2026-08-22（週六）請求，Frankfurter 靜默回退到前一交易日 2026-08-21
    mockFetchOnce(200, [
      { date: "2026-08-21", base, quote: TEST_QUOTE, rate: 0.20033 },
    ]);

    await getDailyRate({ base, quote: TEST_QUOTE, date: "2026-08-22" });

    // 用【請求日期】2026-08-22 再問一次，若快取鍵存對了，這裡不該再打 API
    const cached = await getDailyRate({ base, quote: TEST_QUOTE, date: "2026-08-22" });
    expect(cached?.source).toBe("cache");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // 反面驗證：問 2026-08-21（回應裡的日期），這是不同的快取鍵，必須重打 API
    mockFetchOnce(200, [
      { date: "2026-08-21", base, quote: TEST_QUOTE, rate: 0.20033 },
    ]);
    const differentKey = await getDailyRate({ base, quote: TEST_QUOTE, date: "2026-08-21" });
    expect(differentKey?.source).toBe("api");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    await cleanupBase(base);
  });

  it("HTTP 非 2xx：回傳 null，不寫入快取，不拋出", async () => {
    const base = nextBase();
    mockFetchOnce(404, { message: "not found" });

    const result = await getDailyRate({ base, quote: TEST_QUOTE, date: "2026-08-21" });
    expect(result).toBeNull();

    const cached = await prisma.fxRate.findFirst({ where: { base, quote: TEST_QUOTE } });
    expect(cached).toBeNull();
  });

  it("網路錯誤（fetch 拋出）：回傳 null，不拋出", async () => {
    const base = nextBase();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      getDailyRate({ base, quote: TEST_QUOTE, date: "2026-08-21" }),
    ).resolves.toBeNull();
  });

  it("回應陣列裡找不到對應 quote：回傳 null", async () => {
    const base = nextBase();
    mockFetchOnce(200, [
      { date: "2026-08-21", base, quote: "XZZ", rate: 1.23 },
    ]);

    const result = await getDailyRate({ base, quote: TEST_QUOTE, date: "2026-08-21" });
    expect(result).toBeNull();
  });

  it("回應格式不符（非陣列）：回傳 null 而非拋出例外", async () => {
    const base = nextBase();
    mockFetchOnce(200, { message: "unexpected shape" });

    const result = await getDailyRate({ base, quote: TEST_QUOTE, date: "2026-08-21" });
    expect(result).toBeNull();
  });
});
