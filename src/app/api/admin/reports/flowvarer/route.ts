import { NextResponse } from "next/server";
import { formatStockQuantity } from "@/lib/backevent/quantity-format";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import type { Product } from "@/lib/backevent/types";
import { buildFlowReport, type FlowReportReturnLine, type FlowReportSyncLine } from "@/lib/onlinepos/flow-report";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "ansvarlig");
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ ok: false, message: "Supabase service role mangler" }, { status: 500 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) return NextResponse.json({ ok: false, message: "Gyldigt fra/til-interval mangler" }, { status: 400 });
  const locationIds = url.searchParams.getAll("location");
  const productIds = url.searchParams.getAll("product");

  const [datedLinesResult, legacyLinesResult, runsResult, locationsResult, productsResult, returnsResult] = await Promise.all([
    supabase.from("onlinepos_inventory_sync_lines")
      .select("external_line_id,transaction_id,receipt_number,transaction_datetime,created_at,onlinepos_product_name,quantity_sold,status,error_reason,mapping_action,location_id,run_id,applied_components")
      .gte("transaction_datetime", from).lte("transaction_datetime", to).limit(20000),
    supabase.from("onlinepos_inventory_sync_lines")
      .select("external_line_id,transaction_id,receipt_number,transaction_datetime,created_at,onlinepos_product_name,quantity_sold,status,error_reason,mapping_action,location_id,run_id,applied_components")
      .is("transaction_datetime", null).gte("created_at", from).lte("created_at", to).limit(20000),
    supabase.from("onlinepos_inventory_sync_runs").select("id,source,duplicate_count,datetime_from,datetime_to").lte("datetime_from", to).gte("datetime_to", from).limit(5000),
    supabase.from("backevent_locations").select("id,name,type,active").order("name"),
    supabase.from("backevent_products").select("id,name,unit,active,units_per_case,purchase_unit_label,units_per_purchase_unit,stock_unit_label,content_per_stock_unit,consumption_unit_label").order("name"),
    supabase.from("backevent_return_lines").select("id,backevent_product_id,return_handling,processing_status,calculated_stock_quantity,waste_registered_quantity,backevent_returns!inner(onlinepos_returned_at,created_at,location_id,source)").limit(20000),
  ]);
  const error = datedLinesResult.error ?? legacyLinesResult.error ?? runsResult.error ?? locationsResult.error ?? productsResult.error ?? returnsResult.error;
  if (error) return NextResponse.json({ ok: false, message: "Flowvarerapporten kunne ikke hentes" }, { status: 500 });

  const runs = new Map((runsResult.data ?? []).map((row) => [String(row.id), row]));
  const products = (productsResult.data ?? []).map(toProduct);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const syncLines: FlowReportSyncLine[] = [...(datedLinesResult.data ?? []), ...(legacyLinesResult.data ?? [])].map((row) => ({
    externalLineId: String(row.external_line_id), transactionId: stringOrNull(row.transaction_id), receiptNumber: stringOrNull(row.receipt_number),
    transactionDatetime: String(row.transaction_datetime ?? row.created_at), onlineposProductName: stringOrNull(row.onlinepos_product_name), quantitySold: Number(row.quantity_sold ?? 0),
    status: row.status, errorReason: stringOrNull(row.error_reason), mappingAction: stringOrNull(row.mapping_action), locationId: stringOrNull(row.location_id),
    source: String(runs.get(String(row.run_id))?.source ?? "live"), components: Array.isArray(row.applied_components) ? row.applied_components : [],
  }));
  const returnLines: FlowReportReturnLine[] = (returnsResult.data ?? []).flatMap((row) => {
    const parent = Array.isArray(row.backevent_returns) ? row.backevent_returns[0] : row.backevent_returns;
    const datetime = String(parent?.onlinepos_returned_at ?? parent?.created_at ?? "");
    if (!datetime || datetime < from || datetime > to || parent?.source === "test_harness") return [];
    const productId = stringOrNull(row.backevent_product_id);
    const product = productId ? productMap.get(productId) : null;
    const divisor = product ? productDivisor(product) : 1;
    return [{ id: String(row.id), productId, locationId: stringOrNull(parent?.location_id), datetime, handling: String(row.return_handling), processingStatus: String(row.processing_status), stockQuantity: Number(row.calculated_stock_quantity ?? 0) * divisor, wasteQuantity: Number(row.waste_registered_quantity ?? 0) * divisor }];
  });
  const report = buildFlowReport({ syncLines, returnLines, duplicateCount: Array.from(runs.values()).reduce((sum, run) => sum + Number(run.duplicate_count ?? 0), 0), locationIds, productIds, from, to });
  const locations = (locationsResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name), type: row.type, active: Boolean(row.active) }));
  const rows = report.rows.map((row) => {
    const product = productMap.get(row.productId);
    const divisor = product ? productDivisor(product) : 1;
    return { ...row, productName: product?.name ?? "Ukendt produkt", humanGross: product ? formatStockQuantity(row.gross / divisor, product) : `${row.gross} ${row.consumptionUnit}`, humanReturned: product ? formatStockQuantity(row.returned / divisor, product) : `${row.returned} ${row.consumptionUnit}`, humanNet: product ? formatStockQuantity(row.net / divisor, product) : `${row.net} ${row.consumptionUnit}`, humanWaste: product ? formatStockQuantity(row.waste / divisor, product) : `${row.waste} ${row.consumptionUnit}`, details: row.details.map((detail) => auth.profileRole === "ejer" ? detail : { ...detail, storedDelta: undefined }) };
  });
  if (url.searchParams.get("format") === "csv") return new Response(toCsv(rows, locations), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="flowvarer-${from.slice(0, 10)}-${to.slice(0, 10)}.csv"` } });
  return NextResponse.json({ ok: true, from, to, canSeeDiagnostics: auth.profileRole === "ejer", summary: report.summary, rows, locations, products: products.map((item) => ({ id: item.id, name: item.name, active: item.active })) });
}

function toProduct(row: Record<string, unknown>): Product { return { id: String(row.id), name: String(row.name), unit: String(row.unit ?? "kasser"), active: Boolean(row.active), lowThreshold: 0, criticalThreshold: 0, unitsPerCase: numberOrNull(row.units_per_case), purchaseUnitLabel: stringOrNull(row.purchase_unit_label), unitsPerPurchaseUnit: numberOrNull(row.units_per_purchase_unit), stockUnitLabel: stringOrNull(row.stock_unit_label), contentPerStockUnit: numberOrNull(row.content_per_stock_unit), consumptionUnitLabel: stringOrNull(row.consumption_unit_label) }; }
function productDivisor(product: Product) { return Number(product.unitsPerPurchaseUnit ?? product.unitsPerCase ?? 1) * Number(product.contentPerStockUnit ?? 1); }
function stringOrNull(value: unknown) { return value === null || value === undefined || String(value).trim() === "" ? null : String(value); }
function numberOrNull(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : null; }
type CsvRow = { productName: string; consumptionUnit: string; gross: number; returned: number; net: number; waste: number; lineCount: number; latestAt: string; byLocation: Record<string, number> };
function toCsv(rows: CsvRow[], locations: Array<{ id: string; name: string }>) { const header = ["Produkt","Forbrugsenhed","Brutto","Retur","Netto","Svind","Linjer","Seneste",...locations.map((item) => item.name)]; const data = rows.map((row) => [row.productName,row.consumptionUnit,row.gross,row.returned,row.net,row.waste,row.lineCount,row.latestAt,...locations.map((item) => row.byLocation[item.id] ?? 0)]); return "\uFEFF" + [header,...data].map((line) => line.map(csvCell).join(";")).join("\r\n"); }
function csvCell(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
