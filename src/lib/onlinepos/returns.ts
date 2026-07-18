import type { SupabaseClient } from "@supabase/supabase-js";
import webPush from "web-push";
import type { OnlinePosInventoryMapping, OnlinePosMappingAction } from "./inventory-mappings.ts";
import {
  createOnlinePosLocationResolver,
  getOnlinePosLocationMappings,
  resolveOnlinePosLocation,
  type OnlinePosLocationResolution,
} from "./location-mappings.ts";
import {
  analyzeOnlinePosReceipt,
  buildOnlinePosReceiptControlKey,
  type OnlinePosReceiptControlAnalysis,
} from "./receipt-control.ts";
import { calculateOnlinePosInventoryConsumption } from "./inventory-unit-conversion.ts";
import {
  getOnlinePosGrossAmount,
  getOnlinePosGrossTotal,
  getOnlinePosSourcedLineAmount,
  getOnlinePosSourcedTotal,
} from "./pricing.ts";

export type ReturnHandling = "waste" | "return_to_stock" | "manual_review" | "no_stock_effect";
export type ReturnEconomicDirection = "refund" | "charge" | "neutral";

export type ParsedOnlinePosReturnLine = {
  onlineposLineId: string | null;
  externalReturnLineId: string;
  onlineposProductId: string | null;
  productDescription: string;
  productGroupName: string | null;
  returnedQuantity: number;
  inputUnit: string | null;
  parentOnlineposLineId: string | null;
  unitPrice: number | null;
  lineAmount: number;
  economicDirection: ReturnEconomicDirection;
  lineType: string;
  isDeposit: boolean;
  isCup: boolean;
  isFee: boolean;
};

export type ParsedOnlinePosReturn = {
  externalIdempotencyKey: string;
  contentHash: string;
  receiptNumber: string | null;
  onlineposTransactionId: string | null;
  onlineposReturnId: string | null;
  originalTransactionId: string | null;
  onlineposReturnedAt: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string | null;
  totalAmount: number;
  productAmount: number;
  depositAmount: number;
  cupAmount: number;
  controlReasons: string[];
  suspicionFlags: string[];
  rawMetadata: Record<string, unknown>;
  lines: ParsedOnlinePosReturnLine[];
};

type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  units_per_case?: number | string | null;
  purchase_unit_label?: string | null;
  units_per_purchase_unit?: number | string | null;
  stock_unit_label?: string | null;
  content_per_stock_unit?: number | string | null;
  consumption_unit_label?: string | null;
  return_handling: ReturnHandling | null;
  active: boolean | null;
};

type LocationRow = {
  id: string;
  name: string;
  type: string | null;
  source_location_id: string | null;
  active: boolean | null;
};

export type ReturnRegistrationOptions = {
  source?: "onlinepos" | "test_harness";
  testScenario?: string | null;
  createdByUserId?: string | null;
  createdByName?: string | null;
  extraMappings?: OnlinePosInventoryMapping[];
  forceControlReasons?: string[];
  locationResolution?: OnlinePosLocationResolution;
  skipFinanceNotification?: boolean;
};

export type ReceiptControlLocationContext = {
  locationId: string | null;
  locationName: string | null;
  mappingStatus: "mapped" | "unmapped";
};

type TokenResponse = {
  access_token?: string;
};

type ReturnPagination = {
  total: string | number | null;
  per_page: string | number | null;
  current_page: string | number | null;
  last_page: string | number | null;
};

const restBaseUrl = "https://rest.onlinepos.dk";
const timeoutMs = 15000;
const maxPages = 100;

export async function runOnlinePosReturnSync({
  supabase,
  datetimeFrom,
  datetimeTo,
  source = "manual",
}: {
  supabase: SupabaseClient;
  datetimeFrom: string;
  datetimeTo: string;
  source?: "manual" | "cron";
}) {
  const run = await createReturnSyncRun(supabase, { datetimeFrom, datetimeTo, source });
  try {
    const fetched = await fetchOnlinePosTransactions({ datetimeFrom, datetimeTo });
    const receiptAnalyses = fetched.transactions.map(analyzeRawOnlinePosReceipt);
    const returns = fetched.transactions.map(parseOnlinePosReturn).filter((item): item is ParsedOnlinePosReturn => Boolean(item));
    const context = await loadReturnContext(supabase);
    const venueId = process.env.ONLINEPOS_VENUE_ID ?? null;
    const locationResolver = createOnlinePosLocationResolver(
      receiptAnalyses.map((item) => ({ venueId, cashRegisterId: item.cashRegisterId, cashRegisterName: item.cashRegisterName })),
      context.locationMappings,
      context.locations,
    );
    const registered = [];
    let processedLineCount = 0;
    let reviewCount = 0;
    let duplicateCount = 0;

    for (const analysis of receiptAnalyses.filter((item) => item.controlTypes.length > 0)) {
      const locationResolution = locationResolver.resolve({
        venueId,
        cashRegisterId: analysis.cashRegisterId,
        cashRegisterName: analysis.cashRegisterName,
      });
      await notifyFinanceAboutReceiptControls(supabase, analysis, {
        locationContext: buildReceiptControlLocationContext(locationResolution),
      }).catch(() => undefined);
    }

    for (const parsedReturn of returns) {
      try {
        const result = await registerAndProcessReturn(supabase, parsedReturn, context, {
          locationResolution: locationResolver.resolve({
            venueId,
            cashRegisterId: parsedReturn.cashRegisterId,
            cashRegisterName: parsedReturn.cashRegisterName,
          }),
          skipFinanceNotification: true,
        });
        registered.push(result);
        processedLineCount += result.processedLineCount;
        reviewCount += result.reviewCount;
        if (result.duplicate) duplicateCount += 1;
      } catch (error) {
        reviewCount += 1;
        registered.push({ error: safeErrorMessage(error), duplicate: false, processedLineCount: 0, reviewCount: 1 });
      }
    }

    const status = reviewCount > 0 || fetched.pageErrors.length > 0 ? "partial" : "completed";
    await updateReturnSyncRun(supabase, run.id, {
      status,
      pageCount: fetched.pageCount,
      transactionCount: fetched.transactions.length,
      returnCount: returns.length,
      processedLineCount,
      reviewCount,
      duplicateCount,
      errorMessage: fetched.pageErrors.join(" | ") || null,
    });

    return {
      ok: true,
      runId: run.id,
      status,
      transactionCount: fetched.transactions.length,
      returnCount: returns.length,
      processedLineCount,
      reviewCount,
      duplicateCount,
      pageCount: fetched.pageCount,
      pageErrors: fetched.pageErrors,
      registered,
    };
  } catch (error) {
    await updateReturnSyncRun(supabase, run.id, {
      status: "failed",
      pageCount: 0,
      transactionCount: 0,
      returnCount: 0,
      processedLineCount: 0,
      reviewCount: 0,
      duplicateCount: 0,
      errorMessage: safeErrorMessage(error),
    });
    return { ok: false, runId: run.id, message: safeErrorMessage(error) };
  }
}

