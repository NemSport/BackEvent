import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyReplayReturn,
  getHistoricalReplayBlockingErrors,
  historicalReplayTestRunExternalLineId,
  mapReplayErrorCode,
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

test("fejl grupperes med stabile replay-koder", () => {
  assert.equal(mapReplayErrorCode(decision("OnlinePOS-kasse mangler lokationsmapping")), "LOCATION_MAPPING_MISSING");
  assert.equal(mapReplayErrorCode(decision("Mangler godkendt mapping")), "PRODUCT_MAPPING_MISSING");
  assert.equal(mapReplayErrorCode(decision("Mangler godkendt mapping", "modifier_stock_item")), "MODIFIER_MAPPING_FAILED");
  assert.equal(mapReplayErrorCode(decision("Mapping mangler gyldige lagerkomponenter")), "UNIT_CONVERSION_FAILED");
});

test("retursignaler klassificerer verificeret og sandsynlig retur", () => {
  assert.equal(classifyReplayReturn([line({ transactionType: "refund" })]), "Verificeret retur");
  assert.equal(classifyReplayReturn([line({ refundId: "refund-1" })]), "Verificeret retur");
  assert.equal(classifyReplayReturn([line({ transactionTotal: -20, quantitySold: -1, revenue: -20 })]), "Sandsynlig retur");
});

test("returtekst uden stærkere signal markeres usikker", () => {
  assert.equal(classifyReplayReturn([line({ onlineposProductName: "RETUR test", transactionTotal: 20, quantitySold: 1, revenue: 20 })]), "Usikker retur");
});

test("test-run forbliver blokeret uden eksplicit confirmation", () => {
  assert.equal(validateReplayConfirmation("test-run", null), "Test-run kræver bekræftelsen KØR HISTORISK TEST");
  assert.equal(validateReplayConfirmation("dry-run", null), null);
});

test("fejlkoder indeholder ikke secrets", () => {
  const code = mapReplayErrorCode(decision("OnlinePOS-kasse mangler lokationsmapping"));
  assert.equal(JSON.stringify(code).includes("secret"), false);
  assert.equal(JSON.stringify(code).includes("token"), false);
});

test("test-run blokeres kun af alvorlige replay-fejl", () => {
  const details = [
    { errorCode: "LOCATION_MAPPING_MISSING" },
    { errorCode: "PRODUCT_MAPPING_MISSING" },
    { errorCode: "MODIFIER_MAPPING_FAILED" },
    { errorCode: "RETURN_DETECTION_UNCERTAIN" },
    { errorCode: "OTHER" },
    { errorCode: "AMOUNT_MISMATCH" },
  ];

  assert.deepEqual(
    getHistoricalReplayBlockingErrors(details).map((item) => item.errorCode),
    ["LOCATION_MAPPING_MISSING", "PRODUCT_MAPPING_MISSING", "MODIFIER_MAPPING_FAILED", "RETURN_DETECTION_UNCERTAIN"],
  );
});

test("pant og ignorerede linjer blokerer ikke test-run", () => {
  assert.equal(mapReplayErrorCode(decision("Pant/gebyr behandles ikke som vareforbrug", "deposit_fee")), "OTHER");
  assert.equal(getHistoricalReplayBlockingErrors([{ errorCode: "OTHER" }]).length, 0);
});

test("historical test-run bruger stabil linje-idempotens på tværs af replay id", () => {
  const productionId = "tx-1:line-1:233";
  assert.equal(historicalReplayTestRunExternalLineId(productionId), "historical-replay:test-run:tx-1:line-1:233");
  assert.equal(historicalReplayTestRunExternalLineId(productionId), historicalReplayTestRunExternalLineId(productionId));
});
