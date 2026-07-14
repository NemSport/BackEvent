import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnlinePosInventoryMapping } from "../onlinepos/inventory-mappings.ts";
import { calculateOnlinePosInventoryConsumption } from "../onlinepos/inventory-unit-conversion.ts";
import { loadReturnContext, parseOnlinePosReturn, registerAndProcessReturn } from "../onlinepos/returns.ts";
import {
  buildReturnTestTransaction,
  calculateReturnTestAdjustmentReversal,
  calculateReturnEconomy,
  calculateSignedReturnAmount,
  canCleanupReturnTestSource,
  defaultReturnInputUnit,
  getReturnInputUnitOptions,
  isDestructiveReturnTestScenario,
  isReturnTestHarnessEnabled,
  normalizeReturnTestScenario,
  prepareReturnTestLines,
  returnTestScenarios,
  scenarioLineType,
  scenarioMappingAction,
  scenarioProductGroup,
  scenarioProductName,
  shouldReverseReturnTestAdjustment,
  testIdempotencyKey,
  type PreparedReturnTestLine,
  type ReturnTestLineInput,
  type ReturnTestScenarioId,
} from "./return-test-harness-core.ts";

export {
  buildReturnTestTransaction,
  calculateReturnEconomy,
  calculateSignedReturnAmount,
  calculateReturnTestAdjustmentReversal,
  canCleanupReturnTestSource,
  defaultReturnInputUnit,
  getReturnInputUnitOptions,
  isDestructiveReturnTestScenario,
  isReturnTestHarnessEnabled,
  normalizeReturnTestScenario,
  prepareReturnTestLines,
  returnTestScenarios,
  shouldReverseReturnTestAdjustment,
};
export type { ReturnTestLineInput, ReturnTestScenarioId };

export type ReturnTestHarnessInput = {
  scenario: ReturnTestScenarioId;
  locationId: string;
  receiptNumber: string;
  returnedAt: string;
  runId: string;
  lines: ReturnTestLineInput[];
  createdByUserId: string;
  createdByName: string;
};

export async function runReturnTestHarnessScenario(supabase: SupabaseClient, input: ReturnTestHarnessInput) {
  const context = await loadReturnContext(supabase);
  const location = context.locations.find((item) => item.id === input.locationId) ?? null;

  if (!location && input.scenario !== "unknown_location") {
    throw new Error("Testlokation findes ikke");
  }

  const products = context.products.map((product) => ({
    id: product.id,
    name: product.name,
    unit: product.unit,
    units_per_case: product.units_per_case,
    purchase_unit_label: product.purchase_unit_label,
    units_per_purchase_unit: product.units_per_purchase_unit,
    stock_unit_label: product.stock_unit_label,
    content_per_stock_unit: product.content_per_stock_unit,
    consumption_unit_label: product.consumption_unit_label,
  }));
  const preparedLines = prepareReturnTestLines({
    scenario: input.scenario,
    runId: input.runId,
    lines: input.lines,
    products,
  });

  const transaction = buildReturnTestTransaction({
    scenario: input.scenario,
    locationName: input.scenario === "unknown_location" ? "Ukendt testlokation" : location?.name ?? "Ukendt testlokation",
    locationId: input.scenario === "unknown_location" ? "unknown-test-location" : location?.id ?? null,
    receiptNumber: input.receiptNumber,
    returnedAt: input.returnedAt,
    runId: input.runId,
    lines: preparedLines,
  });

  const parsedReturn = parseOnlinePosReturn(transaction);
  if (!parsedReturn) {
    throw new Error("Testretur kunne ikke parses");
  }

  parsedReturn.externalIdempotencyKey = testIdempotencyKey(input.runId);

  const extraMappings = preparedLines
    .filter((line) => line.product && input.scenario !== "unknown_product")
    .map((line) => buildTestMapping(input.scenario, line));
  const forceControlReasons = forcedControlReasons(input.scenario);

  return {
    ...(await registerAndProcessReturn(supabase, parsedReturn, context, {
      source: "test_harness",
      testScenario: input.scenario,
      createdByUserId: input.createdByUserId,
      createdByName: input.createdByName,
      extraMappings,
      forceControlReasons,
    })),
    previewLines: preparedLines.map((line) => ({
      clientLineId: line.clientLineId,
      productName: line.onlineposProductName,
      input: line.displayQuantity,
      stockImpact: line.displayStockImpact,
      calculatedStockQuantity: line.calculatedStockQuantity,
      lineType: line.lineType,
      parentLineId: line.parentLineId,
    })),
  };
}

function buildTestMapping(scenario: ReturnTestScenarioId, line: PreparedReturnTestLine): OnlinePosInventoryMapping {
  const action = scenarioMappingAction(scenario, line.lineType);
  const consumptionPerSale = line.product && action === "consume_stock"
    ? line.conversionFactor / calculateOnlinePosInventoryConsumption({
      soldQuantity: 1,
      consumptionPerSale: 1,
      product: {
        unit: line.product.unit,
        unitsPerCase: line.product.units_per_case,
        purchaseUnitLabel: line.product.purchase_unit_label,
        unitsPerPurchaseUnit: line.product.units_per_purchase_unit,
        stockUnitLabel: line.product.stock_unit_label,
        contentPerStockUnit: line.product.content_per_stock_unit,
        consumptionUnitLabel: line.product.consumption_unit_label,
      },
    }).storedQuantity
    : null;
  return {
    id: `test-harness-${line.lineId}`,
    onlineposProductId: line.onlineposProductId,
    onlineposProductName: scenarioProductName(scenario, line.lineType, line.product?.name ?? line.onlineposProductName),
    onlineposProductGroupName: scenarioProductGroup(scenario, line.lineType),
    lineType: scenarioLineType(scenario, line.lineType),
    backeventInventoryItemId: action === "consume_stock" ? line.product?.id ?? null : null,
    conversionFactor: action === "consume_stock" ? consumptionPerSale : null,
    mappingAction: action,
    status: "approved",
    components: action === "consume_stock" ? [{ backeventInventoryItemId: line.product?.id ?? null, conversionFactor: consumptionPerSale, sortOrder: 0 }] : [],
    createdAt: null,
    updatedAt: null,
  };
}

function forcedControlReasons(scenario: ReturnTestScenarioId) {
  if (scenario === "manual_review") return ["Manuel kontrol test"];
  if (scenario === "simulated_stock_failure" || scenario === "partial_failure") return ["Simuleret lagerfejl"];
  if (scenario === "simulated_waste_failure") return ["Simuleret svindfejl"];
  return [];
}
