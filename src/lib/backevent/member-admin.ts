import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canCreateMemberGroup as canCreateMemberGroupByRole, financeGroupName } from "./member-groups-core";
import { allPermissions, normalizeRole, type BackEventRole } from "./permissions";
import type { BackEventMember, BackEventMemberGroup, BackEventMemberGroupMembership, BackEventPermissionKey, MemberRole } from "./types";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean | null;
  invitation_status: "not_sent" | "pending" | "accepted" | null;
  invitation_sent_at: string | null;
  invitation_accepted_at: string | null;
  last_login_at: string | null;
  created_at: string | null;
};

type PushRow = {
  user_id: string;
};

type PermissionRow = {
  profile_id: string;
  permission_key: string;
  enabled: boolean | null;
};

export type MemberAdminList = {
  members: BackEventMember[];
  groups: BackEventMemberGroup[];
  memberships: BackEventMemberGroupMembership[];
  auditLogs: MemberAuditLog[];
};

export type MemberAuditLog = {
  id: string;
  actorUserId: string | null;
  memberUserId: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type UpsertMemberInput = {
  fullName: string;
  email: string;
  phone?: string | null;
  role: MemberRole;
  active: boolean;
  groupIds: string[];
  permissions: BackEventPermissionKey[];
  sendInvite?: boolean;
  confirmSelfDeactivate?: boolean;
};

export type UpsertMemberGroupInput = {
  name: string;
  description?: string | null;
  active: boolean;
  memberIds: string[];
};

export function getMemberAdminClient() {
  return createSupabaseAdminClient();
}

export async function listMembersForAdmin(admin: AdminClient): Promise<MemberAdminList> {
  await ensureFinanceResponsibleGroup(admin);

  const [profilesResponse, groupsResponse, membershipsResponse, pushResponse, permissionsResponse, auditResponse, usersResponse] = await Promise.all([
    admin
      .from("backevent_profiles")
      .select("id,full_name,email,phone,role,active,invitation_status,invitation_sent_at,invitation_accepted_at,last_login_at,created_at")
      .order("created_at", { ascending: true }),
    admin.from("backevent_member_groups").select("id,name,description,active,created_at,updated_at").order("name", { ascending: true }),
    admin.from("backevent_member_group_members").select("id,group_id,profile_id,created_at"),
    admin.from("backevent_push_subscriptions").select("user_id").eq("active", true),
    admin.from("backevent_profile_permissions").select("profile_id,permission_key,enabled").eq("enabled", true),
    admin
      .from("backevent_member_audit_logs")
      .select("id,actor_user_id,member_user_id,action,details,created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesResponse.error) throw profilesResponse.error;
  if (groupsResponse.error) throw groupsResponse.error;
  if (membershipsResponse.error) throw membershipsResponse.error;
  if (pushResponse.error) throw pushResponse.error;
  if (permissionsResponse.error) throw permissionsResponse.error;
  if (auditResponse.error) throw auditResponse.error;
  if (usersResponse.error) throw usersResponse.error;

  const groups = (groupsResponse.data ?? []).map(toMemberGroup);
  const memberships = (membershipsResponse.data ?? []).map(toMembership);
  const usersById = new Map((usersResponse.data.users ?? []).map((user) => [user.id, user]));
  const pushCountByUser = countBy((pushResponse.data ?? []) as PushRow[], (row) => row.user_id);
  const permissionsByUser = groupPermissions((permissionsResponse.data ?? []) as PermissionRow[]);

  const members = ((profilesResponse.data ?? []) as ProfileRow[]).map((profile) => {
    const user = usersById.get(profile.id) ?? null;
    const lastLoginAt = user?.last_sign_in_at ?? profile.last_login_at ?? null;
    const invitationAcceptedAt = user?.confirmed_at ?? profile.invitation_accepted_at ?? null;
    const invitationStatus = getInvitationStatus(profile, user);

    return {
      id: profile.id,
      fullName: profile.full_name,
      email: profile.email ?? user?.email ?? null,
      phone: profile.phone,
      role: normalizeRole(profile.role),
      active: profile.active ?? true,
      invitationStatus,
      invitationSentAt: profile.invitation_sent_at,
      invitationAcceptedAt,
      lastLoginAt,
      pushSubscriptionCount: pushCountByUser.get(profile.id) ?? 0,
      permissions: permissionsByUser.get(profile.id) ?? [],
      createdAt: profile.created_at,
      groups: groups.filter((group) => memberships.some((membership) => membership.profileId === profile.id && membership.groupId === group.id)),
    } satisfies BackEventMember;
  });

  return {
    members,
    groups,
    memberships,
    auditLogs: (auditResponse.data ?? []).map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      memberUserId: row.member_user_id,
      action: row.action,
      details: row.details ?? {},
      createdAt: row.created_at,
    })),
  };
}

export async function createMemberGroupForAdmin(admin: AdminClient, actorUserId: string, input: UpsertMemberGroupInput) {
  const name = normalizeGroupName(input.name);
  if (!name) throw new Error("Gruppenavn mangler.");
  await ensureGroupNameAvailable(admin, name);

  const { data, error } = await admin
    .from("backevent_member_groups")
    .insert({
      name,
      description: input.description?.trim() || null,
      active: input.active,
    })
    .select("id")
    .single();

  if (error) throw error;
  const groupId = String(data.id);
  await setGroupMembers(admin, groupId, input.memberIds);
  await createAuditLog(admin, actorUserId, null, "member_group_created", {
    groupId,
    name,
    memberCount: input.memberIds.length,
  });
  return groupId;
}

export async function updateMemberGroupForAdmin(admin: AdminClient, actorUserId: string, groupId: string, input: UpsertMemberGroupInput) {
  const name = normalizeGroupName(input.name);
  if (!name) throw new Error("Gruppenavn mangler.");
  await ensureGroupNameAvailable(admin, name, groupId);

  const { error } = await admin
    .from("backevent_member_groups")
    .update({
      name,
      description: input.description?.trim() || null,
      active: input.active,
    })
    .eq("id", groupId);
  if (error) throw error;

  await setGroupMembers(admin, groupId, input.memberIds);
  await createAuditLog(admin, actorUserId, null, "member_group_updated", {
    groupId,
    name,
    active: input.active,
    memberCount: input.memberIds.length,
  });
}

export async function deleteMemberGroupForAdmin(admin: AdminClient, actorUserId: string, groupId: string) {
  const { data: group, error: groupError } = await admin.from("backevent_member_groups").select("id,name").eq("id", groupId).single();
  if (groupError) throw groupError;

  const { error } = await admin.from("backevent_member_groups").delete().eq("id", groupId);
  if (error) throw error;

  await createAuditLog(admin, actorUserId, null, "member_group_deleted", {
    groupId,
    name: group.name,
  });
}

export async function createMember(admin: AdminClient, actorUserId: string, input: UpsertMemberInput) {
  const normalizedEmail = normalizeEmail(input.email);
  await ensureEmailAvailable(admin, normalizedEmail);

  let userId: string;
  const invitationStatus: "not_sent" | "pending" = input.sendInvite ? "pending" : "not_sent";
  let invitationSentAt: string | null = null;

  if (input.sendInvite) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      data: { full_name: input.fullName.trim() },
    });
    if (error) throw error;
    userId = data.user.id;
    invitationSentAt = new Date().toISOString();
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: createTemporaryPassword(),
      email_confirm: false,
      user_metadata: { full_name: input.fullName.trim() },
    });
    if (error) throw error;
    userId = data.user.id;
  }

  await upsertProfile(admin, userId, {
    ...input,
    email: normalizedEmail,
    invitationStatus,
    invitationSentAt,
  });
  await setGroups(admin, userId, input.groupIds);
  await setPermissions(admin, userId, input.role, input.permissions);
  await createAuditLog(admin, actorUserId, userId, input.sendInvite ? "member_created_invited" : "member_created", {
    email: normalizedEmail,
    role: input.role,
    groupCount: input.groupIds.length,
    permissions: input.permissions,
  });

  return userId;
}

