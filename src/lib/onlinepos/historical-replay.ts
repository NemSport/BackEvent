import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  buildReplayWindows,
  isOnlinePosReplayEnabled,
  productionExternalLineId,
  replayExternalLineId,
  validateCleanupConfirmation,
  validateReplayConfirmation,
  type ReplayMode,
} from "./historical-replay-core.ts";
import {
  applyOnlinePosSyncDecisions,
  buildSyncDecisions,
  fetchOnlinePosTransactionLines,
  getInventoryMappings,
  getLocations,
  getProducts,
  type OnlinePosSyncDecision,
  type OnlinePosTransactionLine,
} from "./inventory-sync.ts";
import {
  getOnlinePosLocationMappings,
  recordOnlinePosLocationDiscoveries,
  resolveOnlinePosLocation,
  type OnlinePosLocationDiagnostics,
  type OnlinePosLocationMapping,
} from "./location-mappings.ts";
import {
  analyzeOnlinePosReceipt,
  type OnlinePosReceiptControlAnalysis,
  type OnlinePosReceiptControlType,
} from "./receipt-control.ts";
import { persistReceiptControls, type ReceiptControlLocationContext } from "./returns.ts";

export {
  buildReplayWindows,
  isOnlinePosReplayEnabled,
  productionExternalLineId,
  replayExternalLineId,
  validateCleanupConfirmation,
  validateReplayConfirmation,
};

export type { ReplayMode } from "./historical-replay-core.ts";

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

export type HistoricalReplayDryRunMeta = {
  id: string;
  completedAt: string;
  inputKey: string;
  fingerprint: string;
  blockingErrorSummary: Array<{ code: string; count: number }>;
};

export async function runHistoricalReplayDryRun({
  supabase,
  input,
}: {
  supabase: SupabaseClient;
  input: HistoricalReplayInput;
}) {
  const analysis = await analyzeHistoricalReplay({ supabase, input, externalLineIdMode: "dry-run" });
  return stripInternalDecisions(analysis);
}

export async function runHistoricalReplayTestRun({
  supabase,
  input,
  actorUserId,
  actorEmail,
  expectedDryRun,
}: {
  supabase: SupabaseClient;
  input: HistoricalReplayInput;
  actorUserId: string | null;
  actorEmail: string | null;
  expectedDryRun: HistoricalReplayDryRunMeta | null;
}) {
  const analysis = await analyzeHistoricalReplay({ supabase, input: { ...input, mode: "dry-run" }, externalLineIdMode: "test-run" });
  const blockingErrors = getHistoricalReplayBlockingErrors(analysis.errorDetails);

  if (!expectedDryRun || !isCurrentHistoricalReplayDryRun(expectedDryRun, analysis.dryRun)) {
    return {
      ...stripInternalDecisions(analysis),
      ok: false,
      mode: "test-run" as const,
      staleDryRun: true,
      message: "Dry-run-resultatet er forældet. Kør et nyt dry-run med samme interval før test-run.",
      testRun: {
        enabled: false,
        blockingErrors,
        blockingErrorSummary: groupErrors(blockingErrors),
      },
    };
  }

  if (blockingErrors.length > 0) {
    return {
      ...stripInternalDecisions(analysis),
      ok: false,
      mode: "test-run" as const,
      message: `Test-run er blokeret: ${formatBlockingReason(blockingErrors)}`,
      testRun: {
        enabled: false,
        blockingErrors,
        blockingErrorSummary: groupErrors(blockingErrors),
      },
    };
  }

  const testLog = await createHistoricalReplayTestLog(supabase, input, actorUserId, actorEmail, analysis);
  const applyResult = {
    ok: !testLog.error,
    runId: testLog.id,
    status: testLog.error ? "failed" : "previewed",
    processedCount: 0,
    ignoredCount: analysis.testRunPlan.ignoredLineCount,
    failedCount: testLog.error ? 1 : 0,
    missingMappingCount: analysis.testRunPlan.mappingSkippedLineCount,
    duplicateCount: 0,
  };

  const result = {
    ...stripInternalDecisions(analysis),
    ok: applyResult.ok,
    mode: "test-run" as const,
    message: applyResult.ok ? "Historical replay test-run er gennemført" : "Historical replay test-run fejlede",
    testRun: {
      enabled: true,
      blockingErrors: [],
      blockingErrorSummary: [],
    },
    applyResult,
    actualStockChanges: analysis.stockPreview,
    testRunResult: {
      safelyProcessedCount: analysis.testRunPlan.safeLineCount,
      actualStockChangeCount: 0,
      duplicateCount: applyResult.duplicateCount,
      ignoredLineCount: analysis.testRunPlan.ignoredLineCount,
      manualReviewReceiptCount: analysis.testRunPlan.manualReviewReceiptCount,
      manualReviewLineCount: analysis.testRunPlan.manualReviewLineCount,
      mappingSkippedLineCount: analysis.testRunPlan.mappingSkippedLineCount,
      economicControlCount: analysis.testRunPlan.economicControlCount,
      wouldCreateControlMessageCount: analysis.testRunPlan.wouldCreateControlMessageCount,
      technicalErrorCount: applyResult.failedCount,
    },
    safety: {
      mode: "test-run",
      writesStock: false,
      writesSyncLines: false,
      sendsPush: false,
      createsNotifications: true,
      changesMappings: false,
      updatesLocationDiscovery: true,
      changesReturnStatus: false,
      testRunEnabled: true,
    },
  };
  return result;
}

