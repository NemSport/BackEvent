import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildReplayWindows,
  isOnlinePosReplayEnabled,
  productionExternalLineId,
  replayExternalLineId,
  validateCleanupConfirmation,
  validateReplayConfirmation,
  type ReplayMode,
} from "./historical-replay-core";
import {
  buildSyncDecisions,
  fetchOnlinePosTransactionLines,
  getInventoryMappings,
  getLocations,
  getProducts,
  type OnlinePosSyncDecision,
  type OnlinePosTransactionLine,
} from "./inventory-sync";
import { getOnlinePosLocationMappings, recordOnlinePosLocationDiscoveries } from "./location-mappings";

export {
  buildReplayWindows,
  isOnlinePosReplayEnabled,
  productionExternalLineId,
  replayExternalLineId,
  validateCleanupConfirmation,
  validateReplayConfirmation,
};

export type { ReplayMode } from "./historical-replay-core";

export type HistoricalReplayInput = {
  date: string;
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  overlapMinutes: number;
  venue?: string | null;
  cashRegister?: string | null;
  mode: ReplayMode;
  replayRunId: string;
};

export async function runHistoricalReplayDryRun({
  supabase,
  input,
}: {
  supabase: SupabaseClient;
  input: HistoricalReplayInput;
}) {
  const windows = buildReplayWindows(input);
  const [mappings, products, locations, locationMappings] = await Promise.all([
    getInventoryMappings(supabase),
    getProducts(supabase),
    getLocations(supabase),
    getOnlinePosLocationMappings(supabase),
  ]);
  const seenProductionLineIds = new Set<string>();
  const seenTransactionIds = new Set<string>();
  const totals = emptyTotals();
  const windowResults = [];
  const allErrorDetails: ReplayErrorDetail[] = [];
  const allReturnAudits: ReplayReturnAudit[] = [];
  const allModifierAudits: ReplayModifierAudit[] = [];
  const allStockPreview: ReplayStockPreviewLine[] = [];
  const duplicateDetails: ReplayDuplicateDetail[] = [];
  const locationDiscoveries = [];

  for (const window of windows) {
    const fetched = await fetchOnlinePosTransactionLines({ datetimeFrom: window.fetchFrom, datetimeTo: window.fetchTo, venue: input.venue });
    const filteredLines = input.cashRegister
      ? fetched.lines.filter((line) => line.cashRegisterId === input.cashRegister || line.cashRegisterName === input.cashRegister)
      : fetched.lines;
    const decisions = buildSyncDecisions(filteredLines, mappings, products, locations, locationMappings);
    locationDiscoveries.push(...filteredLines.map((line) => ({
      venueId: input.venue ?? null,
      cashRegisterId: line.cashRegisterId,
      cashRegisterName: line.cashRegisterName,
      seenAt: line.transactionDatetime,
    })));
    const uniqueDecisions: OnlinePosSyncDecision[] = [];
    let duplicateCount = 0;
    const windowDuplicateDetails: ReplayDuplicateDetail[] = [];

    for (const decision of decisions) {
      const line = filteredLines.find((item) => productionExternalLineId(item) === decision.externalLineId);
      const productionId = line ? productionExternalLineId(line) : decision.externalLineId;
      if (seenProductionLineIds.has(productionId)) {
        duplicateCount += 1;
        const detail = {
          replayWindow: window.label,
          key: productionId,
          transactionId: decision.transactionId,
          receiptNumber: decision.receiptNumber,
          lineId: decision.lineId,
          productName: decision.onlineposProductName,
          ignored: true,
        };
        duplicateDetails.push(detail);
        windowDuplicateDetails.push(detail);
        continue;
      }
      seenProductionLineIds.add(productionId);
      uniqueDecisions.push({
        ...decision,
        externalLineId: `historical-replay:${input.replayRunId}:${decision.externalLineId}`,
      });
    }

    for (const line of filteredLines) {
      if (line.transactionId) seenTransactionIds.add(line.transactionId);
    }

    const summary = summarizeDecisions(uniqueDecisions, duplicateCount);
    const errorDetails = buildErrorDetails(window.label, uniqueDecisions, filteredLines);
    const returnAudits = buildReturnAudits(window.label, filteredLines);
    const modifierAudits = buildModifierAudits(window.label, filteredLines, uniqueDecisions);
    const stockPreview = buildStockPreview(window.label, uniqueDecisions, products, locations);
    allErrorDetails.push(...errorDetails);
    allReturnAudits.push(...returnAudits);
    allModifierAudits.push(...modifierAudits);
    allStockPreview.push(...stockPreview);
    addTotals(totals, summary);
    windowResults.push({
      ...window,
      apiPages: Number(fetched.pagination.fetched_pages ?? fetched.pagination.current_page ?? 1),
      transactionCount: new Set(filteredLines.map((line) => line.transactionId ?? line.receiptNumber ?? `${line.lineIndex}`)).size,
      salesLineCount: filteredLines.length,
      returnTransactionCount: countReturnTransactions(filteredLines),
      ...summary,
      cashRegisters: distinct(filteredLines.map((line) => line.cashRegisterName ?? line.cashRegisterId).filter(Boolean) as string[]),
      unmappedProducts: distinct(uniqueDecisions.filter((line) => line.errorReason === "Mangler godkendt mapping").map((line) => line.onlineposProductName ?? "Ukendt vare")),
      unmappedLocations: distinct(uniqueDecisions.filter((line) => line.errorReason === "OnlinePOS-kasse mangler lokationsmapping" || line.errorReason === "OnlinePOS-lokationsmapping er inaktiv" || line.errorReason === "Ukendt BackEvent-lokation" || line.errorReason === "Bar mangler lagerkilde").map((line) => line.cashRegisterName ?? "Ukendt sted")),
      modifiers: uniqueDecisions.filter((line) => line.lineType === "modifier_stock_item").length,
      deposits: uniqueDecisions.filter((line) => line.lineType === "deposit_fee" || line.lineType === "deposit_return").length,
      expectedStockChanges: groupStockChanges(uniqueDecisions),
      controlErrors: uniqueDecisions.filter((line) => line.status === "failed" || line.errorReason === "Mangler godkendt mapping").map((line) => line.errorReason ?? "Fejl"),
      errorSummary: groupErrors(errorDetails),
      errorDetails: errorDetails.slice(0, 100),
      returnAudits,
      modifierAudits,
      stockPreview: stockPreview.slice(0, 100),
      duplicateDetails: windowDuplicateDetails.slice(0, 50),
    });
  }

  const unmappedProducts = summarizeUnmappedProducts(allErrorDetails, allModifierAudits, products);
  const returnSummary = summarizeReturns(allReturnAudits);
  await recordOnlinePosLocationDiscoveries(supabase, locationDiscoveries);
  return {
    ok: true,
    mode: input.mode,
    replayRunId: input.replayRunId,
    windows: windowResults,
    totals: {
      ...totals,
      uniqueLineCount: seenProductionLineIds.size,
      uniqueTransactionCount: seenTransactionIds.size,
      errorCount: allErrorDetails.length,
      returnCount: allReturnAudits.length,
      uncertainReturnCount: allReturnAudits.filter((item) => item.classification === "Usikker retur").length,
      modifierAuditCount: allModifierAudits.length,
      stockPreviewCount: allStockPreview.length,
    },
    errorSummary: groupErrors(allErrorDetails),
    errorDetails: allErrorDetails.slice(0, 500),
    returns: allReturnAudits.slice(0, 200),
    returnSummary,
    modifierAudit: allModifierAudits.slice(0, 300),
    unmappedProducts,
    stockPreview: allStockPreview.slice(0, 500),
    duplicateDetails: duplicateDetails.slice(0, 300),
    safety: {
      mode: "dry-run",
      writesStock: false,
      writesSyncLines: false,
      sendsPush: false,
      createsNotifications: false,
      changesMappings: false,
      updatesLocationDiscovery: true,
      changesReturnStatus: false,
      testRunEnabled: false,
    },
  };
}