export async function updateMember(admin: AdminClient, actorUserId: string, memberId: string, input: UpsertMemberInput) {
  const normalizedEmail = normalizeEmail(input.email);
  const current = await getProfile(admin, memberId);
  await ensureEmailAvailable(admin, normalizedEmail, memberId);

  if (current.role === "ejer" && (!input.active || input.role !== "ejer")) {
    await ensureAnotherActiveOwner(admin, memberId);
  }

  if (memberId === actorUserId && !input.active && !input.confirmSelfDeactivate) {
    throw new Error("Bekræft selv-deaktivering først.");
  }

  if (current.email !== normalizedEmail) {
    const { error } = await admin.auth.admin.updateUserById(memberId, { email: normalizedEmail });
    if (error) throw error;
  }

  await upsertProfile(admin, memberId, {
    ...input,
    email: normalizedEmail,
    invitationStatus: current.invitation_status ?? "accepted",
    invitationSentAt: current.invitation_sent_at,
  });
  await setGroups(admin, memberId, input.groupIds);
  await setPermissions(admin, memberId, input.role, input.permissions);

  const roleChanged = normalizeRole(current.role) !== input.role;
  const activeChanged = (current.active ?? true) !== input.active;
  const groupChanged = true;
  await createAuditLog(admin, actorUserId, memberId, "member_updated", {
    email: normalizedEmail,
    role: input.role,
    roleChanged,
    activeChanged,
    groupChanged,
    groupCount: input.groupIds.length,
    permissions: input.permissions,
  });
}

