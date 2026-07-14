import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeRawOnlinePosReceipt,
  buildReturnNotificationDedupeKey,
  buildReturnNotificationText,
  buildReturnNotificationTitle,
  fetchOnlinePosTransactions,
  getSeriousReturnControlReasons,
  parseOnlinePosReturn,
  returnLineNeedsStockSource,
} from "../returns.ts";

test("almindeligt salg bliver ikke behandlet som retur", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-1",
    receipt_number: "100",
    total: 120,
    cash_register: { name: "Rødbar" },
    lines: [{ line_id: "1", product_id: "233", product_name: "Kildevand", quantity: 2, net_price: 40 }],
  });

  assert.equal(parsed, null);
});

test("negativ produkttransaktion uden retursignal går til manuel kontrol", () => {
  const transaction = {
    transaction_id: "tx-2",
    receipt_number: "101",
    total: -40,
    cash_register: { name: "Rødbar" },
    lines: [{ line_id: "1", product_id: "233", product_name: "Kildevand", quantity: -2, net_price: -40 }],
  };
  const parsed = parseOnlinePosReturn(transaction);
  const analysis = analyzeRawOnlinePosReceipt(transaction);

  assert.equal(parsed, null);
  assert.equal(analysis.classification, "uncertain");
});

test("pant og krus markeres uden normal lagerpåvirkning", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-3",
    receipt_number: "102",
    type: "refund",
    total: -20,
    lines: [
      { line_id: "1", product_name: "RETUR Krus", product_group_name: "Pant", quantity: -1, net_price: -20 },
      { line_id: "2", product_name: "GEBYR Kande", product_group_name: "Pant", quantity: -1, net_price: 0 },
    ],
  });

  assert.equal(parsed?.lines[0].isCup, true);
  assert.equal(parsed?.lines[0].isDeposit, true);
  assert.equal(parsed?.suspicionFlags.includes("PANT_KRUS"), true);
});

test("pant retur 10 og gebyr 10 giver netto 0", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-pant-gebyr",
    receipt_number: "105",
    type: "refund",
    total: 0,
    lines: [
      { line_id: "1", product_name: "RETUR Krus", product_group_name: "Pant", quantity: -1, net_price: -10 },
      { line_id: "2", product_name: "GEBYR Krus", product_group_name: "Pant", quantity: 1, net_price: 10 },
    ],
  });
  assert.equal(parsed?.totalAmount, 0);
  assert.equal(parsed?.rawMetadata.economy.fees, 10);
  assert.equal(parsed?.rawMetadata.economy.refunds, 10);
});

test("vare 70 plus pant 10 minus gebyr 10 giver netto refundering 70", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-netto",
    receipt_number: "106",
    type: "refund",
    total: -70,
    lines: [
      { line_id: "1", product_name: "Mokai", quantity: -1, net_price: -70 },
      { line_id: "2", product_name: "RETUR Krus", product_group_name: "Pant", quantity: -1, net_price: -10 },
      { line_id: "3", product_name: "GEBYR Krus", product_group_name: "Pant", quantity: 1, net_price: 10 },
    ],
  });
  assert.equal(parsed?.totalAmount, -70);
  assert.equal(Math.abs(parsed?.totalAmount ?? 0), 70);
  assert.equal(parsed?.rawMetadata.economy.productRefund, 70);
  assert.equal(parsed?.rawMetadata.economy.fees, 10);
});

test("pant uden gebyr giver refundering og gebyr uden pant reducerer refundering", () => {
  const pantOnly = parseOnlinePosReturn({
    transaction_id: "tx-pant-only",
    receipt_number: "107",
    type: "refund",
    total: -10,
    lines: [{ line_id: "1", product_name: "RETUR Krus", product_group_name: "Pant", quantity: -1, net_price: -10 }],
  });
  const feeOnly = parseOnlinePosReturn({
    transaction_id: "tx-fee-only",
    receipt_number: "108",
    type: "refund",
    total: -60,
    lines: [
      { line_id: "1", product_name: "Mokai", quantity: -1, net_price: -70 },
      { line_id: "2", product_name: "GEBYR Krus", product_group_name: "Pant", quantity: 1, net_price: 10 },
    ],
  });
  assert.equal(pantOnly?.totalAmount, -10);
  assert.equal(feeOnly?.totalAmount, -60);
});