type ReplayErrorCode =
  | "LOCATION_MAPPING_MISSING"
  | "PRODUCT_MAPPING_MISSING"
  | "RETURN_DETECTION_UNCERTAIN"
  | "UNIT_CONVERSION_FAILED"
  | "MODIFIER_MAPPING_FAILED"
  | "TRANSACTION_PARSE_FAILED"
  | "LINE_PARSE_FAILED"
  | "AMOUNT_MISMATCH"
  | "OTHER";

type ReplayErrorDetail = {
  replayWindow: string;
  transactionId: string | null;
  receiptNumber: string | null;
  datetime: string | null;
  cashRegister: string | null;
  lineId: string | null;
  onlineposProductId: string | null;
  productName: string | null;
  quantity: number;
  amount: number;
  errorCode: ReplayErrorCode;
  message: string;
};

type ReplayReturnAudit = {
  replayWindow: string;
  transactionId: string | null;
  receiptNumber: string | null;
  datetime: string | null;
  cashRegister: string | null;
  total: number | null;
  type: string | null;
  status: string | null;
  returnId: string | null;
  refundId: string | null;
  negativeLines: number;
  signals: string[];
  classification: "Verificeret retur" | "Sandsynlig retur" | "Usikker retur";
};

type ReplayModifierAudit = {
  replayWindow: string;
  transactionId: string | null;
  receiptNumber: string | null;
  parentLineId: string | null;
  lineId: string | null;
  productName: string | null;
  productGroupName: string | null;
  quantity: number;
  amount: number;
  isModifier: boolean;
  isZeroPrice: boolean;
  economyProduct: string | null;
  stockProduct: string | null;
  stockRelevant: boolean;
  decision: string;
};

