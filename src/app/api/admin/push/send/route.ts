import { NextResponse } from "next/server";
import webPush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildMessageUrl, createPushMessage, isOperationalGroupName, pushPayload } from "@/lib/backevent/push-messages";
import { isOwnerRole, isResponsibleRole, normalizeRole, type BackEventRole } from "@/lib/backevent/permissions";

type Body = {
  targetMode?: unknown;
  groupIds?: unknown;
  roles?: unknown;
  memberIds?: unknown;
  title?: unknown;
  message?: unknown;
  targetUrl?: unknown;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  active: boolean;
};

type GroupRow = {
  id: string;
  name: string;
  active: boolean;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ansvarlig");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const validation = validateBody((await request.json().catch(() => null)) as Body | null);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, message: validation.message }, { status: 400 });
  }

  if (!isOwnerRole(auth.profileRole) && auth.supabase) {
    const { data, error } = await auth.supabase.rpc("backevent_has_permission", { p_permission_key: "send_notifications" });
    if (error || data !== true) {
      return NextResponse.json({ ok: false, message: "Du har ikke adgang til at sende notifikationer" }, { status: 403 });
    }
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({
      ok: true,
      memberCount: 1,
      subscriptionCount: 1,
      sentCount: 1,
      failedCount: 0,
      skippedCount: 0,
      recipientSummary: "Mock mode",
    });
  }

  try {
    const context = await resolveRecipients(admin, auth.profileRole, validation);
    if (!context.ok) {
      return NextResponse.json({ ok: false, message: context.message }, { status: context.status });
    }

    const subscriptions = context.members.length > 0 ? await getActiveSubscriptions(admin, context.members.map((member) => member.id)) : [];
    const membersWithSubscriptions = new Set(subscriptions.map((subscription) => subscription.user_id));
    const memberMessageIds = new Map<string, string>();
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const member of context.members) {
      const inboxMessage = await createPushMessage(admin, {
        recipientUserId: member.id,
        recipientEmail: member.email,
        senderUserId: auth.userId,
        senderName: auth.userEmail,
        groupId: context.primaryGroupId,
        title: validation.title,
        body: validation.message,
        targetUrl: validation.targetUrl,
        category: "group",
      });
      memberMessageIds.set(member.id, inboxMessage.id);
    }

    if (!isWebPushConfigured()) {
      for (const member of context.members) {
        skippedCount += 1;
        await createPushLog(admin, {
          senderUserId: auth.userId,
          member,
          groupId: context.primaryGroupId,
          recipientScope: context.scope,
          title: validation.title,
          body: validation.message,
          status: "skipped",
          errorMessage: "Push er ikke konfigureret endnu",
        });
      }

      return NextResponse.json({
        ok: false,
        memberCount: context.members.length,
        subscriptionCount: subscriptions.length,
        sentCount,
        failedCount,
        skippedCount,
        recipientSummary: context.summary,
        message: "Push er ikke konfigureret endnu",
      });
    }

    webPush.setVapidDetails(process.env.WEB_PUSH_SUBJECT!, getPublicVapidKey()!, process.env.WEB_PUSH_PRIVATE_KEY!);

    for (const member of context.members) {
      if (!membersWithSubscriptions.has(member.id)) {
        skippedCount += 1;
        await createPushLog(admin, {
          senderUserId: auth.userId,
          member,
          groupId: context.primaryGroupId,
          recipientScope: context.scope,
          title: validation.title,
          body: validation.message,
          status: "skipped",
          errorMessage: "Ingen aktiv push-enhed",
        });
      }
    }

    for (const subscription of subscriptions) {
      const member = context.members.find((item) => item.id === subscription.user_id) ?? null;
      const messageId = member ? memberMessageIds.get(member.id) ?? null : null;

      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify(pushPayload({
            title: validation.title,
            body: validation.message,
            messageId,
            url: buildMessageUrl(messageId),
          })),
        );
        sentCount += 1;
        await createPushLog(admin, {
          senderUserId: auth.userId,
          member,
          groupId: context.primaryGroupId,
          recipientScope: context.scope,
          title: validation.title,
          body: validation.message,
          status: "sent",
          errorMessage: null,
        });
      } catch (error) {
        failedCount += 1;
        if (isExpiredSubscription(error)) {
          await admin.from("backevent_push_subscriptions").update({ active: false }).eq("id", subscription.id);
        }
        await createPushLog(admin, {
          senderUserId: auth.userId,
          member,
          groupId: context.primaryGroupId,
          recipientScope: context.scope,
          title: validation.title,
          body: validation.message,
          status: "failed",
          errorMessage: safeErrorMessage(error),
        });
      }
    }

    return NextResponse.json({
      ok: sentCount > 0,
      memberCount: context.members.length,
      subscriptionCount: subscriptions.length,
      sentCount,
      failedCount,
      skippedCount,
      recipientSummary: context.summary,
    });
  } catch {
    return NextResponse.json({ ok: false, message: "Push-besked kunne ikke sendes" }, { status: 500 });
  }
}

