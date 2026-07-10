import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

type PushSubscribeBody = {
  subscription?: {
    endpoint?: unknown;
    keys?: {
      p256dh?: unknown;
      auth?: unknown;
    };
  };
  userAgent?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "frivillig");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!auth.supabase) {
    return NextResponse.json({ ok: true, message: "Mock mode: notifikation gemt lokalt" });
  }

  const body = (await request.json().catch(() => null)) as PushSubscribeBody | null;
  const parsed = parseSubscription(body);

  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: parsed.message }, { status: 400 });
  }

  const { error } = await auth.supabase.from("backevent_push_subscriptions").upsert(
    {
      user_id: auth.userId,
      endpoint: parsed.endpoint,
      p256dh: parsed.p256dh,
      auth: parsed.auth,
      user_agent: parsed.userAgent,
      active: true,
    },
    {
      onConflict: "user_id,endpoint",
    },
  );

  if (error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke gemme notifikationer" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Notifikationer er aktiveret" });
}

function parseSubscription(body: PushSubscribeBody | null):
  | { ok: false; message: string }
  | { ok: true; endpoint: string; p256dh: string; auth: string; userAgent: string | null } {
  const endpoint = body?.subscription?.endpoint;
  const p256dh = body?.subscription?.keys?.p256dh;
  const auth = body?.subscription?.keys?.auth;

  if (typeof endpoint !== "string" || endpoint.length < 10) {
    return { ok: false, message: "Push endpoint mangler" };
  }

  if (typeof p256dh !== "string" || typeof auth !== "string") {
    return { ok: false, message: "Push nøgler mangler" };
  }

  return {
    ok: true,
    endpoint,
    p256dh,
    auth,
    userAgent: typeof body?.userAgent === "string" ? body.userAgent.slice(0, 500) : null,
  };
}
