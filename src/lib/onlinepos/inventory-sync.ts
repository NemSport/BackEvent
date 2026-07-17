import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnlinePosInventoryMapping, OnlinePosInventoryMappingComponent, OnlinePosLineType, OnlinePosMappingAction } from "./inventory-mappings.ts";
import {
  createOnlinePosLocationResolver,
  getOnlinePosLocationMappings,
  type OnlinePosLocationDiagnostics,
  type OnlinePosLocationMapping,
} from "./location-mappings.ts";
import {
  calculateOnlinePosInventoryConsumption,
  type OnlinePosConsumptionDiagnostics,
} from "./inventory-unit-conversion.ts";
import { getOnlinePosGrossAmount, getOnlinePosGrossTotal } from "./pricing.ts";

export type OnlinePosSyncLineStatus = "processed" | "ignored" | "failed";

export type OnlinePosTransactionLine = {
  transactionId: string | null;
  receiptNumber: string | null;
  transactionDatetime: string | null;
  transactionType: string | null;
  transactionStatus: string | null;
  returnId: string | null;
  refundId: string | null;
  transactionTotal: number | null;
  lineId: string | null;
  parentLineId: string | null;
  lineIndex: number;
  onlineposProductId: string | null;
  onlineposProductName: string | null;
  onlineposProductGroupId: string | null;
  onlineposProductGroupName: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string | null;
  quantitySold: number;
  revenue: number;
  lineType: OnlinePosLineType;
  inventoryRelevant: boolean;
  needsMapping: boolean;
};

export type OnlinePosSyncDecision = {
  externalLineId: string;
  transactionId: string | null;
  transactionDatetime: string | null;
  receiptNumber: string | null;
  lineId: string | null;
  onlineposProductId: string | null;
  onlineposProductName: string | null;
  onlineposProductGroupName: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string | null;
  lineType: OnlinePosLineType;
  mappingId: string | null;
  mappingStatus: "unmapped" | "approved";
  mappingAction: OnlinePosMappingAction;
  status: OnlinePosSyncLineStatus;
  errorReason: string | null;
  locationDiagnostics?: OnlinePosLocationDiagnostics | null;
  locationId: string | null;
  sourceLocationId: string | null;
  quantitySold: number;
  stockDelta: number;
  revenue: number;
  components: Array<{
    productId: string;
    locationId: string;
    quantity: number;
    consumptionDiagnostics: OnlinePosConsumptionDiagnostics;
  }>;
};

export type OnlinePosSyncSummary = {
  fetchedCount: number;
  processedCount: number;
  ignoredCount: number;
  failedCount: number;
  missingMappingCount: number;
  duplicateCount: number;
};

type TokenResponse = {
  access_token?: string;
};

type SafePagination = {
  total: string | number | null;
  per_page: string | number | null;
  current_page: string | number | null;
  last_page: string | number | null;
  fetched_pages?: number;
};

type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  active: boolean | null;
  unitsPerCase?: number | null;
  purchaseUnitLabel?: string | null;
  unitsPerPurchaseUnit?: number | null;
  stockUnitLabel?: string | null;
  contentPerStockUnit?: number | null;
  consumptionUnitLabel?: string | null;
};

type LocationRow = {
  id: string;
  name: string;
  type: string | null;
  source_location_id: string | null;
  active: boolean | null;
};

const restBaseUrl = "https://rest.onlinepos.dk";
const tokenUrl = `${restBaseUrl}/auth/token`;
const transactionsUrl = `${restBaseUrl}/transactions`;
const timeoutMs = 15000;