export function parseOnlinePosReturn(transaction: Record<string, unknown>, transactionIndex = 0): ParsedOnlinePosReturn | null {
  const rawLines = findTransactionLines(transaction);
  const returnSignal = hasReturnSignal(transaction);
  if (!returnSignal.isReturn) return null;

  const parsedLines = rawLines
    .map((line, lineIndex) => toReturnLine(line, stringOrNull(pickField(transaction, ["transaction_id", "transactionId", "id"])), stringOrNull(pickField(transaction, ["receipt_number", "receiptNumber"])), lineIndex))
    .filter((line) => line.returnedQuantity > 0 || line.lineAmount !== 0);

  if (parsedLines.length === 0) return null;

  const onlineposTransactionId = stringOrNull(pickField(transaction, ["transaction_id", "transactionId", "id"])) ?? `transaction-${transactionIndex}`;
  const receiptNumber = stringOrNull(pickField(transaction, ["receipt_number", "receiptNumber", "receipt"]));
  const onlineposReturnId = stringOrNull(pickField(transaction, ["return_id", "returnId", "refund_id", "refundId"]));
  const originalTransactionId = stringOrNull(pickField(transaction, ["original_transaction_id", "originalTransactionId", "parent_transaction_id", "parentTransactionId"]));
  const returnedAt = stringOrNull(pickField(transaction, ["datetime", "created_at", "createdAt", "returned_at", "returnedAt"]));
  const cashRegister = toSafeCashRegister(pickField(transaction, ["cash_register", "cashRegister"]));
  const cashRegisterId = cashRegister?.id ?? stringOrNull(pickField(transaction, ["cash_register_id", "cashRegisterId", "department_id", "departmentId"]));
  const cashRegisterName = cashRegister?.name ?? stringOrNull(pickField(transaction, ["cash_register_name", "cashRegisterName", "department", "department_name", "departmentName"]));
  const rawTotalAmount = getOnlinePosGrossTotal(transaction, rawLines);
  const totalAmount = roundNumber(parsedLines.reduce((sum, line) => sum + line.lineAmount, 0));
  const depositAmount = roundNumber(parsedLines.filter((line) => line.isDeposit || line.isCup || line.isFee).reduce((sum, line) => sum + line.lineAmount, 0));
  const productAmount = roundNumber(totalAmount - depositAmount);
  const cupAmount = roundNumber(parsedLines.filter((line) => line.isCup).reduce((sum, line) => sum + line.lineAmount, 0));
  const externalIdempotencyKey = ["return", onlineposReturnId ?? onlineposTransactionId, receiptNumber ?? "no-receipt", returnedAt ?? "no-time"].join(":");
  const contentHash = stableHash({ receiptNumber, onlineposTransactionId, onlineposReturnId, totalAmount, lines: parsedLines.map((line) => ({ id: line.onlineposLineId, product: line.onlineposProductId ?? line.productDescription, qty: line.returnedQuantity, amount: line.lineAmount, direction: line.economicDirection })) });
  const controlReasons = [...returnSignal.reasons];
  const suspicionFlags: string[] = [];
  const ordinaryReturnedQuantity = parsedLines
    .filter((line) => !line.isDeposit && !line.isCup && !line.isFee && !line.parentOnlineposLineId)
    .reduce((sum, line) => sum + line.returnedQuantity, 0);

  if (ordinaryReturnedQuantity > 10) {
    suspicionFlags.push("STOR_RETUR");
    controlReasons.push("Stor retur over 10 enheder");
  }
  if (parsedLines.some((line) => line.isCup || line.isDeposit || line.isFee)) suspicionFlags.push("PANT_KRUS");
  for (const line of parsedLines) {
    if (line.economicDirection === "refund" && line.lineAmount > 0) controlReasons.push("Linjefortegn modsiger returlinje");
    if (line.economicDirection === "charge" && line.lineAmount < 0) controlReasons.push("Gebyr har refund-retning");
  }
  if (typeof rawTotalAmount === "number" && Math.abs(roundNumber(rawTotalAmount) - totalAmount) > 0.01) {
    controlReasons.push("Rå OnlinePOS-total afviger fra beregnede returlinjer");
  }

  return {
    externalIdempotencyKey,
    contentHash,
    receiptNumber,
    onlineposTransactionId,
    onlineposReturnId,
    originalTransactionId,
    onlineposReturnedAt: returnedAt,
    cashRegisterId,
    cashRegisterName,
    totalAmount,
    productAmount,
    depositAmount,
    cupAmount,
    controlReasons: uniqueJson(controlReasons),
    suspicionFlags: uniqueJson(suspicionFlags),
    rawMetadata: {
      source: "onlinepos",
      cashRegister,
      weakSignal: returnSignal.weak,
      rawTotalAmount: rawTotalAmount ?? null,
      calculatedNetAmount: totalAmount,
      economy: summarizeReturnEconomy(parsedLines),
    },
    lines: parsedLines,
  };
}

export function analyzeRawOnlinePosReceipt(transaction: Record<string, unknown>): OnlinePosReceiptControlAnalysis {
  const rawLines = findTransactionLines(transaction);
  const cashRegister = toSafeCashRegister(pickField(transaction, ["cash_register", "cashRegister"]));
  const total = getOnlinePosSourcedTotal(transaction, rawLines);
  return analyzeOnlinePosReceipt({
    venueId: process.env.ONLINEPOS_VENUE_ID ?? null,
    transactionId: stringOrNull(pickField(transaction, ["transaction_id", "transactionId", "id"])),
    receiptNumber: stringOrNull(pickField(transaction, ["receipt_number", "receiptNumber", "receipt"])),
    transactionType: stringOrNull(pickField(transaction, ["type", "kind", "transaction_type", "transactionType"])),
    transactionStatus: stringOrNull(pickField(transaction, ["status", "transaction_status", "transactionStatus"])),
    returnId: stringOrNull(pickField(transaction, ["return_id", "returnId"])),
    refundId: stringOrNull(pickField(transaction, ["refund_id", "refundId"])),
    total: total.value,
    totalIncludingVat: total.valueIncludingVat,
    totalSource: total.sourceField,
    cashRegisterId: cashRegister?.id ?? stringOrNull(pickField(transaction, ["cash_register_id", "cashRegisterId", "department_id", "departmentId"])),
    cashRegisterName: cashRegister?.name ?? stringOrNull(pickField(transaction, ["cash_register_name", "cashRegisterName", "department", "department_name", "departmentName"])),
    transactionDatetime: stringOrNull(pickField(transaction, ["datetime", "created_at", "createdAt"])),
    amountsIncludeVat: total.includesVat,
    lines: rawLines.map((line) => {
      const productName = stringOrNull(pickField(line, ["product_name", "productName", "productname", "name", "receipt_text", "receiptText"]));
      const productGroupName = stringOrNull(pickField(line, ["product_group_name", "productGroupName", "productgroupname"]));
      const sourcedAmount = getOnlinePosSourcedLineAmount(line);
      return {
        productName,
        lineType: classifyOnlinePosLine(productName, productGroupName).lineType,
        quantity: numberValue(pickField(line, ["quantity", "qty", "count", "amount"])) ?? 0,
        amount: sourcedAmount.value,
        amountIncludingVat: sourcedAmount.valueIncludingVat,
        amountSource: sourcedAmount.sourceField,
      };
    }),
  });
}

