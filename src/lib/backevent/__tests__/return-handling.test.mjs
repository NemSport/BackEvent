import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReturnHandlingAudit,
  filterProductsForReturnSetup,
  getReturnHandlingLabel,
  recommendReturnHandling,
} from "../return-handling.ts";

test("audit counts null separately from explicit manual_review", () => {
  const audit = buildReturnHandlingAudit([
    product("p1", "Kildevand", null),
    product("p2", "Mokai", "waste"),
    product("p3", "Tuborg", "manual_review"),
    product("p4", "Pepsi Max", "return_to_stock"),
    product("p5", "GEBYR - Krus", "no_stock_effect"),
  ]);

  assert.equal(audit.total, 5);
  assert.equal(audit.missing, 1);
  assert.equal(audit.waste, 1);
  assert.equal(audit.manualReview, 1);
  assert.equal(audit.returnToStock, 1);
  assert.equal(audit.noStockEffect, 1);
});

test("missing decision filter only returns database null products", () => {
  const products = [
    product("p1", "Kildevand", null),
    product("p2", "Tuborg", "manual_review"),
  ];

  const filtered = filterProductsForReturnSetup(products, {
    returnHandling: "missing",
    active: "all",
    group: "all",
  });

  assert.deepEqual(filtered.map((item) => item.id), ["p1"]);
});

test("recommendations are suggestions and do not change explicit values", () => {
  const mokai = product("p1", "Mokai", null);
  const kildevand = product("p2", "Kildevand", null);
  const fee = product("p3", "GEBYR - Krus", null);

  assert.equal(recommendReturnHandling(mokai), "waste");
  assert.equal(recommendReturnHandling(kildevand), "return_to_stock");
  assert.equal(recommendReturnHandling(fee), "no_stock_effect");
  assert.equal(mokai.returnHandlingExplicit, null);
});

test("labels distinguish missing from manual_review", () => {
  assert.equal(getReturnHandlingLabel(null), "Mangler beslutning");
  assert.equal(getReturnHandlingLabel("manual_review"), "Kræver manuel kontrol");
});

function product(id, name, explicit, overrides = {}) {
  return {
    id,
    name,
    unit: "stk",
    trackingMode: "inventory",
    returnHandling: explicit ?? "manual_review",
    returnHandlingExplicit: explicit,
    active: true,
    sortOrder: 1,
    ...overrides,
  };
}