type ReplayStockPreviewLine = {
  replayWindow: string;
  locationId: string;
  locationName: string;
  backeventProductId: string;
  backeventProductName: string;
  onlineposProductId: string | null;
  onlineposProductName: string | null;
  transactionId: string | null;
  lineId: string | null;
  quantity: number;
  quantityText: string;
  internalQuantity: number;
  mappingId: string | null;
  decision: "Klar";
};

type ReplayDuplicateDetail = {
  replayWindow: string;
  key: string;
  transactionId: string | null;
  receiptNumber: string | null;
  lineId: string | null;
  productName: string | null;
  ignored: boolean;
};

function summarizeDecisions(decisions: OnlinePosSyncDecision[], duplicateCount: number) {
  return {
    processedCount: decisions.filter((line) => line.status === "processed").length,
    ignoredCount: decisions.filter((line) => line.status === "ignored").length,
    failedCount: decisions.filter((line) => line.status === "failed").length,
    missingMappingCount: decisions.filter((line) => line.errorReason === "Mangler godkendt mapping").length,
    duplicateCount,
    expectedStockDelta: decisions.reduce((sum, line) => sum + Math.abs(line.stockDelta), 0),
  };
}

export function mapReplayErrorCode(decision: Pick<OnlinePosSyncDecision, "errorReason" | "lineType">): ReplayErrorCode | null {
  const reason = decision.errorReason ?? "";
  if (!reason) return null;
  if (reason.includes("lokationsmapping") || reason.includes("BackEvent-lokation") || reason.includes("lagerkilde")) return "LOCATION_MAPPING_MISSING";
  if (reason === "Mangler godkendt mapping" && decision.lineType === "modifier_stock_item") return "MODIFIER_MAPPING_FAILED";
  if (reason === "Mangler godkendt mapping") return "PRODUCT_MAPPING_MISSING";
  if (reason.includes("lagerkomponenter") || reason.includes("konverter")) return "UNIT_CONVERSION_FAILED";
  return "OTHER";
}

export function classifyReplayReturn(lines: OnlinePosTransactionLine[]): ReplayReturnAudit["classification"] | null {
  const signals = getReturnSignals(lines);
  if (signals.length === 0) return null;
  if (signals.includes("explicit_refund_type") || signals.includes("return_id_present") || signals.includes("refund_id_present")) {
    return "Verificeret retur";
  }
  if (signals.includes("negative_total_and_lines")) return "Sandsynlig retur";
  return "Usikker retur";
}