export async function runHistoricalReplay({
  supabase,
  input,
  actorUserId,
  actorEmail,
  expectedDryRun,
}: {
  supabase: SupabaseClient;
  input: HistoricalReplayInput;
  actorUserId: string | null;
  actorEmail: string | null;
  expectedDryRun: HistoricalReplayDryRunMeta | null;
}) {
  const analysis = await analyzeHistoricalReplay({ supabase, input: { ...input, mode: "dry-run" }, externalLineIdMode: "dry-run" });
  const blockingErrors = getHistoricalReplayBlockingErrors(analysis.errorDetails);
  if (!expectedDryRun || !isCurrentHistoricalReplayDryRun(expectedDryRun, analysis.dryRun) || blockingErrors.length > 0) {
    return {
      ...stripInternalDecisions(analysis),
      ok: false,
      mode: "replay" as const,
      staleDryRun: !expectedDryRun || !isCurrentHistoricalReplayDryRun(expectedDryRun, analysis.dryRun),
      message: blockingErrors.length ? `Replay er blokeret: ${formatBlockingReason(blockingErrors)}` : "Dry-run-resultatet er forældet.",
    };
  }
  const interval = selectedReplayInterval(input);
  const decisions = analysis.internalTestRunDecisions.map((decision) => ({
    ...decision,
    externalLineId: stripHistoricalReplayPrefix(decision.externalLineId),
  }));
  const applyResult = await applyOnlinePosSyncDecisions({
    supabase,
    datetimeFrom: interval.from,
    datetimeTo: interval.to,
    actorUserId,
    actorEmail,
    source: "historical_replay",
    decisions,
  });
  let controlCount = 0;
  for (const audit of analysis.returns.filter((item) => item.controlTriggers.length > 0)) {
    await persistReceiptControls(supabase, replayAuditToControlAnalysis(audit), {
      source: "historical_replay",
      replayRunId: input.replayRunId,
      locationContext: {
        locationId: audit.locationId,
        locationName: audit.locationName,
        mappingStatus: audit.locationMappingStatus,
      },
    });
    controlCount += 1;
  }
  return {
    ...stripInternalDecisions(analysis),
    ok: applyResult.ok,
    mode: "replay" as const,
    message: applyResult.ok ? "Faktisk historical replay er gennemført" : applyResult.message,
    applyResult,
    persistedControlCount: controlCount,
    safety: { mode: "replay", writesStock: true, writesSyncLines: true, sendsPush: true, createsNotifications: true, changesMappings: false },
  };
}

function replayAuditToControlAnalysis(audit: ReplayReturnAudit): OnlinePosReceiptControlAnalysis {
  return {
    receiptKey: audit.replayKey.replace(/^onlinepos-replay:/, "onlinepos-receipt:"),
    transactionId: audit.transactionId,
    receiptNumber: audit.receiptNumber,
    cashRegisterId: audit.cashRegisterId,
    cashRegisterName: audit.cashRegisterName,
    transactionDatetime: audit.datetime,
    amountsIncludeVat: false,
    classification: audit.classification === "Verificeret retur" ? "return_receipt" : audit.classification === "Usikker retur" ? "uncertain" : audit.classification === "Almindeligt salg med pantretur" ? "sale_with_deposit_return" : "sale",
    classificationLabel: audit.classification,
    signals: audit.signals,
    controlTypes: audit.controlTriggers,
    depositReturnQuantity: audit.depositReturnQuantity,
    depositBreakdown: audit.depositBreakdown,
    purchaseValue: audit.purchaseValue,
    depositReturnValue: audit.depositReturnValue,
    finalTotal: audit.finalTotal,
  };
}

async function createHistoricalReplayTestLog(supabase: SupabaseClient, input: HistoricalReplayInput, actorUserId: string | null, actorEmail: string | null, analysis: Awaited<ReturnType<typeof analyzeHistoricalReplay>>) {
  const { data, error } = await supabase.from("backevent_historical_replay_test_logs").upsert({
    replay_run_id: input.replayRunId,
    run_by: actorUserId,
    interval_from: selectedReplayInterval(input).from,
    interval_to: selectedReplayInterval(input).to,
    preview: {
      controls: analysis.returns.filter((item) => item.controlTriggers.length > 0),
      errors: analysis.errorDetails,
      notificationRecipients: ["Oekonomiansvarlige"],
      pushRecipients: ["Test-run sender ikke push til rigtige modtagere"],
      runByEmail: actorEmail,
    },
  }, { onConflict: "replay_run_id" }).select("id").single();
  return { id: data?.id ? String(data.id) : input.replayRunId, error };
}