export async function runOnlinePosInventorySync({
  supabase,
  datetimeFrom,
  datetimeTo,
  actorUserId,
  actorEmail,
  source = "manual",
}: {
  supabase: SupabaseClient;
  datetimeFrom: string;
  datetimeTo: string;
  actorUserId: string | null;
  actorEmail: string | null;
  source?: string;
}) {
  const run = await createRun(supabase, { datetimeFrom, datetimeTo, actorUserId, actorEmail, source });

  try {
    const fetched = await fetchOnlinePosTransactionLines({ datetimeFrom, datetimeTo });
    const [mappings, products, locations, locationMappings] = await Promise.all([
      getInventoryMappings(supabase),
      getProducts(supabase),
      getLocations(supabase),
      getOnlinePosLocationMappings(supabase),
    ]);
    const decisions = buildSyncDecisions(fetched.lines, mappings, products, locations, locationMappings);
    const applyResult = await applySyncLines(supabase, run.id, decisions);
    const missingMappingCount = decisions.filter((line) => line.errorReason === "Mangler godkendt mapping").length;
    const failedCount = applyResult.failedCount;
    const status = failedCount > 0 ? "partial" : "completed";

    await updateRun(supabase, run.id, {
      status,
      fetchedCount: fetched.lines.length,
      processedCount: applyResult.processedCount,
      ignoredCount: applyResult.ignoredCount + applyResult.duplicateCount,
      failedCount,
      missingMappingCount,
      duplicateCount: applyResult.duplicateCount,
      errorMessage: failedCount > 0 ? "Nogle OnlinePOS-linjer fejlede" : null,
    });

    return {
      ok: true,
      runId: run.id,
      status,
      datetimeFrom,
      datetimeTo,
      pagination: fetched.pagination,
      hasMorePages: hasMorePages(fetched.pagination),
      fetchedCount: fetched.lines.length,
      processedCount: applyResult.processedCount,
      ignoredCount: applyResult.ignoredCount + applyResult.duplicateCount,
      failedCount,
      missingMappingCount,
      duplicateCount: applyResult.duplicateCount,
      lines: decisions,
    };
  } catch (error) {
    await updateRun(supabase, run.id, {
      status: "failed",
      fetchedCount: 0,
      processedCount: 0,
      ignoredCount: 0,
      failedCount: 0,
      missingMappingCount: 0,
      duplicateCount: 0,
      errorMessage: safeErrorMessage(error),
    }).catch(() => undefined);

    return {
      ok: false,
      runId: run.id,
      status: "failed",
      datetimeFrom,
      datetimeTo,
      message: safeErrorMessage(error),
      fetchedCount: 0,
      processedCount: 0,
      ignoredCount: 0,
      failedCount: 0,
      missingMappingCount: 0,
      duplicateCount: 0,
      lines: [] as OnlinePosSyncDecision[],
    };
  }
}

export async function applyOnlinePosSyncDecisions({
  supabase,
  datetimeFrom,
  datetimeTo,
  actorUserId,
  actorEmail,
  source = "historical_replay",
  decisions,
}: {
  supabase: SupabaseClient;
  datetimeFrom: string;
  datetimeTo: string;
  actorUserId: string | null;
  actorEmail: string | null;
  source?: string;
  decisions: OnlinePosSyncDecision[];
}) {
  const run = await createRun(supabase, { datetimeFrom, datetimeTo, actorUserId, actorEmail, source });

  try {
    const applyResult = await applySyncLines(supabase, run.id, decisions);
    const failedCount = applyResult.failedCount;
    const status = failedCount > 0 ? "partial" : "completed";

    await updateRun(supabase, run.id, {
      status,
      fetchedCount: decisions.length,
      processedCount: applyResult.processedCount,
      ignoredCount: applyResult.ignoredCount + applyResult.duplicateCount,
      failedCount,
      missingMappingCount: applyResult.missingMappingCount,
      duplicateCount: applyResult.duplicateCount,
      errorMessage: failedCount > 0 ? "Nogle historical replay-linjer fejlede" : null,
    });

    return {
      ok: true,
      runId: run.id,
      status,
      datetimeFrom,
      datetimeTo,
      fetchedCount: decisions.length,
      processedCount: applyResult.processedCount,
      ignoredCount: applyResult.ignoredCount + applyResult.duplicateCount,
      failedCount,
      missingMappingCount: applyResult.missingMappingCount,
      duplicateCount: applyResult.duplicateCount,
    };
  } catch (error) {
    await updateRun(supabase, run.id, {
      status: "failed",
      fetchedCount: decisions.length,
      processedCount: 0,
      ignoredCount: 0,
      failedCount: decisions.length,
      missingMappingCount: decisions.filter((decision) => decision.errorReason === "Mangler godkendt mapping").length,
      duplicateCount: 0,
      errorMessage: safeErrorMessage(error),
    }).catch(() => undefined);

    return {
      ok: false,
      runId: run.id,
      status: "failed",
      datetimeFrom,
      datetimeTo,
      message: safeErrorMessage(error),
      fetchedCount: decisions.length,
      processedCount: 0,
      ignoredCount: 0,
      failedCount: decisions.length,
      missingMappingCount: decisions.filter((decision) => decision.errorReason === "Mangler godkendt mapping").length,
      duplicateCount: 0,
    };
  }
}

