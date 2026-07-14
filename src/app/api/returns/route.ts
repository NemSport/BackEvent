import { NextResponse } from "next/server";
import { requireReturnAccess } from "@/lib/backevent/return-access";
import { ACTIVE_RECEIPT_CONTROL_STATUSES, CLOSED_RECEIPT_CONTROL_STATUSES } from "@/lib/backevent/return-control-contract";

export async function GET(request: Request) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });

  if (!auth.supabase) return NextResponse.json({ ok: true, summary: mockSummary(), returns: [] });

  const url = new URL(request.url);
  const control = url.searchParams.get("control");
  const date = url.searchParams.get("date");
  const locationId = url.searchParams.get("locationId");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");
  let query = auth.supabase
    .from("backevent_returns")
    .select("id,receipt_number,onlinepos_returned_at,created_at,total_amount,processing_status,control_status,control_reasons,suspicion_flags,onlinepos_location_ref,location_id,backevent_locations!backevent_returns_location_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (control === "open") {
    query = query.eq("control_status", "open");
  }
  if (date) {
    query = query.gte("onlinepos_returned_at", `${date}T00:00:00.000Z`).lte("onlinepos_returned_at", `${date}T23:59:59.999Z`);
  }
  if (locationId) {
    query = query.eq("location_id", locationId);
  }
  if (status) {
    if (status === "control") query = query.eq("control_status", "open");
    else if (status === "failed") query = query.eq("processing_status", "processing_failed");
    else if (status === "processed") query = query.eq("processing_status", "processed");
  }
  if (search) {
    query = query.ilike("receipt_number", `%${search}%`);
  }

  const { data, error } = await query;
  if (error) return databaseError("Returer kunne ikke hentes", error);

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    receiptNumber: row.receipt_number,
    returnedAt: row.onlinepos_returned_at ?? row.created_at,
    createdAt: row.created_at,
    totalAmount: Number(row.total_amount ?? 0),
    processingStatus: row.processing_status,
    controlStatus: row.control_status,
    controlReasons: Array.isArray(row.control_reasons) ? row.control_reasons : [],
    suspicionFlags: Array.isArray(row.suspicion_flags) ? row.suspicion_flags : [],
    locationName: relationName(row.backevent_locations) ?? row.onlinepos_location_ref ?? "Ukendt sted",
  }));
  const receiptControlsResult = auth.canControl && (control === "open" || control === "history")
    ? await auth.supabase
      .from("backevent_onlinepos_receipt_controls")
      .select("id,receipt_number,onlinepos_transaction_id,classification,control_types,deposit_return_quantity,deposit_breakdown,purchase_value,deposit_return_value,final_total,source,replay_run_id,status,handled_at,handled_by_name,internal_note,created_at,updated_at")
      .in("status", control === "open" ? [...ACTIVE_RECEIPT_CONTROL_STATUSES] : [...CLOSED_RECEIPT_CONTROL_STATUSES])
      .order("created_at", { ascending: false })
      .limit(100)
    : { data: [], error: null };
  if (receiptControlsResult.error) return databaseError("Bonkontroller kunne ikke hentes", receiptControlsResult.error);
  const receiptControlRows = receiptControlsResult.data;

  const { data: latestRun } = await auth.supabase
    .from("backevent_return_sync_runs")
    .select("id,status,page_count,transaction_count,return_count,review_count,duplicate_count,error_message,started_at,finished_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    summary: buildSummary(rows),
    latestSync: latestRun ?? null,
    returns: rows,
    receiptControls: (receiptControlRows ?? []).map((row) => ({
      id: row.id,
      receiptNumber: row.receipt_number,
      transactionId: row.onlinepos_transaction_id,
      classification: row.classification,
      controlTypes: Array.isArray(row.control_types) ? row.control_types : [],
      depositReturnQuantity: Number(row.deposit_return_quantity ?? 0),
      depositBreakdown: row.deposit_breakdown ?? {},
      purchaseValue: Number(row.purchase_value ?? 0),
      depositReturnValue: Number(row.deposit_return_value ?? 0),
      finalTotal: Number(row.final_total ?? 0),
      source: row.source,
      status: row.status,
      handledAt: row.handled_at,
      handledByName: row.handled_by_name,
      internalNote: row.internal_note,
      updatedAt: row.updated_at,
      replayRunId: row.replay_run_id,
      createdAt: row.created_at,
    })),
  });
}

function databaseError(message: string, error: { code?: string; message?: string; details?: string; hint?: string }) {
  console.error("[returns-api] database query failed", { code: error.code, message: error.message, details: error.details, hint: error.hint });
  const detail = process.env.NODE_ENV === "development"
    ? `${message}: ${error.code ?? "DATABASE_ERROR"} ${error.message ?? "Ukendt databasefejl"}`
    : message;
  return NextResponse.json({ ok: false, message: detail, errorCode: error.code ?? "DATABASE_ERROR" }, { status: 500 });
}

function relationName(value: unknown) {
  if (Array.isArray(value)) return relationName(value[0]);
  if (value && typeof value === "object" && "name" in value) return String((value as { name: unknown }).name ?? "");
  return null;
}

function buildSummary(rows: Array<{ totalAmount: number; processingStatus: string; controlStatus: string; returnedAt: string | null }>) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    todayCount: rows.filter((row) => (row.returnedAt ?? "").slice(0, 10) === today).length,
    requiresControl: rows.filter((row) => row.controlStatus === "open").length,
    failed: rows.filter((row) => row.processingStatus === "processing_failed").length,
    totalReturnAmount: rows.reduce((sum, row) => sum + Math.abs(row.totalAmount), 0),
  };
}

function mockSummary() {
  return { todayCount: 0, requiresControl: 0, failed: 0, totalReturnAmount: 0 };
}