function buildErrorDetails(replayWindow: string, decisions: OnlinePosSyncDecision[], lines: OnlinePosTransactionLine[]) {
  const details: ReplayErrorDetail[] = [];
  const linesByKey = new Map(lines.map((line) => [productionExternalLineId(line), line]));
  for (const decision of decisions) {
    const code = mapReplayErrorCode(decision);
    if (!code) continue;
    const line = linesByKey.get(decision.externalLineId);
    details.push({
      replayWindow,
      transactionId: decision.transactionId,
      receiptNumber: decision.receiptNumber,
      datetime: line?.transactionDatetime ?? null,
      cashRegister: decision.cashRegisterName ?? decision.cashRegisterId,
      lineId: decision.lineId,
      onlineposProductId: decision.onlineposProductId,
      productName: decision.onlineposProductName,
      quantity: decision.quantitySold,
      amount: decision.revenue,
      errorCode: code,
      message: readableReplayError(code, decision.errorReason),
    });
  }

  for (const audit of buildReturnAudits(replayWindow, lines)) {
    if (audit.classification !== "Usikker retur") continue;
    details.push({
      replayWindow,
      transactionId: audit.transactionId,
      receiptNumber: audit.receiptNumber,
      datetime: audit.datetime,
      cashRegister: audit.cashRegister,
      lineId: null,
      onlineposProductId: null,
      productName: null,
      quantity: 0,
      amount: audit.total ?? 0,
      errorCode: "RETURN_DETECTION_UNCERTAIN",
      message: "Returklassifikation er usikker",
    });
  }
  return details;
}

function buildReturnAudits(replayWindow: string, lines: OnlinePosTransactionLine[]) {
  const groups = groupLinesByTransaction(lines);
  const audits: ReplayReturnAudit[] = [];
  for (const group of groups.values()) {
    const signals = getReturnSignals(group);
    const classification = classifyReplayReturn(group);
    if (!classification) continue;
    const first = group[0];
    audits.push({
      replayWindow,
      transactionId: first.transactionId,
      receiptNumber: first.receiptNumber,
      datetime: first.transactionDatetime,
      cashRegister: first.cashRegisterName ?? first.cashRegisterId,
      total: first.transactionTotal,
      type: first.transactionType,
      status: first.transactionStatus,
      returnId: first.returnId,
      refundId: first.refundId,
      negativeLines: group.filter((line) => line.quantitySold < 0 || line.revenue < 0).length,
      signals,
      classification,
    });
  }
  return audits;
}

function buildModifierAudits(replayWindow: string, lines: OnlinePosTransactionLine[], decisions: OnlinePosSyncDecision[]) {
  const decisionsByKey = new Map(decisions.map((decision) => [decision.externalLineId, decision]));
  return lines
    .filter((line) => line.parentLineId || line.lineType === "modifier_stock_item" || line.revenue === 0)
    .map((line) => {
      const parent = line.parentLineId ? lines.find((candidate) => candidate.lineId === line.parentLineId && candidate.transactionId === line.transactionId) : null;
      const decision = decisionsByKey.get(productionExternalLineId(line));
      return {
        replayWindow,
        transactionId: line.transactionId,
        receiptNumber: line.receiptNumber,
        parentLineId: line.parentLineId,
        lineId: line.lineId,
        productName: line.onlineposProductName,
        productGroupName: line.onlineposProductGroupName,
        quantity: line.quantitySold,
        amount: line.revenue,
        isModifier: line.lineType === "modifier_stock_item" || Boolean(line.parentLineId),
        isZeroPrice: line.revenue === 0,
        economyProduct: parent?.onlineposProductName ?? line.onlineposProductName,
        stockProduct: decision?.components.length ? line.onlineposProductName : null,
        stockRelevant: line.inventoryRelevant && line.needsMapping,
        decision: decision?.status ?? "ikke vurderet",
      };
    });
}

