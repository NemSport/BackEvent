import assert from "node:assert/strict";
import test from "node:test";
import { clampQrMoveQuantity, validateQrMoveLines } from "../qr-move-validation.ts";

test("QR move quantity cannot go below zero", () => {
  assert.equal(clampQrMoveQuantity(-1, 10), 0);
});

test("QR move quantity cannot exceed available stock", () => {
  assert.equal(clampQrMoveQuantity(12, 5), 5);
});

test("QR move requires at least one selected product", () => {
  const result = validateQrMoveLines([{ productId: "pepsi", quantity: 0, available: 4 }]);
  assert.equal(result.ok, false);
});

test("QR move accepts selected products within stock", () => {
  const result = validateQrMoveLines([{ productId: "pepsi", quantity: 2, available: 4 }]);
  assert.equal(result.ok, true);
});
