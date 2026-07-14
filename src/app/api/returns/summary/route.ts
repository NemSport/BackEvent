import { NextResponse } from "next/server";
import { requireReturnAccess } from "@/lib/backevent/return-access";
import { ACTIVE_RECEIPT_CONTROL_STATUSES, buildOpenReturnControlSummary } from "@/lib/backevent/return-control-contract";

export async function GET(request: Request) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  if (!auth.supabase) return NextResponse.json({ ok: true, openReturns: 0, openReceiptControls: 0, openTotal: 0 });

  const [returns, receiptControls] = await Promise.all([
    auth.supabase.from("backevent_returns").select("id", { count: "exact", head: true }).eq("control_status", "open"),
    auth.canControl
      ? auth.supabase.from("backevent_onlinepos_receipt_controls").select("id", { count: "exact", head: true }).in("status", [...ACTIVE_RECEIPT_CONTROL_STATUSES])
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (returns.error || receiptControls.error) {
    const error = returns.error ?? receiptControls.error!;
    console.error("[returns-summary-api] database query failed", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    const message = process.env.NODE_ENV === "development"
      ? `Returstatus kunne ikke hentes: ${error.code ?? "DATABASE_ERROR"} ${error.message}`
      : "Returstatus kunne ikke hentes";
    return NextResponse.json({ ok: false, message, errorCode: error.code ?? "DATABASE_ERROR" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...buildOpenReturnControlSummary(returns.count, receiptControls.count) });
}
