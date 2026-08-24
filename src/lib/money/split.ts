import type Decimal from "decimal.js";
import { Money, type MoneyInput } from "./decimal";
import { toStorageScale } from "./round";

/** 分攤模式，對應 schema 的 SplitMode enum */
export type SplitMode = "EQUAL" | "WEIGHT" | "EXACT" | "BY_GROUP";

export interface SplitParticipant {
  memberId: string;
  /** WEIGHT 模式使用；未給時視為 1 */
  weight?: MoneyInput;
  /** BY_GROUP 模式使用：此成員所屬組別 */
  groupId?: string | null;
  /** EXACT 模式使用：直接指定該成員的分攤額 */
  exactShare?: MoneyInput;
}

export interface SplitInput {
  /** 記帳幣金額（已由 convert.ts 換算完成） */
  amountHome: MoneyInput;
  mode: SplitMode;
  participants: SplitParticipant[];
  /** 餘數歸屬對象。schema 允許為 null（無明確付款人） */
  payerId: string | null;
  /** BY_GROUP 模式使用：本筆金額屬於哪一組 */
  groupId?: string | null;
}

export interface SplitShare {
  memberId: string;
  shareHome: Decimal;
}

export interface SplitResult {
  shares: SplitShare[];
  /** 除不盡而產生的尾差，已計入 remainderAssignedTo 的 share */
  remainder: Decimal;
  remainderAssignedTo: string | null;
}

/**
 * 分攤引擎。
 *
 * 不變式（由 assertConserved 在回傳前實際驗證，非僅註解宣稱）：
 *   Σ shares.shareHome ≡ amountHome，嚴格相等。
 *
 * 除不盡的餘數依 CLAUDE.md 鐵律 4 指派給付款人；付款人本身沒有分攤額時
 * （例如 BY_GROUP 的機票由組外成員代墊）退回「分攤額最大者」，同額則取
 * memberId 字典序最小者，確保結果可重現。
 */
export function splitExpense(input: SplitInput): SplitResult {
  const amount = new Money(input.amountHome);
  if (!amount.isFinite()) {
    throw new Error(`分攤金額必須為有限數，收到 ${String(input.amountHome)}`);
  }

  assertNoDuplicateMembers(input.participants);
  assertPayerIsKnown(input.payerId, input.participants);

  const holders = selectHolders(input);
  if (holders.length === 0) {
    throw new Error(
      input.mode === "BY_GROUP"
        ? `BY_GROUP 分攤找不到屬於組別 ${String(input.groupId)} 的成員`
        : "分攤參與者不可為空",
    );
  }

  if (input.mode === "EXACT") {
    return splitExact(amount, holders);
  }

  const rawShares = computeRawShares(input.mode, amount, holders);
  const shares = rawShares.map((share, index) => ({
    memberId: holders[index].memberId,
    shareHome: toStorageScale(share),
  }));

  const assigned = sumShares(shares);
  const remainder = amount.minus(assigned);
  const target = pickRemainderTarget(input.payerId, shares);

  if (target !== null && !remainder.isZero()) {
    const slot = shares.find((s) => s.memberId === target);
    // target 由 pickRemainderTarget 從 shares 選出，必然存在
    slot!.shareHome = slot!.shareHome.plus(remainder);
  }

  assertConserved(shares, amount);
  return {
    shares,
    remainder,
    remainderAssignedTo: remainder.isZero() ? null : target,
  };
}

/** 挑出實際持有分攤額的成員：BY_GROUP 只取該組成員，其餘模式為全體 */
function selectHolders(input: SplitInput): SplitParticipant[] {
  if (input.mode !== "BY_GROUP") return input.participants;
  return input.participants.filter((p) => p.groupId === input.groupId);
}

function computeRawShares(
  mode: Exclude<SplitMode, "EXACT">,
  amount: Decimal,
  holders: SplitParticipant[],
): Decimal[] {
  if (mode === "WEIGHT") {
    const weights = holders.map((holder) => {
      const weight = new Money(holder.weight ?? 1);
      if (!weight.isFinite() || weight.isNegative()) {
        throw new Error(
          `權重必須為非負的有限數，成員 ${holder.memberId} 收到 ${String(holder.weight)}`,
        );
      }
      return weight;
    });
    const totalWeight = weights.reduce((acc, w) => acc.plus(w), new Money(0));
    if (totalWeight.isZero()) {
      throw new Error("權重總和為 0，無法按權重分攤");
    }
    return weights.map((weight) => amount.times(weight).dividedBy(totalWeight));
  }

  // EQUAL 與 BY_GROUP 皆為持有者之間均分
  const count = new Money(holders.length);
  return holders.map(() => amount.dividedBy(count));
}

/**
 * EXACT：直接採用指定金額，但總和必須等於 amountHome，否則拒絕。
 * 不套用餘數歸屬——指定模式下任何差額都是呼叫端的錯，不該被靜默吸收。
 */
function splitExact(amount: Decimal, holders: SplitParticipant[]): SplitResult {
  const shares = holders.map((holder) => {
    if (holder.exactShare == null) {
      throw new Error(`EXACT 分攤缺少成員 ${holder.memberId} 的指定金額`);
    }
    const share = new Money(holder.exactShare);
    if (!share.isFinite()) {
      throw new Error(
        `EXACT 指定金額必須為有限數，成員 ${holder.memberId} 收到 ${String(holder.exactShare)}`,
      );
    }
    return { memberId: holder.memberId, shareHome: toStorageScale(share) };
  });

  const total = sumShares(shares);
  if (!total.equals(amount)) {
    throw new Error(
      `EXACT 分攤總和 ${total.toString()} 與支出金額 ${amount.toString()} 不符，差額 ${amount.minus(total).toString()}`,
    );
  }

  return { shares, remainder: new Money(0), remainderAssignedTo: null };
}

function pickRemainderTarget(
  payerId: string | null,
  shares: SplitShare[],
): string | null {
  if (payerId !== null && shares.some((s) => s.memberId === payerId)) {
    return payerId;
  }
  // 退回分攤額最大者；同額取 memberId 字典序最小者，確保可重現
  return shares.reduce((best, current) => {
    if (current.shareHome.greaterThan(best.shareHome)) return current;
    if (
      current.shareHome.equals(best.shareHome) &&
      current.memberId < best.memberId
    ) {
      return current;
    }
    return best;
  }).memberId;
}

function sumShares(shares: SplitShare[]): Decimal {
  return shares.reduce((acc, s) => acc.plus(s.shareHome), new Money(0));
}

function assertNoDuplicateMembers(participants: SplitParticipant[]): void {
  const seen = new Set<string>();
  for (const participant of participants) {
    if (seen.has(participant.memberId)) {
      throw new Error(`分攤參與者出現重複成員 ${participant.memberId}`);
    }
    seen.add(participant.memberId);
  }
}

function assertPayerIsKnown(
  payerId: string | null,
  participants: SplitParticipant[],
): void {
  if (payerId === null) return;
  if (!participants.some((p) => p.memberId === payerId)) {
    throw new Error(`付款人 ${payerId} 不在分攤參與者名單中`);
  }
}

/** 守恆檢查：Σ shares 必須嚴格等於支出金額，差一分錢都不放行 */
function assertConserved(shares: SplitShare[], amount: Decimal): void {
  const total = sumShares(shares);
  if (!total.equals(amount)) {
    throw new Error(
      `分攤守恆失敗：Σshares = ${total.toString()}，amountHome = ${amount.toString()}`,
    );
  }
}