export async function registerAndProcessReturn(
  supabase: SupabaseClient,
  parsedReturn: ParsedOnlinePosReturn,
  context: Awaited<ReturnType<typeof loadReturnContext>>,
  options: ReturnRegistrationOptions = {},
) {
  const processingContext = {
    ...context,
    mappings: [...(options.extraMappings ?? []), ...context.mappings],
  };
  const locationResolution = options.locationResolution ?? resolveOnlinePosLocation(
    { venueId: process.env.ONLINEPOS_VENUE_ID ?? null, cashRegisterId: parsedReturn.cashRegisterId, cashRegisterName: parsedReturn.cashRegisterName },
    context.locationMappings,
    context.locations,
  );
  const location = locationResolution.ok ? locationResolution.location : null;
  const sourceLocationId = location?.source_location_id ?? null;
  const controlReasons = [...parsedReturn.controlReasons, ...(options.forceControlReasons ?? [])];

  if (!locationResolution.ok) controlReasons.push(locationResolution.errorCode);
  if (!parsedReturn.receiptNumber) controlReasons.push("Mangler bonnummer");

  const existing = await findExistingReturn(supabase, parsedReturn.externalIdempotencyKey);
  if (existing) {
    if (existing.content_hash && existing.content_hash !== parsedReturn.contentHash) {
      const reasons = uniqueJson([...(asStringArray(existing.control_reasons) ?? []), "Dublet med ændret indhold"]);
      await supabase
        .from("backevent_returns")
        .update({
          processing_status: "duplicate",
          control_status: "open",
          control_reasons: reasons,
        })
        .eq("id", existing.id);
      await notifyOwnersAboutReturnControl(supabase, String(existing.id), parsedReturn, getSeriousReturnControlReasons(reasons));
    }
    return {
      id: String(existing.id),
      duplicate: true,
      processedLineCount: 0,
      reviewCount: 0,
      processingStatus: existing.processing_status,
    };
  }

  const { data: insertedReturn, error: insertError } = await supabase
    .from("backevent_returns")
    .insert({
      location_id: location?.id ?? null,
      source_location_id: sourceLocationId,
      onlinepos_venue_id: process.env.ONLINEPOS_VENUE_ID ?? null,
      onlinepos_location_ref: parsedReturn.cashRegisterName ?? parsedReturn.cashRegisterId,
      onlinepos_returned_at: parsedReturn.onlineposReturnedAt,
      receipt_number: parsedReturn.receiptNumber,
      onlinepos_transaction_id: parsedReturn.onlineposTransactionId,
      onlinepos_return_id: parsedReturn.onlineposReturnId,
      original_transaction_id: parsedReturn.originalTransactionId,
      external_idempotency_key: parsedReturn.externalIdempotencyKey,
      content_hash: parsedReturn.contentHash,
      total_amount: parsedReturn.totalAmount,
      product_amount: parsedReturn.productAmount,
      deposit_amount: parsedReturn.depositAmount,
      cup_amount: parsedReturn.cupAmount,
      source: options.source ?? "onlinepos",
      test_scenario: options.testScenario ?? null,
      created_by: options.createdByUserId ?? null,
      created_by_name: options.createdByName ?? null,
      processing_status: "processing",
      control_status: controlReasons.length > 0 ? "open" : "not_required",
      control_reasons: uniqueJson(controlReasons),
      suspicion_flags: uniqueJson(parsedReturn.suspicionFlags),
      raw_metadata: {
        ...parsedReturn.rawMetadata,
        testHarness: options.source === "test_harness",
        testScenario: options.testScenario ?? null,
      },
    })
    .select("id")
    .single();

  if (insertError) throw new Error("Retur kunne ikke registreres");

  const returnId = String(insertedReturn.id);
  await supabase.from("backevent_return_history").insert({
    return_id: returnId,
    action: "registered",
    actor_name: "BackEvent",
    metadata: { lineCount: parsedReturn.lines.length },
  });

  const preparedLines = parsedReturn.lines.map((line) => prepareReturnLine(line, returnId, processingContext));
  if (!sourceLocationId) {
    for (const line of preparedLines) {
      if (!returnLineNeedsStockSource(line.row)) continue;
      const reason = `STOCK_SOURCE_MISSING: ${line.row.product_description}`;
      line.reasons.push(reason);
      line.row.processing_status = "requires_review";
      line.row.error_message = line.row.error_message ? `${line.row.error_message}, ${reason}` : reason;
    }
  }
  const allControlReasons = uniqueJson([...controlReasons, ...preparedLines.flatMap((line) => line.reasons)]);
  if (allControlReasons.length > controlReasons.length) {
    await supabase.from("backevent_returns").update({ control_status: "open", control_reasons: allControlReasons }).eq("id", returnId);
  }

  const { data: insertedLines, error: lineError } = await supabase
    .from("backevent_return_lines")
    .insert(preparedLines.map((line) => line.row))
    .select("id,processing_status");

  if (lineError) {
    await supabase.from("backevent_returns").update({ processing_status: "processing_failed", control_status: "open" }).eq("id", returnId);
    await notifyOwnersAboutReturnControl(supabase, returnId, parsedReturn, ["Returlinjer kunne ikke registreres"]);
    throw new Error("Returlinjer kunne ikke registreres");
  }

  let processedLineCount = 0;
  let reviewCount = 0;
  const postProcessControlReasons: string[] = [];

  for (const row of insertedLines ?? []) {
    const { data, error } = await supabase.rpc("backevent_process_return_line", { p_return_line_id: row.id });
    const result = data as { ok?: boolean; status?: string } | null;
    if (result?.ok) processedLineCount += 1;
    if (error || result?.status === "requires_review" || result?.status === "failed") {
      reviewCount += 1;
      if (error || result?.status === "failed") postProcessControlReasons.push("Lagerbehandling fejler");
    }
  }

  const finalControlReasons = uniqueJson([...allControlReasons, ...postProcessControlReasons]);
  if (finalControlReasons.length > allControlReasons.length) {
    await supabase.from("backevent_returns").update({ control_status: "open", control_reasons: finalControlReasons }).eq("id", returnId);
  }

  if (!options.skipFinanceNotification) {
    await notifyFinanceAboutReturn(supabase, returnId, parsedReturn, location?.name ?? null);
  }
  const seriousReasons = getSeriousReturnControlReasons(finalControlReasons);
  if (seriousReasons.length > 0) {
    await notifyOwnersAboutReturnControl(supabase, returnId, parsedReturn, seriousReasons);
  }

  return { id: returnId, duplicate: false, processedLineCount, reviewCount, processingStatus: reviewCount > 0 ? "requires_review" : "processed" };
}
export async function fetchOnlinePosTransactions({ datetimeFrom, datetimeTo, page }: { datetimeFrom: string; datetimeTo: string; page?: string | null }) {
  if (!process.env.ONLINEPOS_CLIENT_ID || !process.env.ONLINEPOS_CLIENT_SECRET || !process.env.ONLINEPOS_VENUE_ID) {
    throw new Error("OnlinePOS env mangler");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const tokenResponse = await fetch(`${restBaseUrl}/auth/token`, {
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

    if (!tokenResponse.ok) throw new Error("OnlinePOS token request fejlede");
    const accessToken = parseAccessToken(tokenText);
    if (!accessToken) throw new Error("OnlinePOS token response manglede access_token");

    const collected: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const pageErrors: string[] = [];
    let pagination: ReturnPagination = emptyPagination();
    let currentPage = page ? Number(page) : 1;
    let pageCount = 0;

    while (pageCount < maxPages) {
      const pageResult = await fetchOnlinePosTransactionPage({
        accessToken,
        datetimeFrom,
        datetimeTo,
        page: String(currentPage),
        signal: controller.signal,
      });
      pageCount += 1;
      pagination = pageResult.pagination;

      for (const transaction of pageResult.transactions) {
        const key = transactionKey(transaction);
        if (!seen.has(key)) {
          seen.add(key);
          collected.push(transaction);
        }
      }

      if (page || !hasMorePages(pagination)) {
        break;
      }

      const nextPage = nextPageNumber(pagination, currentPage);
      if (!nextPage || nextPage <= currentPage) {
        pageErrors.push("Pagination stoppede uden gyldig nÃ¦ste side");
        break;
      }
      currentPage = nextPage;
    }

    if (pageCount >= maxPages && hasMorePages(pagination)) {
      pageErrors.push("Pagination stoppet af sikkerhedsgrÃ¦nse");
    }

    return {
      transactions: collected,
      pagination,
      pageCount,
      pageErrors,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("OnlinePOS kald timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOnlinePosTransactionPage({
  accessToken,
  datetimeFrom,
  datetimeTo,
  page,
  signal,
}: {
  accessToken: string;
  datetimeFrom: string;
  datetimeTo: string;
  page: string;
  signal: AbortSignal;
}) {
  const url = new URL(`${restBaseUrl}/transactions`);
  url.searchParams.set("venue", process.env.ONLINEPOS_VENUE_ID!);
  url.searchParams.set("extended_view", "1");
  url.searchParams.set("datetime_from", datetimeFrom);
  url.searchParams.set("datetime_to", datetimeTo);
  url.searchParams.set("page", page);

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403 ? "OnlinePOS afviser adgang" : `OnlinePOS transactions fejlede pÃ¥ side ${page}`);
  }

  return parseTransactions(text);
}

async function createReturnSyncRun(supabase: SupabaseClient, input: { datetimeFrom: string; datetimeTo: string; source: "manual" | "cron" }) {
  const { data, error } = await supabase
    .from("backevent_return_sync_runs")
    .insert({
      source: input.source,
      datetime_from: input.datetimeFrom,
      datetime_to: input.datetimeTo,
    })
    .select("id")
    .single();

  if (error) {
    return { id: crypto.randomUUID() };
  }

  return { id: String(data.id) };
}

async function updateReturnSyncRun(
  supabase: SupabaseClient,
  runId: string,
  input: {
    status: "completed" | "partial" | "failed";
    pageCount: number;
    transactionCount: number;
    returnCount: number;
    processedLineCount: number;
    reviewCount: number;
    duplicateCount: number;
    errorMessage: string | null;
  },
) {
  await supabase
    .from("backevent_return_sync_runs")
    .update({
      status: input.status,
      page_count: input.pageCount,
      transaction_count: input.transactionCount,
      return_count: input.returnCount,
      processed_line_count: input.processedLineCount,
      review_count: input.reviewCount,
      duplicate_count: input.duplicateCount,
      error_message: input.errorMessage,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

export async function loadReturnContext(supabase: SupabaseClient) {
  const [mappingsResult, componentsResult, productsResult, locationsResult, locationMappings] = await Promise.all([
    supabase.from("onlinepos_inventory_mappings").select("id,onlinepos_product_id,onlinepos_product_name,line_type,mapping_action,status,backevent_inventory_item_id,conversion_factor"),
    supabase.from("onlinepos_inventory_mapping_components").select("mapping_id,backevent_inventory_item_id,conversion_factor,sort_order").order("sort_order"),
    supabase
      .from("backevent_products")
      .select("id,name,unit,units_per_case,purchase_unit_label,units_per_purchase_unit,stock_unit_label,content_per_stock_unit,consumption_unit_label,return_handling,active")
      .eq("active", true),
    supabase.from("backevent_locations").select("id,name,type,source_location_id,active").eq("active", true),
    getOnlinePosLocationMappings(supabase),
  ]);

  if (mappingsResult.error || componentsResult.error || productsResult.error || locationsResult.error) {
    throw new Error("Returdata kunne ikke hentes");
  }

  const componentsByMapping = new Map<string, Array<{ backeventInventoryItemId: string | null; conversionFactor: number | null; sortOrder: number }>>();
  for (const component of componentsResult.data ?? []) {
    const key = String(component.mapping_id);
    const list = componentsByMapping.get(key) ?? [];
    list.push({
      backeventInventoryItemId: stringOrNull(component.backevent_inventory_item_id),
      conversionFactor: component.conversion_factor === null ? null : Number(component.conversion_factor),
      sortOrder: Number(component.sort_order ?? 0),
    });
    componentsByMapping.set(key, list);
  }

  const mappings: OnlinePosInventoryMapping[] = (mappingsResult.data ?? []).map((mapping) => ({
    id: String(mapping.id),
    onlineposProductId: stringOrNull(mapping.onlinepos_product_id),
    onlineposProductName: stringOrNull(mapping.onlinepos_product_name),
    onlineposProductGroupName: null,
    lineType: mapping.line_type,
    backeventInventoryItemId: stringOrNull(mapping.backevent_inventory_item_id),
    conversionFactor: mapping.conversion_factor === null ? null : Number(mapping.conversion_factor),
    mappingAction: mapping.mapping_action as OnlinePosMappingAction,
    status: mapping.status as "unmapped" | "approved",
    components: componentsByMapping.get(String(mapping.id)) ?? [],
    createdAt: null,
    updatedAt: null,
  }));

  return {
    mappings,
    products: (productsResult.data ?? []) as ProductRow[],
    locations: (locationsResult.data ?? []) as LocationRow[],
    locationMappings,
  };
}

function prepareReturnLine(
  line: ParsedOnlinePosReturnLine,
  returnId: string,
  context: Awaited<ReturnType<typeof loadReturnContext>>,
) {
  const mapping = findMapping(line, context.mappings);
  const components = normalizeReturnComponents(mapping);
  const firstComponent = components.length === 1 ? components[0] : null;
  const product = firstComponent?.backeventInventoryItemId
    ? context.products.find((item) => item.id === firstComponent.backeventInventoryItemId) ?? null
    : null;
  const explicitReturnHandling = product?.return_handling ?? null;
  const handling = line.isDeposit || line.isCup || line.isFee
    ? "no_stock_effect"
    : explicitReturnHandling ?? "manual_review";
  const conversionFactor = firstComponent?.conversionFactor ?? 0;
  const calculatedStockQuantity = product && Number(conversionFactor) > 0
    ? calculateOnlinePosInventoryConsumption({
      soldQuantity: line.returnedQuantity,
      consumptionPerSale: Number(conversionFactor),
      product: {
        unit: product.unit,
        unitsPerCase: product.units_per_case,
        purchaseUnitLabel: product.purchase_unit_label,
        unitsPerPurchaseUnit: product.units_per_purchase_unit,
        stockUnitLabel: product.stock_unit_label,
        contentPerStockUnit: product.content_per_stock_unit,
        consumptionUnitLabel: product.consumption_unit_label,
      },
    }).storedQuantity
    : 0;
  const reasons = [];

  if (handling !== "no_stock_effect" && (!mapping || mapping.status !== "approved")) reasons.push("Mangler godkendt mapping");
  if (handling !== "no_stock_effect" && components.length > 1) reasons.push("Flere lagerkomponenter krÃ¦ver manuel returkontrol");
  if (!product && handling !== "no_stock_effect") reasons.push("Produkt findes ikke i BackEvent");
  if (product && explicitReturnHandling === null && handling !== "no_stock_effect") reasons.push(`Produkt mangler returbehandling: ${product.name}`);
  if (handling === "manual_review" && explicitReturnHandling === "manual_review") reasons.push("Produkt krÃ¦ver manuel returkontrol");

  return {
    reasons,
    row: {
      return_id: returnId,
      onlinepos_line_id: line.onlineposLineId,
      external_return_line_id: line.externalReturnLineId,
      onlinepos_product_id: line.onlineposProductId,
      backevent_product_id: product?.id ?? null,
      product_description: line.productDescription,
      returned_quantity: line.returnedQuantity,
      input_unit: line.inputUnit,
      unit: product?.unit ?? null,
      unit_price: line.unitPrice,
      line_amount: line.lineAmount,
      line_type: line.lineType,
      parent_external_line_id: line.parentOnlineposLineId,
      return_handling: handling,
      is_deposit: line.isDeposit,
      is_cup: line.isCup,
      is_fee: line.isFee,
      affects_stock: handling === "return_to_stock",
      calculated_stock_quantity: calculatedStockQuantity,
      processing_status: reasons.length > 0 ? "requires_review" : "registered",
      error_message: reasons.length > 0 ? reasons.join(", ") : null,
      idempotency_key: line.externalReturnLineId,
    },
  };
}

export function returnLineNeedsStockSource(row: { return_handling?: string | null; backevent_product_id?: string | null; calculated_stock_quantity?: number | string | null }) {
  return row.return_handling === "return_to_stock" && Boolean(row.backevent_product_id) && Number(row.calculated_stock_quantity ?? 0) > 0;
}

type ReturnNotificationRecipient = { id: string; email: string | null };

export async function persistReceiptControls(
  supabase: SupabaseClient,
  analysis: OnlinePosReceiptControlAnalysis,
  options: { sendNotifications?: boolean; source?: "live" | "historical_replay"; replayRunId?: string | null; locationContext?: ReceiptControlLocationContext } = {},
) {
  if (analysis.controlTypes.length === 0) return;
  const control = await getOrCreateReceiptControl(supabase, analysis, options);
  if (options.sendNotifications === false) return control;
  if (!control) return;
  const financeMembers = analysis.controlTypes.some((type) => type !== "MANUAL_REVIEW") ? await getFinanceMembers(supabase) : [];
  const ownerMembers = analysis.controlTypes.includes("MANUAL_REVIEW") ? await getOwnerMembers(supabase) : [];
  const members = [...financeMembers, ...ownerMembers]
    .filter((member, index, all) => all.findIndex((candidate) => candidate.id === member.id) === index);
  console.info("[receipt-control-notification] dispatch", {
    receiptControlId: control.id,
    source: options.source ?? "live",
    replayRunId: options.replayRunId ?? null,
    controlTypes: analysis.controlTypes,
    recipientCount: members.length,
    webPushConfigured: isWebPushConfigured(),
  });
  if (members.length === 0) return control;

  const title = analysis.controlTypes.length > 1 ? "Bon kræver økonomikontrol" : "Økonomikontrol af bon";
  const body = buildReceiptControlNotificationText(analysis, options.locationContext);
  for (const member of members) {
    try {
      await dispatchReceiptControlNotification(supabase, {
        receiptControlId: control.id,
        member,
        dedupeKey: buildReceiptControlNotificationDedupeKey(analysis.receiptKey, member.id),
        title,
        body,
        targetUrl: `/retur/kontrol/${control.id}`,
      });
    } catch {
      // Økonomikontrol må ikke blokere OnlinePOS-sync.
    }
  }
}

const notifyFinanceAboutReceiptControls = persistReceiptControls;

async function getOrCreateReceiptControl(
  supabase: SupabaseClient,
  analysis: OnlinePosReceiptControlAnalysis,
  options: { source?: "live" | "historical_replay"; replayRunId?: string | null; locationContext?: ReceiptControlLocationContext } = {},
) {
  const locationContext = options.locationContext ?? { locationId: null, locationName: null, mappingStatus: "unmapped" as const };
  const row = {
    receipt_key: analysis.receiptKey,
    onlinepos_transaction_id: analysis.transactionId,
    receipt_number: analysis.receiptNumber,
    classification: analysis.classification,
    control_types: analysis.controlTypes,
    control_keys: analysis.controlTypes.map((controlType) =>
      buildOnlinePosReceiptControlKey(analysis.receiptKey, controlType),
    ),
    deposit_return_quantity: analysis.depositReturnQuantity,
    deposit_breakdown: analysis.depositBreakdown,
    purchase_value: analysis.purchaseValue,
    deposit_return_value: analysis.depositReturnValue,
    final_total: analysis.finalTotal,
    purchase_value_including_vat: analysis.purchaseValueIncludingVat,
    deposit_return_value_including_vat: analysis.depositReturnValueIncludingVat,
    final_total_including_vat: analysis.finalTotalIncludingVat,
    amount_source_details: analysis.amountSourceDetails,
    source: options.source ?? "live",
    replay_run_id: options.replayRunId ?? null,
    transaction_datetime: analysis.transactionDatetime,
    location_id: locationContext.locationId,
    location_name: locationContext.locationName,
    cash_register_id: analysis.cashRegisterId,
    cash_register_name: analysis.cashRegisterName,
    location_mapping_status: locationContext.mappingStatus,
    amounts_include_vat: analysis.amountsIncludeVat,
  };
  const inserted = await supabase.from("backevent_onlinepos_receipt_controls").insert(row).select("id").single();
  if (!inserted.error) return { id: String(inserted.data.id) };
  if (!isUniqueViolation(inserted.error)) throw inserted.error;
  const existing = await supabase
    .from("backevent_onlinepos_receipt_controls")
    .select("id")
    .eq("receipt_key", analysis.receiptKey)
    .maybeSingle();
  if (!existing.data) return null;

  const update = receiptControlLocationUpdate(analysis, locationContext);
  if (Object.keys(update).length > 0) {
    const updated = await supabase
      .from("backevent_onlinepos_receipt_controls")
      .update(update)
      .eq("id", existing.data.id);
    if (updated.error) throw updated.error;
  }
  return { id: String(existing.data.id) };
}

export function buildReceiptControlLocationContext(resolution: OnlinePosLocationResolution): ReceiptControlLocationContext {
  return resolution.ok
    ? { locationId: resolution.location.id, locationName: resolution.location.name, mappingStatus: "mapped" }
    : { locationId: null, locationName: null, mappingStatus: "unmapped" };
}

export function receiptControlLocationUpdate(
  analysis: Pick<OnlinePosReceiptControlAnalysis, "cashRegisterId" | "cashRegisterName" | "transactionDatetime">,
  context: ReceiptControlLocationContext,
) {
  const update: Record<string, string | null> = {};
  if (analysis.cashRegisterId) update.cash_register_id = analysis.cashRegisterId;
  if (analysis.cashRegisterName) update.cash_register_name = analysis.cashRegisterName;
  if (analysis.transactionDatetime) update.transaction_datetime = analysis.transactionDatetime;
  if (context.mappingStatus === "mapped" && context.locationId && context.locationName) {
    update.location_id = context.locationId;
    update.location_name = context.locationName;
    update.location_mapping_status = "mapped";
  }
  return update;
}

async function notifyFinanceAboutReturn(supabase: SupabaseClient, returnId: string, parsedReturn: ParsedOnlinePosReturn, locationName: string | null) {
  const members = await getFinanceMembers(supabase);
  if (members.length === 0) return;

  const title = buildReturnNotificationTitle(locationName ?? parsedReturn.cashRegisterName ?? "Ukendt sted");
  const body = buildReturnNotificationText(parsedReturn);
  const targetUrl = "/retur/" + returnId;

  for (const member of members) {
    try {
      await dispatchReturnNotification(supabase, {
        returnId,
        member,
        dedupeKey: buildReturnNotificationDedupeKey(returnId, "finance", member.id),
        notificationType: "return_created_finance",
        title,
        body,
        targetUrl,
      });
    } catch {
      // Notifikationer må aldrig blokere returregistreringen.
    }
  }
}

async function notifyOwnersAboutReturnControl(supabase: SupabaseClient, returnId: string, parsedReturn: ParsedOnlinePosReturn, reasons: string[]) {
  const seriousReasons = getSeriousReturnControlReasons(reasons);
  if (seriousReasons.length === 0) return;

  const owners = await getOwnerMembers(supabase);
  if (owners.length === 0) return;

  const title = "Retur kræver ejerkontrol";
  const bonText = parsedReturn.receiptNumber ? "Bon " + parsedReturn.receiptNumber : "Bon mangler";
  const body = bonText + " · " + seriousReasons.slice(0, 3).join(" · ");
  const targetUrl = "/retur/" + returnId;

  for (const owner of owners) {
    try {
      await dispatchReturnNotification(supabase, {
        returnId,
        member: owner,
        dedupeKey: buildReturnNotificationDedupeKey(returnId, "owner-control", owner.id),
        notificationType: "return_control_owner",
        title,
        body,
        targetUrl,
      });
    } catch {
      // Ejerbesked må ikke blokere returregistreringen.
    }
  }
}

async function dispatchReturnNotification(
  supabase: SupabaseClient,
  input: {
    returnId: string;
    member: ReturnNotificationRecipient;
    dedupeKey: string;
    notificationType: string;
    title: string;
    body: string;
    targetUrl: string;
  },
) {
  const claim = await claimReturnNotification(supabase, input);
  if (!claim) return;

  let messageId: string | null = null;
  try {
    const message = await createPushMessage(supabase, {
      recipientUserId: input.member.id,
      recipientEmail: input.member.email,
      senderName: "BackEvent",
      title: input.title,
      body: input.body,
      targetUrl: input.targetUrl,
      category: "group",
    });
    messageId = message.id;
    await updateReturnNotification(supabase, claim.id, { push_message_id: message.id });
  } catch (error) {
    await updateReturnNotification(supabase, claim.id, { status: "failed", error_message: `Indbakke kunne ikke oprettes: ${safeErrorMessage(error)}` });
    await createReturnPushLog(supabase, input.member, input.title, input.body, "failed", `Indbakke kunne ikke oprettes: ${safeErrorMessage(error)}`);
    return;
  }

  if (!isWebPushConfigured()) {
    await updateReturnNotification(supabase, claim.id, { status: "skipped", error_message: "Push er ikke konfigureret" });
    await createReturnPushLog(supabase, input.member, input.title, input.body, "skipped", "Push er ikke konfigureret");
    return;
  }

  webPush.setVapidDetails(process.env.WEB_PUSH_SUBJECT!, getPublicVapidKey()!, process.env.WEB_PUSH_PRIVATE_KEY!);

  const { data: subscriptions } = await supabase
    .from("backevent_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", input.member.id)
    .eq("active", true);

  if (!subscriptions?.length) {
    await updateReturnNotification(supabase, claim.id, { status: "skipped", error_message: "Ingen aktiv push-enhed" });
    await createReturnPushLog(supabase, input.member, input.title, input.body, "skipped", "Ingen aktiv push-enhed");
    return;
  }

  let sentCount = 0;
  let failedCount = 0;
  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(
        {
          endpoint: String(subscription.endpoint),
          keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth) },
        },
        JSON.stringify(pushPayload({ title: input.title, body: input.body, messageId, url: input.targetUrl })),
      );
      sentCount += 1;
      await createReturnPushLog(supabase, input.member, input.title, input.body, "sent", null);
    } catch (error) {
      failedCount += 1;
      const errorMessage = safeErrorMessage(error);
      if (isExpiredSubscription(error)) {
        await supabase.from("backevent_push_subscriptions").update({ active: false }).eq("id", subscription.id);
      }
      await createReturnPushLog(supabase, input.member, input.title, input.body, "failed", errorMessage);
    }
  }

  if (sentCount > 0) {
    await updateReturnNotification(supabase, claim.id, { status: "sent", error_message: failedCount > 0 ? `${failedCount} push fejlede` : null });
  } else {
    await updateReturnNotification(supabase, claim.id, { status: "failed", error_message: "Alle push-forsøg fejlede" });
  }
}

async function dispatchReceiptControlNotification(
  supabase: SupabaseClient,
  input: {
    receiptControlId: string;
    member: ReturnNotificationRecipient;
    dedupeKey: string;
    title: string;
    body: string;
    targetUrl: string;
  },
) {
  const claim = await claimReceiptControlNotification(supabase, input);
  if (!claim) return;

  let messageId: string | null = null;
  try {
    const message = await createPushMessage(supabase, {
      recipientUserId: input.member.id,
      recipientEmail: input.member.email,
      senderName: "BackEvent",
      title: input.title,
      body: input.body,
      targetUrl: input.targetUrl,
      category: "group",
    });
    messageId = message.id;
    await updateReceiptControlNotification(supabase, claim.id, { push_message_id: message.id });
  } catch (error) {
    const message = `Indbakke kunne ikke oprettes: ${safeErrorMessage(error)}`;
    await updateReceiptControlNotification(supabase, claim.id, { status: "failed", error_message: message });
    await createReturnPushLog(supabase, input.member, input.title, input.body, "failed", message);
    return;
  }

  if (!isWebPushConfigured()) {
    await updateReceiptControlNotification(supabase, claim.id, { status: "skipped", error_message: "Push er ikke konfigureret" });
    await createReturnPushLog(supabase, input.member, input.title, input.body, "skipped", "Push er ikke konfigureret");
    return;
  }

  webPush.setVapidDetails(process.env.WEB_PUSH_SUBJECT!, getPublicVapidKey()!, process.env.WEB_PUSH_PRIVATE_KEY!);
  const { data: subscriptions } = await supabase
    .from("backevent_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", input.member.id)
    .eq("active", true);

  if (!subscriptions?.length) {
    await updateReceiptControlNotification(supabase, claim.id, { status: "skipped", error_message: "Ingen aktiv push-enhed" });
    await createReturnPushLog(supabase, input.member, input.title, input.body, "skipped", "Ingen aktiv push-enhed");
    return;
  }

  let sentCount = 0;
  let failedCount = 0;
  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(
        {
          endpoint: String(subscription.endpoint),
          keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth) },
        },
        JSON.stringify(pushPayload({ title: input.title, body: input.body, messageId, url: input.targetUrl })),
      );
      sentCount += 1;
      await createReturnPushLog(supabase, input.member, input.title, input.body, "sent", null);
    } catch (error) {
      failedCount += 1;
      const errorMessage = safeErrorMessage(error);
      if (isExpiredSubscription(error)) {
        await supabase.from("backevent_push_subscriptions").update({ active: false }).eq("id", subscription.id);
      }
      await createReturnPushLog(supabase, input.member, input.title, input.body, "failed", errorMessage);
    }
  }

  await updateReceiptControlNotification(supabase, claim.id, sentCount > 0
    ? { status: "sent", error_message: failedCount > 0 ? `${failedCount} push fejlede` : null }
    : { status: "failed", error_message: "Alle push-forsøg fejlede" });
}

