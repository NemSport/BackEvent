import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeReplayReceipt,
  buildHistoricalReplayTestRunPlan,
  buildReplayClassificationKey,
  classifyReplayReturn,
  getHistoricalReplayBlockingErrors,
  historicalReplayInputKey,
  historicalReplayTestRunExternalLineId,
  isCurrentHistoricalReplayDryRun,
  mapReplayErrorCode,
  mapReplayIgnoredCode,
  summarizeDecisions,
} from "../historical-replay.ts";
import { validateReplayConfirmation } from "../historical-replay-core.ts";

function decision(errorReason, lineType = "stock_item") {
  return { errorReason, lineType };
}

function line(overrides = {}) {
  return {
    transactionId: "tx-1",
    receiptNumber: "100",
    transactionDatetime: "2025-07-17T15:00:00Z",
    transactionType: null,
    transactionStatus: null,
    returnId: null,
    refundId: null,
    transactionTotal: 40,
    lineId: "line-1",
    parentLineId: null,
    lineIndex: 0,
    onlineposProductId: "233",
    onlineposProductName: "Kildevand",
    onlineposProductGroupId: null,
    onlineposProductGroupName: "Sodavand",
    cashRegisterId: "cash-1",
    cashRegisterName: "Rød Bar",
    quantitySold: 1,
    revenue: 20,
    lineType: "stock_item",
    inventoryRelevant: true,
    needsMapping: true,
    ...overrides,
  };
}

function testRunDecision(transactionId, status, errorReason = null) {
  return {
    externalLineId: `historical-replay:test-run:${transactionId}:line:product`,
    transactionId,
    receiptNumber: transactionId,
    lineId: "line",
    lineType: "stock_item",
    status,
    errorReason,
    stockDelta: status === "processed" ? 1 : 0,
    components: status === "processed" ? [{ productId: "product", locationId: "location", quantity: 1 }] : [],
  };
}

function uncertainAudit(transactionId) {
  return {
    replayKey: `receipt:${transactionId}`,
    transactionId,
    receiptNumber: transactionId,
    classification: "Usikker retur",
    signals: ["negative_product_line_without_return_header"],
    lines: [{ lineId: "line" }],
    controlTriggers: [],
  };
}

test("fejl grupperes med stabile replay-koder", () => {
  assert.equal(mapReplayErrorCode(decision("OnlinePOS-kasse mangler lokationsmapping")), "LOCATION_MAPPING_MISSING");
  assert.equal(mapReplayErrorCode(decision("OnlinePOS-lokationsmapping har konflikt")), "LOCATION_MAPPING_CONFLICT");
  assert.equal(mapReplayErrorCode(decision("Mangler godkendt mapping")), "PRODUCT_MAPPING_MISSING");
  assert.equal(mapReplayErrorCode(decision("Mangler godkendt mapping", "modifier_stock_item")), "MODIFIER_MAPPING_FAILED");
  assert.equal(mapReplayErrorCode(decision("Mapping mangler gyldige lagerkomponenter")), "UNIT_CONVERSION_FAILED");
});

test("retursignaler kræver eksplicit returheader", () => {
  assert.equal(classifyReplayReturn([line({ transactionType: "refund" })]), "Verificeret retur");
  assert.equal(classifyReplayReturn([line({ refundId: "refund-1" })]), "Verificeret retur");
  assert.equal(classifyReplayReturn([line({ transactionTotal: -20, quantitySold: -1, revenue: -20 })]), "Usikker retur");
});

test("negative produktlinjer uden stærkere signal markeres usikker", () => {
  assert.equal(classifyReplayReturn([line({ onlineposProductName: "Returvare", transactionTotal: -20, quantitySold: -1, revenue: -20 })]), "Usikker retur");
});

test("test-run forbliver blokeret uden eksplicit confirmation", () => {
  assert.equal(validateReplayConfirmation("test-run", null), "Test-run kræver bekræftelsen KØR HISTORISK TEST");
  assert.equal(validateReplayConfirmation("dry-run", null), null);
});

test("test-run afviser et stale dry-run efter mapping eller klassifikation er ændret", () => {
  const expected = { id: "run-1", completedAt: "2026-07-14T10:00:00Z", inputKey: "interval", fingerprint: "before", blockingErrorSummary: [] };
  const current = { ...expected, completedAt: "2026-07-14T10:05:00Z", fingerprint: "after" };
  assert.equal(isCurrentHistoricalReplayDryRun(expected, current), false);
});

test("nyt matching dry-run kan bruges til test-run", () => {
  const dryRun = { id: "run-2", completedAt: "2026-07-14T10:05:00Z", inputKey: "interval", fingerprint: "current", blockingErrorSummary: [] };
  assert.equal(isCurrentHistoricalReplayDryRun(dryRun, { ...dryRun }), true);
});