async function analyzeHistoricalReplay({
  supabase,
  input,
  externalLineIdMode,
}: {
  supabase: SupabaseClient;
  input: HistoricalReplayInput;
  externalLineIdMode: "dry-run" | "test-run";
}) {
  const windows = buildReplayWindows(input);
  const [mappings, products, locations] = await Promise.all([
    getInventoryMappings(supabase),
    getProducts(supabase),
    getLocations(supabase),
  ]);
  let latestLocationMappings = await getOnlinePosLocationMappings(supabase);
  const manualClassifications = await getManualReplayClassifications(supabase);
  const notificationRecipients = await getReplayNotificationRecipients(supabase);
  const initialLocationMappings = latestLocationMappings;
  const locationMappingWindows: Array<{
    replayWindow: string;
    activeApprovedMappingCount: number;
    mappingsLoaded: ReturnType<typeof safeLocationMappingRows>;
    canonicalLocations: OnlinePosLocationDiagnostics[];
  }> = [];
  const seenProductionLineIds = new Set<string>();
  const seenTransactionIds = new Set<string>();
  const totals = emptyTotals();
  const windowResults = [];
  const allErrorDetails: ReplayErrorDetail[] = [];
  const allIgnoredDetails: ReplayIgnoredDetail[] = [];
  const allReturnAudits: ReplayReturnAudit[] = [];
  const allModifierAudits: ReplayModifierAudit[] = [];
  const allStockPreview: ReplayStockPreviewLine[] = [];
  const duplicateDetails: ReplayDuplicateDetail[] = [];
  const allInternalDecisions: OnlinePosSyncDecision[] = [];

  for (const window of windows) {
    const fetched = await fetchOnlinePosTransactionLines({ datetimeFrom: window.fetchFrom, datetimeTo: window.fetchTo, venue: input.venue });
    const filteredLines = input.cashRegister
      ? fetched.lines.filter((line) => line.cashRegisterId === input.cashRegister || line.cashRegisterName === input.cashRegister)
      : fetched.lines;
    const windowLocationDiscoveries = filteredLines.map((line) => ({
      venueId: input.venue ?? null,
      cashRegisterId: line.cashRegisterId,
      cashRegisterName: line.cashRegisterName,
      seenAt: line.transactionDatetime,
    }));
    await recordOnlinePosLocationDiscoveries(supabase, windowLocationDiscoveries);
    latestLocationMappings = await getOnlinePosLocationMappings(supabase);
    const decisionLines = filteredLines.filter((line) => isLineInsideDisplayWindow(line, input.date, window.displayFrom, window.displayTo));
    const decisions = buildSyncDecisions(decisionLines, mappings, products, locations, latestLocationMappings);
    locationMappingWindows.push({
      replayWindow: window.label,
      activeApprovedMappingCount: countActiveApprovedLocationMappings(latestLocationMappings),
      mappingsLoaded: safeLocationMappingRows(latestLocationMappings),
      canonicalLocations: canonicalLocationDiagnostics(decisions),
    });
    const uniqueDecisions: OnlinePosSyncDecision[] = [];
    let duplicateCount = 0;
    const windowDuplicateDetails: ReplayDuplicateDetail[] = [];

    for (const decision of decisions) {
      const line = decisionLines.find((item) => productionExternalLineId(item) === decision.externalLineId);
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
        externalLineId: externalLineIdMode === "test-run" ? historicalReplayTestRunExternalLineId(decision.externalLineId) : `historical-replay:${input.replayRunId}:${decision.externalLineId}`,
      });
    }

    for (const line of decisionLines) {
      if (line.transactionId) seenTransactionIds.add(line.transactionId);
    }

    const summary = summarizeDecisions(uniqueDecisions, duplicateCount);
    const errorDetails = buildErrorDetails(window.label, uniqueDecisions, decisionLines, manualClassifications, input.venue ?? null);
    const ignoredDetails = buildIgnoredDetails(window.label, uniqueDecisions, decisionLines);
    const returnAudits = buildReturnAudits(window.label, decisionLines, manualClassifications, input.venue ?? null, latestLocationMappings, locations);
    const modifierAudits = buildModifierAudits(window.label, decisionLines, uniqueDecisions);
    const safeWindowDecisions = excludeUncertainReceiptDecisions(uniqueDecisions, returnAudits);
    const stockPreview = buildStockPreview(window.label, safeWindowDecisions, products, locations);
    allInternalDecisions.push(...uniqueDecisions);
    allErrorDetails.push(...errorDetails);
    allIgnoredDetails.push(...ignoredDetails);
    allReturnAudits.push(...returnAudits);
    allModifierAudits.push(...modifierAudits);
    allStockPreview.push(...stockPreview);
    addTotals(totals, summary);
    windowResults.push({
      ...window,
      apiPages: Number(fetched.pagination.fetched_pages ?? fetched.pagination.current_page ?? 1),
      transactionCount: new Set(decisionLines.map((line) => line.transactionId ?? line.receiptNumber ?? `${line.lineIndex}`)).size,
      salesLineCount: decisionLines.length,
      returnTransactionCount: countReturnTransactions(decisionLines),
      ...summary,
      cashRegisters: distinct(decisionLines.map((line) => line.cashRegisterName ?? line.cashRegisterId).filter(Boolean) as string[]),
      unmappedProducts: distinct(uniqueDecisions.filter((line) => line.errorReason === "Mangler godkendt mapping").map((line) => line.onlineposProductName ?? "Ukendt vare")),
      unmappedLocations: distinct(uniqueDecisions.filter((line) => line.errorReason === "OnlinePOS-kasse mangler lokationsmapping" || line.errorReason === "OnlinePOS-lokationsmapping er inaktiv" || line.errorReason === "OnlinePOS-lokationsmapping har konflikt" || line.errorReason === "Ukendt BackEvent-lokation" || line.errorReason === "Bar mangler lagerkilde").map((line) => line.cashRegisterName ?? "Ukendt sted")),
      modifiers: uniqueDecisions.filter((line) => line.lineType === "modifier_stock_item").length,
      deposits: uniqueDecisions.filter((line) => line.lineType === "deposit_fee" || line.lineType === "deposit_return").length,
      expectedStockChanges: groupStockChanges(uniqueDecisions),
      controlErrors: uniqueDecisions.filter((line) => line.status === "failed" || line.errorReason === "Mangler godkendt mapping").map((line) => line.errorReason ?? "Fejl"),
      errorSummary: groupErrors(errorDetails),
      errorDetails: errorDetails.slice(0, 100),
      ignoredSummary: groupIgnoredLines(ignoredDetails),
      ignoredDetails: ignoredDetails.slice(0, 100),
      returnAudits,
      modifierAudits,
      stockPreview: stockPreview.slice(0, 100),
      duplicateDetails: windowDuplicateDetails.slice(0, 50),
    });
  }

  const unmappedProducts = summarizeUnmappedProducts(allErrorDetails, allModifierAudits, products);
  const returnSummary = summarizeReturns(allReturnAudits);
  const blockingErrors = getHistoricalReplayBlockingErrors(allErrorDetails);
  const blockingIssueGroups = buildBlockingIssueGroups(allErrorDetails, allModifierAudits, allReturnAudits);
  const testRunPlan = buildHistoricalReplayTestRunPlan(allInternalDecisions, allReturnAudits, allErrorDetails);
  const result = {
    ok: true,
    mode: input.mode,
    replayRunId: input.replayRunId,
    windows: windowResults,
    totals: {
      ...totals,
      uniqueLineCount: seenProductionLineIds.size,
      uniqueTransactionCount: seenTransactionIds.size,
      errorCount: allErrorDetails.length,
      classifiedIgnoredCount: allIgnoredDetails.length,
      returnCount: allReturnAudits.length,
      uncertainReturnCount: allReturnAudits.filter((item) => item.classification === "Usikker retur").length,
      modifierAuditCount: allModifierAudits.length,
      stockPreviewCount: allStockPreview.length,
    },
    errorSummary: groupErrors(allErrorDetails),
    errorDetails: allErrorDetails.slice(0, 500),
    ignoredSummary: groupIgnoredLines(allIgnoredDetails),
    ignoredDetails: allIgnoredDetails.slice(0, 500),
    returns: allReturnAudits.slice(0, 200),
    returnSummary,
    modifierAudit: allModifierAudits.slice(0, 300),
    unmappedProducts,
    blockingIssueGroups,
    testRunPlan: testRunPlan.summary,
    stockPreview: allStockPreview.slice(0, 500),
    duplicateDetails: duplicateDetails.slice(0, 300),
    notificationPreview: buildReplayNotificationPreview(allReturnAudits, allErrorDetails, notificationRecipients),
    locationMappingDebug: {
      supabaseProjectHostOnly: supabaseProjectHostOnly(),
      initial: {
        activeApprovedMappingCount: countActiveApprovedLocationMappings(initialLocationMappings),
        mappingsLoaded: safeLocationMappingRows(initialLocationMappings),
      },
      windows: locationMappingWindows,
      latest: {
        activeApprovedMappingCount: countActiveApprovedLocationMappings(latestLocationMappings),
        mappingsLoaded: safeLocationMappingRows(latestLocationMappings),
      },
    },
    testRun: {
      enabled: blockingErrors.length === 0,
      blockingErrors,
      blockingErrorSummary: groupErrors(blockingErrors),
    },
    safety: {
      mode: "dry-run",
      writesStock: false,
      writesSyncLines: false,
      sendsPush: false,
      createsNotifications: false,
      changesMappings: false,
      updatesLocationDiscovery: true,
      changesReturnStatus: false,
      testRunEnabled: blockingErrors.length === 0,
    },
    internalDecisions: allInternalDecisions,
    internalTestRunDecisions: testRunPlan.safeDecisions,
  };
  return {
    ...result,
    dryRun: buildHistoricalReplayDryRunMeta(input, result),
  };
}