async function claimReceiptControlNotification(
  supabase: SupabaseClient,
  input: { receiptControlId: string; member: ReturnNotificationRecipient; dedupeKey: string },
) {
  const { data, error } = await supabase
    .from("backevent_onlinepos_receipt_control_notifications")
    .insert({
      receipt_control_id: input.receiptControlId,
      recipient_user_id: input.member.id,
      dedupe_key: input.dedupeKey,
      status: "pending",
    })
    .select("id")
    .single();
  if (!error) return { id: String(data.id) };
  if (isUniqueViolation(error)) return null;
  throw error;
}

async function updateReceiptControlNotification(supabase: SupabaseClient, id: string, patch: Record<string, unknown>) {
  await supabase.from("backevent_onlinepos_receipt_control_notifications").update(patch).eq("id", id);
}

async function claimReturnNotification(
  supabase: SupabaseClient,
  input: { returnId: string; member: ReturnNotificationRecipient; dedupeKey: string; notificationType: string },
) {
  const { data, error } = await supabase
    .from("backevent_return_notifications")
    .insert({
      return_id: input.returnId,
      recipient_user_id: input.member.id,
      dedupe_key: input.dedupeKey,
      notification_type: input.notificationType,
      status: "pending",
    })
    .select("id")
    .single();

  if (!error) return { id: String(data.id) };
  if (isUniqueViolation(error)) return null;
  throw error;
}

