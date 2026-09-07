import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P7.4 守門列舉測試。
 *
 * 這支不是驗證某個功能對不對，而是**釘住「不會有人新增一個沒守門的進出口」**。
 * 31 個進出口靠人工記得呼叫守門遲早會漏一個，而漏掉的那個不會有任何症狀，
 * 直到被人發現。
 *
 * 做法是靜態掃描 `src/app` 底下所有 page/route/actions，斷言每個檔案都引用了
 * 守門函式。這擋不住「引用了但沒真的呼叫」，但擋得住最常見的失敗模式：
 * 新增一個檔案、完全忘記這件事。真正的行為驗證在 auth.access.test.ts
 * 與各自的功能測試裡。
 *
 * 新增公開頁面時要**明確**加進 PUBLIC 清單——讓「這個頁面不需要登入」變成
 * 一個要動手寫下來的決定，而不是預設值。
 */

const APP_DIR = join(process.cwd(), "src", "app");

/** 刻意公開、不需要登入的進出口。每一項都要有理由。 */
const PUBLIC: Record<string, string> = {
  "(auth)/actions.ts": "登入／註冊／登出本身",
  "(auth)/login/page.tsx": "登入頁",
  "(auth)/signup/page.tsx": "註冊頁",
  "invite/[token]/page.tsx": "邀請認領頁——被邀請者本來就還沒有帳號",
  "invite/[token]/actions.ts": "認領動作，有效性由券本身驗證",
  "page.tsx": "首頁，只是 redirect 到 /trips",
};

/** 守門函式：檔案裡出現任一個就算守住 */
const GUARD_NAMES = [
  "guardPage",
  "guardSignedInPage",
  "guardAction",
  "guardRoute",
  "guardSignedInRoute",
  "requireTripAccess",
  "getTripAccess",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/^(page\.tsx|route\.ts|.*[aA]ctions\.ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("P7.4 · 每個進出口都要守門", () => {
  const files = walk(APP_DIR)
    .map((f) => relative(APP_DIR, f).split("\\").join("/"))
    .sort();

  it("掃到的檔案數量符合預期（新增檔案時這條會先亮）", () => {
    // 注意單位：AUTH_PLAN.md 說的「31 個進出口」是**函式層級**
    // （5 個 route handler ＋ 14 個 server action ＋ 12 個頁面），
    // 一個 actions.ts 檔案裡可能有好幾支 action。這裡數的是**檔案**：
    // 28 個 = 22 個需要守門的 ＋ 6 個刻意公開的。
    //
    // 這條會在新增任何 page/route/actions 檔案時先亮起來，逼人回來
    // 決定它該守門還是該進 PUBLIC 清單。
    expect(files.length).toBe(28);
    expect(files.filter((f) => !(f in PUBLIC))).toHaveLength(22);
  });

  it.each(
    walk(APP_DIR)
      .map((f) => relative(APP_DIR, f).split("\\").join("/"))
      .sort()
      .filter((f) => !(f in PUBLIC)),
  )("%s 有引用守門函式", (relPath) => {
    const source = readFileSync(join(APP_DIR, relPath), "utf8");
    const guarded = GUARD_NAMES.some((name) => source.includes(name));
    expect(
      guarded,
      `${relPath} 沒有引用任何守門函式。若這個進出口刻意公開，請加進 tests/auth.gating.test.ts 的 PUBLIC 清單並寫明理由。`,
    ).toBe(true);
  });

  it("公開清單裡的每一項都真的存在（避免清單過時）", () => {
    for (const relPath of Object.keys(PUBLIC)) {
      expect(files, `PUBLIC 清單裡的 ${relPath} 已經不存在了`).toContain(relPath);
    }
  });

  it("listTrips 這種「會列出所有行程」的舊介面已經不存在", () => {
    const load = readFileSync(join(process.cwd(), "src/lib/trips/load.ts"), "utf8");
    // P7.4 把它改成必填 userId 的 listTripsForUser；舊名字若復活，
    // 代表有人又加回一個不帶過濾條件的清單查詢
    expect(load).not.toMatch(/export async function listTrips\s*\(/);
    expect(load).toContain("listTripsForUser");
  });
});
