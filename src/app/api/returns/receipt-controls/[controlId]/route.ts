import { NextResponse } from "next/server";
import { requireReturnAccess } from "@/lib/backevent/return-access";

export async function GET(request: Request, context: { params: Promise<{ controlId: string }> }) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  if (!auth.canControl) return NextResponse.json({ ok: false, message: "Du har ikke adgang til bonkontroller" }, { status: 403 });
  if (!auth.supabase) return NextResponse.json({ ok: false, message: "Ingen data endnu" }, { status: 404 });
  const { controlId } = await context.params;
  const [{ data: control, error }, { data: notifications, error: notificationError }, { data: audit, error: auditError }] = await Promise.all([
    auth.supabase.from("backevent_onlinepos_receipt_controls").select("*").eq("id", controlId).maybeSingle(),
    auth.supabase.from("backevent_onlinepos_receipt_control_notifications")
      .select("id,recipient_user_id,status,error_message,push_message_id,created_at")
      .eq("receipt_control_id", controlId).order("created_at", { ascending: false }),
    auth.supabase.from("backevent_onlinepos_receipt_control_audit")
      .select("id,previous_status,status,internal_note,handled_by,handled_by_name,created_at")
      .eq("receipt_control_id", controlId).order("created_at", { ascending: false }),
  ]);
  if (error || notificationError || auditError) {
    const queryError = error ?? notificationError ?? auditError!;
    console.error("[receipt-control-detail-api] database query failed", { controlId, code: queryError.code, message: queryError.message, details: queryError.details, hint: queryError.hint });
    const message = process.env.NODE_ENV === "development" ? `Bonkontrol kunne ikke hentes: ${queryError.code} ${queryError.message}` : "Bonkontrol kunne ikke hentes";
    return NextResponse.json({ ok: false, message, errorCode: queryError.code }, { status: 500 });
  }
  if (!control) return NextResponse.json({ ok: false, message: "Bonkontrol ikke fundet" }, { status: 404 });
  const recipientIds = [...new Set((notifications ?? []).map((item) => item.recipient_user_id).filter(Boolean))];
  const profiles = recipientIds.length
    ? await auth.supabase.from("backevent_profiles").select("id,email,full_name").in("id", recipientIds)
    : { data: [], error: null };
  if (profiles.error) console.error("[receipt-control-detail-api] recipient lookup failed", { controlId, code: profiles.error.code, message: profiles.error.message });
  const profilesById = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  return NextResponse.json({
    ok: true,
    type: "receipt-control",
    control,
    canControl: auth.canControl,
    audit: audit ?? [],
    notifications: (notifications ?? []).map((item) => ({ ...item, recipient: profilesById.get(item.recipient_user_id ?? "") ?? null })),
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ controlId: string }> }) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  if (!auth.canControl) return NextResponse.json({ ok: false, message: "Kun Økonomiansvarlige og Ejer kan behandle bonkontroller" }, { status: 403 });
  if (!auth.supabase) return NextResponse.json({ ok: true, mockMode: true });

  const { controlId } = await context.params;
  const body = await request.json().catch(() => null) as { action?: string; note?: string; expectedUpdatedAt?: string } | null;
  if (!body || !["approve", "follow_up", "confirm_error", "save_note"].includes(body.action ?? "") || !body.expectedUpdatedAt) {
    return NextResponse.json({ ok: false, message: "Ugyldig behandling" }, { status: 400 });
  }
  const { data, error } = await auth.supabase.rpc("backevent_handle_receipt_control", {
    p_control_id: controlId,
    p_action: body.action,
    p_internal_note: String(body.note ?? "").trim() || null,
    p_expected_updated_at: body.expectedUpdatedAt,
  });
  if (error) {
    const conflict = error.message.includes("RECEIPT_CONTROL_CONFLICT");
    console.error("[receipt-control-detail-api] treatment failed", { controlId, code: error.code, message: error.message });
    return NextResponse.json({ ok: false, message: conflict ? "Sagen er ændret af en anden bruger. Siden opdateres nu." : "Bonkontrollen kunne ikke gemmes", conflict }, { status: conflict ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, control: Array.isArray(data) ? data[0] : data });
}
