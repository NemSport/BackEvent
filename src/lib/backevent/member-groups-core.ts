import type { BackEventMemberGroup, BackEventMemberGroupMembership, MemberRole } from "./types";

export const financeGroupName = "Økonomiansvarlige";

export function canCreateMemberGroup(role: MemberRole | "admin" | string | null | undefined) {
  return normalizeMemberGroupRole(role) === "ejer";
}

export function needsFinanceGroupSeed(groups: Array<Pick<BackEventMemberGroup, "name">>) {
  return !groups.some((group) => group.name.trim().toLocaleLowerCase("da-DK") === financeGroupName.toLocaleLowerCase("da-DK"));
}

export function countFinanceGroups(groups: Array<Pick<BackEventMemberGroup, "name">>) {
  return groups.filter((group) => group.name.trim().toLocaleLowerCase("da-DK") === financeGroupName.toLocaleLowerCase("da-DK")).length;
}

export function applyMemberGroupCreate(
  groups: BackEventMemberGroup[],
  memberships: BackEventMemberGroupMembership[],
  input: { id: string; name: string; description?: string | null; active: boolean; memberIds: string[]; now: string },
) {
  const group: BackEventMemberGroup = {
    id: input.id,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    active: input.active,
    createdAt: input.now,
    updatedAt: input.now,
  };

  return {
    groups: [...groups, group].sort((a, b) => a.name.localeCompare(b.name, "da")),
    memberships: [
      ...memberships,
      ...Array.from(new Set(input.memberIds.filter(Boolean))).map((memberId) => ({
        id: `${input.id}:${memberId}`,
        groupId: input.id,
        profileId: memberId,
        createdAt: input.now,
      })),
    ],
  };
}

export function applyMemberGroupMembers(
  memberships: BackEventMemberGroupMembership[],
  groupId: string,
  memberIds: string[],
  now: string,
) {
  return [
    ...memberships.filter((membership) => membership.groupId !== groupId),
    ...Array.from(new Set(memberIds.filter(Boolean))).map((memberId) => ({
      id: `${groupId}:${memberId}`,
      groupId,
      profileId: memberId,
      createdAt: now,
    })),
  ];
}

function normalizeMemberGroupRole(role: MemberRole | "admin" | string | null | undefined): MemberRole {
  if (role === "admin" || role === "ejer") return "ejer";
  if (role === "ansvarlig") return "ansvarlig";
  return "frivillig";
}
