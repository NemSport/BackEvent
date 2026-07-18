import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildReceiptControlWorkbook } from "../receipt-control-export.ts";
import { buildReceiptControlQueueState } from "../receipt-control-queue.ts";
import { parseReceiptControlFilters, receiptControlSort } from "../receipt-control-query.ts";

test("aktive filtre bevares i forrige og næste links", () => {
  const queue = buildReceiptControlQueueState({
    currentId: "b",
    items: ["a", "b", "c"],
    page: 1,
    pageSize: 25,
    total: 3,
    baseQuery: "status=follow_up&location=pub&sort=oldest&search=375",
  });
  assert.match(queue.previousHref, /status=follow_up/);
  assert.match(queue.nextHref, /location=pub/);
  assert.match(queue.nextHref, /sort=oldest/);
  assert.match(queue.nextHref, /search=375/);
  assert.match(queue.nextHref, /\/c\?/);
  assert.equal(queue.position, 2);
});

test("næste bon findes på tværs af pagination", () => {
  const queue = buildReceiptControlQueueState({
    currentId: "last-page-one",
    items: ["first", "last-page-one"],
    page: 1,
    pageSize: 2,
    total: 4,
    baseQuery: "status=active&sort=oldest",
    nextPageFirstId: "first-page-two",
  });
  assert.match(queue.nextHref, /first-page-two/);
  assert.match(queue.nextHref, /page=2/);
});

test("sidste bon viser ingen næste og forrige virker", () => {
  const queue = buildReceiptControlQueueState({
    currentId: "last",
    items: ["previous", "last"],
    page: 1,
    pageSize: 25,
    total: 2,
    baseQuery: "status=active",
  });
  assert.equal(queue.nextHref, null);
  assert.match(queue.previousHref, /previous/);
});

test("status, dato, søgning og sortering parses stabilt fra URL", () => {
  const filters = parseReceiptControlFilters(new URLSearchParams("status=approved&from=2026-07-01&to=2026-07-17&search=375&location=unmapped&sort=receipt_desc"));
  assert.equal(filters.status, "approved");
  assert.equal(filters.dateFrom, "2026-07-01");
  assert.equal(filters.dateTo, "2026-07-17");
  assert.equal(filters.search, "375");
  assert.equal(filters.location, "unmapped");
  assert.deepEqual(receiptControlSort(filters.sort), { column: "receipt_number", ascending: false, secondary: "created_at" });
});

test("Excel-eksport er en gyldig xlsx med filtre og danske kolonner", async () => {
  const buffer = await buildReceiptControlWorkbook([sampleControl()]);
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Boner");
  assert.ok(sheet);
  assert.equal(sheet.getCell("A1").value, "Bonnummer");
  assert.equal(sheet.getCell("A2").value, "375");
  assert.ok(sheet.autoFilter);
  assert.equal(sheet.views[0].state, "frozen");
  assert.ok(workbook.getWorksheet("Opsummering"));
});

test("eksport-endpoint kræver kontrolrolle og understøtter valgte samt filtrerede boner", async () => {
  const source = await readFile(new URL("../../../app/api/returns/receipt-controls/export/route.ts", import.meta.url), "utf8");
  assert.match(source, /requireReturnAccess/);
  assert.match(source, /auth\.canControl/);
  assert.match(source, /scope === "selected"/);
  assert.match(source, /parseReceiptControlFilters/);
  assert.match(source, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
});

test("server-query understøtter ikke-mappet, status, dato og bonnummersøgning", async () => {
  const source = await readFile(new URL("../receipt-control-query.ts", import.meta.url), "utf8");
  assert.match(source, /locationFilter === "unmapped"/);
  assert.match(source, /\.in\("status"/);
  assert.match(source, /\.gte\("effective_datetime"/);
  assert.match(source, /receipt_number\.ilike/);
});

function sampleControl() {
  return {
    receiptNumber: "375",
    transactionId: "1135591735",
    transactionDatetime: "2026-07-17T14:01:00Z",
    createdAt: "2026-07-17T14:01:01Z",
    source: "live",
    cashRegisterId: "29305",
    cashRegisterName: "Pubben",
    locationName: "Pubben",
    locationMappingStatus: "mapped",
    purchaseValue: 100,
    depositReturnValue: 125,
    finalTotal: -25,
    depositReturnQuantity: 12,
    controlTypes: ["HIGH_DEPOSIT_RETURN", "NEGATIVE_RECEIPT_TOTAL"],
    status: "open",
    internalNote: null,
    handledByName: null,
    handledAt: null,
  };
}
