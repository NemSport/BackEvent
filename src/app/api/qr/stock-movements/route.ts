import { NextResponse } from "next/server";
import { locations as mockLocations, products as mockProducts, stockBalances as mockBalances } from "@/lib/backevent/mock-data";
import { createQrGuestFingerprint, logQrGuestSecurityEvent, readQrJsonBody } from "@/lib/backevent/qr-guest-security";
import { validateQrMoveRequest, type QrMoveLine, type QrMoveRequest } from "@/lib/backevent/qr-move-request";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

export async function POST(request: Request) {
  // A valid active BackEvent user is preferred; otherwise this is the narrowly
  // allowed guest operation and the submitted display name becomes mandatory.
  const auth = await requireBackEventRole(request, "frivillig");
  const parsedBody = await readQrJsonBody(request);
  if (!parsedBody.ok) {
    if (!auth.ok) logQrGuestSecurityEvent(parsedBody.event);
    return NextResponse.json({ ok: false, message: parsedBody.message }, { status: parsedBody.status });
  }

  const body = parsedBody.value as QrMoveRequest | null;
  const validation = validateQrMoveRequest(body, !auth.ok, isSupabaseConfigured());

  if (!validation.ok) {
    if (!auth.ok) logQrGuestSecurityEvent("validation_rejected");
    return NextResponse.json({ ok: false, message: validation.message }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const profileResponse = auth.ok && supabase
    ? await supabase.from("backevent_profiles").select("full_name,email").eq("id", auth.userId).maybeSingle()
    : { data: null, error: null };

  if (profileResponse.error) {
    return NextResponse.json({ ok: false, message: "Flytningen kunne ikke gemmes" }, { status: 500 });
  }

  const profile = profileResponse.data as { full_name?: string | null; email?: string | null } | null;
  const performedByType = auth.ok ? "user" : "guest";
  const performedByUserId = auth.ok ? auth.userId : null;
  const performedByName = auth.ok
    ? profile?.full_name || profile?.email || auth.userEmail || "Ukendt bruger"
    : validation.actorName;

  if (!isSupabaseConfigured()) {
    const mockError = applyMockMove(validation.fromLocationId, validation.toLocationId, validation.lines);
    if (mockError) {
      return NextResponse.json({ ok: false, message: mockError }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      batchId: `mock-batch-${Date.now()}`,
      createdAt: new Date().toISOString(),
      createdByName: performedByName,
      performedByType,
      message: "Mock mode: samlet QR-flytning gemt",
    });
  }

  if (!supabase) {
    return NextResponse.json({ ok: false, message: "Serveren mangler Supabase opsætning" }, { status: 500 });
  }

  if (!auth.ok) {
    const fingerprint = createQrGuestFingerprint(request, validation.fromLocationId);
    if (!fingerprint) {
      logQrGuestSecurityEvent("rate_limit_unavailable");
      return NextResponse.json({ ok: false, message: "Flytningen kunne ikke gemmes" }, { status: 503 });
    }

    const { data: allowed, error: rateLimitError } = await supabase.rpc("backevent_allow_qr_guest_move", {
      p_fingerprint: fingerprint,
    });
    if (rateLimitError) {
      logQrGuestSecurityEvent("rate_limit_error");
      return NextResponse.json({ ok: false, message: "Flytningen kunne ikke gemmes" }, { status: 503 });
    }
    if (!allowed) {
      logQrGuestSecurityEvent("rate_limited");
      return NextResponse.json(
        { ok: false, message: "For mange forsøg. Vent lidt og prøv igen." },
        { status: 429, headers: { "Retry-After": "600" } },
      );
    }
  }

  const { data, error } = await supabase.rpc("backevent_create_qr_stock_movement_batch", {
    p_from_location_id: validation.fromLocationId,
    p_to_location_id: validation.toLocationId,
    p_lines: validation.lines,
    p_performed_by_name: performedByName,
    p_performed_by_type: performedByType,
    p_performed_by_user_id: performedByUserId,
  });

  if (error) {
    if (!auth.ok) logQrGuestSecurityEvent("database_rejected");
    return NextResponse.json({ ok: false, message: safeDatabaseMessage(error.message) }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    batchId: data as string,
    createdAt: new Date().toISOString(),
    createdByName: performedByName,
    performedByType,
  });
}

function applyMockMove(fromLocationId: string, toLocationId: string, lines: QrMoveLine[]) {
  const from = mockLocations.find((location) => location.id === fromLocationId && location.active !== false);
  const to = mockLocations.find((location) => location.id === toLocationId && location.active !== false);
  if (!from || !to) return "Lokationen findes ikke eller er deaktiveret";

  for (const line of lines) {
    const product = mockProducts.find(
      (item) => item.id === line.productId && item.active !== false && item.trackingMode === "inventory",
    );
    if (!product) return "Varen findes ikke eller er deaktiveret";
    const balance = mockBalances.find((item) => item.productId === line.productId && item.locationId === fromLocationId);
    if ((balance?.quantity ?? 0) < line.quantity) return "Der er ikke nok på lager";
  }

  for (const line of lines) {
    const fromBalance = mockBalances.find((item) => item.productId === line.productId && item.locationId === fromLocationId);
    let toBalance = mockBalances.find((item) => item.productId === line.productId && item.locationId === toLocationId);
    if (!toBalance) {
      toBalance = { productId: line.productId, locationId: toLocationId, quantity: 0 };
      mockBalances.push(toBalance);
    }
    if (fromBalance) fromBalance.quantity -= line.quantity;
    toBalance.quantity += line.quantity;
  }
  return null;
}

function safeDatabaseMessage(message: string) {
  if (/not enough|ikke nok|Der er ikke nok/i.test(message)) return "Der er ikke nok på lager";
  if (/Fra og til|forskellige/i.test(message)) return "Start og destination skal være forskellige";
  if (/Navn/i.test(message)) return "Skriv dit navn";
  if (/lokation/i.test(message)) return "Lokationen findes ikke eller er deaktiveret";
  if (/vare|produkt/i.test(message)) return "Varen findes ikke eller er deaktiveret";
  return "Flytningen kunne ikke gemmes";
}