function buildStockPreview(
  replayWindow: string,
  decisions: OnlinePosSyncDecision[],
  products: Array<{ id: string; name: string }>,
  locations: Array<{ id: string; name: string }>,
) {
  const preview: ReplayStockPreviewLine[] = [];
  for (const decision of decisions.filter((item) => item.status === "processed")) {
    for (const component of decision.components) {
      const product = products.find((item) => item.id === component.productId);
      const location = locations.find((item) => item.id === component.locationId);
      preview.push({
        replayWindow,
        locationId: component.locationId,
        locationName: location?.name ?? "Ukendt lokation",
        backeventProductId: component.productId,
        backeventProductName: product?.name ?? "Ukendt vare",
        onlineposProductId: decision.onlineposProductId,
        onlineposProductName: decision.onlineposProductName,
        transactionId: decision.transactionId,
        lineId: decision.lineId,
        quantity: -Math.abs(component.quantity),
        quantityText: formatReplayQuantity(-Math.abs(component.quantity), product?.name),
        internalQuantity: component.quantity,
        mappingId: decision.mappingId,
        decision: "Klar",
      });
    }
  }
  return preview;
}

function groupErrors(details: ReplayErrorDetail[]) {
  const counts = new Map<string, number>();
  for (const detail of details) counts.set(detail.errorCode, (counts.get(detail.errorCode) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, "da"));
}

function summarizeReturns(returns: ReplayReturnAudit[]) {
  return {
    verified: returns.filter((item) => item.classification === "Verificeret retur").length,
    probable: returns.filter((item) => item.classification === "Sandsynlig retur").length,
    uncertain: returns.filter((item) => item.classification === "Usikker retur").length,
  };
}

function summarizeUnmappedProducts(
  errors: ReplayErrorDetail[],
  modifierAudits: ReplayModifierAudit[],
  products: Array<{ id: string; name: string }>,
) {
  const groups = new Map<string, {
    onlineposProductId: string | null;
    productName: string | null;
    occurrenceCount: number;
    totalQuantity: number;
    cashRegisters: Set<string>;
    relation: Set<string>;
    priceMin: number | null;
    priceMax: number | null;
    suggestedProductName: string | null;
  }>();
  for (const error of errors.filter((item) => item.errorCode === "PRODUCT_MAPPING_MISSING" || item.errorCode === "MODIFIER_MAPPING_FAILED")) {
    const key = `${error.onlineposProductId ?? ""}:${error.productName ?? ""}`;
    const group = groups.get(key) ?? {
      onlineposProductId: error.onlineposProductId,
      productName: error.productName,
      occurrenceCount: 0,
      totalQuantity: 0,
      cashRegisters: new Set<string>(),
      relation: new Set<string>(),
      priceMin: null,
      priceMax: null,
      suggestedProductName: suggestProduct(error.productName, products),
    };
    group.occurrenceCount += 1;
    group.totalQuantity += Math.abs(error.quantity);
    if (error.cashRegister) group.cashRegisters.add(error.cashRegister);
    const modifier = modifierAudits.find((item) => item.transactionId === error.transactionId && item.lineId === error.lineId);
    group.relation.add(modifier?.isModifier ? "modifier" : "parent/normal");
    group.priceMin = group.priceMin === null ? error.amount : Math.min(group.priceMin, error.amount);
    group.priceMax = group.priceMax === null ? error.amount : Math.max(group.priceMax, error.amount);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => ({
    onlineposProductId: group.onlineposProductId,
    productName: group.productName,
    occurrenceCount: group.occurrenceCount,
    totalQuantity: Math.round(group.totalQuantity * 1000) / 1000,
    cashRegisters: Array.from(group.cashRegisters).sort((a, b) => a.localeCompare(b, "da")),
    parentModifierRelation: Array.from(group.relation).join(", "),
    priceLevel: { min: group.priceMin, max: group.priceMax },
    suggestedProductName: group.suggestedProductName,
  }));
}