export function buildSyncDecisions(
  lines: OnlinePosTransactionLine[],
  mappings: OnlinePosInventoryMapping[],
  products: ProductRow[],
  locations: LocationRow[],
  locationMappings: OnlinePosLocationMapping[] = [],
): OnlinePosSyncDecision[] {
  const venueId = process.env.ONLINEPOS_VENUE_ID ?? null;
  const locationInputs = lines.map((line) => ({
    venueId,
    cashRegisterId: line.cashRegisterId,
    cashRegisterName: line.cashRegisterName,
  }));
  const locationResolver = createOnlinePosLocationResolver(locationInputs, locationMappings, locations);

  return lines.map((line) => {
    const mapping = findMapping(line, mappings);
    const mappingAction = mapping?.mappingAction ?? defaultMappingAction(line);
    const mappingStatus = mapping?.status ?? "unmapped";
    const locationResolution = locationResolver.resolve({
      venueId,
      cashRegisterId: line.cashRegisterId,
      cashRegisterName: line.cashRegisterName,
    });
    const location = locationResolution.ok ? locationResolution.location : null;
    const sourceLocationId = location?.source_location_id ?? null;
    const base = {
      externalLineId: buildExternalLineId(line),
      transactionId: line.transactionId,
      transactionDatetime: line.transactionDatetime,
      receiptNumber: line.receiptNumber,
      lineId: line.lineId,
      onlineposProductId: line.onlineposProductId,
      onlineposProductName: line.onlineposProductName,
      onlineposProductGroupName: line.onlineposProductGroupName,
      cashRegisterId: line.cashRegisterId,
      cashRegisterName: line.cashRegisterName,
      lineType: line.lineType,
      mappingId: mapping?.id ?? null,
      mappingStatus,
      mappingAction,
      locationDiagnostics: locationResolution.diagnostics,
      locationId: location?.id ?? null,
      sourceLocationId,
      quantitySold: line.quantitySold,
      revenue: line.revenue,
    };

    if (line.lineType === "deposit_fee" || line.lineType === "deposit_return") {
      return ignoredDecision(base, "Pant/gebyr behandles ikke som vareforbrug");
    }

    if (mappingAction !== "consume_stock") {
      return ignoredDecision(base, `Mapping handling: ${mappingAction}`);
    }

    if (mappingStatus !== "approved" || !mapping) {
      return ignoredDecision(base, "Mangler godkendt mapping");
    }

    if (!locationResolution.ok) {
      return failedDecision(base, locationResolution.errorReason);
    }

    if (!sourceLocationId) {
      return failedDecision(base, "Bar mangler lagerkilde");
    }

    const components = normalizeComponents(mapping.components, mapping).map((component) => {
      const product = products.find((item) => item.id === component.backeventInventoryItemId);
      const conversion = product && Number(component.conversionFactor) > 0
        ? calculateOnlinePosInventoryConsumption({
          soldQuantity: line.quantitySold,
          consumptionPerSale: Number(component.conversionFactor),
          product,
        })
        : null;
      return {
        productId: component.backeventInventoryItemId ?? "",
        locationId: sourceLocationId,
        quantity: conversion?.storedQuantity ?? 0,
        consumptionDiagnostics: conversion?.diagnostics ?? null,
        valid: Boolean(product && component.backeventInventoryItemId && conversion),
      };
    });

    if (components.length === 0 || components.some((component) => !component.valid)) {
      return failedDecision(base, "Mapping mangler gyldige lagerkomponenter");
    }

    const validComponents = components.map(({ productId, locationId, quantity, consumptionDiagnostics }) => ({
      productId,
      locationId,
      quantity,
      consumptionDiagnostics: consumptionDiagnostics!,
    }));

    return {
      ...base,
      status: "processed",
      errorReason: null,
      stockDelta: validComponents.reduce((sum, component) => sum + component.quantity, 0),
      components: validComponents,
    };
  });
}

