import { NextResponse } from "next/server";
import webPush from "web-push";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { buildMessageUrl, createPushMessage, pushPayload } from "@/lib/backevent/push-messages";

type PushTestBody = {
  endpoint?: unknown;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "frivillig");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!isWebPushConfigured()) {
    return NextResponse.json({
      ok: false,
      sent: 0,
      failed: 0,
      message: "Push er ikke konfigureret endnu",
      missingEnv: getMissingEnv(),
    });
  }

  if (!auth.supabase) {
    return NextResponse.json({ ok: true, sent: 1, failed: 0, message: "Mock mode: testnotifikation simuleret" });
  }

  const body = (await request.json().catch(() => null)) as PushTestBody | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  let query = auth.supabase
    .from("backevent_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", auth.userId)
    .eq("active", true);

  if (endpoint) {
    query = query.eq("endpoint", endpoint);
  }

  const { data, error } = await query.limit(5);

  if (error) {
    return NextResponse.json({ ok: false, sent: 0, failed: 0, message: "Kunne ikke hente notifikationer" }, { status: 500 });
  }

  const subscriptions = (data ?? []) as PushSubscriptionRow[];

  if (subscriptions.length === 0) {
    return NextResponse.json({ ok: false, sent: 0, failed: 0, message: "Ingen aktiv notifikation fundet" }, { status: 404 });
  }

  webPush.setVapidDetails(process.env.WEB_PUSH_SUBJECT!, getPublicVapidKey()!, process.env.WEB_PUSH_PRIVATE_KEY!);

  let sent = 0;
  let failed = 0;
  let messageId: string | null = null;

  for (const subscription of subscriptions) {
    try {
      if (!messageId) {
        const message = await createPushMessage(auth.supabase, {
          recipientUserId: auth.userId,
          recipientEmail: auth.userEmail,
          senderUserId: auth.userId,
          senderName: "BackEvent",
          title: "BackEvent",
          body: "Testnotifikation fra BackEvent",
          targetUrl: "/notifikationer",
          category: "test",
        });
        messageId = message.id;
      }

      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(pushPayload({
          title: "BackEvent",
          body: "Testnotifikation fra BackEvent",
          messageId,
          url: buildMessageUrl(messageId),
        })),
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      if (isExpiredSubscription(error)) {
        await auth.supabase.from("backevent_push_subscriptions").update({ active: false }).eq("id", subscription.id);
      }
    }
  }

  return NextResponse.json({
    ok: sent > 0,
    sent,
    failed,
    message: sent > 0 ? "Testnotifikation sendt" : "Testnotifikation kunne ikke sendes",
  });
}

function isWebPushConfigured() {
  return Boolean(getPublicVapidKey() && process.env.WEB_PUSH_PRIVATE_KEY && process.env.WEB_PUSH_SUBJECT);
}

function getPublicVapidKey() {
  return process.env.WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

function getMissingEnv() {
  return {
    hasPublicKey: Boolean(getPublicVapidKey()),
    hasPrivateKey: Boolean(process.env.WEB_PUSH_PRIVATE_KEY),
    hasSubject: Boolean(process.env.WEB_PUSH_SUBJECT),
  };
}

function isExpiredSubscription(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const statusCode = "statusCode" in error ? Number(error.statusCode) : null;
  return statusCode === 404 || statusCode === 410;
}
