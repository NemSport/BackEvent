import assert from "node:assert/strict";
import test from "node:test";
import { calculateOnlinePosInventoryConsumption } from "../inventory-unit-conversion.ts";

test("Shaker Sport: 5 salg af 1 dåse bliver 5/24 kasse og vises som 5 dåser", () => {
  const result = calculateOnlinePosInventoryConsumption({
    soldQuantity: 5,
    consumptionPerSale: 1,
    product: {
      unit: "kasser",
      purchaseUnitLabel: "kasse",
      unitsPerPurchaseUnit: 24,
      stockUnitLabel: "dåse",
      contentPerStockUnit: 1,
      consumptionUnitLabel: "dåser",
    },
  });
  assert.equal(result.storedQuantity, 5 / 24);
  assert.equal(result.diagnostics.totalConsumptionQuantity, 5);
  assert.equal(result.diagnostics.conversionDivisor, 24);
  assert.equal(result.diagnostics.finalStoredDelta, -5 / 24);
  assert.equal(result.diagnostics.humanReadableDelta, "-5 dåser");
});

test("Postmix: 5 salg af 10,5 cl bliver 52,5/500 kasse og vises som 52,5 cl", () => {
  const result = calculateOnlinePosInventoryConsumption({
    soldQuantity: 5,
    consumptionPerSale: 10.5,
    product: {
      unit: "kasser",
      purchaseUnitLabel: "kasse",
      unitsPerPurchaseUnit: 1,
      stockUnitLabel: "sirupskasse",
      contentPerStockUnit: 500,
      consumptionUnitLabel: "cl",
    },
  });
  assert.equal(result.storedQuantity, 0.105);
  assert.equal(result.diagnostics.totalConsumptionQuantity, 52.5);
  assert.equal(result.diagnostics.conversionDivisor, 500);
  assert.equal(result.diagnostics.finalStoredDelta, -0.105);
  assert.equal(result.diagnostics.humanReadableDelta, "-52,5 cl");
});

test("eksisterende lagerenheder konverterer uden manglende eller dobbelt konvertering", () => {
  const storedDirectly = calculateOnlinePosInventoryConsumption({
    soldQuantity: 3,
    consumptionPerSale: 2,
    product: { unit: "stk", consumptionUnitLabel: "stk", unitsPerPurchaseUnit: 24 },
  });
  const bottles = calculateOnlinePosInventoryConsumption({
    soldQuantity: 6,
    consumptionPerSale: 1,
    product: { unit: "kasser", unitsPerPurchaseUnit: 24, stockUnitLabel: "flasker", consumptionUnitLabel: "flasker" },
  });
  const liters = calculateOnlinePosInventoryConsumption({
    soldQuantity: 4,
    consumptionPerSale: 0.5,
    product: { unit: "dunke", unitsPerPurchaseUnit: 1, contentPerStockUnit: 20, stockUnitLabel: "dunk", consumptionUnitLabel: "liter" },
  });
  assert.equal(storedDirectly.storedQuantity, 6);
  assert.equal(bottles.storedQuantity, 0.25);
  assert.equal(liters.storedQuantity, 0.1);
});
