import assert from "node:assert/strict";
import test from "node:test";
import { buildFlowReport } from "../flow-report.ts";

function syncLine(overrides = {}) {
  return {
    externalLineId: "line-1",
    transactionId: "receipt-1",
    receiptNumber: "100",
    transactionDatetime: "2025-07-17T15:00:00Z",
    onlineposProductName: "Shaker Sport",
    quantitySold: 5,
    status: "processed",
    errorReason: null,
    mappingAction: "stock_item",
    locationId: "bar-a",
    source: "live",
    components: [{ productId: "product-a", quantity: 5 / 24, consumptionDiagnostics: { consumptionPerSale: 1, consumptionUnit: "dåser", totalConsumptionQuantity: 5, finalStoredDelta: -5 / 24 } }],
    ...overrides,
  };
}

test("multiple bar filter includes only selected bars", () => {
  const report = buildFlowReport({ syncLines: [syncLine(), syncLine({ externalLineId: "line-2", transactionId: "receipt-2", locationId: "bar-b" })], returnLines: [], duplicateCount: 0, locationIds: ["bar-b"] });
  assert.equal(report.summary.processedLineCount, 1);
  assert.deepEqual(report.rows[0].byLocation, { "bar-b": 5 });
});

test("date and time interval excludes lines outside the exact interval", () => {
  const report = buildFlowReport({ syncLines: [syncLine(), syncLine({ externalLineId: "line-2", transactionDatetime: "2025-07-17T16:00:00Z" })], returnLines: [], duplicateCount: 0, from: "2025-07-17T14:59:00Z", to: "2025-07-17T15:01:00Z" });
  assert.equal(report.summary.processedLineCount, 1);
});

test("same external line is counted only once", () => {
  const report = buildFlowReport({ syncLines: [syncLine(), syncLine()], returnLines: [], duplicateCount: 1 });
  assert.equal(report.rows[0].gross, 5);
  assert.equal(report.summary.duplicateCount, 1);
});

test("return to stock reduces net while waste remains separate", () => {
  const report = buildFlowReport({ syncLines: [syncLine()], duplicateCount: 0, returnLines: [
    { id: "return-1", productId: "product-a", locationId: "bar-a", datetime: "2025-07-17T15:10:00Z", handling: "return_to_stock", processingStatus: "returned_to_stock", stockQuantity: 2, wasteQuantity: 0 },
    { id: "return-2", productId: "product-a", locationId: "bar-a", datetime: "2025-07-17T15:11:00Z", handling: "waste", processingStatus: "waste_registered", stockQuantity: 0, wasteQuantity: 1 },
  ] });
  assert.equal(report.rows[0].gross, 5);
  assert.equal(report.rows[0].returned, 2);
  assert.equal(report.rows[0].net, 3);
  assert.equal(report.rows[0].waste, 1);
});

test("ignored pant and container-only lines never count as consumption", () => {
  const report = buildFlowReport({ syncLines: [syncLine({ status: "ignored", mappingAction: "container_only" }), syncLine({ externalLineId: "line-2", status: "ignored", mappingAction: "fee" })], returnLines: [], duplicateCount: 0 });
  assert.equal(report.rows.length, 0);
  assert.equal(report.summary.ignoredLineCount, 2);
});

test("applied historical test-run is included as actual consumption", () => {
  const report = buildFlowReport({ syncLines: [syncLine({ source: "historical_replay" })], returnLines: [], duplicateCount: 0 });
  assert.equal(report.rows[0].gross, 5);
});