export function classifyOnlinePosLine(
  productName: string | null,
  productGroupName: string | null,
): Pick<OnlinePosTransactionLine, "lineType" | "inventoryRelevant" | "needsMapping"> {
  const name = (productName ?? "").toLocaleUpperCase("da-DK");
  const group = (productGroupName ?? "").trim();
  const groupUpper = group.toLocaleUpperCase("da-DK");

  if (!productName && !productGroupName) {
    return { lineType: "unknown", inventoryRelevant: false, needsMapping: false };
  }

  if (groupUpper.startsWith("MSG -")) {
    return { lineType: "modifier_stock_item", inventoryRelevant: true, needsMapping: true };
  }

  if (name.includes("GEBYR") && (name.includes("KRUS") || name.includes("KANDE"))) {
    return { lineType: "deposit_fee", inventoryRelevant: false, needsMapping: false };
  }

  if (name.includes("RETUR") && (name.includes("KRUS") || name.includes("KANDE"))) {
    return { lineType: "deposit_return", inventoryRelevant: false, needsMapping: false };
  }

  if (["DRINKS", "SODAVAND"].includes(groupUpper)) {
    return { lineType: "container_product", inventoryRelevant: false, needsMapping: true };
  }

  return { lineType: "stock_item", inventoryRelevant: true, needsMapping: true };
}

export function buildExternalLineId(line: OnlinePosTransactionLine) {
  return [
    line.transactionId ?? line.receiptNumber ?? "transaction",
    line.lineId ?? `line-${line.lineIndex}`,
    line.onlineposProductId ?? normalizeName(line.onlineposProductName) ?? "product",
  ].join(":");
}

