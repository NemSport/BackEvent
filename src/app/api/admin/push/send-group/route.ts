import { NextResponse } from "next/server";
import webPush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

type SendGroupPushBody = {
  groupId?: unknown;
  title?: unknown;
  message?: unknown;
};

type GroupRow = {
  id: string;
  name: string;
  active: boolean;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  active: boolean;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!auth.supabase) {
    return NextResponse.json({ ok: true, logs: [] });
  }

  const { data, error } = await auth.supabase
    .from("backevent_push_logs")
    .select("id,recipient_user_id,recipient_email,group_id,title,body,status,error_message,created_at")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente push-log" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    logs: (data ?? []).map((row) => ({
      id: row.id,
      recipientUserId: row.recipient_user_id,
      recipientEmail: row.recipient_email,
      groupId: row.group_id,
      title: row.title,
      body: row.body,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as SendGroupPushBody | null;
  const validation = validateBody(body);

  if (!validation.ok) {
    return NextResponse.json({ ok: false, message: validation.message }, { status: 400 });
  }

  if (!auth.supabase) {
    return NextResponse.json({
      ok: true,
      groupId: validation.groupId,
      groupName: "Mock gruppe",
      memberCount: 1,
      subscriptionCount: 1,
      sentCount: 1,
      failedCount: 0,
      skippedCount: 0,
      message: "Mock mode: gruppepush simuleret",
    });
  }

  let group: GroupRow | null = null;
  let members: ProfileRow[] = [];
  let subscriptions: PushSubscriptionRow[] = [];

  try {
    group = await getActiveGroup(auth.supabase, validation.groupId);

    if (!group) {
      return NextResponse.json({ ok: false, message: "Gruppen findes ikke eller er inaktiv" }, { status: 404 });
    }

    members = await getActiveGroupMembers(auth.supabase, group.id);
    subscriptions = members.length > 0 ? await getActiveSubscriptions(auth.supabase, members.map((member) => member.id)) : [];
  } catch {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente gruppe og enheder" }, { status: 500 });
  }

  const membersWithSubscriptions = new Set(subscriptions.map((subscription) => subscription.user_id));
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  if (!isWebPushConfigured()) {
    for (const member of members) {
      skippedCount += 1;
      await createPushLog(auth.supabase, {
        member,
        groupId: group.id,
        title: validation.title,
        body: validation.message,
        status: "skipped",
        errorMessage: "Push er ikke konfigureret endnu",
      });
    }

    return NextResponse.json({
      ok: false,
      groupId: group.id,
      groupName: group.name,
      memberCount: members.length,
      subscriptionCount: subscriptions.length,
      sentCount,
      failedCount,
      skippedCount,
      message: "Push er ikke konfigureret endnu",
    });
  }

  webPush.setVapidDetails(process.env.WEB_PUSH_SUBJECT!, getPublicVapidKey()!, process.env.WEB_PUSH_PRIVATE_KEY!);

  for (const member of members) {
    if (!membersWithSubscriptions.has(member.id)) {
      skippedCount += 1;
      await createPushLog(auth.supabase, {
        member,
        groupId: group.id,
        title: validation.title,
        body: validation.message,
        status: "skipped",
        errorMessage: "Ingen aktiv push-enhed",
      });
    }
  }

  for (const subscription of subscriptions) {
    const member = members.find((item) => item.id === subscription.user_id) ?? null;

    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify({
          title: validation.title,
          body: validation.message,
          url: "/",
        }),
      );
      sentCount += 1;
      await createPushLog(auth.supabase, {
        member,
        groupId: group.id,
        title: validation.title,
        body: validation.message,
        status: "sent",
        errorMessage: null,
      });
    } catch (error) {
      failedCount += 1;
      const errorMessage = safeErrorMessage(error);
      if (isExpiredSubscription(error)) {
        await auth.supabase.from("backevent_push_subscriptions").update({ active: false }).eq("id", subscription.id);
      }
      await createPushLog(auth.supabase, {
        member,
        groupId: group.id,
        title: validation.title,
        body: validation.message,
        status: "failed",
        errorMessage,
      });
    }
  }

  return NextResponse.json({
    ok: sentCount > 0,
    groupId: group.id,
    groupName: group.name,
    memberCount: members.length,
    subscriptionCount: subscriptions.length,
    sentCount,
    failedCount,
    skippedCount,
  });
}

function validateBody(body: SendGroupPushBody | null):
  | { ok: false; message: string }
  | { ok: true; groupId: string; title: string; message: string } {
  if (!body) {
    return { ok: false, message: "Ugyldig forespørgsel" };
  }

  if (typeof body.groupId !== "string" || body.groupId.trim().length < 10) {
    return { ok: false, message: "Vælg en gruppe" };
  }

  if (typeof body.title !== "string" || body.title.trim().length < 2) {
    return { ok: false, message: "Udfyld titel" };
  }

  if (typeof body.message !== "string" || body.message.trim().length < 2) {
    return { ok: false, message: "Udfyld besked" };
  }

  return {
    ok: true,
    groupId: body.groupId.trim(),
    title: body.title.trim().slice(0, 120),
    message: body.message.trim().slice(0, 500),
  };
}

async function getActiveGroup(supabase: SupabaseClient, groupId: string) {
  const { data, error } = await supabase
    .from("backevent_member_groups")
    .select("id,name,active")
    .eq("id", groupId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as GroupRow | null;
}

async function getActiveGroupMembers(supabase: SupabaseClient, groupId: string) {
  const { data: memberships, error: membershipsError } = await supabase
    .from("backevent_member_group_members")
    .select("profile_id")
    .eq("group_id", groupId);

  if (membershipsError) {
    throw membershipsError;
  }

  const profileIds = Array.from(new Set((memberships ?? []).map((membership) => membership.profile_id as string).filter(Boolean)));

  if (profileIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("backevent_profiles")
    .select("id,email,full_name,active")
    .in("id", profileIds)
    .eq("active", true);

  if (profilesError) {
    throw profilesError;
  }

  return (profiles ?? []) as ProfileRow[];
}

async function getActiveSubscriptions(supabase: SupabaseClient, userIds: string[]) {
  const { data, error } = await supabase
    .from("backevent_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", userIds)
    .eq("active", true);

  if (error) {
    throw error;
  }

  return (data ?? []) as PushSubscriptionRow[];
}

async function createPushLog(
  supabase: SupabaseClient,
  input: {
    member: ProfileRow | null;
    groupId: string;
    title: string;
    body: string;
    status: "sent" | "failed" | "skipped";
    errorMessage: string | null;
  },
) {
  await supabase.from("backevent_push_logs").insert({
    recipient_user_id: input.member?.id ?? null,
    recipient_email: input.member?.email ?? null,
    group_id: input.groupId,
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
  if (!error || typeof error !== "object") {
    return false;
  }

  const statusCode = "statusCode" in error ? Number(error.statusCode) : null;
  return statusCode === 404 || statusCode === 410;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "Push kunne ikke sendes";
}
