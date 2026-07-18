import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildReceiptControlWorkbook } from "../receipt-control-export.ts";
import { buildReceiptControlQueueState } from "../receipt-control-queue.ts";
import {
  fetchReceiptControls,
  parseReceiptControlFilters,
  receiptControlSort,
} from "../receipt-control-query.ts";
import { RECEIPT_CONTROL_REASONS } from "../return-control-contract.ts";

test("aktive filtre bevares i forrige og næste links", () => {
  const queue = buildReceiptControlQueueState({
    currentId: "b",
    items: ["a", "b", "c"],
    page: 1,
    pageSize: 25,
    total: 3,
    baseQuery: "status=follow_up&location=pub&reason=NEGATIVE_RECEIPT_TOTAL&sort=oldest&search=375",
  });
  assert.match(queue.previousHref, /status=follow_up/);
  assert.match(queue.nextHref, /location=pub/);
  assert.match(queue.nextHref, /reason=NEGATIVE_RECEIPT_TOTAL/);
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
  const parsed = parseReceiptControlFilters(new URLSearchParams("status=approved&from=2026-07-01&to=2026-07-17&search=375&location=unmapped&sort=receipt_desc"));
  assert.equal(parsed.ok, true);
  const filters = parsed.filters;
  assert.equal(filters.status, "approved");
  assert.equal(filters.dateFrom, "2026-07-01");
  assert.equal(filters.dateTo, "2026-07-17");
  assert.equal(filters.search, "375");
  assert.equal(filters.location, "unmapped");
  assert.deepEqual(receiptControlSort(filters.sort), { column: "receipt_number", ascending: false, secondary: "created_at" });
});

test("hver understøttet kontrolårsag bliver sendt som JSONB-containment", async () => {
  for (const reason of RECEIPT_CONTROL_REASONS) {
    const parsed = parseReceiptControlFilters(new URLSearchParams({ reason }));
    assert.equal(parsed.ok, true);
    const database = queryRecorder([{ id: reason }]);
    const result = await fetchReceiptControls(database.supabase, parsed.filters);
    assert.equal(result.error, null);
    assert.equal(result.data.length, 1);
    assert.deepEqual(
      database.calls.find((call) => call.method === "filter"),
      { method: "filter", args: ["control_types", "cs", JSON.stringify([reason])] },
    );
  }
});

test("kontrolårsag kan kombineres med lokation og sortering", async () => {
  const parsed = parseReceiptControlFilters(new URLSearchParams({
    reason: "HIGH_DEPOSIT_RETURN",
    location: "5e716e7f-c39b-4c58-9f26-87aef566f8b2",
    sort: "receipt_desc",
  }));
  assert.equal(parsed.ok, true);
  const database = queryRecorder([]);
  const result = await fetchReceiptControls(database.supabase, parsed.filters);
  assert.equal(result.data.length, 0);
  assert.ok(database.calls.some((call) => call.method === "eq" && call.args[0] === "location_id"));
  assert.ok(database.calls.some((call) => call.method === "filter" && call.args[2] === '["HIGH_DEPOSIT_RETURN"]'));
  assert.ok(database.calls.some((call) => call.method === "order" && call.args[0] === "receipt_number" && call.args[1].ascending === false));
});

test("ugyldig kontrolårsag afvises kontrolleret før databasekald", () => {
  assert.deepEqual(
    parseReceiptControlFilters(new URLSearchParams({ reason: "NOT_A_REAL_REASON" })),
    { ok: false, message: "Ugyldig kontrolårsag" },
  );
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
  assert.equal(sheet.getCell("J2").value, 100);
  assert.equal(sheet.getCell("K2").value, 125);
  assert.equal(sheet.getCell("L2").value, -25);
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
  assert.match(source, /status: 400/);
  assert.match(source, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
});

test("liste-endpoint returnerer 400 for ugyldige filtre", async () => {
  const source = await readFile(new URL("../../../app/api/returns/receipt-controls/route.ts", import.meta.url), "utf8");
  assert.match(source, /parseReceiptControlFilters/);
  assert.match(source, /status: 400/);
});

test("server-query understøtter ikke-mappet, status, dato og bonnummersøgning", async () => {
  const source = await readFile(new URL("../receipt-control-query.ts", import.meta.url), "utf8");
  assert.match(source, /locationFilter === "unmapped"/);
  assert.match(source, /\.in\("status"/);
  assert.match(source, /\.gte\("effective_datetime"/);
  assert.match(source, /receipt_number\.ilike/);
});

test("den allerede anvendte legacy-migration dokumenteres uændret", async () => {
  const source = await readFile(new URL("../../../../supabase/migrations/202607180001_receipt_control_vat_basis.sql", import.meta.url), "utf8");
  assert.match(source, /amounts_include_vat boolean not null default false/i);
  assert.doesNotMatch(source, /\bupdate\b/i);
  assert.doesNotMatch(source, /\b(purchase_value|deposit_return_value|final_total)\s*=/i);
});

test("korrigerende momsmigration kopierer dokumenterede beløb uden at ændre originalerne", async () => {
  const source = await readFile(new URL("../../../../supabase/migrations/202607180002_receipt_control_individual_vat_sources.sql", import.meta.url), "utf8");
  assert.match(source, /final_total_including_vat\s*=\s*coalesce\(final_total_including_vat,\s*final_total\)/i);
  assert.match(source, /legacy_documented_onlinepos_amount/);
  assert.doesNotMatch(source, /\b(final_total|purchase_value|deposit_return_value)\s*=\s*[^,;\n]+/i);
});

test("liste, detalje og eksport bruger de samme individuelle inkl. moms-beløb", async () => {
  const [query, list, detail, workbook] = await Promise.all([
    readFile(new URL("../receipt-control-query.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../app/retur/kontrol/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../app/retur/kontrol/[controlId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../receipt-control-export.ts", import.meta.url), "utf8"),
  ]);
  assert.match(query, /final_total_including_vat/);
  assert.match(list, /finalTotalIncludingVat/);
  assert.match(detail, /final_total_including_vat/);
  assert.match(workbook, /finalTotalIncludingVat/);
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
    purchaseValueIncludingVat: 100,
    depositReturnValueIncludingVat: 125,
    finalTotalIncludingVat: -25,
    depositReturnQuantity: 12,
    controlTypes: ["HIGH_DEPOSIT_RETURN", "NEGATIVE_RECEIPT_TOTAL"],
    status: "open",
    internalNote: null,
    handledByName: null,
    handledAt: null,
  };
}

function queryRecorder(data) {
  const calls = [];
  const result = { data, error: null, count: data.length };
  const query = new Proxy({}, {
    get(_target, method) {
      if (method === "then") return (resolve) => resolve(result);
      return (...args) => {
        calls.push({ method: String(method), args });
        return query;
      };
    },
  });
  return {
    calls,
    supabase: {
      from(table) {
        calls.push({ method: "from", args: [table] });
        return query;
      },
    },
  };
}