async function updateReturnNotification(supabase: SupabaseClient, notificationId: string, patch: Record<string, unknown>) {
  await supabase.from("backevent_return_notifications").update(patch).eq("id", notificationId);
}

async function createReturnPushLog(
  supabase: SupabaseClient,
  member: ReturnNotificationRecipient,
  title: string,
  body: string,
  status: "sent" | "failed" | "skipped",
  errorMessage: string | null,
) {
  await supabase.from("backevent_push_logs").insert({
    recipient_user_id: member.id,
    recipient_email: member.email,
    title,
    body,
    status,
    error_message: errorMessage,
  });
}

export function buildReturnNotificationTitle(locationName: string) {
  return `Retur – ${locationName}`;
}

export function buildReturnNotificationDedupeKey(returnId: string, scope: "finance" | "owner-control", userId: string) {
  return `return:${scope}:${returnId}:${userId}`;
}

export function buildReceiptControlNotificationDedupeKey(receiptKey: string, userId: string) {
  return `${receiptKey}:finance-notification:${userId}`;
}

export function buildReceiptControlNotificationText(
  analysis: OnlinePosReceiptControlAnalysis,
  locationContext?: ReceiptControlLocationContext,
) {
  const reasons: string[] = [];
  if (analysis.controlTypes.includes("RETURN_RECEIPT")) reasons.push("Egentlig returbon");
  if (analysis.controlTypes.includes("HIGH_DEPOSIT_RETURN")) {
    reasons.push(
      `${formatControlNumber(analysis.depositReturnQuantity)} pant-enheder ` +
      `(krus ${formatControlNumber(analysis.depositBreakdown.cups)}, kander ${formatControlNumber(analysis.depositBreakdown.pitchers)})`,
    );
  }
  if (analysis.controlTypes.includes("NEGATIVE_RECEIPT_TOTAL")) {
    reasons.push(`Negativ total ${formatControlMoney(analysis.finalTotalIncludingVat)}`);
  }
  if (analysis.controlTypes.includes("MANUAL_REVIEW")) reasons.push("Kræver manuel kontrol");
  return [
    `Bon: ${analysis.receiptNumber ?? analysis.transactionId ?? "Mangler"}`,
    receiptControlNotificationLocation(analysis, locationContext),
    ...reasons.map((reason) => `Årsag: ${reason}`),
    `Køb inkl. moms: ${formatControlMoney(analysis.purchaseValueIncludingVat)}`,
    `Pantretur inkl. moms: ${formatControlMoney(analysis.depositReturnValueIncludingVat)}`,
    `Sluttotal inkl. moms: ${formatControlMoney(analysis.finalTotalIncludingVat)}`,
  ].join("\n");
}

