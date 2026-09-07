import { prisma } from "@/lib/db";
import { generateToken, hashToken } from "@/lib/auth/token";
import { createSession } from "@/lib/auth/session";
import type { TripRole } from "@/lib/auth/access";

/**
 * 邀請券（P7.3）。2026-09-07 使用者裁示採「具名且可重複使用」：
 * 一張券綁定特定團員，帶到期日與可用次數上限，團長可隨時撤銷。
 *
 * ⚠️ **這是「知道網址就能進」的憑證**（bearer credential）。被截圖轉發、
 * 留在瀏覽器紀錄、共用裝置，都等於身分外流。三道閘門是為了限縮這件事的
 * 影響範圍，不是消除它：
 *   1. 到期日——預設 7 天，且不超過行程結束日
 *   2. 可用次數上限——預設 5 次，用完自動失效
 *   3. 隨時可撤銷——團長在成員頁按一下即可
 *
 * 另外券只發 EDITOR／VIEWER，**被邀請者不能再邀請別人**（同日裁示）。
 */

export const DEFAULT_INVITE_DAYS = 7;
export const DEFAULT_MAX_USES = 5;

/** 券可以帶的角色。OWNER 不在其中——發券本身就是 OWNER 的權限。 */
export type InvitableRole = Extract<TripRole, "EDITOR" | "VIEWER">;

export interface CreateInviteInput {
  tripId: string;
  memberId: string;
  role: InvitableRole;
  createdBy: string;
  days?: number;
  maxUses?: number;
}

/**
 * 開一張券。回傳的 token 是唯一一次拿得到原始值的機會——DB 只存雜湊，
 * 之後連團長自己都查不回來，只能撤銷後重發。
 */
export async function createInvite(
  input: CreateInviteInput,
): Promise<{ token: string; expiresAt: Date }> {
  const [member, trip] = await Promise.all([
    prisma.member.findFirst({
      where: { id: input.memberId, tripId: input.tripId },
      select: { id: true, membership: { select: { id: true } } },
    }),
    prisma.trip.findUniqueOrThrow({
      where: { id: input.tripId },
      select: { endDate: true },
    }),
  ]);
  if (member === null) {
    throw new Error("找不到這位成員，或他不屬於這個行程");
  }
  if (member.membership !== null) {
    throw new Error("這位成員已經有人認領了，不需要再發邀請");
  }

  const days = input.days ?? DEFAULT_INVITE_DAYS;
  const byDays = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  // 行程結束後這張券就沒有意義了，取兩者較早的那個
  const endOfTrip = new Date(trip.endDate);
  endOfTrip.setHours(23, 59, 59, 999);
  const expiresAt = byDays < endOfTrip ? byDays : endOfTrip;

  const token = generateToken();
  await prisma.invite.create({
    data: {
      tripId: input.tripId,
      memberId: input.memberId,
      role: input.role,
      tokenHash: hashToken(token),
      expiresAt,
      maxUses: input.maxUses ?? DEFAULT_MAX_USES,
      createdBy: input.createdBy,
    },
  });
  return { token, expiresAt };
}

export async function revokeInvite(tripId: string, inviteId: string): Promise<void> {
  const { count } = await prisma.invite.updateMany({
    where: { id: inviteId, tripId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    throw new Error("找不到這張邀請券，或它已經被撤銷");
  }
}

export interface InviteSummary {
  id: string;
  memberId: string;
  memberName: string;
  role: TripRole;
  expiresAt: Date;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
  /** 過期／用完／已撤銷任一成立就是 false */
  active: boolean;
}

export async function listInvites(tripId: string): Promise<InviteSummary[]> {
  const rows = await prisma.invite.findMany({
    where: { tripId },
    select: {
      id: true,
      memberId: true,
      role: true,
      expiresAt: true,
      maxUses: true,
      usedCount: true,
      revokedAt: true,
      member: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    memberName: row.member.name,
    role: row.role,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    revokedAt: row.revokedAt,
    active:
      row.revokedAt === null &&
      row.expiresAt.getTime() > now &&
      row.usedCount < row.maxUses,
  }));
}

export interface InvitePreview {
  tripId: string;
  tripName: string;
  memberName: string;
  role: TripRole;
}

export type InviteProblem =
  | "not-found"
  | "revoked"
  | "expired"
  | "exhausted"
  | "member-taken";

/**
 * 看一張券是否還能用，並回傳要顯示給被邀請者確認的資訊。
 * 不改任何狀態——認領是 `redeemInvite` 的事。
 */
export async function previewInvite(
  token: string,
): Promise<{ preview: InvitePreview } | { problem: InviteProblem }> {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      tripId: true,
      role: true,
      expiresAt: true,
      maxUses: true,
      usedCount: true,
      revokedAt: true,
      trip: { select: { name: true } },
      member: { select: { name: true, membership: { select: { id: true } } } },
    },
  });
  if (invite === null) return { problem: "not-found" };
  if (invite.revokedAt !== null) return { problem: "revoked" };
  if (invite.expiresAt.getTime() <= Date.now()) return { problem: "expired" };
  // member-taken 先於 exhausted：兩者可能同時成立（maxUses=1 的券用過一次
  // 之後就是這樣），而「這個身分已經有人認領」才是真正的阻擋原因——講次數
  // 用完會讓團長以為重發一張就好，但重發同樣會被拒絕
  if (invite.member.membership !== null) return { problem: "member-taken" };
  if (invite.usedCount >= invite.maxUses) return { problem: "exhausted" };

  return {
    preview: {
      tripId: invite.tripId,
      tripName: invite.trip.name,
      memberName: invite.member.name,
      role: invite.role,
    },
  };
}