export async function fetchOnlinePosTransactionLines({
  datetimeFrom,
  datetimeTo,
  page,
  venue,
}: {
  datetimeFrom: string;
  datetimeTo: string;
  page?: string | null;
  venue?: string | null;
}) {
  const venueId = venue ?? process.env.ONLINEPOS_VENUE_ID;
  if (!process.env.ONLINEPOS_CLIENT_ID || !process.env.ONLINEPOS_CLIENT_SECRET || !venueId) {
    throw new Error("OnlinePOS env mangler");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.ONLINEPOS_CLIENT_ID,
        client_secret: process.env.ONLINEPOS_CLIENT_SECRET,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const tokenText = await tokenResponse.text();

    if (!tokenResponse.ok) {
      throw new Error(tokenResponse.status === 401 ? "OnlinePOS afviser client credentials" : "OnlinePOS token request fejlede");
    }

    const accessToken = parseAccessToken(tokenText);

    if (!accessToken) {
      throw new Error("OnlinePOS token response manglede access_token");
    }

    const collectedLines: OnlinePosTransactionLine[] = [];
    let pagination = emptyPagination();
    let currentPage = page ? Number(page) : 1;
    let pageCount = 0;
    while (pageCount < 50) {
      const url = new URL(transactionsUrl);
      url.searchParams.set("venue", venueId);
      url.searchParams.set("extended_view", "1");
      url.searchParams.set("datetime_from", datetimeFrom);
      url.searchParams.set("datetime_to", datetimeTo);
      url.searchParams.set("page", String(currentPage));

      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();

      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403 ? "OnlinePOS transactions afviser adgang" : "OnlinePOS transactions fejlede");
      }

      const parsed = parseTransactions(text);
      collectedLines.push(...parsed.transactions.flatMap(toTransactionLines));
      pagination = parsed.pagination;
      pageCount += 1;

      if (page || !hasMorePages(pagination)) break;
      const nextPage = numberValue(pagination.current_page);
      if (nextPage === null) break;
      currentPage = nextPage + 1;
    }

    return {
      lines: collectedLines,
      pagination: { ...pagination, fetched_pages: pageCount },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OnlinePOS kald timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toTransactionLines(transaction: Record<string, unknown>, transactionIndex: number): OnlinePosTransactionLine[] {
  const rawLines = findTransactionLines(transaction);
  const cashRegister = toSafeCashRegister(pickField(transaction, ["cash_register", "cashRegister"]));
  const transactionId = stringOrNull(pickField(transaction, ["transaction_id", "transactionId", "id"]));
  const receiptNumber = stringOrNull(pickField(transaction, ["receipt_number", "receiptNumber"]));
  const transactionDatetime = stringOrNull(pickField(transaction, ["datetime", "created_at", "createdAt", "returned_at", "returnedAt"]));
  const transactionType = stringOrNull(pickField(transaction, ["type", "transaction_type", "transactionType"]));
  const transactionStatus = stringOrNull(pickField(transaction, ["status", "state"]));
  const returnId = stringOrNull(pickField(transaction, ["return_id", "returnId"]));
  const refundId = stringOrNull(pickField(transaction, ["refund_id", "refundId"]));
  const transactionTotal = getOnlinePosGrossTotal(transaction, rawLines);

  return rawLines.map((line, lineIndex) => {
    const onlineposProductName = stringOrNull(pickField(line, ["product_name", "productName", "productname", "name", "receipt_text", "receiptText"]));
    const onlineposProductGroupName = stringOrNull(pickField(line, ["product_group_name", "productGroupName", "productgroupname"]));
    const classification = classifyOnlinePosLine(onlineposProductName, onlineposProductGroupName);

    return {
      transactionId,
      receiptNumber,
      transactionDatetime,
      transactionType,
      transactionStatus,
      returnId,
      refundId,
      transactionTotal,
      lineId: stringOrNull(pickField(line, ["line_id", "lineId", "orderlineid", "id"])),
      parentLineId: stringOrNull(pickField(line, ["parent_line_id", "parentLineId", "parent_id", "parentId"])),
      lineIndex: transactionIndex * 10000 + lineIndex,
      onlineposProductId: stringOrNull(pickField(line, ["product_id", "productId", "productid"])),
      onlineposProductName,
      onlineposProductGroupId: stringOrNull(pickField(line, ["product_group_id", "productGroupId", "productgroupid"])),
      onlineposProductGroupName,
      cashRegisterId: cashRegister?.id ?? null,
      cashRegisterName: cashRegister?.name ?? null,
      quantitySold: numberValue(pickField(line, ["quantity", "qty", "count", "amount"])) ?? 0,
      revenue: getOnlinePosGrossAmount(line),
      ...classification,
    };
  });
}

function parseTransactions(text: string) {
  try {
    const json = JSON.parse(text) as unknown;
    return {
      transactions: findTransactions(json),
      pagination: findPagination(json),
    };
  } catch {
    return {
      transactions: [],
      pagination: emptyPagination(),
    };
  }
}

export async function getInventoryMappings(supabase: SupabaseClient): Promise<OnlinePosInventoryMapping[]> {
  const { data, error } = await supabase
    .from("onlinepos_inventory_mappings")
    .select("id,onlinepos_product_id,onlinepos_product_name,onlinepos_product_group_name,line_type,backevent_inventory_item_id,conversion_factor,mapping_action,status,created_at,updated_at")
    .order("onlinepos_product_name", { ascending: true });

  if (error) {
    throw new Error("Mappinger kunne ikke hentes");
  }

  const components = await getMappingComponents(supabase, (data ?? []).map((row) => String(row.id)));

  return (data ?? []).map((row) => ({
    id: String(row.id),
    onlineposProductId: stringOrNull(row.onlinepos_product_id),
    onlineposProductName: stringOrNull(row.onlinepos_product_name),
    onlineposProductGroupName: stringOrNull(row.onlinepos_product_group_name),
    lineType: row.line_type,
    backeventInventoryItemId: stringOrNull(row.backevent_inventory_item_id),
    conversionFactor: row.conversion_factor === null ? null : Number(row.conversion_factor),
    mappingAction: row.mapping_action,
    status: row.status,
    components: components.get(String(row.id)) ?? legacyComponents(row),
    createdAt: stringOrNull(row.created_at),
    updatedAt: stringOrNull(row.updated_at),
  }));
}

async function getMappingComponents(supabase: SupabaseClient, mappingIds: string[]) {
  const componentsByMapping = new Map<string, OnlinePosInventoryMappingComponent[]>();

  if (mappingIds.length === 0) {
    return componentsByMapping;
  }

  const { data, error } = await supabase
    .from("onlinepos_inventory_mapping_components")
    .select("id,mapping_id,backevent_inventory_item_id,conversion_factor,sort_order,created_at,updated_at")
    .in("mapping_id", mappingIds)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error("Mapping-komponenter kunne ikke hentes");
  }

  (data ?? []).forEach((row) => {
    const mappingId = String(row.mapping_id);
    const current = componentsByMapping.get(mappingId) ?? [];
    current.push({
      id: stringOrNull(row.id),
      mappingId,
      backeventInventoryItemId: stringOrNull(row.backevent_inventory_item_id),
      conversionFactor: row.conversion_factor === null ? null : Number(row.conversion_factor),
      sortOrder: numberValue(row.sort_order) ?? 0,
      createdAt: stringOrNull(row.created_at),
      updatedAt: stringOrNull(row.updated_at),
    });
    componentsByMapping.set(mappingId, current);
  });

  return componentsByMapping;
}

