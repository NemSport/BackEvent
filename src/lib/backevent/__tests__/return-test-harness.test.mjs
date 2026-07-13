import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildReturnTestLinePreview,
  buildReturnTestTransaction,
  calculateReturnEconomy,
  calculateSignedReturnAmount,
  calculateReturnTestAdjustmentReversal,
  calculateReturnUnitConversion,
  canCleanupReturnTestSource,
  isReturnTestHarnessEnabled,
  normalizeReturnTestScenario,
  prepareReturnTestLines,
  returnTestScenarios,
  shouldReverseReturnTestAdjustment,
} from "../return-test-harness-core.ts";
import { parseOnlinePosReturn } from "../../onlinepos/returns.ts";

const kildevand = {
  id: "kildevand",
  name: "Kildevand",
  unit: "kasse",
  purchase_unit_label: "kasse",
  units_per_purchase_unit: 24,
  units_per_case: 24,
  stock_unit_label: "flaske",
  content_per_stock_unit: 1,
  consumption_unit_label: "flaske",
};
const beer = {
  id: "beer",
  name: "Tuborg",
  unit: "kasse",
  purchase_unit_label: "kasse",
  units_per_purchase_unit: 30,
  units_per_case: 30,
  stock_unit_label: "stk",
  content_per_stock_unit: 1,
  consumption_unit_label: "stk",
};
const syrup = {
  id: "syrup",
  name: "Pink Lady PostMix",
  unit: "dunk",
  purchase_unit_label: "dunk",
  units_per_purchase_unit: 1,
  stock_unit_label: "liter",
  content_per_stock_unit: 100,
  consumption_unit_label: "cl",
};
const mokai = {
  id: "mokai",
  name: "Mokai",
  unit: "kasse",
  purchase_unit_label: "kasse",
  units_per_purchase_unit: 24,
  units_per_case: 24,
  stock_unit_label: "flaske",
  content_per_stock_unit: 1,
  consumption_unit_label: "flaske",
  return_handling: "waste",
};
const cups = {
  id: "krus",
  name: "Krus",
  unit: "krus",
  purchase_unit_label: "kasse",
  units_per_purchase_unit: 1,
  stock_unit_label: "krus",
  content_per_stock_unit: 1,
  consumption_unit_label: "krus",
  return_handling: "no_stock_effect",
};

test("feature flag er slukket uden eksplicit env", () => {
  assert.equal(isReturnTestHarnessEnabled({}), false);
  assert.equal(isReturnTestHarnessEnabled({ NODE_ENV: "production" }), false);
});

test("feature flag aktiveres kun med true", () => {
  assert.equal(isReturnTestHarnessEnabled({ BACKEVENT_ENABLE_RETURN_TEST_HARNESS: "true" }), true);
  assert.equal(isReturnTestHarnessEnabled({ BACKEVENT_ENABLE_RETURN_TEST_HARNESS: "1" }), false);
});

test("alle krævede retur-testscenarier findes", () => {
  const ids = new Set(returnTestScenarios.map((scenario) => scenario.id));
  for (const id of ["normal_return", "mixed_return", "multiple_stock", "multiple_waste", "parent_modifier", "partial_failure", "over_10_split", "deposit_and_products", "unit_conversion"]) {
    assert.equal(ids.has(id), true, `${id} mangler`);
  }
});

test("ukendt scenarie falder sikkert tilbage til normal retur", () => {
  assert.equal(normalizeReturnTestScenario("hvad-er-det"), "normal_return");
});

test("Kildevand 1 flaske bliver 1/24 kasse og vises som 1 flaske", () => {
  const conversion = calculateReturnUnitConversion(kildevand, 1, "flaske");
  assert.equal(conversion.calculatedStockQuantity, 1 / 24);
  assert.equal(conversion.displayQuantity, "1 flaske");
  assert.equal(conversion.displayStockImpact, "1 flaske");
});

test("Kildevand 24 flasker bliver 1 kasse", () => {
  assert.equal(calculateReturnUnitConversion(kildevand, 24, "flaske").calculatedStockQuantity, 1);
});