async function getReplayNotificationRecipients(supabase: SupabaseClient) {
  const [{ data: financeRows }, { data: ownerRows }] = await Promise.all([
    supabase
      .from("backevent_member_group_members")
      .select("profile_id,backevent_member_groups!inner(name,active),backevent_profiles!inner(id,email,full_name,active)")
      .eq("backevent_member_groups.active", true)
      .eq("backevent_profiles.active", true)
      .ilike("backevent_member_groups.name", "Økonomiansvarlige"),
    supabase.from("backevent_profiles").select("id,email,full_name").eq("active", true).eq("role", "ejer"),
  ]);
  const finance = (financeRows ?? []).map((row) => {
    const profile = row.backevent_profiles as { id?: string; email?: string | null; full_name?: string | null } | null;
    return { id: String(profile?.id ?? row.profile_id), email: profile?.email ?? null, name: profile?.full_name ?? null, role: "Oekonomiansvarlig" };
  });
  const owners = (ownerRows ?? []).map((row) => ({ id: String(row.id), email: row.email ?? null, name: row.full_name ?? null, role: "Ejer" }));
  return { finance, owners };
}

function buildReplayNotificationPreview(
  audits: ReplayReturnAudit[],
  errors: ReplayErrorDetail[],
  recipients: Awaited<ReturnType<typeof getReplayNotificationRecipients>>,
) {
  const controls = audits.filter((audit) => audit.controlTriggers.length > 0).map((audit) => ({
    receiptKey: audit.replayKey,
    receiptNumber: audit.receiptNumber,
    transactionId: audit.transactionId,
    rules: audit.controlTriggers,
    why: audit.signals,
    wouldCreateControlCase: true,
    wouldCreatePermanentNotifications: recipients.finance.map((member) => member.id),
    wouldSendPushTo: recipients.finance,
  }));
  const seriousHistoricalErrors = errors.map((error) => ({
    rule: error.errorCode,
    why: error.message,
    receiptNumber: error.receiptNumber,
    transactionId: error.transactionId,
    wouldCreatePermanentNotifications: recipients.owners.map((member) => member.id),
    wouldSendPushTo: recipients.owners,
  }));
  return { controls, seriousHistoricalErrors, recipients, eventResponsibleRecipients: [] };
}

export function historicalReplayInputKey(input: Pick<HistoricalReplayInput, "date" | "startTime" | "endTime" | "intervalMinutes" | "overlapMinutes" | "venue" | "cashRegister">) {
  return [
    input.date,
    input.startTime,
    input.endTime,
    input.intervalMinutes,
    input.overlapMinutes,
    input.venue ?? "",
    input.cashRegister?.trim() ?? "",
  ].join("|");
}

export function isCurrentHistoricalReplayDryRun(expected: HistoricalReplayDryRunMeta, current: HistoricalReplayDryRunMeta) {
  return expected.id === current.id && expected.inputKey === current.inputKey && expected.fingerprint === current.fingerprint;
}

function buildHistoricalReplayDryRunMeta(
  input: HistoricalReplayInput,
  result: {
    errorDetails: ReplayErrorDetail[];
    ignoredDetails: ReplayIgnoredDetail[];
    internalDecisions: OnlinePosSyncDecision[];
    returns: ReplayReturnAudit[];
    stockPreview: ReplayStockPreviewLine[];
    locationMappingDebug: unknown;
  },
): HistoricalReplayDryRunMeta {
  const fingerprintPayload = {
    errors: result.errorDetails,
    ignored: result.ignoredDetails,
    decisions: result.internalDecisions.map((decision) => ({
      externalLineId: stripHistoricalReplayPrefix(decision.externalLineId),
      status: decision.status,
      errorReason: decision.errorReason,
      locationId: decision.locationId,
      stockDelta: decision.stockDelta,
      mappingId: decision.mappingId,
    })),
    returns: result.returns,
    stockPreview: result.stockPreview,
    locationMappings: (result.locationMappingDebug as { latest?: unknown }).latest ?? null,
  };
  return {
    id: input.replayRunId,
    completedAt: new Date().toISOString(),
    inputKey: historicalReplayInputKey(input),
    fingerprint: createHash("sha256").update(JSON.stringify(fingerprintPayload)).digest("hex"),
    blockingErrorSummary: groupErrors(getHistoricalReplayBlockingErrors(result.errorDetails)),
  };
}

function stripInternalDecisions<T extends { internalDecisions?: OnlinePosSyncDecision[]; internalTestRunDecisions?: OnlinePosSyncDecision[] }>(result: T) {
  const publicResult = { ...result };
  delete publicResult.internalDecisions;
  delete publicResult.internalTestRunDecisions;
  return publicResult;
}

function countActiveApprovedLocationMappings(mappings: OnlinePosLocationMapping[]) {
  return mappings.filter((mapping) => mapping.active && Boolean(mapping.backeventLocationId)).length;
}

function safeLocationMappingRows(mappings: OnlinePosLocationMapping[]) {
  return mappings.map((mapping) => ({
    id: mapping.id,
    venueId: mapping.venueId,
    cashRegisterId: mapping.cashRegisterId,
    cashRegisterName: mapping.cashRegisterName,
    normalizedCashRegisterName: mapping.normalizedCashRegisterName,
    backeventLocationId: mapping.backeventLocationId,
    active: mapping.active,
    hasBackeventLocation: Boolean(mapping.backeventLocationId),
  }));
}

function canonicalLocationDiagnostics(decisions: OnlinePosSyncDecision[]) {
  const diagnostics = new Map<string, OnlinePosLocationDiagnostics>();
  for (const decision of decisions) {
    const item = decision.locationDiagnostics;
    if (item && !diagnostics.has(item.canonicalKey)) diagnostics.set(item.canonicalKey, item);
  }
  return Array.from(diagnostics.values()).sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey, "da"));
}

