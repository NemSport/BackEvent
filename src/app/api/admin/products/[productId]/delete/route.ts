import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { planAdminObjectDelete } from "@/lib/backevent/delete-safety";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const gate = await requireOwner(request);
  if (!gate.ok) return gate.response;
  const { productId } = await params;
  return NextResponse.json(await buildProductDeletePreview(gate.supabase, productId));
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const gate = await requireOwner(request);
  if (!gate.ok) return gate.response;
  const { productId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action === "deactivate" ? "deactivate" : "delete";
  const preview = await buildProductDeletePreview(gate.supabase, productId);

  if (!preview.ok) return NextResponse.json(preview, { status: 404 });
  if (preview.plan.action === "blocked") {
    return NextResponse.json({ ...preview, ok: false, message: preview.plan.reason }, { status: 409 });
  }

  if (action === "delete") {
    if (preview.plan.action !== "delete") {
      return NextResponse.json({
        ...preview,
        ok: false,
        message: "Produktet har historik eller relationer og kan ikke slettes permanent.",
      }, { status: 409 });
    }

    await gate.supabase.from("backevent_stock_balances").delete().eq("product_id", productId).eq("quantity", 0);
    await gate.supabase.from("backevent_inventory_alert_settings").delete().eq("inventory_item_id", productId);
    await gate.supabase.from("backevent_location_product_thresholds").delete().eq("product_id", productId);
    const { error } = await gate.supabase.from("backevent_products").delete().eq("id", productId);
    if (error) return NextResponse.json({ ok: false, message: "Produktet kunne ikke slettes." }, { status: 500 });
    return NextResponse.json({ ok: true, action: "deleted", message: "Produkt slettet permanent." });
  }

  const { error } = await gate.supabase.from("backevent_products").update({ active: false }).eq("id", productId);
  if (error) return NextResponse.json({ ok: false, message: "Produktet kunne ikke deaktiveres." }, { status: 500 });
  return NextResponse.json({ ok: true, action: "deactivated", message: "Produkt deaktiveret." });
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

async function buildProductDeletePreview(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, productId: string) {
  const { data: product, error } = await supabase.from("backevent_products").select("id,name,active").eq("id", productId).maybeSingle();
  if (error || !product) return { ok: false as const, message: "Produkt ikke fundet" };

  const stockRows = await selectRows<{ quantity: number | string | null }>(supabase, "backevent_stock_balances", "quantity", "product_id", productId);
  const activeStockQuantity = stockRows.reduce((sum, row) => sum + Math.abs(Number(row.quantity ?? 0)), 0);
  const [movementCount, adjustmentCount, openingLineCount, returnLineCount, mappingCount, componentCount, syncComponentCount] = await Promise.all([
    countRows(supabase, "backevent_stock_movements", "product_id", productId),
    countRows(supabase, "backevent_stock_adjustments", "product_id", productId),
    countRows(supabase, "backevent_opening_closing_lines", "product_id", productId),
    countRows(supabase, "backevent_return_lines", "backevent_product_id", productId),
    countRows(supabase, "onlinepos_inventory_mappings", "backevent_inventory_item_id", productId),
    countRows(supabase, "onlinepos_inventory_mapping_components", "backevent_inventory_item_id", productId),
    countJsonbComponentRows(supabase, productId),
  ]);

  const historyCount = movementCount + adjustmentCount + openingLineCount + returnLineCount + syncComponentCount;
  const relationCount = mappingCount + componentCount;
  const plan = planAdminObjectDelete({ activeStockQuantity, historyCount, relationCount });

  return {
    ok: true as const,
    product: { id: String(product.id), name: String(product.name), active: product.active !== false },
    plan,
    summary: {
      activeStockQuantity,
      historyCount,
      relationCount,
      movementCount,
      adjustmentCount,
      openingLineCount,
      returnLineCount,
      mappingCount,
      componentCount,
      syncComponentCount,
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

async function countJsonbComponentRows(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, productId: string) {
  const { data, error } = await supabase.from("onlinepos_inventory_sync_lines").select("id,applied_components").limit(5000);
  if (error) return 0;
  return (data ?? []).filter((row) => JSON.stringify(row.applied_components ?? "").includes(productId)).length;
}