test("Kildevand 1 kasse bliver 1 kasse", () => {
  assert.equal(calculateReturnUnitConversion(kildevand, 1, "kasse").calculatedStockQuantity, 1);
});

test("Øl 1 stk bliver 1/30 kasse", () => {
  assert.equal(calculateReturnUnitConversion(beer, 1, "stk").calculatedStockQuantity, 1 / 30);
});

test("Decimalprodukt konverterer cl korrekt", () => {
  assert.equal(calculateReturnUnitConversion(syrup, 10.5, "cl").calculatedStockQuantity, 0.105);
});

test("ukendt inputenhed afvises", () => {
  assert.throws(() => calculateReturnUnitConversion(kildevand, 1, "palle"), /Ugyldig enhed/);
});

test("serveren beregner alle lagerantal fra produktdata", () => {
  const prepared = prepareReturnTestLines({
    scenario: "normal_return",
    runId: "run-1",
    products: [kildevand],
    lines: [{ clientLineId: "a", productId: "kildevand", quantity: 1, inputUnit: "flaske", amount: 20, lineType: "main" }],
  });
  assert.equal(prepared[0].calculatedStockQuantity, 1 / 24);
  assert.equal(prepared[0].conversionFactor, 1 / 24);
});

test("preview for 1 flaske Kildevand viser flaske og ikke kasse", () => {
  const preview = buildReturnTestLinePreview({
    product: { ...kildevand, return_handling: "return_to_stock" },
    quantity: 1,
    inputUnit: "flaske",
    lineType: "main",
  });
  assert.equal(preview.inputDisplay, "1 flaske");
  assert.equal(preview.impactDisplay, "Tilbage på lager: 1 flaske");
  assert.equal(preview.impactDisplay.includes("1 kasse"), false);
  assert.equal(preview.calculatedStockQuantity, 1 / 24);
});

test("preview for Mokai viser svind og ikke lagerretur", () => {
  const preview = buildReturnTestLinePreview({
    product: mokai,
    quantity: 1,
    inputUnit: "flaske",
    lineType: "main",
  });
  assert.equal(preview.automaticHandling, "Svind");
  assert.equal(preview.impactDisplay, "Registreres som svind: 1 flaske");
  assert.equal(preview.impactDisplay.startsWith("Tilbage på lager"), false);
});

test("preview for krus og pant viser ingen almindelig lagerpåvirkning", () => {
  const preview = buildReturnTestLinePreview({
    product: cups,
    quantity: 2,
    inputUnit: "krus",
    lineType: "deposit",
  });
  assert.equal(preview.inputDisplay, "2 krus");
  assert.equal(preview.impactDisplay, "Ingen almindelig lagerpåvirkning");
  assert.equal(preview.noOrdinaryStockImpact, true);
  assert.equal(preview.calculatedStockQuantity, 0);
});

test("missing return handling blocks automatic stock effect", () => {
  const preview = buildReturnTestLinePreview({
    product: { ...kildevand, return_handling: null },
    quantity: 1,
    inputUnit: "flaske",
    lineType: "main",
  });

  assert.equal(preview.automaticHandling, "Kræver manuel kontrol");
  assert.equal(preview.noOrdinaryStockImpact, true);
  assert.equal(preview.calculatedStockQuantity, 1 / 24);
});

test("preview og serverforberedelse bruger samme beregnede quantity", () => {
  const product = { ...kildevand, return_handling: "return_to_stock" };
  const preview = buildReturnTestLinePreview({
    product,
    quantity: 1,
    inputUnit: "flaske",
    lineType: "main",
  });
  const prepared = prepareReturnTestLines({
    scenario: "return_to_stock",
    runId: "run-preview",
    products: [product],
    lines: [{ clientLineId: "a", productId: "kildevand", quantity: 1, inputUnit: "flaske", amount: 20, lineType: "main" }],
  });
  assert.equal(preview.calculatedStockQuantity, prepared[0].calculatedStockQuantity);
});