async function getManualReplayClassifications(supabase: SupabaseClient) {
  const classifications = new Map<string, ManualReplayClassification>();
  const { data, error } = await supabase
    .from("backevent_onlinepos_replay_classifications")
    .select("replay_key,venue_id,transaction_id,receipt_number,cash_register_id,cash_register_name,classification,reason");

  if (error) {
    return classifications;
  }

  for (const row of data ?? []) {
    const classification = String(row.classification) as ManualReplayClassificationValue;
    if (!["sale", "return", "void", "ignored_testdata"].includes(classification)) continue;
    classifications.set(String(row.replay_key), {
      replayKey: String(row.replay_key),
      venueId: stringOrNull(row.venue_id),
      transactionId: stringOrNull(row.transaction_id),
      receiptNumber: stringOrNull(row.receipt_number),
      cashRegisterId: stringOrNull(row.cash_register_id),
      cashRegisterName: stringOrNull(row.cash_register_name),
      classification,
      reason: stringOrNull(row.reason),
    });
  }
  return classifications;
}

export function buildReplayClassificationKey(input: { venueId?: string | null; transactionId?: string | null; receiptNumber?: string | null }) {
  return [
    "onlinepos-replay",
    normalizeKeyPart(input.venueId) ?? "venue",
    normalizeKeyPart(input.transactionId) ?? "transaction",
    normalizeKeyPart(input.receiptNumber) ?? "receipt",
  ].join(":");
}

function isLineInsideDisplayWindow(line: OnlinePosTransactionLine, date: string, displayFrom: string, displayTo: string) {
  if (!line.transactionDatetime) return true;
  const lineTime = new Date(line.transactionDatetime).getTime();
  if (!Number.isFinite(lineTime)) return true;
  const start = new Date(`${date}T${displayFrom}:00+02:00`).getTime();
  const end = new Date(`${date}T${displayTo}:00+02:00`).getTime();
  return lineTime >= start && lineTime < end;
}

function selectedReplayInterval(input: Pick<HistoricalReplayInput, "date" | "startTime" | "endTime">) {
  return {
    from: new Date(`${input.date}T${input.startTime}:00+02:00`).toISOString(),
    to: new Date(`${input.date}T${input.endTime}:00+02:00`).toISOString(),
  };
}

function supabaseProjectHostOnly() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export type ReplayErrorCode =
  | "LOCATION_MAPPING_MISSING"
  | "LOCATION_MAPPING_CONFLICT"
  | "PRODUCT_MAPPING_MISSING"
  | "RETURN_DETECTION_UNCERTAIN"
  | "UNIT_CONVERSION_FAILED"
  | "MODIFIER_MAPPING_FAILED"
  | "TRANSACTION_PARSE_FAILED"
  | "LINE_PARSE_FAILED"
  | "AMOUNT_MISMATCH"
  | "OTHER";

export type ReplayErrorDetail = {
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
  locationDiagnostics?: OnlinePosLocationDiagnostics | null;
};

export type ReplayIgnoredCode = "IGNORED_NON_STOCK_LINE" | "IGNORED_CONTAINER_ONLY";

export type ReplayIgnoredDetail = {
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
  ignoredCode: ReplayIgnoredCode;
  message: string;
};

