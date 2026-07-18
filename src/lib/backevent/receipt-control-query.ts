import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_RECEIPT_CONTROL_STATUSES } from "./return-control-contract.ts";

export const RECEIPT_CONTROL_SELECT = "id,receipt_number,onlinepos_transaction_id,classification,control_types,deposit_return_quantity,deposit_breakdown,purchase_value,deposit_return_value,final_total,amounts_include_vat,source,replay_run_id,status,handled_by,handled_at,handled_by_name,internal_note,created_at,updated_at,transaction_datetime,location_id,location_name,cash_register_id,cash_register_name,location_mapping_status";

export type ReceiptControlFilters = {
  status: string;
  location: string;
  reason: string;
  dateFrom: string;
  dateTo: string;
  source: string;
  handler: string;
  search: string;
  sort: string;
  quick: string;
};

export type ReceiptControlListOptions = {
  page?: number;
  pageSize?: number;
  all?: boolean;
  selectedIds?: string[];
  currentUserId?: string | null;
};

export function parseReceiptControlFilters(searchParams: URLSearchParams): ReceiptControlFilters {
  return {
    status: clean(searchParams.get("status")) ?? "open",
    location: clean(searchParams.get("location")) ?? "all",
    reason: clean(searchParams.get("reason")) ?? "all",
    dateFrom: dateValue(searchParams.get("from")),
    dateTo: dateValue(searchParams.get("to")),
    source: clean(searchParams.get("source")) ?? "all",
    handler: clean(searchParams.get("handler")) ?? "all",
    search: clean(searchParams.get("search")) ?? "",
    sort: clean(searchParams.get("sort")) ?? "oldest",
    quick: clean(searchParams.get("quick")) ?? "",
  };
}

export async function fetchReceiptControls(
  supabase: SupabaseClient,
  filters: ReceiptControlFilters,
  options: ReceiptControlListOptions = {},
) {
  const pageSize = options.all ? 1000 : clamp(options.pageSize ?? 25, 25, 100);
  const page = Math.max(1, options.page ?? 1);
  let query = supabase
    .from("backevent_onlinepos_receipt_controls")
    .select(RECEIPT_CONTROL_SELECT, { count: "exact" });

  const effectiveStatus = filters.quick === "all-open" || filters.quick === "mine-open"
    ? "active"
    : filters.quick === "follow-up"
      ? "follow_up"
      : filters.quick === "processed-today"
        ? "all"
      : filters.status;
  if (effectiveStatus === "active") query = query.in("status", [...ACTIVE_RECEIPT_CONTROL_STATUSES]);
  else if (effectiveStatus !== "all") query = query.eq("status", effectiveStatus);

  if (filters.quick === "mine-open" && options.currentUserId) query = query.eq("handled_by", options.currentUserId);
  if (filters.quick === "processed-today") {
    const today = new Date().toISOString().slice(0, 10);
    query = query.gte("handled_at", `${today}T00:00:00.000Z`);
  }

  const locationFilter = filters.quick === "unmapped" ? "unmapped" : filters.location;
  if (locationFilter === "unmapped") {
    query = query.is("location_id", null).or("cash_register_name.not.is.null,cash_register_id.not.is.null");
  } else if (locationFilter === "unknown") {
    query = query.is("location_id", null).is("cash_register_name", null).is("cash_register_id", null);
  } else if (locationFilter !== "all") {
    query = query.eq("location_id", locationFilter);
  }

  if (filters.reason !== "all") query = query.contains("control_types", [filters.reason]);
  if (filters.dateFrom) query = query.gte("effective_datetime", `${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) query = query.lte("effective_datetime", `${filters.dateTo}T23:59:59.999Z`);
  if (filters.source !== "all") query = query.eq("source", filters.source);
  if (filters.handler !== "all") query = query.eq("handled_by", filters.handler);
  if (filters.search) {
    const safeSearch = filters.search.replace(/[%(),]/g, " ").trim();
    if (safeSearch) {
      query = query.or([
        `receipt_number.ilike.%${safeSearch}%`,
        `onlinepos_transaction_id.ilike.%${safeSearch}%`,
        `cash_register_name.ilike.%${safeSearch}%`,
        `location_name.ilike.%${safeSearch}%`,
        `internal_note.ilike.%${safeSearch}%`,
      ].join(","));
    }
  }
  if (options.selectedIds?.length) query = query.in("id", options.selectedIds);

  const sort = receiptControlSort(filters.sort);
  query = query.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
  if (sort.secondary) query = query.order(sort.secondary, { ascending: sort.ascending });
  if (sort.column !== "id") query = query.order("id", { ascending: true });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const result = await query.range(from, to);
  return {
    ...result,
    page,
    pageSize,
    total: result.count ?? 0,
  };
}

export function receiptControlSort(value: string) {
  const values: Record<string, { column: string; ascending: boolean; secondary?: string }> = {
    newest: { column: "created_at", ascending: false },
    oldest: { column: "created_at", ascending: true },
    receipt_asc: { column: "receipt_number", ascending: true, secondary: "created_at" },
    receipt_desc: { column: "receipt_number", ascending: false, secondary: "created_at" },
    negative_total: { column: "final_total", ascending: true, secondary: "created_at" },
    deposit_value: { column: "deposit_return_value", ascending: false, secondary: "created_at" },
    location: { column: "location_name", ascending: true, secondary: "created_at" },
    handled: { column: "handled_at", ascending: false, secondary: "created_at" },
  };
  return values[value] ?? values.oldest;
}

export function mapReceiptControlRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    receiptNumber: stringOrNull(row.receipt_number),
    transactionId: stringOrNull(row.onlinepos_transaction_id),
    classification: stringOrNull(row.classification),
    controlTypes: Array.isArray(row.control_types) ? row.control_types.map(String) : [],
    depositReturnQuantity: Number(row.deposit_return_quantity ?? 0),
    depositBreakdown: row.deposit_breakdown ?? {},
    purchaseValue: Number(row.purchase_value ?? 0),
    depositReturnValue: Number(row.deposit_return_value ?? 0),
    finalTotal: Number(row.final_total ?? 0),
    amountsIncludeVat: row.amounts_include_vat === true,
    source: String(row.source ?? "live"),
    status: String(row.status ?? "open"),
    handledBy: stringOrNull(row.handled_by),
    handledAt: stringOrNull(row.handled_at),
    handledByName: stringOrNull(row.handled_by_name),
    internalNote: stringOrNull(row.internal_note),
    updatedAt: stringOrNull(row.updated_at),
    replayRunId: stringOrNull(row.replay_run_id),
    createdAt: String(row.created_at),
    transactionDatetime: stringOrNull(row.transaction_datetime),
    locationId: stringOrNull(row.location_id),
    locationName: stringOrNull(row.location_name),
    cashRegisterId: stringOrNull(row.cash_register_id),
    cashRegisterName: stringOrNull(row.cash_register_name),
    locationMappingStatus: row.location_id ? "mapped" : "unmapped",
  };
}

function clean(value: string | null) {
  return value?.trim() || null;
}

function dateValue(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : value === null || value === undefined ? null : String(value);
}
