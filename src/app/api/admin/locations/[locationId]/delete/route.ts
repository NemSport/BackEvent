import { NextResponse } from "next/server";
import { planAdminObjectDelete } from "@/lib/backevent/delete-safety";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request, { params }: { params: Promise<{ locationId: string }> }) {
  const gate = await requireOwner(request);
  if (!gate.ok) return gate.response;
  const { locationId } = await params;
  return NextResponse.json(await buildLocationDeletePreview(gate.supabase, locationId));
}

export async function POST(request: Request, { params }: { params: Promise<{ locationId: string }> }) {
  const gate = await requireOwner(request);
  if (!gate.ok) return gate.response;
  const { locationId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action === "deactivate" ? "deactivate" : "delete";
  const preview = await buildLocationDeletePreview(gate.supabase, locationId);

  if (!preview.ok) return NextResponse.json(preview, { status: 404 });
  if (preview.plan.action === "blocked") {
    return NextResponse.json({ ...preview, ok: false, message: preview.plan.reason }, { status: 409 });
  }

  if (action === "delete") {
    if (preview.plan.action !== "delete") {
      return NextResponse.json({
        ...preview,
        ok: false,
        message: "Stedet har historik eller relationer og kan ikke slettes permanent.",
      }, { status: 409 });
    }

    await gate.supabase.from("backevent_stock_balances").delete().eq("location_id", locationId).eq("quantity", 0);
    await gate.supabase.from("backevent_inventory_alert_settings").delete().eq("location_id", locationId);
    await gate.supabase.from("backevent_location_product_thresholds").delete().eq("location_id", locationId);
    const { error } = await gate.supabase.from("backevent_locations").delete().eq("id", locationId);
    if (error) return NextResponse.json({ ok: false, message: "Stedet kunne ikke slettes." }, { status: 500 });
    return NextResponse.json({ ok: true, action: "deleted", message: "Sted slettet permanent." });
  }

  const { error } = await gate.supabase.from("backevent_locations").update({ active: false }).eq("id", locationId);
  if (error) return NextResponse.json({ ok: false, message: "Stedet kunne ikke deaktiveres." }, { status: 500 });
  return NextResponse.json({ ok: true, action: "deactivated", message: "Sted deaktiveret." });
}

async function requireOwner(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return { ok: false as const, response: NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status }) };
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return { ok: false as const, response: NextResponse.json({ ok: false, message: "Supabase service role mangler" }, { status: 500 }) };
  }

  return { ok: true as const, supabase };
}

async function buildLocationDeletePreview(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, locationId: string) {
  const { data: location, error } = await supabase.from("backevent_locations").select("id,name,active").eq("id", locationId).maybeSingle();
  if (error || !location) return { ok: false as const, message: "Sted ikke fundet" };

  const stockRows = await selectRows<{ quantity: number | string | null }>(supabase, "backevent_stock_balances", "quantity", "location_id", locationId);
  const activeStockQuantity = stockRows.reduce((sum, row) => sum + Math.abs(Number(row.quantity ?? 0)), 0);
  const [fromMovementCount, toMovementCount, adjustmentCount, statusCount, returnLocationCount, returnSourceCount, qrFromCount, qrToCount, syncLocationCount, syncSourceCount, sourceRelationCount, onlineposLocationMappingCount] = await Promise.all([
    countRows(supabase, "backevent_stock_movements", "from_location_id", locationId),
    countRows(supabase, "backevent_stock_movements", "to_location_id", locationId),
    countRows(supabase, "backevent_stock_adjustments", "location_id", locationId),
    countRows(supabase, "backevent_opening_closing_statuses", "location_id", locationId),
    countRows(supabase, "backevent_returns", "location_id", locationId),
    countRows(supabase, "backevent_returns", "source_location_id", locationId),
    countRows(supabase, "backevent_qr_move_batches", "from_location_id", locationId),
    countRows(supabase, "backevent_qr_move_batches", "to_location_id", locationId),
    countRows(supabase, "onlinepos_inventory_sync_lines", "location_id", locationId),
    countRows(supabase, "onlinepos_inventory_sync_lines", "source_location_id", locationId),
    countRows(supabase, "backevent_locations", "source_location_id", locationId),
    countRows(supabase, "backevent_onlinepos_location_mappings", "backevent_location_id", locationId),
  ]);

  const historyCount = fromMovementCount + toMovementCount + adjustmentCount + statusCount + returnLocationCount + returnSourceCount + qrFromCount + qrToCount + syncLocationCount + syncSourceCount;
  const relationCount = sourceRelationCount + onlineposLocationMappingCount;
  const plan = planAdminObjectDelete({ activeStockQuantity, historyCount, relationCount });

  return {
    ok: true as const,
    location: { id: String(location.id), name: String(location.name), active: location.active !== false },
    plan,
    summary: {
      activeStockQuantity,
      historyCount,
      relationCount,
      fromMovementCount,
      toMovementCount,
      adjustmentCount,
      statusCount,
      returnLocationCount,
      returnSourceCount,
      qrFromCount,
      qrToCount,
      syncLocationCount,
      syncSourceCount,
      sourceRelationCount,
      onlineposLocationMappingCount,
    },
  };
}

async function countRows(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, table: string, column: string, value: string) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (error) return 0;
  return count ?? 0;
}

async function selectRows<T>(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, table: string, columns: string, column: string, value: string) {
  const { data, error } = await supabase.from(table).select(columns).eq(column, value);
  if (error) return [] as T[];
  return (data ?? []) as T[];
}