test("dry-run input key binder test-run til præcis samme interval og filter", () => {
  const input = { date: "2025-07-17", startTime: "17:00", endTime: "17:50", intervalMinutes: 10, overlapMinutes: 2, venue: "15249", cashRegister: "Rød Bar" };
  assert.equal(historicalReplayInputKey(input), historicalReplayInputKey({ ...input }));
  assert.notEqual(historicalReplayInputKey(input), historicalReplayInputKey({ ...input, endTime: "18:00" }));
});

test("fejlkoder indeholder ikke secrets", () => {
  const code = mapReplayErrorCode(decision("OnlinePOS-kasse mangler lokationsmapping"));
  assert.equal(JSON.stringify(code).includes("secret"), false);
  assert.equal(JSON.stringify(code).includes("token"), false);
});

test("test-run blokeres kun af alvorlige replay-fejl", () => {
  const details = [
    { errorCode: "LOCATION_MAPPING_MISSING" },
    { errorCode: "LOCATION_MAPPING_CONFLICT" },
    { errorCode: "PRODUCT_MAPPING_MISSING" },
    { errorCode: "MODIFIER_MAPPING_FAILED" },
    { errorCode: "RETURN_DETECTION_UNCERTAIN" },
    { errorCode: "OTHER" },
    { errorCode: "AMOUNT_MISMATCH" },
  ];

  assert.deepEqual(
    getHistoricalReplayBlockingErrors(details).map((item) => item.errorCode),
    ["OTHER"],
  );
});

test("pant og ignorerede linjer blokerer ikke test-run", () => {
  const deposit = decision("Pant/gebyr behandles ikke som vareforbrug", "deposit_fee");
  const container = decision("Mapping handling: container_only", "container_product");
  assert.equal(mapReplayIgnoredCode(deposit), "IGNORED_NON_STOCK_LINE");
  assert.equal(mapReplayIgnoredCode(container), "IGNORED_CONTAINER_ONLY");
  assert.equal(mapReplayErrorCode(deposit), null);
  assert.equal(mapReplayErrorCode(container), null);
  assert.equal(getHistoricalReplayBlockingErrors([
    { errorCode: "IGNORED_NON_STOCK_LINE" },
    { errorCode: "IGNORED_CONTAINER_ONLY" },
  ]).length, 0);
});

test("OTHER bruges kun til ukendt adfærd", () => {
  assert.equal(mapReplayErrorCode(decision("Ukendt runtime-adfærd")), "OTHER");
});

test("RETURN_DETECTION_UNCERTAIN sendes til manuel kontrol uden global blokering", () => {
  assert.deepEqual(
    getHistoricalReplayBlockingErrors([{ errorCode: "RETURN_DETECTION_UNCERTAIN" }]).map((item) => item.errorCode),
    [],
  );
});

test("10 sikre boner behandles mens én usikker bon får nul lagerpåvirkning", () => {
  const safe = Array.from({ length: 10 }, (_, index) => testRunDecision(`safe-${index}`, "processed"));
  const uncertain = testRunDecision("uncertain", "processed");
  const plan = buildHistoricalReplayTestRunPlan(
    [...safe, uncertain],
    [uncertainAudit("uncertain")],
    [{ errorCode: "RETURN_DETECTION_UNCERTAIN" }],
  );
  assert.equal(plan.safeDecisions.length, 10);
  assert.equal(plan.safeDecisions.some((item) => item.transactionId === "uncertain"), false);
  assert.equal(plan.summary.manualReviewReceiptCount, 1);
  assert.equal(plan.summary.manualReviewLineCount, 1);
  assert.equal(plan.summary.manualReviews[0].wouldCreateControlMessage, true);
});

test("usikker bon kan behandles senere efter manuel klassifikation", () => {
  const candidate = testRunDecision("uncertain", "processed");
  const before = buildHistoricalReplayTestRunPlan([candidate], [uncertainAudit("uncertain")], []);
  const after = buildHistoricalReplayTestRunPlan([candidate], [], []);
  assert.equal(before.safeDecisions.length, 0);
  assert.equal(after.safeDecisions.length, 1);
  assert.equal(after.safeDecisions[0].externalLineId, candidate.externalLineId);
});

test("manglende produktmapping stopper kun den berørte linje", () => {
  const safe = testRunDecision("safe", "processed");
  const missing = testRunDecision("missing", "ignored", "Mangler godkendt mapping");
  const plan = buildHistoricalReplayTestRunPlan([safe, missing], [], [{ errorCode: "PRODUCT_MAPPING_MISSING" }]);
  assert.deepEqual(plan.safeDecisions.map((item) => item.transactionId), ["safe"]);
  assert.equal(plan.summary.mappingSkippedLineCount, 1);
});

