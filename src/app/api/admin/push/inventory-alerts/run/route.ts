import { NextResponse } from "next/server";
import { getLatestInventoryAlertRun, runInventoryAlerts } from "@/lib/backevent/inventory-alert-runner";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!auth.supabase) {
    return NextResponse.json({ ok: true, latestAutomaticRun: null });
  }

  const latestAutomaticRun = await getLatestInventoryAlertRun(auth.supabase, "cron").catch(() => null);
  return NextResponse.json({ ok: true, latestAutomaticRun });
}

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!auth.supabase) {
    return NextResponse.json({
      ok: true,
      checkedItems: 0,
      lowCount: 0,
      criticalCount: 0,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      suppressedCount: 0,
      alerts: [],
      runStatus: "success",
      message: "Mock mode: lageralarm simuleret uden afsendelse",
    });
  }

  const result = await runInventoryAlerts(auth.supabase, { runType: "manual" });
  return NextResponse.json(result, { status: result.runStatus === "failed" ? 500 : 200 });
}