/**
 * 認領一張券。
 *
 * 兩種情境：
 *   - 已登入（existingUserId 有值）：把現有帳號綁到這位團員
 *   - 未登入：建立一個**沒有密碼**的帳號（passwordHash 為 null），
 *     顯示名稱沿用團員名字，然後簽發 session
 *
 * 整段包在交易裡，而且對 usedCount 用條件更新——同一張券被兩個人同時打開
 * 時，只會有一個人成功，另一個會撞到「已經有人認領」而不是兩個人都綁上去。
 */
export async function redeemInvite(
  token: string,
  existingUserId: string | null,
  userAgent?: string,
): Promise<{ tripId: string; sessionToken: string | null } | { problem: InviteProblem }> {
  const tokenHash = hashToken(token);

  // 明確標註交易的回傳型別：不標的話 TS 會把兩個分支推導成「所有欄位都可能
  // 是 undefined」的聯集，跟外層宣告的形狀對不起來
  type TxResult =
    | { problem: InviteProblem }
    | { tripId: string; userId: string; isNewUser: boolean };

  const result: TxResult = await prisma.$transaction(async (tx): Promise<TxResult> => {
    const invite = await tx.invite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        tripId: true,
        memberId: true,
        role: true,
        expiresAt: true,
        maxUses: true,
        usedCount: true,
        revokedAt: true,
        member: { select: { name: true, membership: { select: { id: true } } } },
      },
    });
    if (invite === null) return { problem: "not-found" as const };
    if (invite.revokedAt !== null) return { problem: "revoked" as const };
    if (invite.expiresAt.getTime() <= Date.now()) return { problem: "expired" as const };
    if (invite.member.membership !== null) return { problem: "member-taken" as const };
    if (invite.usedCount >= invite.maxUses) return { problem: "exhausted" as const };

    // 條件更新：只有 usedCount 還沒超過上限時才加一。兩個人同時認領時，
    // 後到的那個會 count=0，直接視為用完
    const bumped = await tx.invite.updateMany({
      where: { id: invite.id, usedCount: { lt: invite.maxUses }, revokedAt: null },
      data: { usedCount: { increment: 1 } },
    });
    if (bumped.count === 0) return { problem: "exhausted" as const };

    const userId =
      existingUserId ??
      (
        await tx.user.create({
          data: { displayName: invite.member.name },
          select: { id: true },
        })
      ).id;

    // 已經是這個行程的成員就不重複建立（例如同一個人點了兩次連結）
    const already = await tx.tripMembership.findUnique({
      where: { tripId_userId: { tripId: invite.tripId, userId } },
      select: { id: true, memberId: true },
    });
    if (already === null) {
      await tx.tripMembership.create({
        data: {
          tripId: invite.tripId,
          userId,
          memberId: invite.memberId,
          role: invite.role,
        },
      });
    } else if (already.memberId === null) {
      // 有權限但還沒認領身分——補上綁定
      await tx.tripMembership.update({
        where: { id: already.id },
        data: { memberId: invite.memberId },
      });
    }

    return { tripId: invite.tripId, userId, isNewUser: existingUserId === null };
  });

  if ("problem" in result) return result;

  // session 在交易外簽發：它不屬於這筆認領的原子性範圍，
  // 而且已登入的使用者本來就有 session，不需要再發一組
  const sessionToken = result.isNewUser
    ? (await createSession(result.userId, userAgent)).token
    : null;

  return { tripId: result.tripId, sessionToken };
}
