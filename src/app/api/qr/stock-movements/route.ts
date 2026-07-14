import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

type QrMoveRequest = {
  fromLocationId?: unknown;
  toLocationId?: unknown;
  actorName?: unknown;
  lines?: unknown;
};

type QrMoveLine = {
  productId: string;
  quantity: number;
  unit: string;
};

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "frivillig");
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  const body = (await request.json().catch(() => null)) as QrMoveRequest | null;
  const validation = validateBody(body);

  if (!validation.ok) {
    return NextResponse.json({ ok: false, message: validation.message }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      ok: true,
      batchId: `mock-batch-${Date.now()}`,
      createdAt: new Date().toISOString(),
      createdByName: auth.userEmail ?? validation.actorName,
      message: "Mock mode: samlet QR-flytning gemt",
    });
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ ok: false, message: "Serveren mangler Supabase opsætning" }, { status: 500 });
  }

  const sessionActorName = await getSessionActorName(request);
  const createdByName = sessionActorName ?? auth.userEmail ?? validation.actorName;

  const { data, error } = await supabase.rpc("backevent_create_stock_movement_batch", {
    p_from_location_id: validation.fromLocationId,
    p_to_location_id: validation.toLocationId,
    p_lines: validation.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unit: line.unit,
    })),
    p_created_by_name: createdByName,
    p_source: "qr",
  });

  if (error) {
    return NextResponse.json({ ok: false, message: safeDatabaseMessage(error.message) }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    batchId: data as string,
    createdAt: new Date().toISOString(),
    createdByName,
  });
}

function validateBody(body: QrMoveRequest | null):
  | { ok: false; message: string }
  | { ok: true; fromLocationId: string; toLocationId: string; actorName: string; lines: QrMoveLine[] } {
  if (!body) {
    return { ok: false, message: "Ugyldig forespørgsel" };
  }

  if (typeof body.fromLocationId !== "string" || !body.fromLocationId) {
    return { ok: false, message: "Vælg startlokation" };
  }

  if (typeof body.toLocationId !== "string" || !body.toLocationId) {
    return { ok: false, message: "Vælg destination" };
  }

  if (body.fromLocationId === body.toLocationId) {
    return { ok: false, message: "Start og destination skal være forskellige" };
  }

  if (typeof body.actorName !== "string" || body.actorName.trim().length < 2) {
    return { ok: false, message: "Skriv dit navn" };
  }

  if (!Array.isArray(body.lines)) {
    return { ok: false, message: "Vælg mindst én vare" };
  }

  const lines = body.lines
    .map((line) => parseLine(line))
    .filter((line): line is QrMoveLine => Boolean(line));

  if (lines.length === 0) {
    return { ok: false, message: "Vælg mindst én vare" };
  }

  return {
    ok: true,
    fromLocationId: body.fromLocationId,
    toLocationId: body.toLocationId,
    actorName: body.actorName.trim().slice(0, 120),
    lines,
  };
}

function parseLine(line: unknown): QrMoveLine | null {
  if (!line || typeof line !== "object") {
    return null;
  }

  const productId = "productId" in line && typeof line.productId === "string" ? line.productId : null;
  const quantity = "quantity" in line ? Number(line.quantity) : 0;
  const unit = "unit" in line && typeof line.unit === "string" && line.unit.trim() ? line.unit.trim() : "kasser";

  if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return { productId, quantity, unit };
}

async function getSessionActorName(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return null;
  }

  const supabase = createSupabaseServerClient(accessToken);

  if (!supabase) {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser(accessToken);

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("backevent_profiles")
    .select("full_name,email")
    .eq("id", user.id)
    .maybeSingle();

  return profile?.full_name || profile?.email || user.email || null;
}

function safeDatabaseMessage(message: string) {
  if (message.includes("not enough") || message.includes("ikke nok") || message.includes("Der er ikke nok")) {
    return "Der er ikke nok på lager";
  }

  if (message.includes("Fra og til")) {
    return "Start og destination skal være forskellige";
  }

  if (message.includes("Navn")) {
    return "Skriv dit navn";
  }

  return "Flytningen kunne ikke gemmes";
}
