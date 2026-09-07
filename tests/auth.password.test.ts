import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("auth/password · scrypt 雜湊", () => {
  it("同一個密碼驗得過", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
  });

  it("錯誤密碼驗不過", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse batterz", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("同一個密碼每次雜湊結果都不同（salt 有生效）", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    // 但兩份都驗得過
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("雜湊字串自帶參數，格式為 scrypt$N$r$p$salt$hash", async () => {
    const stored = await hashPassword("whatever");
    const parts = stored.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBe(65536); // N=2^16，見 password.ts 的實測說明
    expect(Number(parts[2])).toBe(8);
    expect(Number(parts[3])).toBe(1);
    expect(parts[4].length).toBeGreaterThan(0);
    expect(parts[5].length).toBeGreaterThan(0);
  });

  it("passwordHash 為 null（邀請帳號）時任何密碼都不通過", async () => {
    expect(await verifyPassword("", null)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
  });

  it("被竄改或格式錯誤的雜湊一律回 false，不丟例外", async () => {
    const stored = await hashPassword("original");
    const parts = stored.split("$");

    // 改掉雜湊本體
    const tampered = [...parts.slice(0, 5), "AAAA"].join("$");
    expect(await verifyPassword("original", tampered)).toBe(false);

    // 改掉 salt
    const otherSalt = [...parts.slice(0, 4), "BBBBBBBBBBBBBBBBBBBBBB", parts[5]].join("$");
    expect(await verifyPassword("original", otherSalt)).toBe(false);

    // 各種壞格式
    expect(await verifyPassword("original", "")).toBe(false);
    expect(await verifyPassword("original", "notascrypthash")).toBe(false);
    expect(await verifyPassword("original", "bcrypt$65536$8$1$aa$bb")).toBe(false);
    expect(await verifyPassword("original", "scrypt$abc$8$1$aa$bb")).toBe(false);
    // N 不是 2 的冪：scrypt 會丟例外，要被接住
    expect(await verifyPassword("original", "scrypt$65535$8$1$aa$bb")).toBe(false);
  });

  it("能驗證用較低參數產生的舊雜湊（日後調高 N 不會讓舊密碼失效）", async () => {
    // 手動組一份 N=2^14 的雜湊，模擬「參數調高之前存進去的帳號」
    const { scrypt } = await import("node:crypto");
    const { promisify } = await import("node:util");
    const scryptAsync = promisify(scrypt) as (
      p: string,
      s: Buffer,
      k: number,
      o: { N: number; r: number; p: number; maxmem: number },
    ) => Promise<Buffer>;
    const salt = Buffer.from("0123456789abcdef");
    const derived = await scryptAsync("legacy password", salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const legacy = [
      "scrypt",
      16384,
      8,
      1,
      salt.toString("base64url"),
      derived.toString("base64url"),
    ].join("$");

    expect(await verifyPassword("legacy password", legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
  });
});