type ReplayReturnAudit = {
  replayKey: string;
  replayWindow: string;
  transactionId: string | null;
  receiptNumber: string | null;
  datetime: string | null;
  cashRegister: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string | null;
  locationId: string | null;
  locationName: string | null;
  locationMappingStatus: ReceiptControlLocationContext["mappingStatus"];
  total: number | null;
  type: string | null;
  status: string | null;
  returnId: string | null;
  refundId: string | null;
  negativeLines: number;
  depositLines: number;
  signals: string[];
  classification: "Verificeret retur" | "Almindeligt salg med pantretur" | "Almindeligt salg" | "Usikker retur";
  manualClassification: ManualReplayClassificationValue | null;
  controlTriggers: OnlinePosReceiptControlType[];
  depositReturnQuantity: number;
  depositBreakdown: OnlinePosReceiptControlAnalysis["depositBreakdown"];
  purchaseValue: number;
  depositReturnValue: number;
  finalTotal: number;
  lines: ReplayReturnAuditLine[];
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

type ReplayReturnAuditLine = {
  lineId: string | null;
  productName: string | null;
  productGroupName: string | null;
  quantity: number;
  amount: number;
  lineType: string;
};

export type ManualReplayClassificationValue = "sale" | "return" | "void" | "ignored_testdata";

type ManualReplayClassification = {
  replayKey: string;
  venueId: string | null;
  transactionId: string | null;
  receiptNumber: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string | null;
  classification: ManualReplayClassificationValue;
  reason: string | null;
};

type ReplayBlockingIssueGroup = {
  code: ReplayErrorCode;
  groupKey: string;
  label: string;
  count: number;
  exampleReceiptNumber: string | null;
  exampleTransactionId: string | null;
  cashRegister: string | null;
  datetime: string | null;
  quantity: number;
  amount: number;
  adminHref: string;
  adminLabel: string;
  details: string;
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
  soldQuantity: number;
  consumptionPerSale: number;
  consumptionUnit: string;
  totalConsumptionQuantity: number;
  conversionDivisor: number;
  conversionMultiplier: number;
  finalStoredDelta: number;
  humanReadableDelta: string;
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

const blockingTestRunErrorCodes = new Set<ReplayErrorCode>([
  "LOCATION_MAPPING_MISSING",
  "LOCATION_MAPPING_CONFLICT",
  "PRODUCT_MAPPING_MISSING",
  "MODIFIER_MAPPING_FAILED",
  "RETURN_DETECTION_UNCERTAIN",
]);

const hardBlockingTestRunErrorCodes = new Set<ReplayErrorCode>(["OTHER"]);
const mappingSkipErrorCodes = new Set<ReplayErrorCode>([
  "LOCATION_MAPPING_MISSING",
  "LOCATION_MAPPING_CONFLICT",
  "PRODUCT_MAPPING_MISSING",
  "MODIFIER_MAPPING_FAILED",
  "UNIT_CONVERSION_FAILED",
]);

export type HistoricalReplayTestRunPlan = {
  safeDecisions: OnlinePosSyncDecision[];
  summary: {
    safeLineCount: number;
    actualStockChangeCount: number;
    ignoredLineCount: number;
    manualReviewReceiptCount: number;
    manualReviewLineCount: number;
    mappingSkippedLineCount: number;
    economicControlCount: number;
    wouldCreateControlMessageCount: number;
    technicalErrorCount: number;
    manualReviews: Array<{
      replayKey: string;
      receiptNumber: string | null;
      transactionId: string | null;
      reason: string;
      signals: string[];
      lineCount: number;
      wouldCreateControlMessage: true;
    }>;
  };
};

export function buildHistoricalReplayTestRunPlan(
  decisions: OnlinePosSyncDecision[],
  returnAudits: ReplayReturnAudit[],
  errors: ReplayErrorDetail[],
): HistoricalReplayTestRunPlan {
  const uncertainAudits = returnAudits.filter((item) => item.classification === "Usikker retur");
  const uncertainReceiptKeys = new Set(uncertainAudits.map(receiptIdentity));
  const safeDecisions = decisions.filter((decision) =>
    decision.status === "processed" && !uncertainReceiptKeys.has(receiptIdentity(decision)),
  );
  const mappingSkippedLineCount = decisions.filter((decision) => {
    const code = mapReplayErrorCode(decision);
    return code !== null && mappingSkipErrorCodes.has(code);
  }).length;
  const economicControlReceipts = new Set(
    returnAudits.filter((item) => item.controlTriggers.length > 0).map((item) => item.replayKey),
  );
  const controlMessageReceipts = new Set([
    ...uncertainAudits.map((item) => item.replayKey),
    ...economicControlReceipts,
  ]);

  return {
    safeDecisions,
    summary: {
      safeLineCount: safeDecisions.length,
      actualStockChangeCount: safeDecisions.reduce((count, decision) => count + decision.components.length, 0),
      ignoredLineCount: decisions.filter((decision) => Boolean(mapReplayIgnoredCode(decision))).length,
      manualReviewReceiptCount: uncertainAudits.length,
      manualReviewLineCount: decisions.filter((decision) => uncertainReceiptKeys.has(receiptIdentity(decision))).length,
      mappingSkippedLineCount,
      economicControlCount: economicControlReceipts.size,
      wouldCreateControlMessageCount: controlMessageReceipts.size,
      technicalErrorCount: errors.filter((error) => hardBlockingTestRunErrorCodes.has(error.errorCode)).length,
      manualReviews: uncertainAudits.map((audit) => ({
        replayKey: audit.replayKey,
        receiptNumber: audit.receiptNumber,
        transactionId: audit.transactionId,
        reason: audit.signals.join(", ") || "Returklassifikation er usikker",
        signals: audit.signals,
        lineCount: audit.lines.length,
        wouldCreateControlMessage: true as const,
      })),
    },
  };
}

function excludeUncertainReceiptDecisions(decisions: OnlinePosSyncDecision[], returnAudits: ReplayReturnAudit[]) {
  const uncertainReceiptKeys = new Set(
    returnAudits.filter((item) => item.classification === "Usikker retur").map(receiptIdentity),
  );
  return decisions.filter((decision) => !uncertainReceiptKeys.has(receiptIdentity(decision)));
}

function receiptIdentity(value: { transactionId: string | null; receiptNumber: string | null }) {
  return `${value.transactionId ?? ""}|${value.receiptNumber ?? ""}`;
}

export function summarizeDecisions(decisions: OnlinePosSyncDecision[], duplicateCount: number) {
  const ignoredCodes = decisions.map(mapReplayIgnoredCode).filter((code): code is ReplayIgnoredCode => Boolean(code));
  return {
    processedCount: decisions.filter((line) => line.status === "processed").length,
    ignoredCount: decisions.filter((line) => line.status === "ignored").length,
    failedCount: decisions.filter((line) => line.status === "failed").length,
    missingMappingCount: decisions.filter((line) => line.errorReason === "Mangler godkendt mapping").length,
    duplicateCount,
    classifiedIgnoredCount: ignoredCodes.length,
    ignoredNonStockLineCount: ignoredCodes.filter((code) => code === "IGNORED_NON_STOCK_LINE").length,
    ignoredContainerOnlyCount: ignoredCodes.filter((code) => code === "IGNORED_CONTAINER_ONLY").length,
    expectedStockDelta: decisions.reduce((sum, line) => sum + Math.abs(line.stockDelta), 0),
  };
}

export function historicalReplayTestRunExternalLineId(productionLineId: string) {
  return `historical-replay:test-run:${productionLineId}`;
}

export function mapReplayErrorCode(decision: Pick<OnlinePosSyncDecision, "errorReason" | "lineType">): ReplayErrorCode | null {
  const reason = decision.errorReason ?? "";
  if (!reason) return null;
  if (mapReplayIgnoredCode(decision)) return null;
  if (reason.includes("lokationsmapping har konflikt")) return "LOCATION_MAPPING_CONFLICT";
  if (reason.includes("lokationsmapping") || reason.includes("BackEvent-lokation") || reason.includes("lagerkilde")) return "LOCATION_MAPPING_MISSING";
  if (reason === "Mangler godkendt mapping" && decision.lineType === "modifier_stock_item") return "MODIFIER_MAPPING_FAILED";
  if (reason === "Mangler godkendt mapping") return "PRODUCT_MAPPING_MISSING";
  if (reason.includes("lagerkomponenter") || reason.includes("konverter")) return "UNIT_CONVERSION_FAILED";
  return "OTHER";
}

export function mapReplayIgnoredCode(
  decision: Pick<OnlinePosSyncDecision, "errorReason" | "lineType">,
): ReplayIgnoredCode | null {
  const reason = decision.errorReason ?? "";
  if (reason === "Mapping handling: container_only") return "IGNORED_CONTAINER_ONLY";
  if (
    reason === "Pant/gebyr behandles ikke som vareforbrug" ||
    reason === "Mapping handling: ignore" ||
    reason === "Mapping handling: deposit_fee" ||
    reason === "Mapping handling: deposit_return" ||
    decision.lineType === "deposit_fee" ||
    decision.lineType === "deposit_return"
  ) {
    return "IGNORED_NON_STOCK_LINE";
  }
  return null;
}

export function getHistoricalReplayBlockingErrors(details: ReplayErrorDetail[]) {
  return details.filter((detail) => hardBlockingTestRunErrorCodes.has(detail.errorCode));
}

function formatBlockingReason(details: ReplayErrorDetail[]) {
  return groupErrors(details).map((item) => `${item.code} (${item.count})`).join(", ");
}

export function classifyReplayReturn(
  lines: OnlinePosTransactionLine[],
  manualClassification: Pick<ManualReplayClassification, "classification"> | null = null,
): ReplayReturnAudit["classification"] | null {
  if (manualClassification?.classification === "return") return "Verificeret retur";
  if (
    manualClassification?.classification === "sale" ||
    manualClassification?.classification === "void" ||
    manualClassification?.classification === "ignored_testdata"
  ) {
    return null;
  }

  const analysis = analyzeReplayReceipt(lines);
  if (analysis.classification === "return_receipt") return "Verificeret retur";
  if (analysis.classification === "uncertain") return "Usikker retur";
  return null;
}

export function analyzeReplayReceipt(lines: OnlinePosTransactionLine[]) {
  const first = lines[0];
  return analyzeOnlinePosReceipt({
    venueId: process.env.ONLINEPOS_VENUE_ID ?? null,
    transactionId: first?.transactionId ?? null,
    receiptNumber: first?.receiptNumber ?? null,
    transactionType: first?.transactionType ?? null,
    transactionStatus: first?.transactionStatus ?? null,
    returnId: first?.returnId ?? null,
    refundId: first?.refundId ?? null,
    total: first?.transactionTotal ?? null,
    cashRegisterId: first?.cashRegisterId ?? null,
    cashRegisterName: first?.cashRegisterName ?? null,
    transactionDatetime: first?.transactionDatetime ?? null,
    lines: lines.map((line) => ({
      productName: line.onlineposProductName,
      lineType: line.lineType,
      quantity: line.quantitySold,
      amount: line.revenue,
    })),
  });
}

function buildErrorDetails(
  replayWindow: string,
  decisions: OnlinePosSyncDecision[],
  lines: OnlinePosTransactionLine[],
  manualClassifications: Map<string, ManualReplayClassification>,
  venueId: string | null,
) {
  const details: ReplayErrorDetail[] = [];
  const linesByKey = new Map(lines.map((line) => [productionExternalLineId(line), line]));
  for (const decision of decisions) {
    const code = mapReplayErrorCode(decision);
    if (!code) continue;
    const line = linesByKey.get(stripHistoricalReplayPrefix(decision.externalLineId));
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
      locationDiagnostics: code === "LOCATION_MAPPING_MISSING" || code === "LOCATION_MAPPING_CONFLICT" ? decision.locationDiagnostics ?? null : null,
    });
  }

  for (const audit of buildReturnAudits(replayWindow, lines, manualClassifications, venueId)) {
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

function buildIgnoredDetails(
  replayWindow: string,
  decisions: OnlinePosSyncDecision[],
  lines: OnlinePosTransactionLine[],
) {
  const details: ReplayIgnoredDetail[] = [];
  const linesByKey = new Map(lines.map((line) => [productionExternalLineId(line), line]));
  for (const decision of decisions) {
    const ignoredCode = mapReplayIgnoredCode(decision);
    if (!ignoredCode) continue;
    const line = linesByKey.get(stripHistoricalReplayPrefix(decision.externalLineId));
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
      ignoredCode,
      message: ignoredCode === "IGNORED_CONTAINER_ONLY"
        ? "Containerprodukt er eksplicit markeret uden lagerforbrug"
        : "Pant/gebyr eller eksplicit ikke-lagerført linje",
    });
  }
  return details;
}

