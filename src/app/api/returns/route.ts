import { NextResponse } from "next/server";
import { requireReturnAccess } from "@/lib/backevent/return-access";

export async function GET(request: Request) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });

  if (!auth.supabase) return NextResponse.json({ ok: true, summary: mockSummary(), returns: [] });

  const url = new URL(request.url);
  const control = url.searchParams.get("control");
  const date = url.searchParams.get("date");
  const locationId = url.searchParams.get("locationId");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");
  let query = auth.supabase
    .from("backevent_returns")
    .select("id,receipt_number,onlinepos_returned_at,created_at,total_amount,processing_status,control_status,control_reasons,suspicion_flags,onlinepos_location_ref,location_id,backevent_locations(name)")
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
  if (error) return NextResponse.json({ ok: false, message: "Returer kunne ikke hentes" }, { status: 500 });

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
  });
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