test("RETUR Krus er refund og GEBYR Krus er charge", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-directions",
    receipt_number: "109",
    type: "refund",
    total: 0,
    lines: [
      { line_id: "1", product_name: "RETUR - Krus", product_group_name: "Pant", quantity: -1, net_price: -10 },
      { line_id: "2", product_name: "GEBYR - Krus", product_group_name: "Pant", quantity: 1, net_price: 10 },
    ],
  });
  assert.equal(parsed?.lines[0].economicDirection, "refund");
  assert.equal(parsed?.lines[1].economicDirection, "charge");
});

test("modifier 0 kr og parent modifier tælles økonomisk én gang", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-parent-modifier",
    receipt_number: "110",
    type: "refund",
    total: -70,
    lines: [
      { line_id: "parent", product_name: "Drink", quantity: -1, net_price: -70 },
      { line_id: "modifier", parent_line_id: "parent", product_name: "MSG - Mokai", product_group_name: "MSG - Test", quantity: -1, net_price: 0 },
    ],
  });
  assert.equal(parsed?.totalAmount, -70);
  assert.equal(parsed?.lines[1].economicDirection, "neutral");
});

test("mismatch mellem linjetype og fortegn markeres til kontrol", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-mismatch",
    receipt_number: "111",
    type: "refund",
    total: -10,
    lines: [{ line_id: "1", product_name: "GEBYR - Krus", product_group_name: "Pant", quantity: -1, net_price: -10 }],
  });
  assert.equal(parsed?.controlReasons.includes("Gebyr har refund-retning"), true);
});

test("rå OnlinePOS-total og beregnet nettotal mismatch markeres til kontrol", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-total-mismatch",
    receipt_number: "112",
    type: "refund",
    total: -90,
    lines: [
      { line_id: "1", product_name: "Mokai", quantity: -1, net_price: -70 },
      { line_id: "2", product_name: "RETUR Krus", product_group_name: "Pant", quantity: -1, net_price: -10 },
      { line_id: "3", product_name: "GEBYR Krus", product_group_name: "Pant", quantity: 1, net_price: 10 },
    ],
  });
  assert.equal(parsed?.totalAmount, -70);
  assert.equal(parsed?.controlReasons.includes("Rå OnlinePOS-total afviger fra beregnede returlinjer"), true);
});
test("stabil return idempotency key er ens ved genkørsel", () => {
  const tx = {
    refund_id: "refund-1",
    transaction_id: "tx-4",
    receipt_number: "103",
    total: -30,
    datetime: "2026-07-11T10:00:00Z",
    lines: [{ line_id: "1", product_id: "233", product_name: "Kildevand", quantity: -1, net_price: -30 }],
  };

  assert.equal(parseOnlinePosReturn(tx)?.externalIdempotencyKey, parseOnlinePosReturn(tx)?.externalIdempotencyKey);
});

test("void/cancel behandles ikke ukritisk som refund", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-void",
    receipt_number: "104",
    status: "cancelled",
    total: -30,
    lines: [{ line_id: "1", product_id: "233", product_name: "Kildevand", quantity: -1, net_price: -30 }],
  });

  assert.equal(parsed, null);
});

test("kun return_to_stock-linjer kræver lagerkilde", () => {
  assert.equal(returnLineNeedsStockSource({ return_handling: "waste", backevent_product_id: "p", calculated_stock_quantity: 1 }), false);
  assert.equal(returnLineNeedsStockSource({ return_handling: "no_stock_effect", backevent_product_id: "p", calculated_stock_quantity: 1 }), false);
  assert.equal(returnLineNeedsStockSource({ return_handling: "manual_review", backevent_product_id: "p", calculated_stock_quantity: 1 }), false);
  assert.equal(returnLineNeedsStockSource({ return_handling: "return_to_stock", backevent_product_id: "p", calculated_stock_quantity: 1 }), true);
  assert.equal(returnLineNeedsStockSource({ return_handling: "return_to_stock", backevent_product_id: null, calculated_stock_quantity: 1 }), false);
});