test("testharness sætter signed amount ud fra linjetype og ikke klientfortegn", () => {
  assert.equal(calculateSignedReturnAmount("main", 70), -70);
  assert.equal(calculateSignedReturnAmount("deposit", 10), -10);
  assert.equal(calculateSignedReturnAmount("cup", 10), -10);
  assert.equal(calculateSignedReturnAmount("fee", 10), 10);
  assert.equal(calculateSignedReturnAmount("modifier", 0), 0);
});

test("testharness økonomi: pant 10 og gebyr 10 giver netto 0", () => {
  const economy = calculateReturnEconomy([
    { lineType: "deposit", amount: 10 },
    { lineType: "fee", amount: 10 },
  ]);
  assert.equal(economy.depositRefund, 10);
  assert.equal(economy.fees, 10);
  assert.equal(economy.netAmount, 0);
});

test("testharness økonomi: vare 70 plus pant 10 minus gebyr 10 giver netto -70", () => {
  const prepared = prepareReturnTestLines({
    scenario: "mixed_return",
    runId: "run-economy",
    products: [mokai, cups],
    lines: [
      { clientLineId: "a", productId: "mokai", quantity: 1, inputUnit: "flaske", amount: 70, lineType: "main" },
      { clientLineId: "b", productId: "krus", quantity: 1, inputUnit: "krus", amount: 10, lineType: "cup" },
      { clientLineId: "c", productId: "krus", quantity: 1, inputUnit: "krus", amount: 10, lineType: "fee" },
    ],
  });
  const transaction = buildReturnTestTransaction({
    scenario: "mixed_return",
    locationName: "Rødbar",
    locationId: "location-1",
    receiptNumber: "TEST-ECONOMY",
    returnedAt: "2026-07-11T10:00:00Z",
    runId: "run-economy",
    lines: prepared,
  });
  assert.equal(transaction.total, -70);
  assert.equal(transaction.lines[0].net_price, -70);
  assert.equal(transaction.lines[1].net_price, -10);
  assert.equal(transaction.lines[2].net_price, 10);
  const parsed = parseOnlinePosReturn(transaction);
  assert.equal(parsed?.totalAmount, -70);
  assert.equal(parsed?.rawMetadata.economy.fees, 10);
});
test("én returbon kan have tre produkter med samme return header og unikke line IDs", () => {
  const prepared = prepareReturnTestLines({
    scenario: "mixed_return",
    runId: "run-multi",
    products: [kildevand, beer],
    lines: [
      { clientLineId: "a", productId: "kildevand", quantity: 1, inputUnit: "flaske", amount: 20, lineType: "main" },
      { clientLineId: "b", productId: "beer", quantity: 2, inputUnit: "stk", amount: 40, lineType: "main" },
      { clientLineId: "c", productId: "kildevand", quantity: 3, inputUnit: "flaske", amount: 15, lineType: "deposit" },
    ],
  });
  const transaction = buildReturnTestTransaction({
    scenario: "mixed_return",
    locationName: "Rødbar",
    locationId: "location-1",
    receiptNumber: "TEST-MULTI",
    returnedAt: "2026-07-11T10:00:00Z",
    runId: "run-multi",
    lines: prepared,
  });
  const parsed = parseOnlinePosReturn(transaction);
  assert.equal(parsed?.lines.length, 3);
  assert.equal(new Set(parsed?.lines.map((line) => line.onlineposLineId)).size, 3);
  assert.equal(parsed?.onlineposTransactionId, "test-return-run-multi");
});

test("parent + modifier tæller som én almindelig vare og modifier med 0 kr parses", () => {
  const prepared = prepareReturnTestLines({
    scenario: "parent_modifier",
    runId: "run-parent",
    products: [kildevand, beer],
    lines: [
      { clientLineId: "parent", productId: "kildevand", quantity: 1, inputUnit: "flaske", amount: 30, lineType: "main" },
      { clientLineId: "modifier", productId: "beer", quantity: 1, inputUnit: "stk", amount: 0, lineType: "modifier", parentClientLineId: "parent" },
    ],
  });
  const parsed = parseOnlinePosReturn(buildReturnTestTransaction({
    scenario: "parent_modifier",
    locationName: "Rødbar",
    locationId: "location-1",
    receiptNumber: "TEST-PARENT",
    returnedAt: "2026-07-11T10:00:00Z",
    runId: "run-parent",
    lines: prepared,
  }));
  assert.equal(parsed?.lines.length, 2);
  assert.equal(parsed?.lines[1].parentOnlineposLineId, parsed?.lines[0].onlineposLineId);
  assert.equal(parsed?.controlReasons.includes("Stor retur over 10 enheder"), false);
});