function stripHistoricalReplayPrefix(externalLineId: string) {
  if (externalLineId.startsWith("historical-replay:test-run:")) {
    return externalLineId.replace(/^historical-replay:test-run:/, "");
  }
  const match = externalLineId.match(/^historical-replay:[^:]+:(.+)$/);
  return match?.[1] ?? externalLineId;
}

function buildReturnAudits(
  replayWindow: string,
  lines: OnlinePosTransactionLine[],
  manualClassifications: Map<string, ManualReplayClassification>,
  venueId: string | null,
  locationMappings: OnlinePosLocationMapping[] = [],
  locations: Awaited<ReturnType<typeof getLocations>> = [],
) {
  const groups = groupLinesByTransaction(lines);
  const audits: ReplayReturnAudit[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const replayKey = buildReplayClassificationKey({
      venueId,
      transactionId: first.transactionId,
      receiptNumber: first.receiptNumber,
    });
    const manual = manualClassifications.get(replayKey) ?? null;
    const analysis = analyzeReplayReceipt(group);
    const locationResolution = resolveOnlinePosLocation(
      { venueId, cashRegisterId: first.cashRegisterId, cashRegisterName: first.cashRegisterName },
      locationMappings,
      locations,
    );
    const signals = getReturnSignals(group, manual);
    const classification = replayReceiptClassification(analysis, manual);
    if (!classification && analysis.controlTypes.length === 0) continue;
    audits.push({
      replayKey,
      replayWindow,
      transactionId: first.transactionId,
      receiptNumber: first.receiptNumber,
      datetime: first.transactionDatetime,
      cashRegister: first.cashRegisterName ?? first.cashRegisterId,
      cashRegisterId: first.cashRegisterId,
      cashRegisterName: first.cashRegisterName,
      locationId: locationResolution.ok ? locationResolution.location.id : null,
      locationName: locationResolution.ok ? locationResolution.location.name : null,
      locationMappingStatus: locationResolution.ok ? "mapped" : "unmapped",
      total: first.transactionTotal,
      type: first.transactionType,
      status: first.transactionStatus,
      returnId: first.returnId,
      refundId: first.refundId,
      negativeLines: group.filter((line) => line.quantitySold < 0 || line.revenue < 0).length,
      depositLines: group.filter((line) => line.lineType === "deposit_fee" || line.lineType === "deposit_return").length,
      signals,
      classification: classification ?? (analysis.classification === "sale_with_deposit_return" ? "Almindeligt salg med pantretur" : "Almindeligt salg"),
      manualClassification: manual?.classification ?? null,
      controlTriggers: analysis.controlTypes,
      depositReturnQuantity: analysis.depositReturnQuantity,
      depositBreakdown: analysis.depositBreakdown,
      purchaseValue: analysis.purchaseValue,
      depositReturnValue: analysis.depositReturnValue,
      finalTotal: analysis.finalTotal,
      lines: group.map((line) => ({
        lineId: line.lineId,
        productName: line.onlineposProductName,
        productGroupName: line.onlineposProductGroupName,
        quantity: line.quantitySold,
        amount: line.revenue,
        lineType: line.lineType,
      })),
    });
  }
  return audits;
}

