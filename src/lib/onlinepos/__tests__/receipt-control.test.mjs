import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeOnlinePosReceipt,
  buildOnlinePosReceiptControlKey,
} from "../receipt-control.ts";
import {
  buildReceiptControlNotificationDedupeKey,
  buildReceiptControlNotificationText,
} from "../returns.ts";

function receipt(overrides = {}) {
  return {
    venueId: "15249",
    transactionId: "tx-1",
    receiptNumber: "100",
    transactionType: "sale",
    transactionStatus: "completed",
    returnId: null,
    refundId: null,
    total: 10,
    lines: [],
    ...overrides,
  };
}

function deposit(name, quantity, amount) {
  return { productName: name, lineType: "deposit_return", quantity, amount };
}

function product(name, quantity, amount) {
  return { productName: name, lineType: "stock_item", quantity, amount };
}

test("normal bon med negativ pantlinje og positiv total er almindeligt salg", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({
    total: 90,
    lines: [product("Øl", 1, 100), deposit("RETUR - Krus", 1, -10)],
  }));
  assert.equal(analysis.classification, "sale_with_deposit_return");
  assert.deepEqual(analysis.controlTypes, []);
});

test("normal bon med mange pantlinjer og positiv total giver kun pantaalarm", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({
    total: 80,
    lines: [product("Varer", 1, 200), deposit("RETUR - Krus", 12, -120)],
  }));
  assert.equal(analysis.classification, "sale_with_deposit_return");
  assert.deepEqual(analysis.controlTypes, ["HIGH_DEPOSIT_RETURN"]);
});

test("normal bon med pant og negativ total giver negativ-total-alarm", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({
    total: -5,
    lines: [product("Varer", 1, 75), deposit("RETUR - Krus", 8, -80)],
  }));
  assert.equal(analysis.classification, "sale_with_deposit_return");
  assert.deepEqual(analysis.controlTypes, ["NEGATIVE_RECEIPT_TOTAL"]);
  assert.equal(analysis.finalTotal, -5);
});

test("22 kander og 71 krus giver 93 pant og to samlede kontrolårsager", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({
    transactionId: "example-93",
    receiptNumber: "EXAMPLE-93",
    total: -5,
    lines: [
      deposit("RETUR - Kande", 22, -440),
      deposit("RETUR - Krus", 71, -710),
      product("Almindelige køb", 1, 1145),
    ],
  }));

  assert.equal(analysis.classification, "sale_with_deposit_return");
  assert.equal(analysis.classificationLabel, "Almindeligt salg med pantretur");
  assert.equal(analysis.depositReturnQuantity, 93);
  assert.deepEqual(analysis.depositBreakdown, { cups: 71, pitchers: 22, other: 0 });
  assert.equal(analysis.purchaseValue, 1145);
  assert.equal(analysis.depositReturnValue, 1150);
  assert.equal(analysis.finalTotal, -5);
  assert.deepEqual(analysis.controlTypes, ["HIGH_DEPOSIT_RETURN", "NEGATIVE_RECEIPT_TOTAL"]);
  assert.equal(analysis.controlTypes.includes("RETURN_RECEIPT"), false);
  const message = buildReceiptControlNotificationText(analysis);
  assert.match(message, /93 pant-enheder/);
  assert.match(message, /Negativ total -5,00 kr\./);
  assert.match(message, /Køb inkl\. moms: 1\.145,00 kr\./);
  assert.match(message, /Pantretur inkl\. moms: 1\.150,00 kr\./);
});

test("økonominotifikation omregner ekskl. moms-beløb til inkl. moms", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({
    total: -20,
    amountsIncludeVat: false,
    lines: [product("Almindelige køb", 1, 100), deposit("RETUR - Krus", 12, -120)],
  }));
  const message = buildReceiptControlNotificationText(analysis);
  assert.match(message, /Køb inkl\. moms: 125,00 kr\./);
  assert.match(message, /Pantretur inkl\. moms: 150,00 kr\./);
  assert.match(message, /Sluttotal inkl\. moms: -25,00 kr\./);
});

test("økonominotifikation viser den mappede BackEvent-bar", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({
    receiptNumber: "375",
    cashRegisterId: "29305",
    cashRegisterName: "OnlinePOS Pub",
    total: -5,
    lines: [product("Almindelige køb", -1, -5)],
  }));
  const message = buildReceiptControlNotificationText(analysis, {
    locationId: "location-pub",
    locationName: "Pubben",
    mappingStatus: "mapped",
  });
  assert.match(message, /^Bon: 375\nBar: Pubben\n/m);
});

test("økonominotifikation bevarer originalt OnlinePOS-navn uden mapping", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({
    cashRegisterName: "Beer Bar",
    total: -5,
    lines: [product("Almindelige køb", -1, -5)],
  }));
  const message = buildReceiptControlNotificationText(analysis, {
    locationId: null,
    locationName: null,
    mappingStatus: "unmapped",
  });
  assert.match(message, /Bar: Beer Bar · Ikke mappet/);
});

test("eksplicit returbon-signal klassificeres som returbon", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({
    transactionType: "refund",
    total: -40,
    lines: [product("Kildevand", -2, -40)],
  }));
  assert.equal(analysis.classification, "return_receipt");
  assert.equal(analysis.controlTypes.includes("RETURN_RECEIPT"), true);
});

test("negative produktlinjer uden sikkert retursignal kræver manuel kontrol", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({
    total: -40,
    lines: [product("Kildevand", -2, -40)],
  }));
  assert.equal(analysis.classification, "uncertain");
  assert.deepEqual(analysis.controlTypes, ["MANUAL_REVIEW"]);
});

test("samme bon og kontroltype har stabil idempotency key ved replay og retry", () => {
  const analysis = analyzeOnlinePosReceipt(receipt({ receiptNumber: "IDEMPOTENT" }));
  assert.equal(
    buildOnlinePosReceiptControlKey(analysis.receiptKey, "HIGH_DEPOSIT_RETURN"),
    buildOnlinePosReceiptControlKey(analysis.receiptKey, "HIGH_DEPOSIT_RETURN"),
  );
  assert.equal(
    buildReceiptControlNotificationDedupeKey(analysis.receiptKey, "user-1"),
    buildReceiptControlNotificationDedupeKey(analysis.receiptKey, "user-1"),
  );
});
