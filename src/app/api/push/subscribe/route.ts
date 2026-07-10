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
  endpoint?: unknown;
};

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "frivillig");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!auth.supabase) {
    return NextResponse.json({ ok: true, activeCount: 0, subscriptions: [] });
  }

  const { data, error } = await auth.supabase
    .from("backevent_push_subscriptions")
    .select("id,endpoint,active,created_at,updated_at")
    .eq("user_id", auth.userId)
    .eq("active", true)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente notifikationer" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    activeCount: data?.length ?? 0,
    subscriptions: (data ?? []).map((subscription) => ({
      id: subscription.id,
      endpoint: subscription.endpoint,
      active: subscription.active,
      createdAt: subscription.created_at,
      updatedAt: subscription.updated_at,
    })),
  });
}

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

export async function DELETE(request: Request) {
  const auth = await requireBackEventRole(request, "frivillig");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!auth.supabase) {
    return NextResponse.json({ ok: true, message: "Mock mode: notifikation fjernet" });
  }

  const body = (await request.json().catch(() => null)) as PushSubscribeBody | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;

  let query = auth.supabase.from("backevent_push_subscriptions").update({ active: false }).eq("user_id", auth.userId);

  if (endpoint) {
    query = query.eq("endpoint", endpoint);
  }

  const { error } = await query;

  if (error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke fjerne notifikationer" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Notifikationer er slået fra på denne enhed" });
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