function buildModifierAudits(replayWindow: string, lines: OnlinePosTransactionLine[], decisions: OnlinePosSyncDecision[]) {
  const decisionsByKey = new Map(decisions.map((decision) => [stripHistoricalReplayPrefix(decision.externalLineId), decision]));
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
        quantityText: component.consumptionDiagnostics.humanReadableDelta,
        internalQuantity: component.quantity,
        ...component.consumptionDiagnostics,
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

function groupIgnoredLines(details: ReplayIgnoredDetail[]) {
  const counts = new Map<ReplayIgnoredCode, number>();
  for (const detail of details) counts.set(detail.ignoredCode, (counts.get(detail.ignoredCode) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, "da"));
}

function summarizeReturns(returns: ReplayReturnAudit[]) {
  return {
    verified: returns.filter((item) => item.classification === "Verificeret retur").length,
    saleWithDepositReturn: returns.filter((item) => item.classification === "Almindeligt salg med pantretur").length,
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

function buildBlockingIssueGroups(
  errors: ReplayErrorDetail[],
  modifierAudits: ReplayModifierAudit[],
  returnAudits: ReplayReturnAudit[],
) {
  const groups = new Map<string, ReplayBlockingIssueGroup>();

  for (const error of errors) {
    if (!blockingTestRunErrorCodes.has(error.errorCode)) continue;
    if (error.errorCode === "RETURN_DETECTION_UNCERTAIN") continue;
    const modifier = modifierAudits.find((item) => item.transactionId === error.transactionId && item.lineId === error.lineId);
    const isLocationIssue = error.errorCode === "LOCATION_MAPPING_MISSING" || error.errorCode === "LOCATION_MAPPING_CONFLICT";
    const groupKey = isLocationIssue
      ? `${error.errorCode}:${error.locationDiagnostics?.canonicalKey ?? error.cashRegister ?? ""}`
      : error.errorCode === "MODIFIER_MAPPING_FAILED"
      ? `${error.errorCode}:${error.onlineposProductId ?? ""}:${error.productName ?? ""}:${modifier?.economyProduct ?? ""}`
      : `${error.errorCode}:${error.onlineposProductId ?? ""}:${error.productName ?? ""}`;
    upsertBlockingGroup(groups, groupKey, {
      code: error.errorCode,
      groupKey,
      label: isLocationIssue ? error.cashRegister ?? "Ukendt OnlinePOS-kasse" : error.productName ?? "Ukendt OnlinePOS-produkt",
      count: 1,
      exampleReceiptNumber: error.receiptNumber,
      exampleTransactionId: error.transactionId,
      cashRegister: error.cashRegister,
      datetime: error.datetime,
      quantity: Math.abs(error.quantity),
      amount: error.amount,
      adminHref: isLocationIssue ? "/admin/onlinepos/lokationer" : onlinePosMappingHref(error),
      adminLabel: isLocationIssue ? "Ret lokationsmapping" : error.errorCode === "MODIFIER_MAPPING_FAILED" ? "Ret modifier i Produktmapping" : "Ret produkt i Produktmapping",
      details: isLocationIssue
        ? `Canonical key: ${error.locationDiagnostics?.canonicalKey ?? "mangler"} · Kandidater: ${error.locationDiagnostics?.candidateMappingsLoaded.length ?? 0}`
        : error.errorCode === "MODIFIER_MAPPING_FAILED"
        ? `Modifier: ${error.productName ?? "Ukendt"} · Parent: ${modifier?.economyProduct ?? "Ukendt"}`
        : `OnlinePOS ID: ${error.onlineposProductId ?? "mangler"}`,
    });
  }

  for (const audit of returnAudits.filter((item) => item.classification === "Usikker retur")) {
    const reason = audit.signals.join(", ") || "Ingen sikre retursignaler";
    const groupKey = `RETURN_DETECTION_UNCERTAIN:${reason}`;
    upsertBlockingGroup(groups, groupKey, {
      code: "RETURN_DETECTION_UNCERTAIN",
      groupKey,
      label: reason,
      count: 1,
      exampleReceiptNumber: audit.receiptNumber,
      exampleTransactionId: audit.transactionId,
      cashRegister: audit.cashRegister,
      datetime: audit.datetime,
      quantity: audit.lines.reduce((sum, line) => sum + Math.abs(line.quantity), 0),
      amount: audit.total ?? 0,
      adminHref: "#returklassifikation",
      adminLabel: "Klassificér bon her på siden",
      details: `Negative linjer: ${audit.negativeLines} · Pantlinjer: ${audit.depositLines} · Linjer: ${audit.lines.length}`,
    });
  }

  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "da"));
}

function upsertBlockingGroup(groups: Map<string, ReplayBlockingIssueGroup>, key: string, next: ReplayBlockingIssueGroup) {
  const current = groups.get(key);
  if (!current) {
    groups.set(key, next);
    return;
  }
  current.count += next.count;
  current.quantity += next.quantity;
  current.amount += next.amount;
}

function onlinePosMappingHref(error: ReplayErrorDetail) {
  const params = new URLSearchParams();
  if (error.onlineposProductId) params.set("onlineposProductId", error.onlineposProductId);
  if (error.productName) params.set("onlineposName", error.productName);
  params.set("source", "historical-replay");
  params.set("errorCode", error.errorCode);
  return `/onlinepos/mapping?${params.toString()}`;
}

function getReturnSignals(lines: OnlinePosTransactionLine[], manualClassification: Pick<ManualReplayClassification, "classification"> | null = null) {
  const signals = [...analyzeReplayReceipt(lines).signals];
  if (manualClassification?.classification) signals.push(`manual_${manualClassification.classification}`);
  return signals;
}

function replayReceiptClassification(
  analysis: OnlinePosReceiptControlAnalysis,
  manual: Pick<ManualReplayClassification, "classification"> | null,
): ReplayReturnAudit["classification"] | null {
  if (manual?.classification === "return") return "Verificeret retur";
  if (manual?.classification === "void" || manual?.classification === "ignored_testdata") return null;
  if (analysis.classification === "return_receipt") return "Verificeret retur";
  if (analysis.classification === "uncertain" && manual?.classification !== "sale") return "Usikker retur";
  if (analysis.classification === "sale_with_deposit_return") return "Almindeligt salg med pantretur";
  return null;
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
  if (code === "LOCATION_MAPPING_CONFLICT") return "OnlinePOS-kassen matcher flere aktive godkendte lokationsmappinger";
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

function emptyTotals() {
  return {
    processedCount: 0,
    ignoredCount: 0,
    classifiedIgnoredCount: 0,
    ignoredNonStockLineCount: 0,
    ignoredContainerOnlyCount: 0,
    failedCount: 0,
    missingMappingCount: 0,
    duplicateCount: 0,
    expectedStockDelta: 0,
  };
}

function addTotals(totals: ReturnType<typeof emptyTotals>, summary: ReturnType<typeof summarizeDecisions>) {
  totals.processedCount += summary.processedCount;
  totals.ignoredCount += summary.ignoredCount;
  totals.classifiedIgnoredCount += summary.classifiedIgnoredCount;
  totals.ignoredNonStockLineCount += summary.ignoredNonStockLineCount;
  totals.ignoredContainerOnlyCount += summary.ignoredContainerOnlyCount;
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

function stringOrNull(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function normalizeKeyPart(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("da-DK").replace(/\s+/g, " ") || null;
}