export async function sendMemberInvitation(admin: AdminClient, actorUserId: string, memberId: string) {
  const profile = await getProfile(admin, memberId);
  const email = normalizeEmail(profile.email ?? "");
  if (!email) {
    throw new Error("Medlemmet mangler e-mail.");
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: profile.full_name ?? email },
  });
  if (error) throw error;

  const now = new Date().toISOString();
  const { error: profileError } = await admin
    .from("backevent_profiles")
    .update({
      invitation_status: "pending",
      invitation_sent_at: now,
    })
    .eq("id", memberId);

  if (profileError) throw profileError;

  await createAuditLog(admin, actorUserId, memberId, "member_invitation_sent", { email });
}

export async function createAuditLog(
  admin: AdminClient,
  actorUserId: string,
  memberUserId: string | null,
  action: string,
  details: Record<string, unknown>,
) {
  await admin.from("backevent_member_audit_logs").insert({
    actor_user_id: actorUserId,
    member_user_id: memberUserId,
    action,
    details,
  });
}

function toMemberGroup(row: {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}): BackEventMemberGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    active: row.active ?? true,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function toMembership(row: {
  id: string;
  group_id: string;
  profile_id: string;
  created_at?: string | null;
}): BackEventMemberGroupMembership {
  return {
    id: row.id,
    groupId: row.group_id,
    profileId: row.profile_id,
    createdAt: row.created_at ?? null,
  };
}

function getInvitationStatus(profile: ProfileRow, user: User | null): "not_sent" | "pending" | "accepted" {
  if (user?.last_sign_in_at || user?.confirmed_at || profile.invitation_accepted_at) {
    return "accepted";
  }

  return profile.invitation_status ?? "not_sent";
}

async function upsertProfile(
  admin: AdminClient,
  userId: string,
  input: UpsertMemberInput & {
    invitationStatus: "not_sent" | "pending" | "accepted";
    invitationSentAt: string | null;
  },
) {
  const { error } = await admin.from("backevent_profiles").upsert({
    id: userId,
    full_name: input.fullName.trim(),
    email: normalizeEmail(input.email),
    phone: input.phone?.trim() || null,
    role: input.role,
    active: input.active,
    invitation_status: input.invitationStatus,
    invitation_sent_at: input.invitationSentAt,
  });

  if (error) throw error;
}

async function setGroups(admin: AdminClient, memberId: string, groupIds: string[]) {
  const uniqueGroupIds = Array.from(new Set(groupIds.filter(Boolean)));
  const { error: deleteError } = await admin.from("backevent_member_group_members").delete().eq("profile_id", memberId);
  if (deleteError) throw deleteError;

  if (uniqueGroupIds.length === 0) {
    return;
  }

  const { error } = await admin.from("backevent_member_group_members").insert(
    uniqueGroupIds.map((groupId) => ({
      group_id: groupId,
      profile_id: memberId,
    })),
  );
  if (error) throw error;
}

async function setGroupMembers(admin: AdminClient, groupId: string, memberIds: string[]) {
  const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean)));
  const { error: deleteError } = await admin.from("backevent_member_group_members").delete().eq("group_id", groupId);
  if (deleteError) throw deleteError;

  if (uniqueMemberIds.length === 0) {
    return;
  }

  const { error } = await admin.from("backevent_member_group_members").insert(
    uniqueMemberIds.map((memberId) => ({
      group_id: groupId,
      profile_id: memberId,
    })),
  );
  if (error) throw error;
}

async function setPermissions(admin: AdminClient, memberId: string, role: MemberRole, permissions: BackEventPermissionKey[]) {
  const { error: deleteError } = await admin.from("backevent_profile_permissions").delete().eq("profile_id", memberId);
  if (deleteError) throw deleteError;

  if (role === "ejer") {
    return;
  }

  const uniquePermissions = Array.from(new Set(permissions)).filter((permission): permission is BackEventPermissionKey =>
    allPermissions.includes(permission as BackEventPermissionKey),
  );

  if (uniquePermissions.length === 0) {
    return;
  }

  const { error } = await admin.from("backevent_profile_permissions").insert(
    uniquePermissions.map((permission) => ({
      profile_id: memberId,
      permission_key: permission,
      enabled: true,
    })),
  );

  if (error) throw error;
}

async function getProfile(admin: AdminClient, memberId: string): Promise<ProfileRow> {
  const { data, error } = await admin
    .from("backevent_profiles")
    .select("id,full_name,email,phone,role,active,invitation_status,invitation_sent_at,invitation_accepted_at,last_login_at,created_at")
    .eq("id", memberId)
    .single();

  if (error) throw error;
  return data as ProfileRow;
}