function getReturnSignals(lines: OnlinePosTransactionLine[]) {
  if (lines.length === 0) return [];
  const first = lines[0];
  const typeText = `${first.transactionType ?? ""} ${first.transactionStatus ?? ""}`.toLocaleLowerCase("da-DK");
  const signals: string[] = [];
  if (typeText.includes("refund") || typeText.includes("return") || typeText.includes("retur")) signals.push("explicit_refund_type");
  if (first.returnId) signals.push("return_id_present");
  if (first.refundId) signals.push("refund_id_present");
  if ((first.transactionTotal ?? 0) < 0 && lines.some((line) => line.quantitySold < 0 || line.revenue < 0)) signals.push("negative_total_and_lines");
  if (lines.some((line) => (line.onlineposProductName ?? "").toLocaleLowerCase("da-DK").includes("retur"))) signals.push("return_text_signal");
  return signals;
}

function groupLinesByTransaction(lines: OnlinePosTransactionLine[]) {
  const groups = new Map<string, OnlinePosTransactionLine[]>();
  for (const line of lines) {
    const key = line.transactionId ?? line.receiptNumber ?? `line-${line.lineIndex}`;
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }
  return groups;
}

function readableReplayError(code: ReplayErrorCode, fallback: string | null) {
  if (code === "LOCATION_MAPPING_MISSING") return "OnlinePOS-kassen mangler godkendt lokationsmapping";
  if (code === "PRODUCT_MAPPING_MISSING") return "OnlinePOS-produktet mangler godkendt produktmapping";
  if (code === "MODIFIER_MAPPING_FAILED") return "Modifier/MSG-linjen mangler godkendt lagerkomponent";
  if (code === "UNIT_CONVERSION_FAILED") return "Mapping mangler gyldig vare eller forbrug pr. salg";
  return fallback ?? "Ukendt replay-fejl";
}

function suggestProduct(productName: string | null, products: Array<{ name: string }>) {
  const normalized = normalizeName(productName);
  if (!normalized) return null;
  return products.find((product) => normalizeName(product.name) === normalized)?.name ?? null;
}

function normalizeName(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("da-DK").replace(/[^a-z0-9æøå]+/g, "-").replace(/^-|-$/g, "") || null;
}

function formatReplayQuantity(quantity: number, productName: string | null | undefined) {
  const absolute = Math.abs(quantity).toLocaleString("da-DK", { maximumFractionDigits: 3 });
  const prefix = quantity < 0 ? "-" : "";
  return `${prefix}${absolute} ${productName ? "enheder" : "enheder"}`;
}

function emptyTotals() {
  return { processedCount: 0, ignoredCount: 0, failedCount: 0, missingMappingCount: 0, duplicateCount: 0, expectedStockDelta: 0 };
}

function addTotals(totals: ReturnType<typeof emptyTotals>, summary: ReturnType<typeof summarizeDecisions>) {
  totals.processedCount += summary.processedCount;
  totals.ignoredCount += summary.ignoredCount;
  totals.failedCount += summary.failedCount;
  totals.missingMappingCount += summary.missingMappingCount;
  totals.duplicateCount += summary.duplicateCount;
  totals.expectedStockDelta += summary.expectedStockDelta;
}

function groupStockChanges(decisions: OnlinePosSyncDecision[]) {
  const groups = new Map<string, { locationId: string; productId: string; quantity: number }>();
  for (const decision of decisions) {
    for (const component of decision.components) {
      const key = `${component.locationId}:${component.productId}`;
      const current = groups.get(key) ?? { locationId: component.locationId, productId: component.productId, quantity: 0 };
      current.quantity += component.quantity;
      groups.set(key, current);
    }
  }
  return Array.from(groups.values()).map((item) => ({ ...item, quantity: Math.round(item.quantity * 1000) / 1000 }));
}

function countReturnTransactions(lines: OnlinePosTransactionLine[]) {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.quantitySold < 0 || line.revenue < 0) ids.add(line.transactionId ?? line.receiptNumber ?? String(line.lineIndex));
  }
  return ids.size;
}

function distinct(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "da"));
}