function validateBody(body: Body | null):
  | { ok: false; message: string }
  | {
      ok: true;
      targetMode: "all" | "roles" | "groups" | "members";
      groupIds: string[];
      roles: BackEventRole[];
      memberIds: string[];
      title: string;
      message: string;
      targetUrl: string;
    } {
  if (!body) return { ok: false, message: "Ugyldig forespørgsel" };
  const targetMode = body.targetMode === "roles" || body.targetMode === "groups" || body.targetMode === "members" ? body.targetMode : "all";
  const groupIds = Array.isArray(body.groupIds) ? body.groupIds.map(String).filter(Boolean) : [];
  const roles = Array.isArray(body.roles) ? body.roles.map((role) => normalizeRole(role)).filter(Boolean) : [];
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds.map(String).filter(Boolean) : [];
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
  const targetUrl = typeof body.targetUrl === "string" && body.targetUrl.startsWith("/") ? body.targetUrl.trim().slice(0, 160) : "/notifikationer";

  if (title.length < 2) return { ok: false, message: "Udfyld titel" };
  if (message.length < 2) return { ok: false, message: "Udfyld besked" };
  if (targetMode === "roles" && roles.length === 0) return { ok: false, message: "Vælg mindst én rolle" };
  if (targetMode === "groups" && groupIds.length === 0) return { ok: false, message: "Vælg mindst én gruppe" };
  if (targetMode === "members" && memberIds.length === 0) return { ok: false, message: "Vælg mindst ét medlem" };

  return { ok: true, targetMode, groupIds, roles, memberIds, title, message, targetUrl };
}

async function resolveRecipients(
  supabase: SupabaseClient,
  role: string | null,
  input: Extract<ReturnType<typeof validateBody>, { ok: true }>,
): Promise<
  | { ok: false; status: number; message: string }
  | { ok: true; members: ProfileRow[]; primaryGroupId: string | null; scope: Record<string, unknown>; summary: string }
> {
  const isOwner = isOwnerRole(role);

  if (!isOwner && input.targetMode !== "groups") {
    return { ok: false, status: 403, message: "Kun ejer kan sende til alle, roller eller udvalgte medlemmer" };
  }

  if (input.targetMode === "groups") {
    const groups = await getGroups(supabase, input.groupIds);
    if (!isOwner && groups.some((group) => !isOperationalGroupName(group.name))) {
      return { ok: false, status: 403, message: "Ansvarlig kan kun sende til driftsgrupper" };
    }
    const members = await getMembersByGroups(supabase, groups.map((group) => group.id));
    return {
      ok: true,
      members,
      primaryGroupId: groups[0]?.id ?? null,
      scope: { mode: "groups", groupIds: groups.map((group) => group.id), groupNames: groups.map((group) => group.name) },
      summary: `${groups.length} grupper`,
    };
  }

  if (!isResponsibleRole(role)) {
    return { ok: false, status: 403, message: "Du har ikke adgang" };
  }

  let query = supabase.from("backevent_profiles").select("id,email,full_name,role,active").eq("active", true);
  if (input.targetMode === "roles") {
    query = query.in("role", input.roles);
  }
  if (input.targetMode === "members") {
    query = query.in("id", input.memberIds);
  }
  const { data, error } = await query;
  if (error) throw error;

  return {
    ok: true,
    members: (data ?? []) as ProfileRow[],
    primaryGroupId: null,
    scope: { mode: input.targetMode, roles: input.roles, memberIds: input.memberIds },
    summary: input.targetMode === "all" ? "Alle brugere" : input.targetMode === "roles" ? `${input.roles.length} roller` : `${input.memberIds.length} medlemmer`,
  };
}

async function getGroups(supabase: SupabaseClient, groupIds: string[]) {
  const { data, error } = await supabase.from("backevent_member_groups").select("id,name,active").in("id", groupIds).eq("active", true);
  if (error) throw error;
  return (data ?? []) as GroupRow[];
}

async function getMembersByGroups(supabase: SupabaseClient, groupIds: string[]) {
  const { data: memberships, error } = await supabase.from("backevent_member_group_members").select("profile_id").in("group_id", groupIds);
  if (error) throw error;
  const profileIds = Array.from(new Set((memberships ?? []).map((membership) => membership.profile_id as string).filter(Boolean)));
  if (profileIds.length === 0) return [];
  const { data, error: profileError } = await supabase.from("backevent_profiles").select("id,email,full_name,role,active").in("id", profileIds).eq("active", true);
  if (profileError) throw profileError;
  return (data ?? []) as ProfileRow[];
}

async function getActiveSubscriptions(supabase: SupabaseClient, userIds: string[]) {
  const { data, error } = await supabase
    .from("backevent_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", userIds)
    .eq("active", true);
  if (error) throw error;
  return (data ?? []) as PushSubscriptionRow[];
}

async function createPushLog(
  supabase: SupabaseClient,
  input: {
    senderUserId: string;
    member: ProfileRow | null;
    groupId: string | null;
    recipientScope: Record<string, unknown>;
    title: string;
    body: string;
    status: "sent" | "failed" | "skipped";
    errorMessage: string | null;
  },
) {
  await supabase.from("backevent_push_logs").insert({
    sender_user_id: input.senderUserId,
    recipient_user_id: input.member?.id ?? null,
    recipient_email: input.member?.email ?? null,
    group_id: input.groupId,
    recipient_scope: input.recipientScope,
    title: input.title,
    body: input.body,
    status: input.status,
    error_message: input.errorMessage,
  });
}

function isWebPushConfigured() {
  return Boolean(getPublicVapidKey() && process.env.WEB_PUSH_PRIVATE_KEY && process.env.WEB_PUSH_SUBJECT);
}

function getPublicVapidKey() {
  return process.env.WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

function isExpiredSubscription(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const statusCode = "statusCode" in error ? Number(error.statusCode) : null;
  return statusCode === 404 || statusCode === 410;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "Push kunne ikke sendes";
}