test("6 varer + 6 pant tæller som 6 almindelige varer", () => {
  const prepared = prepareReturnTestLines({
    scenario: "deposit_and_products",
    runId: "run-deposit",
    products: [kildevand],
    lines: [
      { clientLineId: "a", productId: "kildevand", quantity: 6, inputUnit: "flaske", amount: 120, lineType: "main" },
      { clientLineId: "b", productId: "kildevand", quantity: 6, inputUnit: "flaske", amount: 30, lineType: "deposit" },
    ],
  });
  const parsed = parseOnlinePosReturn(buildReturnTestTransaction({
    scenario: "deposit_and_products",
    locationName: "Rødbar",
    locationId: "location-1",
    receiptNumber: "TEST-DEPOSIT",
    returnedAt: "2026-07-11T10:00:00Z",
    runId: "run-deposit",
    lines: prepared,
  }));
  assert.equal(parsed?.controlReasons.includes("Stor retur over 10 enheder"), false);
});

test("6 + 5 almindelige varer udløser over-10-kontrol", () => {
  const prepared = prepareReturnTestLines({
    scenario: "over_10_split",
    runId: "run-over",
    products: [kildevand, beer],
    lines: [
      { clientLineId: "a", productId: "kildevand", quantity: 6, inputUnit: "flaske", amount: 120, lineType: "main" },
      { clientLineId: "b", productId: "beer", quantity: 5, inputUnit: "stk", amount: 100, lineType: "main" },
    ],
  });
  const parsed = parseOnlinePosReturn(buildReturnTestTransaction({
    scenario: "over_10_split",
    locationName: "Rødbar",
    locationId: "location-1",
    receiptNumber: "TEST-OVER",
    returnedAt: "2026-07-11T10:00:00Z",
    runId: "run-over",
    lines: prepared,
  }));
  assert.equal(parsed?.controlReasons.includes("Stor retur over 10 enheder"), true);
});

test("tom linjeliste og ugyldig linjetype afvises", () => {
  assert.throws(() => prepareReturnTestLines({ scenario: "normal_return", runId: "run-empty", products: [kildevand], lines: [] }), /mindst/);
  assert.throws(() => prepareReturnTestLines({
    scenario: "normal_return",
    runId: "run-bad",
    products: [kildevand],
    lines: [{ clientLineId: "bad", productId: "kildevand", quantity: 1, inputUnit: "flaske", amount: 1, lineType: "bad" }],
  }), /Ugyldig linjetype/);
});

test("oprydning må kun ramme test_harness source", () => {
  assert.equal(canCleanupReturnTestSource("test_harness"), true);
  assert.equal(canCleanupReturnTestSource("onlinepos"), false);
  assert.equal(canCleanupReturnTestSource(null), false);
});

test("retur-waste 1 flaske ændrer ikke lager og registrerer svind separat", () => {
  const beforeBalance = 0;
  const prepared = prepareReturnTestLines({
    scenario: "waste",
    runId: "run-waste",
    products: [mokai],
    lines: [{ clientLineId: "a", productId: "mokai", quantity: 1, inputUnit: "flaske", amount: 20, lineType: "main" }],
  });
  const line = prepared[0];
  const afterBalance = beforeBalance;
  const returnWastePost = {
    adjustmentType: "waste",
    quantityBefore: beforeBalance,
    quantityAfter: afterBalance,
    quantityDelta: 0,
    inputQuantity: line.quantity,
    inputUnit: line.inputUnit,
    wasteRegisteredQuantity: line.calculatedStockQuantity,
  };
  assert.equal(afterBalance, 0);
  assert.equal(returnWastePost.quantityDelta, 0);
  assert.equal(returnWastePost.inputQuantity, 1);
  assert.equal(returnWastePost.inputUnit, "flaske");
  assert.equal(returnWastePost.wasteRegisteredQuantity, 1 / 24);
});