test("lokationskonflikt stopper kun berørt bon og vælger ingen mapping", () => {
  const safe = testRunDecision("safe", "processed");
  const conflict = testRunDecision("conflict", "failed", "OnlinePOS-lokationsmapping har konflikt");
  const plan = buildHistoricalReplayTestRunPlan([safe, conflict], [], [{ errorCode: "LOCATION_MAPPING_CONFLICT" }]);
  assert.deepEqual(plan.safeDecisions.map((item) => item.transactionId), ["safe"]);
  assert.equal(plan.summary.mappingSkippedLineCount, 1);
});

test("kun sikre linjer beholder stabil idempotensnøgle", () => {
  const safe = testRunDecision("safe", "processed");
  const uncertain = testRunDecision("uncertain", "processed");
  const first = buildHistoricalReplayTestRunPlan([safe, uncertain], [uncertainAudit("uncertain")], []);
  const retry = buildHistoricalReplayTestRunPlan([safe, uncertain], [uncertainAudit("uncertain")], []);
  assert.deepEqual(first.safeDecisions.map((item) => item.externalLineId), retry.safeDecisions.map((item) => item.externalLineId));
  assert.equal(first.safeDecisions.length, 1);
});

test("sikre ignore-kategorier tælles neutralt og ikke som fejl", () => {
  const summary = summarizeDecisions([
    { status: "ignored", errorReason: "Pant/gebyr behandles ikke som vareforbrug", lineType: "deposit_fee", stockDelta: 0 },
    { status: "ignored", errorReason: "Mapping handling: container_only", lineType: "container_product", stockDelta: 0 },
  ], 0);

  assert.equal(summary.ignoredCount, 2);
  assert.equal(summary.classifiedIgnoredCount, 2);
  assert.equal(summary.ignoredNonStockLineCount, 1);
  assert.equal(summary.ignoredContainerOnlyCount, 1);
  assert.equal(summary.failedCount, 0);
});

test("historical test-run bruger stabil linje-idempotens på tværs af replay id", () => {
  const productionId = "tx-1:line-1:233";
  assert.equal(historicalReplayTestRunExternalLineId(productionId), "historical-replay:test-run:tx-1:line-1:233");
  assert.equal(historicalReplayTestRunExternalLineId(productionId), historicalReplayTestRunExternalLineId(productionId));
});

test("manuel replay-klassifikation er idempotent pr venue transaction og bon", () => {
  assert.equal(
    buildReplayClassificationKey({ venueId: "15249", transactionId: "TX-1", receiptNumber: "100" }),
    buildReplayClassificationKey({ venueId: "15249", transactionId: "tx-1", receiptNumber: "100" }),
  );
});

test("manuel klassifikation fjerner usikker retur eller gør den verificeret", () => {
  const uncertain = [line({ onlineposProductName: "Returvare", transactionTotal: -20, quantitySold: -1, revenue: -20 })];
  assert.equal(classifyReplayReturn(uncertain), "Usikker retur");
  assert.equal(classifyReplayReturn(uncertain, { classification: "sale" }), null);
  assert.equal(classifyReplayReturn(uncertain, { classification: "void" }), null);
  assert.equal(classifyReplayReturn(uncertain, { classification: "ignored_testdata" }), null);
  assert.equal(classifyReplayReturn(uncertain, { classification: "return" }), "Verificeret retur");
});

test("replay klassificerer 22 kander og 71 krus som salg med pantretur", () => {
  const analysis = analyzeReplayReceipt([
    line({ lineId: "kander", onlineposProductName: "RETUR - Kande", lineType: "deposit_return", inventoryRelevant: false, needsMapping: false, quantitySold: 22, revenue: -440, transactionTotal: -5 }),
    line({ lineId: "krus", onlineposProductName: "RETUR - Krus", lineType: "deposit_return", inventoryRelevant: false, needsMapping: false, quantitySold: 71, revenue: -710, transactionTotal: -5 }),
    line({ lineId: "sales", onlineposProductName: "Almindelige køb", lineType: "stock_item", quantitySold: 1, revenue: 1145, transactionTotal: -5 }),
  ]);
  assert.equal(analysis.classification, "sale_with_deposit_return");
  assert.equal(analysis.depositReturnQuantity, 93);
  assert.deepEqual(analysis.controlTypes, ["HIGH_DEPOSIT_RETURN", "NEGATIVE_RECEIPT_TOTAL"]);
  assert.equal(classifyReplayReturn([
    line({ lineId: "krus", onlineposProductName: "RETUR - Krus", lineType: "deposit_return", quantitySold: 71, revenue: -710, transactionTotal: -5 }),
    line({ lineId: "sales", onlineposProductName: "Køb", quantitySold: 1, revenue: 705, transactionTotal: -5 }),
  ]), null);
});
