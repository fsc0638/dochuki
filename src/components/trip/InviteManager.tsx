"use client";

import { useActionState, useState } from "react";
import { createInviteAction, revokeInviteAction } from "@/app/trips/[id]/members/inviteActions";
import type { InviteActionState } from "@/app/trips/[id]/members/inviteActions";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INITIAL_ACTION_STATE } from "@/lib/actionState";

export interface InviteRow {
  id: string;
  memberName: string;
  role: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revoked: boolean;
  active: boolean;
}

export interface InvitableMember {
  id: string;
  name: string;
}

/**
 * 團長專用的邀請券管理（P7.3）。只有 OWNER 會看到這一區——
 * 頁面端已經判斷過，這裡不重複判斷，但 action 仍然各自守門
 * （畫面藏起來不等於擋得住直接呼叫）。
 */
export function InviteManager({
  tripId,
  invitableMembers,
  invites,
}: {
  tripId: string;
  invitableMembers: InvitableMember[];
  invites: InviteRow[];
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif-tc text-lg font-bold text-stamp">邀請團員</h2>
        <p className="mt-1 text-xs text-ink-muted">
          產生連結後傳給本人。連結等同身分憑證，任何拿到的人都能用，
          所以有到期日與使用次數上限，也可以隨時撤銷。
        </p>
      </div>

      {invitableMembers.length === 0 ? (
        <p className="text-sm text-ink-soft">所有成員都已經有人認領了。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invitableMembers.map((member) => (
            <InviteCreator key={member.id} tripId={tripId} member={member} />
          ))}
        </ul>
      )}

      {invites.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink-soft">已發出的邀請</h3>
          <ul className="flex flex-col gap-2">
            {invites.map((invite) => (
              <InviteRowItem key={invite.id} tripId={tripId} invite={invite} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function InviteCreator({ tripId, member }: { tripId: string; member: InvitableMember }) {
  const action = createInviteAction.bind(null, tripId, member.id);
  const [state, formAction] = useActionState<InviteActionState, FormData>(
    action,
    INITIAL_ACTION_STATE,
  );
  const [copied, setCopied] = useState(false);

  // 伺服器只給相對路徑——它不知道使用者是從 tunnel 還是正式網域進來的
  const fullUrl =
    state.inviteUrl === undefined
      ? null
      : `${typeof window === "undefined" ? "" : window.location.origin}${state.inviteUrl}`;

  return (
    <li className="rounded-lg border border-washi bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-ink">{member.name}</span>
        <form action={formAction} className="flex items-center gap-2">
          <select
            name="role"
            defaultValue="EDITOR"
            aria-label={`${member.name} 的權限`}
            className="rounded-md border border-washi bg-white px-2 py-1 text-xs text-ink"
          >
            <option value="EDITOR">可記帳</option>
            <option value="VIEWER">只能看</option>
          </select>
          <SubmitButton pendingText="產生中…">產生連結</SubmitButton>
        </form>
      </div>

      <FormMessage error={state.error} />

      {fullUrl !== null && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            readOnly
            value={fullUrl}
            aria-label={`${member.name} 的邀請連結`}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-md border border-washi bg-paper px-2 py-1 text-xs text-ink"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(fullUrl).then(
                  () => setCopied(true),
                  // 剪貼簿在非 HTTPS 或未授權時會失敗——不要讓它看起來像複製成功
                  () => setCopied(false),
                );
              }}
              className="rounded-full border border-washi px-3 py-1 text-xs text-ink-soft hover:bg-washi/30"
            >
              {copied ? "已複製" : "複製連結"}
            </button>
            {state.expiresAt !== undefined && (
              <span className="text-xs text-ink-muted">
                {new Date(state.expiresAt).toLocaleDateString("zh-TW")} 到期
              </span>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            這串連結只顯示這一次，關掉就看不到了。需要的話可以撤銷後重發。
          </p>
        </div>
      )}
    </li>
  );
}

function InviteRowItem({ tripId, invite }: { tripId: string; invite: InviteRow }) {
  const action = revokeInviteAction.bind(null, tripId, invite.id);
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);

  const status = invite.revoked
    ? "已撤銷"
    : !invite.active
      ? "已失效"
      : `${invite.usedCount}/${invite.maxUses} 次`;

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-washi bg-white px-3 py-2">
      <div className="min-w-0">
        <span className="text-sm text-ink">{invite.memberName}</span>
        <span className="ml-2 text-xs text-ink-muted">
          {invite.role === "VIEWER" ? "只能看" : "可記帳"} ・ {status}
        </span>
        {state.error !== undefined && (
          <p className="text-xs text-red-600">{state.error}</p>
        )}
      </div>
      {invite.active && (
        <form action={formAction}>
          <SubmitButton variant="danger" pendingText="撤銷中…">
            撤銷
          </SubmitButton>
        </form>
      )}
    </li>
  );
}