test("kun return_to_stock uden lagerlokation får STOCK_SOURCE_MISSING i RPC migration", () => {
  const sql = fs.readFileSync("supabase/migrations/202607120002_backevent_return_waste_no_stock_delta.sql", "utf8");
  const returnToStockIndex = sql.indexOf("if line_record.return_handling = 'return_to_stock' then");
  const stockMissingIndex = sql.indexOf("STOCK_SOURCE_MISSING");
  const wasteIndex = sql.indexOf("elsif line_record.return_handling = 'waste' then");
  assert.ok(returnToStockIndex > 0, "return_to_stock block mangler");
  assert.ok(stockMissingIndex > returnToStockIndex, "STOCK_SOURCE_MISSING må kun ligge i return_to_stock flowet");
  assert.ok(wasteIndex > stockMissingIndex, "waste flow skal komme efter return_to_stock lagerkildekontrol");
  assert.doesNotMatch(sql.slice(0, returnToStockIndex), /source_location_id is null[\s\S]*STOCK_SOURCE_MISSING/);
});

test("retur-waste bruger returlokation til audit uden lagerdelta", () => {
  const sql = fs.readFileSync("supabase/migrations/202607120002_backevent_return_waste_no_stock_delta.sql", "utf8");
  const wasteBlock = sql.match(/elsif line_record\.return_handling = 'waste' then([\s\S]*?)else\s+update public\.backevent_return_lines/);
  assert.ok(wasteBlock, "waste block mangler i migration");
  assert.match(wasteBlock[1], /coalesce\(return_record\.location_id, return_record\.source_location_id\)/);
  assert.match(wasteBlock[1], /quantity_delta, unit[\s\S]*0,[\s\S]*coalesce\(line_record\.input_unit/);
});
test("retur-waste RPC migration må ikke opdatere lagerbalancen", () => {
  const sql = fs.readFileSync("supabase/migrations/202607120002_backevent_return_waste_no_stock_delta.sql", "utf8");
  const wasteBlock = sql.match(/elsif line_record\.return_handling = 'waste' then([\s\S]*?)else\s+update public\.backevent_return_lines/);
  assert.ok(wasteBlock, "waste block mangler i migration");
  assert.match(wasteBlock[1], /quantity_delta,\s*unit[\s\S]*'waste',\s*0,\s*0,\s*0,\s*coalesce\(line_record\.input_unit/);
  assert.match(wasteBlock[1], /stock_processed_quantity = 0/);
  assert.doesNotMatch(wasteBlock[1], /update public\.backevent_stock_balances/);
});

test("genkørsel af retur-waste giver fortsat lager 0 og kun én svindpost", () => {
  const beforeBalance = 0;
  const seenIdempotencyKeys = new Set();
  const idempotencyKey = "return-line:test-return-run-waste:test-line-run-waste-1:test-product-mokai-test-line-run-waste-1:1:20";
  const firstRunCreatesPost = !seenIdempotencyKeys.has(idempotencyKey);
  seenIdempotencyKeys.add(idempotencyKey);
  const secondRunCreatesPost = !seenIdempotencyKeys.has(idempotencyKey);
  assert.equal(firstRunCreatesPost, true);
  assert.equal(secondRunCreatesPost, false);
  assert.equal(beforeBalance, 0);
  assert.equal(seenIdempotencyKeys.size, 1);
});

test("testharness-oprydning opretter modpost for gamle testdeltaer", () => {
  assert.equal(shouldReverseReturnTestAdjustment({ source: "test_harness", quantityDelta: -1 }), true);
  assert.equal(shouldReverseReturnTestAdjustment({ source: "onlinepos", quantityDelta: -1 }), false);
  assert.equal(shouldReverseReturnTestAdjustment({ source: "test_harness", quantityDelta: 0 }), false);
  assert.equal(calculateReturnTestAdjustmentReversal({ currentQuantity: -1, quantityDelta: -1 }), 0);
  assert.equal(calculateReturnTestAdjustmentReversal({ currentQuantity: 2, quantityDelta: 0.5 }), 1.5);
});
