import assert from "node:assert/strict";
import test from "node:test";
import { mapProductRow, normalizeReturnHandling, withProductDefaults } from "../product-mapping.ts";

test("product with return_handling waste is fetched as waste", () => {
  const product = mapProductRow(baseRow({ return_handling: "waste" }));
  assert.equal(product.returnHandling, "waste");
  assert.equal(product.returnHandlingExplicit, "waste");
});

test("refetch after update from manual_review to waste shows waste", () => {
  const before = mapProductRow(baseRow({ return_handling: "manual_review" }));
  const after = mapProductRow(baseRow({ return_handling: "waste" }));

  assert.equal(before.returnHandling, "manual_review");
  assert.equal(before.returnHandlingExplicit, "manual_review");
  assert.equal(after.returnHandling, "waste");
  assert.equal(after.returnHandlingExplicit, "waste");
});

test("null return_handling falls back to manual_review display only", () => {
  const product = mapProductRow(baseRow({ return_handling: null }));
  assert.equal(product.returnHandling, "manual_review");
  assert.equal(product.returnHandlingExplicit, null);
});

test("explicit manual_review is distinct from null", () => {
  const product = mapProductRow(baseRow({ return_handling: "manual_review" }));
  assert.equal(product.returnHandling, "manual_review");
  assert.equal(product.returnHandlingExplicit, "manual_review");
});

test("valid saved value is not overwritten by client default", () => {
  const refetched = withProductDefaults({
    id: "product-1",
    name: "Kildevand",
    unit: "stk",
    returnHandling: normalizeReturnHandling("return_to_stock"),
    returnHandlingExplicit: "return_to_stock",
  });

  assert.equal(refetched.returnHandling, "return_to_stock");
  assert.equal(refetched.returnHandlingExplicit, "return_to_stock");
});

test("explicit null is not overwritten by display fallback", () => {
  const refetched = withProductDefaults({
    id: "product-1",
    name: "Kildevand",
    unit: "stk",
    returnHandling: "manual_review",
    returnHandlingExplicit: null,
  });

  assert.equal(refetched.returnHandling, "manual_review");
  assert.equal(refetched.returnHandlingExplicit, null);
});

function baseRow(overrides = {}) {
  return {
    id: "product-1",
    name: "Kildevand",
    unit: "stk",
    tracking_mode: "inventory",
    return_handling: "manual_review",
    onlinepos_product_id: null,
    onlinepos_name: null,
    sales_unit_quantity: 1,
    liters_per_sale: null,
    units_per_case: null,
    purchase_unit_label: "kasse",
    units_per_purchase_unit: 24,
    stock_unit_label: "stk",
    content_per_stock_unit: 1,
    consumption_unit_label: "stk",
    sort_order: 1,
    active: true,
    ...overrides,
  };
}