function legacyComponents(row: Record<string, unknown>): OnlinePosInventoryMappingComponent[] {
  const backeventInventoryItemId = stringOrNull(row.backevent_inventory_item_id);
  const conversionFactor = row.conversion_factor === null ? null : Number(row.conversion_factor);

  if (!backeventInventoryItemId || conversionFactor === null || !Number.isFinite(conversionFactor)) {
    return [];
  }

  return [{ backeventInventoryItemId, conversionFactor, sortOrder: 0 }];
}

function normalizeComponents(components: OnlinePosInventoryMappingComponent[], mapping: OnlinePosInventoryMapping) {
  return components.length > 0 ? components : legacyComponents({
    backevent_inventory_item_id: mapping.backeventInventoryItemId,
    conversion_factor: mapping.conversionFactor,
  });
}

export async function getProducts(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("backevent_products").select("id,name,unit,active,units_per_case,purchase_unit_label,units_per_purchase_unit,stock_unit_label,content_per_stock_unit,consumption_unit_label").eq("active", true);
  if (error) throw new Error("Produkter kunne ikke hentes");
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    unit: stringOrNull(row.unit),
    active: row.active === null ? null : Boolean(row.active),
    unitsPerCase: numberValue(row.units_per_case),
    purchaseUnitLabel: stringOrNull(row.purchase_unit_label),
    unitsPerPurchaseUnit: numberValue(row.units_per_purchase_unit),
    stockUnitLabel: stringOrNull(row.stock_unit_label),
    contentPerStockUnit: numberValue(row.content_per_stock_unit),
    consumptionUnitLabel: stringOrNull(row.consumption_unit_label),
  })) satisfies ProductRow[];
}

