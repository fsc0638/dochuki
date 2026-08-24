"use client";

import { useActionState } from "react";
import {
  createGroupAction,
  createMemberAction,
  deleteGroupAction,
  deleteMemberAction,
  updateMemberAction,
} from "@/app/trips/[id]/members/actions";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { Field, inputClass } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INITIAL_ACTION_STATE } from "@/lib/actionState";

interface GroupRow {
  id: string;
  name: string;
}

interface MemberRow {
  id: string;
  name: string;
  groupId: string | null;
  weight: string;
}

function CreateGroupForm({ tripId }: { tripId: string }) {
  const [state, formAction] = useActionState(createGroupAction, INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="tripId" value={tripId} />
      <Field label="新增組別" htmlFor="group-name" errors={state.fieldErrors?.name}>
        <input id="group-name" name="name" type="text" required className={`${inputClass} w-40`} />
      </Field>
      <SubmitButton>新增</SubmitButton>
      <FormMessage error={state.error} />
    </form>
  );
}

function GroupItem({ tripId, group }: { tripId: string; group: GroupRow }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2">
      <span className="text-sm">{group.name}</span>
      <DeleteButton
        action={deleteGroupAction.bind(null, tripId, group.id)}
        confirmMessage={`確定要刪除組別「${group.name}」嗎？組員不會被刪除，只會變成未分組。`}
      />
    </li>
  );
}

function CreateMemberForm({ tripId, groups }: { tripId: string; groups: GroupRow[] }) {
  const [state, formAction] = useActionState(createMemberAction, INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
      <input type="hidden" name="tripId" value={tripId} />
      <FormMessage error={state.error} />
      <Field label="姓名" htmlFor="member-name" errors={state.fieldErrors?.name}>
        <input id="member-name" name="name" type="text" required className={inputClass} />
      </Field>
      <div className="flex gap-3">
        <Field label="組別" htmlFor="member-group">
          <select id="member-group" name="groupId" defaultValue="" className={inputClass}>
            <option value="">未分組</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="權重（按權重分攤用）" htmlFor="member-weight" errors={state.fieldErrors?.weight}>
          <input
            id="member-weight"
            name="weight"
            type="text"
            inputMode="decimal"
            placeholder="1"
            className={inputClass}
          />
        </Field>
      </div>
      <SubmitButton>新增成員</SubmitButton>
    </form>
  );
}

function MemberItem({
  tripId,
  member,
  groups,
}: {
  tripId: string;
  member: MemberRow;
  groups: GroupRow[];
}) {
  const [state, formAction] = useActionState(
    updateMemberAction.bind(null, member.id),
    INITIAL_ACTION_STATE,
  );

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tripId" value={tripId} />
        <input
          name="name"
          type="text"
          defaultValue={member.name}
          required
          className={`${inputClass} w-28`}
        />
        <select name="groupId" defaultValue={member.groupId ?? ""} className={`${inputClass} w-28`}>
          <option value="">未分組</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <input
          name="weight"
          type="text"
          inputMode="decimal"
          defaultValue={member.weight}
          className={`${inputClass} w-20`}
        />
        <SubmitButton>更新</SubmitButton>
      </form>
      <div className="flex items-center justify-between">
        <FormMessage error={state.error} />
        <DeleteButton
          action={deleteMemberAction.bind(null, tripId, member.id)}
          confirmMessage={`確定要刪除成員「${member.name}」嗎？`}
        />
      </div>
    </li>
  );
}

export function MemberManager({
  tripId,
  groups,
  members,
}: {
  tripId: string;
  groups: GroupRow[];
  members: MemberRow[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-600">組別</h2>
        <ul className="flex flex-col gap-2">
          {groups.map((group) => (
            <GroupItem key={group.id} tripId={tripId} group={group} />
          ))}
        </ul>
        <CreateGroupForm tripId={tripId} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-600">成員</h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <MemberItem key={member.id} tripId={tripId} member={member} groups={groups} />
          ))}
        </ul>
        <CreateMemberForm tripId={tripId} groups={groups} />
      </section>
    </div>
  );
}
