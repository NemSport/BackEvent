import { NextResponse } from "next/server";
import { formatPlainQuantity, formatStockQuantity } from "@/lib/backevent/quantity-format";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import type { Product } from "@/lib/backevent/types";
import { runOnlinePosInventorySync } from "@/lib/onlinepos/inventory-sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

type SyncBody = {
  datetimeFrom?: unknown;
  datetimeTo?: unknown;
};

type SyncRunRow = {
  id: string;
  source: string;
  datetime_from: string;
  datetime_to: string;
  status: string;
  fetched_count: number;
  processed_count: number;
  ignored_count: number;
  failed_count: number;
  missing_mapping_count: number;
  duplicate_count: number;
  error_message: string | null;
  created_by_email: string | null;
  started_at: string;
  finished_at: string | null;
};

type SyncLineRow = {
  id: string;
  run_id: string;
  external_line_id: string;
  onlinepos_product_name: string | null;
  onlinepos_product_group_name: string | null;
  cash_register_name: string | null;
  line_type: string;
  mapping_status: string | null;
  mapping_action: string | null;
  status: string;
  error_reason: string | null;
  quantity_sold: number;
  stock_delta: number;
  applied_components: Array<{ productId?: string; quantity?: number }> | null;
  revenue: number;
  created_at: string;
};

type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  units_per_case: number | null;
  purchase_unit_label: string | null;
  units_per_purchase_unit: number | string | null;
  stock_unit_label: string | null;
  content_per_stock_unit: number | string | null;
  consumption_unit_label: string | null;
};

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({
      ok: true,
      mode: "mock",
      latestRun: null,
      recentRuns: [],
      recentLines: [],
      message: "Mock mode: Supabase er ikke konfigureret",
    });
  }

  const { data: runs, error: runsError } = await supabase
    .from("onlinepos_inventory_sync_runs")
    .select("id,source,datetime_from,datetime_to,status,fetched_count,processed_count,ignored_count,failed_count,missing_mapping_count,duplicate_count,error_message,created_by_email,started_at,finished_at")
    .order("started_at", { ascending: false })
    .limit(10);

  if (runsError) {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente OnlinePOS-sync status" }, { status: 500 });
  }

  const latestRun = ((runs ?? []) as SyncRunRow[])[0] ?? null;
  const { data: lines, error: linesError } = latestRun
    ? await supabase
        .from("onlinepos_inventory_sync_lines")
        .select("id,run_id,external_line_id,onlinepos_product_name,onlinepos_product_group_name,cash_register_name,line_type,mapping_status,mapping_action,status,error_reason,quantity_sold,stock_delta,applied_components,revenue,created_at")
        .eq("run_id", latestRun.id)
        .order("created_at", { ascending: false })
        .limit(25)
    : { data: [], error: null };
  const { data: productRows, error: productsError } = latestRun
    ? await supabase
        .from("backevent_products")
        .select("id,name,unit,units_per_case,purchase_unit_label,units_per_purchase_unit,stock_unit_label,content_per_stock_unit,consumption_unit_label")
    : { data: [], error: null };

  if (linesError || productsError) {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente OnlinePOS-sync linjer" }, { status: 500 });
  }
  const products = ((productRows ?? []) as ProductRow[]).map(toProduct);

  return NextResponse.json({
    ok: true,
    mode: "supabase",
    latestRun: latestRun ? toRun(latestRun) : null,
    recentRuns: ((runs ?? []) as SyncRunRow[]).map(toRun),
    recentLines: ((lines ?? []) as SyncLineRow[]).map((line) => toLine(line, products)),
  });
}

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const validation = validateBody((await request.json().catch(() => null)) as SyncBody | null);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, message: validation.message }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      ok: true,
      mode: "mock",
      status: "completed",
      fetchedCount: 0,
      processedCount: 0,
      ignoredCount: 0,
      failedCount: 0,
      missingMappingCount: 0,
      duplicateCount: 0,
      message: "Mock mode: OnlinePOS-sync er simuleret",
    });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, message: "Serveren mangler Supabase service role" }, { status: 500 });
  }

  const result = await runOnlinePosInventorySync({
    supabase,
    datetimeFrom: validation.datetimeFrom,
    datetimeTo: validation.datetimeTo,
    actorUserId: auth.userId,
    actorEmail: auth.userEmail,
    source: "manual",
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

function validateBody(body: SyncBody | null):
  | { ok: false; message: string }
  | { ok: true; datetimeFrom: string; datetimeTo: string } {
  const datetimeFrom = typeof body?.datetimeFrom === "string" ? body.datetimeFrom : "";
  const datetimeTo = typeof body?.datetimeTo === "string" ? body.datetimeTo : "";

  if (!datetimeFrom || !datetimeTo) {
    return { ok: false, message: "Vælg periode" };
  }

  const from = new Date(datetimeFrom);
  const to = new Date(datetimeTo);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, message: "Perioden er ugyldig" };
  }

  if (from >= to) {
    return { ok: false, message: "Fra skal være før til" };
  }

  const maxHours = 24 * 7;
  if (to.getTime() - from.getTime() > maxHours * 60 * 60 * 1000) {
    return { ok: false, message: "Vælg højst 7 dage ad gangen" };
  }

  return { ok: true, datetimeFrom: from.toISOString(), datetimeTo: to.toISOString() };
}

function toRun(row: SyncRunRow) {
  return {
    id: row.id,
    source: row.source,
    datetimeFrom: row.datetime_from,
    datetimeTo: row.datetime_to,
    status: row.status,
    fetchedCount: row.fetched_count,
    processedCount: row.processed_count,
    ignoredCount: row.ignored_count,
    failedCount: row.failed_count,
    missingMappingCount: row.missing_mapping_count,
    duplicateCount: row.duplicate_count,
    errorMessage: row.error_message,
    createdByEmail: row.created_by_email,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toLine(row: SyncLineRow, products: Product[]) {
  const components = Array.isArray(row.applied_components) ? row.applied_components : [];
  const stockDeltaText = components.length > 0
    ? components
        .map((component) => {
          const product = products.find((item) => item.id === component.productId);
          const quantity = Number(component.quantity ?? 0);
          return product ? `${product.name}: ${formatStockQuantity(quantity, product)}` : formatPlainQuantity(quantity);
        })
        .join(" · ")
    : formatPlainQuantity(Number(row.stock_delta ?? 0));

  return {
    id: row.id,
    runId: row.run_id,
    externalLineId: row.external_line_id,
    productName: row.onlinepos_product_name,
    productGroupName: row.onlinepos_product_group_name,
    cashRegisterName: row.cash_register_name,
    lineType: row.line_type,
    mappingStatus: row.mapping_status,
    mappingAction: row.mapping_action,
    status: row.status,
    errorReason: row.error_reason,
    quantitySold: Number(row.quantity_sold ?? 0),
    stockDelta: Number(row.stock_delta ?? 0),
    stockDeltaText,
    revenue: Number(row.revenue ?? 0),
    createdAt: row.created_at,
  };
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit ?? "kasser",
    lowThreshold: 0,
    criticalThreshold: 0,
    unitsPerCase: row.units_per_case,
    purchaseUnitLabel: row.purchase_unit_label,
    unitsPerPurchaseUnit: row.units_per_purchase_unit === null ? null : Number(row.units_per_purchase_unit),
    stockUnitLabel: row.stock_unit_label,
    contentPerStockUnit: row.content_per_stock_unit === null ? null : Number(row.content_per_stock_unit),
    consumptionUnitLabel: row.consumption_unit_label,
  };
}