async function ensureEmailAvailable(admin: AdminClient, email: string, exceptUserId?: string) {
  if (!email) throw new Error("E-mail mangler.");

  const { data, error } = await admin.from("backevent_profiles").select("id").ilike("email", email).limit(2);
  if (error) throw error;

  const duplicate = (data ?? []).find((row) => row.id !== exceptUserId);
  if (duplicate) {
    throw new Error("E-mail findes allerede.");
  }
}

async function ensureAnotherActiveOwner(admin: AdminClient, memberId: string) {
  const { data, error } = await admin.from("backevent_profiles").select("id").eq("role", "ejer").eq("active", true);
  if (error) throw error;

  const otherOwners = (data ?? []).filter((profile) => profile.id !== memberId);
  if (otherOwners.length === 0) {
    throw new Error("Sidste aktive ejer kan ikke nedgraderes eller deaktiveres.");
  }
}

function countBy<T>(items: T[], keyFn: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function groupPermissions(rows: PermissionRow[]) {
  const grouped = new Map<string, BackEventPermissionKey[]>();
  for (const row of rows) {
    if (!row.enabled || !allPermissions.includes(row.permission_key as BackEventPermissionKey)) {
      continue;
    }

    grouped.set(row.profile_id, [...(grouped.get(row.profile_id) ?? []), row.permission_key as BackEventPermissionKey]);
  }
  return grouped;
}

export function parseMemberInput(body: unknown): UpsertMemberInput {
  if (!body || typeof body !== "object") {
    throw new Error("Ugyldige felter.");
  }

  const value = body as Partial<UpsertMemberInput>;
  const fullName = String(value.fullName ?? "").trim();
  const email = normalizeEmail(String(value.email ?? ""));
  const role = normalizeRole(value.role as BackEventRole);
  const groupIds = Array.isArray(value.groupIds) ? value.groupIds.map((id) => String(id)).filter(Boolean) : [];
  const permissions = Array.isArray(value.permissions)
    ? value.permissions
        .map((permission) => String(permission))
        .filter((permission): permission is BackEventPermissionKey => allPermissions.includes(permission as BackEventPermissionKey))
    : [];

  if (!fullName) throw new Error("Navn mangler.");
  if (!email) throw new Error("E-mail mangler.");

  return {
    fullName,
    email,
    phone: value.phone ? String(value.phone) : null,
    role,
    active: value.active !== false,
    groupIds,
    permissions,
    sendInvite: value.sendInvite === true,
    confirmSelfDeactivate: value.confirmSelfDeactivate === true,
  };
}

export function parseMemberGroupInput(body: unknown): UpsertMemberGroupInput {
  if (!body || typeof body !== "object") {
    throw new Error("Ugyldige felter.");
  }

  const value = body as Partial<UpsertMemberGroupInput>;
  const name = normalizeGroupName(String(value.name ?? ""));
  const memberIds = Array.isArray(value.memberIds) ? value.memberIds.map((id) => String(id)).filter(Boolean) : [];

  if (!name) throw new Error("Gruppenavn mangler.");

  return {
    name,
    description: value.description ? String(value.description) : null,
    active: value.active !== false,
    memberIds,
  };
}

export function canCreateMemberGroup(role: string | null | undefined) {
  return canCreateMemberGroupByRole(role);
}

export function financeResponsibleGroupName() {
  return financeGroupName;
}

export async function ensureFinanceResponsibleGroup(admin: AdminClient) {
  const name = financeResponsibleGroupName();
  const { data, error } = await admin
    .from("backevent_member_groups")
    .select("id,name")
    .ilike("name", name)
    .order("created_at", { ascending: true })
    .limit(2);

  if (error) throw error;
  if ((data ?? []).length > 0) return String(data![0].id);

  const { data: inserted, error: insertError } = await admin
    .from("backevent_member_groups")
    .insert({
      name,
      description: "Modtager besked og læseadgang til OnlinePOS-returer.",
      active: true,
    })
    .select("id")
    .single();

  if (insertError) throw insertError;
  return String(inserted.id);
}

async function ensureGroupNameAvailable(admin: AdminClient, name: string, exceptGroupId?: string) {
  const { data, error } = await admin.from("backevent_member_groups").select("id,name").ilike("name", name).limit(2);
  if (error) throw error;

  const duplicate = (data ?? []).find((group) => group.id !== exceptGroupId);
  if (duplicate) {
    throw new Error("Gruppen findes allerede.");
  }
}

function normalizeGroupName(name: string) {
  return name.trim();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function createTemporaryPassword() {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}