function receiptControlNotificationLocation(
  analysis: Pick<OnlinePosReceiptControlAnalysis, "cashRegisterId" | "cashRegisterName">,
  locationContext?: ReceiptControlLocationContext,
) {
  if (locationContext?.mappingStatus === "mapped" && locationContext.locationName) {
    return `Bar: ${locationContext.locationName}`;
  }
  const onlinePosReference = analysis.cashRegisterName ?? analysis.cashRegisterId;
  return onlinePosReference ? `Bar: ${onlinePosReference} · Ikke mappet` : "Bar: Ukendt · Ikke mappet";
}

function formatControlMoney(value: number) {
  return `${value.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;
}

function formatControlNumber(value: number) {
  return value.toLocaleString("da-DK", { maximumFractionDigits: 3 });
}

export function getSeriousReturnControlReasons(reasons: string[]) {
  return uniqueJson(reasons.filter(isSeriousReturnControlReason));
}

export function isSeriousReturnControlReason(reason: string) {
  const normalized = reason.toLocaleLowerCase("da-DK");
  return normalized.includes("dublet med ændret indhold")
    || normalized.includes("idempotens")
    || normalized.includes("stock_source_missing")
    || normalized.includes("produkt findes ikke")
    || normalized.includes("mangler godkendt mapping")
    || normalized.includes("produkt mangler returbehandling")
    || normalized.includes("lagerbehandling fejler")
    || normalized.includes("returlinjer kunne ikke registreres")
    || normalized.includes("quantity overstiger")
    || normalized.includes("parser")
    || normalized.includes("datakonflikt");
}
async function getFinanceMembers(supabase: SupabaseClient): Promise<Array<{ id: string; email: string | null }>> {
  const { data } = await supabase
    .from("backevent_member_group_members")
    .select("profile_id, backevent_member_groups!inner(name,active), backevent_profiles!inner(id,email,active)")
    .eq("backevent_member_groups.active", true)
    .eq("backevent_profiles.active", true)
    .ilike("backevent_member_groups.name", "Økonomiansvarlige");

  return (data ?? []).map((row) => {
    const profile = row.backevent_profiles as { id?: string; email?: string | null } | null;
    return { id: String(profile?.id ?? row.profile_id), email: profile?.email ?? null };
  }).filter((member, index, all) => member.id && all.findIndex((item) => item.id === member.id) === index);
}

async function getOwnerMembers(supabase: SupabaseClient): Promise<Array<{ id: string; email: string | null }>> {
  const { data } = await supabase
    .from("backevent_profiles")
    .select("id,email,active,role")
    .eq("active", true)
    .eq("role", "ejer");

  return (data ?? []).map((row) => ({ id: String(row.id), email: row.email ?? null }));
}

export function buildReturnNotificationText(parsedReturn: Pick<ParsedOnlinePosReturn, "onlineposReturnedAt" | "receiptNumber">) {
  return [
    `Tid: ${formatNotificationTime(parsedReturn.onlineposReturnedAt)}`,
    `Bon: ${parsedReturn.receiptNumber ?? "Mangler"}`,
  ].join("\n");
}

function formatNotificationTime(value: string | null) {
  if (!value) return "Mangler";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Mangler";
  const datePart = new Intl.DateTimeFormat("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("da-DK", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(".", ":");
  return `${datePart} kl. ${timePart}`;
}

async function findExistingReturn(supabase: SupabaseClient, externalIdempotencyKey: string) {
  const { data, error } = await supabase
    .from("backevent_returns")
    .select("id,content_hash,processing_status,control_reasons")
    .eq("external_idempotency_key", externalIdempotencyKey)
    .maybeSingle();
  if (error) throw new Error("Retur kunne ikke kontrolleres for dublet");
  return data as { id: string; content_hash: string | null; processing_status: string; control_reasons: unknown } | null;
}

function findMapping(line: ParsedOnlinePosReturnLine, mappings: OnlinePosInventoryMapping[]) {
  const productId = normalizeOnlinePosId(line.onlineposProductId);
  if (productId) {
    return mappings.find((mapping) => normalizeOnlinePosId(mapping.onlineposProductId) === productId) ?? null;
  }
  const productName = normalizeName(line.productDescription);
  return mappings.find((mapping) => !normalizeOnlinePosId(mapping.onlineposProductId) && normalizeName(mapping.onlineposProductName) === productName) ?? null;
}

async function createPushMessage(supabase: SupabaseClient, input: {
  recipientUserId: string;
  recipientEmail?: string | null;
  senderName?: string | null;
  title: string;
  body: string;
  targetUrl: string;
  category: "group" | "inventory_alert" | "general" | "test";
}) {
  const id = crypto.randomUUID();
  const { error } = await supabase.from("backevent_push_messages").insert({
    id,
    recipient_user_id: input.recipientUserId,
    recipient_email: input.recipientEmail ?? null,
    sender_name: input.senderName ?? null,
    title: input.title,
    body: input.body,
    target_url: input.targetUrl,
    category: input.category,
  });

  if (error) throw error;
  return { id, targetUrl: input.targetUrl };
}

function buildMessageUrl(messageId: string | null | undefined) {
  return messageId ? `/notifikationer/${messageId}` : "/notifikationer";
}

function pushPayload(input: { title: string; body: string; messageId?: string | null; url?: string | null }) {
  return {
    title: input.title,
    body: input.body,
    messageId: input.messageId ?? null,
    url: input.url ?? buildMessageUrl(input.messageId),
  };
}

function classifyOnlinePosLine(productName: string | null, productGroupName: string | null) {
  const name = (productName ?? "").toLocaleUpperCase("da-DK");
  const groupUpper = (productGroupName ?? "").trim().toLocaleUpperCase("da-DK");

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

  if (name.includes("PANT") || groupUpper === "PANT") {
    return { lineType: "deposit_return", inventoryRelevant: false, needsMapping: false };
  }

  if (["DRINKS", "SODAVAND"].includes(groupUpper)) {
    return { lineType: "container_product", inventoryRelevant: false, needsMapping: true };
  }

  return { lineType: "stock_item", inventoryRelevant: true, needsMapping: true };
}

function normalizeEconomicDirection(value: string | null): ReturnEconomicDirection | null {
  if (value === "refund" || value === "charge" || value === "neutral") return value;
  return null;
}

function inferReturnEconomicDirection(lineType: string, lineAmount: number): ReturnEconomicDirection {
  if (lineType === "deposit_fee") return "charge";
  if (lineType === "modifier_stock_item" && Math.abs(lineAmount) === 0) return "neutral";
  return "refund";
}

function summarizeReturnEconomy(lines: ParsedOnlinePosReturnLine[]) {
  return lines.reduce(
    (summary, line) => {
      const absolute = Math.abs(line.lineAmount);
      if (line.economicDirection === "charge") summary.charges += absolute;
      if (line.economicDirection === "refund") summary.refunds += absolute;
      if (line.lineType === "stock_item" || line.lineType === "container_product" || line.lineType === "modifier_stock_item") {
        if (line.lineAmount < 0) summary.productRefund += absolute;
      } else if (line.lineType === "deposit_return") {
        if (line.lineAmount < 0) summary.depositRefund += absolute;
      } else if (line.lineType === "deposit_fee") {
        if (line.lineAmount > 0) summary.fees += absolute;
      }
      summary.netAmount = roundNumber(summary.netAmount + line.lineAmount);
      return summary;
    },
    { productRefund: 0, depositRefund: 0, cupRefund: 0, fees: 0, charges: 0, refunds: 0, netAmount: 0 },
  );
}

function normalizeReturnComponents(mapping: OnlinePosInventoryMapping | null) {
  if (!mapping) return [];
  if (mapping.components.length > 0) return mapping.components;
  if (mapping.backeventInventoryItemId && mapping.conversionFactor !== null) {
    return [{ backeventInventoryItemId: mapping.backeventInventoryItemId, conversionFactor: mapping.conversionFactor }];
  }
  return [];
}

function toReturnLine(line: Record<string, unknown>, transactionId: string | null, receiptNumber: string | null, lineIndex: number): ParsedOnlinePosReturnLine {
  const productDescription = stringOrNull(pickField(line, ["product_name", "productName", "productname", "name", "receipt_text", "receiptText"])) ?? "Ukendt vare";
  const productGroupName = stringOrNull(pickField(line, ["product_group_name", "productGroupName", "productgroupname"]));
  const quantity = Math.abs(numberValue(pickField(line, ["quantity", "qty", "count", "amount"])) ?? 0);
  const lineAmount = getOnlinePosGrossAmount(line);
  const classification = classifyOnlinePosLine(productDescription, productGroupName);
  const normalizedName = productDescription.toLocaleUpperCase("da-DK");
  const isCup = normalizedName.includes("KRUS") || normalizedName.includes("KANDE");
  const isFee = normalizedName.includes("GEBYR");
  const isDeposit = classification.lineType === "deposit_fee" || classification.lineType === "deposit_return" || isCup || isFee;
  const lineId = stringOrNull(pickField(line, ["line_id", "lineId", "orderlineid", "id"]));
  const parentOnlineposLineId = stringOrNull(pickField(line, ["parent_line_id", "parentLineId", "parent_id", "parentId"]));
  const inputUnit = stringOrNull(pickField(line, ["input_unit", "inputUnit", "unit"]));
  const economicDirection = normalizeEconomicDirection(stringOrNull(pickField(line, ["economic_direction", "economicDirection"]))) ?? inferReturnEconomicDirection(classification.lineType, lineAmount);
  const onlineposProductId = stringOrNull(pickField(line, ["product_id", "productId", "productid"]));
  const externalReturnLineId = [
    "return-line",
    transactionId ?? receiptNumber ?? "transaction",
    lineId ?? `line-${lineIndex}`,
    onlineposProductId ?? normalizeName(productDescription),
    quantity,
    Math.abs(roundNumber(lineAmount)),
  ].join(":");

  return {
    onlineposLineId: lineId,
    externalReturnLineId,
    onlineposProductId,
    productDescription,
    productGroupName,
    returnedQuantity: roundNumber(quantity),
    inputUnit,
    parentOnlineposLineId,
    unitPrice: quantity > 0 ? roundNumber(lineAmount / quantity) : null,
    lineAmount: roundNumber(lineAmount),
    economicDirection,
    lineType: classification.lineType,
    isDeposit,
    isCup,
    isFee,
  };
}

function hasReturnSignal(transaction: Record<string, unknown>) {
  const analysis = analyzeRawOnlinePosReceipt(transaction);
  return {
    isReturn: analysis.classification === "return_receipt",
    weak: false,
    reasons: [] as string[],
  };
}

function parseTransactions(text: string): { transactions: Record<string, unknown>[]; pagination: ReturnPagination } {
  try {
    const json = JSON.parse(text) as unknown;
    return { transactions: findTransactions(json), pagination: findPagination(json) };
  } catch {
    return { transactions: [], pagination: emptyPagination() };
  }
}

function findTransactions(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    const data = value.data;
    if (Array.isArray(data)) return data.filter(isRecord);
  }
  return [];
}

function findTransactionLines(transaction: Record<string, unknown>): Record<string, unknown>[] {
  const lines = pickField(transaction, ["lines", "transaction_lines", "transactionLines", "orderlines"]);
  return Array.isArray(lines) ? lines.filter(isRecord) : [];
}

function findPagination(value: unknown) {
  if (!isRecord(value) || !isRecord(value.pagination)) return emptyPagination();
  return {
    total: stringOrNumber(value.pagination.total),
    per_page: stringOrNumber(value.pagination.per_page),
    current_page: stringOrNumber(value.pagination.current_page),
    last_page: stringOrNumber(value.pagination.last_page),
  };
}

function emptyPagination(): ReturnPagination {
  return { total: null, per_page: null, current_page: null, last_page: null };
}

function hasMorePages(pagination: ReturnPagination) {
  const current = numberValue(pagination.current_page);
  const last = numberValue(pagination.last_page);
  if (current !== null && last !== null) return current < last;

  const total = numberValue(pagination.total);
  const perPage = numberValue(pagination.per_page);
  if (total !== null && perPage !== null && perPage > 0 && current !== null) {
    return current < Math.ceil(total / perPage);
  }

  return false;
}

function nextPageNumber(pagination: ReturnPagination, fallbackCurrentPage: number) {
  const current = numberValue(pagination.current_page) ?? fallbackCurrentPage;
  return current + 1;
}

function transactionKey(transaction: Record<string, unknown>) {
  const transactionId = stringOrNull(pickField(transaction, ["transaction_id", "transactionId", "id"]));
  const receiptNumber = stringOrNull(pickField(transaction, ["receipt_number", "receiptNumber"]));
  const datetime = stringOrNull(pickField(transaction, ["datetime", "created_at", "createdAt"]));
  return [transactionId ?? "tx", receiptNumber ?? "receipt", datetime ?? stableHash(transaction)].join(":");
}

function toSafeCashRegister(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    id: stringOrNull(value.id),
    name: stringOrNull(value.name),
  };
}

function parseAccessToken(text: string) {
  try {
    const json = JSON.parse(text) as TokenResponse;
    return typeof json.access_token === "string" ? json.access_token : null;
  } catch {
    return null;
  }
}

function pickField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return null;
}

function stringOrNull(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNumber(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function normalizeOnlinePosId(value: string | null | undefined) {
  return value ? String(value).trim() : "";
}

function normalizeName(value: string | null | undefined) {
  return value ? value.trim().toLocaleLowerCase("da-DK") : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueJson(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stableHash(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16);
}

function roundNumber(value: number) {
  return Math.round(value * 10000) / 10000;
}

function isWebPushConfigured() {
  return Boolean(getPublicVapidKey() && process.env.WEB_PUSH_PRIVATE_KEY && process.env.WEB_PUSH_SUBJECT);
}

function getPublicVapidKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
}

function isExpiredSubscription(error: unknown) {
  return isRecord(error) && (error.statusCode === 404 || error.statusCode === 410);
}

function isUniqueViolation(error: unknown) {
  return isRecord(error) && error.code === "23505";
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ukendt fejl";
}
