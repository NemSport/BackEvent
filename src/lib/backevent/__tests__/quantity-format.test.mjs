import assert from "node:assert/strict";
import test from "node:test";
import { formatStockQuantity } from "../quantity-format.ts";

test("viser kasser og resterende styk", () => {
  assert.equal(
    formatStockQuantity(9 + 23 / 24, {
      unit: "kasser",
      purchaseUnitLabel: "kasser",
      unitsPerPurchaseUnit: 24,
      stockUnitLabel: "stk.",
      contentPerStockUnit: 1,
      consumptionUnitLabel: "stk.",
    }),
    "9 kasser + 23 stk.",
  );
});

test("viser dunke og resterende liter", () => {
  assert.equal(
    formatStockQuantity(4.5, {
      unit: "dunke",
      purchaseUnitLabel: "dunke",
      unitsPerPurchaseUnit: 1,
      stockUnitLabel: "dunk",
      contentPerStockUnit: 5,
      consumptionUnitLabel: "liter",
    }),
    "4 dunke + 2,5 liter",
  );
});

test("viser flasker og resterende cl", () => {
  assert.equal(
    formatStockQuantity(2.5, {
      unit: "flasker",
      purchaseUnitLabel: "flasker",
      unitsPerPurchaseUnit: 1,
      stockUnitLabel: "flaske",
      contentPerStockUnit: 70,
      consumptionUnitLabel: "cl",
    }),
    "2 flasker + 35 cl",
  );
});

test("rå visning bevarer decimal når admin/debug har brug for den", () => {
  assert.equal(
    formatStockQuantity(9.9583, { unit: "kasser" }, "raw"),
    "9,96 kasser",
  );
});