test("testharness-valgt lokation bevares som cash register reference", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "test-return-location",
    receipt_number: "TEST-LOCATION",
    type: "refund",
    total: -70,
    cash_register: { id: "bar-1", name: "Rødbar" },
    lines: [{ line_id: "1", product_name: "Mokai", quantity: -1, net_price: -70 }],
  });
  assert.equal(parsed?.cashRegisterId, "bar-1");
  assert.equal(parsed?.cashRegisterName, "Rødbar");
});
test("pagination henter flere sider og deduplikerer transaktioner", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ONLINEPOS_CLIENT_ID = "client";
  process.env.ONLINEPOS_CLIENT_SECRET = "secret";
  process.env.ONLINEPOS_VENUE_ID = "venue";

  const calls = [];
  globalThis.fetch = async (url, init) => {
    const urlText = String(url);
    calls.push(urlText);
    if (urlText.includes("/auth/token")) {
      return jsonResponse({ access_token: "token" });
    }

    assert.equal(init.headers.Authorization, "Bearer token");
    const page = new URL(urlText).searchParams.get("page");
    if (page === "1") {
      return jsonResponse({
        data: [
          { transaction_id: "tx-a", receipt_number: "200", datetime: "2026-07-11T10:00:00Z", lines: [] },
          { transaction_id: "tx-dup", receipt_number: "201", datetime: "2026-07-11T10:01:00Z", lines: [] },
        ],
        pagination: { current_page: 1, last_page: 2, per_page: 2, total: 4 },
      });
    }

    return jsonResponse({
      data: [
        { transaction_id: "tx-dup", receipt_number: "201", datetime: "2026-07-11T10:01:00Z", lines: [] },
        { transaction_id: "tx-b", receipt_number: "202", datetime: "2026-07-11T10:02:00Z", lines: [] },
      ],
      pagination: { current_page: 2, last_page: 2, per_page: 2, total: 4 },
    });
  };

  try {
    const result = await fetchOnlinePosTransactions({
      datetimeFrom: "2026-07-11T00:00:00Z",
      datetimeTo: "2026-07-11T23:59:59Z",
    });
    assert.equal(result.pageCount, 2);
    assert.equal(result.transactions.length, 3);
    assert.equal(calls.filter((call) => call.includes("/transactions")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

test("finance notification content has title, time, receipt and stable link target", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "return-finance-1",
    receipt_number: "BON-42",
    type: "refund",
    datetime: "2026-07-13T10:15:00.000Z",
    total: -70,
    cash_register: { id: "red", name: "Rød Bar" },
    lines: [{ line_id: "1", product_id: "p1", product_name: "Mokai", quantity: -1, net_price: -70 }],
  });

  assert.ok(parsed);
  assert.equal(buildReturnNotificationTitle("Rød Bar"), "Retur – Rød Bar");
  assert.match(buildReturnNotificationText(parsed), /Tid: 13\.07\.2026 kl\. \d{2}:\d{2}/);
  assert.match(buildReturnNotificationText(parsed), /Bon: BON-42/);
  assert.equal(`/retur/${"return-id-1"}`, "/retur/return-id-1");
});

test("missing receipt number is shown as Mangler", () => {
  assert.equal(
    buildReturnNotificationText({ onlineposReturnedAt: "2026-07-13T10:15:00.000Z", receiptNumber: null }).includes("Bon: Mangler"),
    true,
  );
});

test("return notification dedupe key is stable per user and scope", () => {
  assert.equal(
    buildReturnNotificationDedupeKey("return-1", "finance", "user-1"),
    buildReturnNotificationDedupeKey("return-1", "finance", "user-1"),
  );
  assert.notEqual(
    buildReturnNotificationDedupeKey("return-1", "finance", "user-1"),
    buildReturnNotificationDedupeKey("return-1", "owner-control", "user-1"),
  );
});

test("only serious control reasons notify owner", () => {
  assert.deepEqual(getSeriousReturnControlReasons(["Mangler bonnummer", "Retur fundet ud fra negative linjer"]), []);
  assert.deepEqual(getSeriousReturnControlReasons(["Produkt mangler returbehandling: Mokai"]), ["Produkt mangler returbehandling: Mokai"]);
  assert.deepEqual(getSeriousReturnControlReasons(["STOCK_SOURCE_MISSING: Kildevand"]), ["STOCK_SOURCE_MISSING: Kildevand"]);
});

test("waste pant and fee do not create false stock source alarm", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "return-no-stock-source",
    receipt_number: "BON-43",
    type: "refund",
    total: -70,
    lines: [
      { line_id: "1", product_name: "Mokai", quantity: -1, net_price: -70 },
      { line_id: "2", product_name: "RETUR - Krus", quantity: -1, net_price: -10 },
      { line_id: "3", product_name: "GEBYR - Krus", quantity: 1, net_price: 10 },
    ],
  });

  assert.ok(parsed);
  assert.equal(getSeriousReturnControlReasons(parsed.controlReasons).some((reason) => reason.includes("STOCK_SOURCE_MISSING")), false);
});
