import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * 密碼雜湊用 Node 內建的 scrypt，不引入原生相依套件。
 *
 * 選它而不是 argon2id／bcrypt 的理由：那兩者都要編譯原生模組，正式站的 VM
 * 是 aarch64，本專案在 ARM 上已經吃過苦頭（見 docs/CLOUD_SETUP.md 的 ARM
 * 相容性章節），沒必要為了邊際的強度差異再賭一次建置。scrypt 是 RFC 7914
 * 的標準 KDF，強度對這個用途綽綽有餘。
 *
 * 參數是 2026-09-07 在正式站同一台 ARM VM 上實測選的：
 *   N=2^14  16MB   39ms
 *   N=2^15  32MB   79ms
 *   N=2^16  64MB  157ms  ← 採用
 *   N=2^17 128MB  314ms
 * 取 2^16 落在「登入感覺不到延遲」與「暴力破解成本夠高」的交界，且併發登入
 * 時每個請求佔 64MB 對 12GB 的機器仍安全。maxmem 給兩倍緩衝，否則 Node 會
 * 因為預設 32MB 上限直接丟 ERR_CRYPTO_INVALID_SCRYPT_PARAMS。
 */
const PARAMS = { N: 65536, r: 8, p: 1 } as const;
const MAXMEM = 128 * 1024 * 1024;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * 存進 DB 的字串自帶參數：`scrypt$N$r$p$salt$hash`（salt 與 hash 為 base64url）。
 * 這樣日後調高 N 不會讓既有密碼全部失效——舊雜湊照它自己記的參數驗，
 * 驗過之後可以再用新參數重算一次寫回去（本階段還沒做這件事）。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAXMEM });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * 驗證密碼。
 *
 * stored 為 null 時直接回 false——邀請進來的帳號沒有密碼（passwordHash 是
 * null），不能因為「沒設密碼」就讓任何密碼都通過。
 *
 * 比對一律走 timingSafeEqual，不用 ===：字串比較會在第一個不同的位元組
 * 就返回，洩漏「猜對了幾個字元」這個資訊。
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (stored === null) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    // maxmem 依 stored 記的 N 計算，不用寫死的 MAXMEM——否則日後調高 N，
    // 舊帳號驗證時反而會因為 maxmem 不夠而爆掉
    derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(MAXMEM, 256 * N * r),
    });
  } catch {
    // 參數不合法（例如 N 不是 2 的冪）會丟例外，視同驗證失敗
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