export async function getLocations(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("backevent_locations").select("id,name,type,source_location_id,active").eq("active", true);
  if (error) throw new Error("Steder kunne ikke hentes");
  return (data ?? []) as LocationRow[];
}

async function createRun(
  supabase: SupabaseClient,
  input: { datetimeFrom: string; datetimeTo: string; actorUserId: string | null; actorEmail: string | null; source: string },
) {
  const { data, error } = await supabase
    .from("onlinepos_inventory_sync_runs")
    .insert({
      source: input.source,
      datetime_from: input.datetimeFrom,
      datetime_to: input.datetimeTo,
      created_by_user_id: input.actorUserId,
      created_by_email: input.actorEmail,
    })
    .select("id")
    .single();

  if (error) throw new Error("Sync-run kunne ikke oprettes");
  return { id: String(data.id) };
}

async function updateRun(
  supabase: SupabaseClient,
  runId: string,
  input: OnlinePosSyncSummary & { status: "completed" | "partial" | "failed"; errorMessage: string | null },
) {
  const { error } = await supabase
    .from("onlinepos_inventory_sync_runs")
    .update({
      status: input.status,
      fetched_count: input.fetchedCount,
      processed_count: input.processedCount,
      ignored_count: input.ignoredCount,
      failed_count: input.failedCount,
      missing_mapping_count: input.missingMappingCount,
      duplicate_count: input.duplicateCount,
      error_message: input.errorMessage,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) throw new Error("Sync-run kunne ikke opdateres");
}

async function applySyncLines(supabase: SupabaseClient, runId: string, decisions: OnlinePosSyncDecision[]): Promise<OnlinePosSyncSummary> {
  const { data, error } = await supabase.rpc("backevent_apply_onlinepos_inventory_sync", {
    p_run_id: runId,
    p_lines: decisions.map((decision) => ({
      externalLineId: decision.externalLineId,
      transactionId: decision.transactionId,
      transactionDatetime: decision.transactionDatetime,
      receiptNumber: decision.receiptNumber,
      lineId: decision.lineId,
      onlineposProductId: decision.onlineposProductId,
      onlineposProductName: decision.onlineposProductName,
      onlineposProductGroupName: decision.onlineposProductGroupName,
      cashRegisterId: decision.cashRegisterId,
      cashRegisterName: decision.cashRegisterName,
      lineType: decision.lineType,
      mappingId: decision.mappingId,
      mappingStatus: decision.mappingStatus,
      mappingAction: decision.mappingAction,
      status: decision.status,
      errorReason: decision.errorReason,
      locationId: decision.locationId,
      sourceLocationId: decision.sourceLocationId,
      quantitySold: decision.quantitySold,
      stockDelta: decision.stockDelta,
      revenue: decision.revenue,
      components: decision.components,
    })),
  });

  if (error) {
    throw new Error("OnlinePOS-linjer kunne ikke behandles");
  }

  await Promise.all(decisions.map((decision) => decision.transactionDatetime
    ? supabase.from("onlinepos_inventory_sync_lines").update({ transaction_datetime: decision.transactionDatetime }).eq("external_line_id", decision.externalLineId)
    : Promise.resolve()));

  const result = data as Record<string, unknown>;
  return {
    fetchedCount: decisions.length,
    processedCount: numberValue(result.processedCount) ?? 0,
    ignoredCount: numberValue(result.ignoredCount) ?? 0,
    failedCount: numberValue(result.failedCount) ?? 0,
    missingMappingCount: decisions.filter((decision) => decision.errorReason === "Mangler godkendt mapping").length,
    duplicateCount: numberValue(result.duplicateCount) ?? 0,
  };
}

function ignoredDecision(
  base: Omit<OnlinePosSyncDecision, "status" | "errorReason" | "stockDelta" | "components">,
  errorReason: string,
): OnlinePosSyncDecision {
  return { ...base, status: "ignored", errorReason, stockDelta: 0, components: [] };
}

function failedDecision(
  base: Omit<OnlinePosSyncDecision, "status" | "errorReason" | "stockDelta" | "components">,
  errorReason: string,
): OnlinePosSyncDecision {
  return { ...base, status: "failed", errorReason, stockDelta: 0, components: [] };
}

function findMapping(line: OnlinePosTransactionLine, mappings: OnlinePosInventoryMapping[]) {
  const productId = normalizeOnlinePosId(line.onlineposProductId);
  if (productId) {
    return mappings.find((mapping) => normalizeOnlinePosId(mapping.onlineposProductId) === productId) ?? null;
  }

  const productName = normalizeName(line.onlineposProductName);
  if (!productName) return null;

  return mappings.find((mapping) => !normalizeOnlinePosId(mapping.onlineposProductId) && normalizeName(mapping.onlineposProductName) === productName && mapping.lineType === line.lineType) ?? null;
}

function defaultMappingAction(line: OnlinePosTransactionLine): OnlinePosMappingAction {
  if (line.lineType === "deposit_fee") return "deposit_fee";
  if (line.lineType === "deposit_return") return "deposit_return";
  if (line.lineType === "container_product") return "container_only";
  if (line.lineType === "unknown") return "ignore";
  return line.inventoryRelevant ? "consume_stock" : "ignore";
}

function parseAccessToken(text: string) {
  try {
    const json = JSON.parse(text) as TokenResponse;
    return typeof json.access_token === "string" && json.access_token ? json.access_token : null;
  } catch {
    return null;
  }
}

function toSafeCashRegister(value: unknown): { id: string | null; name: string | null } | null {
  if (isRecord(value)) {
    return {
      id: stringOrNull(pickField(value, ["id", "cash_register_id", "cashRegisterId"])),
      name: stringOrNull(pickField(value, ["name", "cash_register_name", "cashRegisterName"])),
    };
  }

  if (typeof value === "string" || typeof value === "number") {
    return { id: String(value), name: null };
  }

  return null;
}

function findTransactions(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.filter(isRecord);
}

function findTransactionLines(transaction: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(transaction.lines) ? transaction.lines.filter(isRecord) : [];
}

function findPagination(value: unknown): SafePagination {
  if (!isRecord(value)) return emptyPagination();
  const pagination = pickField(value, ["pagination"]);
  if (!isRecord(pagination)) return emptyPagination();
  return {
    total: stringOrNumber(pickField(pagination, ["total", "total_count", "totalCount"])),
    per_page: stringOrNumber(pickField(pagination, ["per_page", "perPage", "limit"])),
    current_page: stringOrNumber(pickField(pagination, ["current_page", "currentPage", "page"])),
    last_page: stringOrNumber(pickField(pagination, ["last_page", "lastPage"])),
  };
}

function hasMorePages(pagination: SafePagination) {
  const currentPage = numberValue(pagination.current_page);
  const lastPage = numberValue(pagination.last_page);
  return currentPage !== null && lastPage !== null ? currentPage < lastPage : false;
}

function emptyPagination(): SafePagination {
  return { total: null, per_page: null, current_page: null, last_page: null };
}

function pickField(row: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(row);
  for (const key of keys) {
    const found = entries.find(([entryKey]) => normalizeKey(entryKey) === normalizeKey(key));
    if (found) return found[1];
  }
  return null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringOrNull(value: unknown) {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function stringOrNumber(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function normalizeOnlinePosId(value: unknown) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function normalizeName(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("da-DK") || null;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}


function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "OnlinePOS sync fejlede";
}
