import type { OnlinePosLineType, OnlinePosMappingAction } from "../onlinepos/inventory-mappings";

export const returnTestScenarios = [
  { id: "normal_return", label: "Normal retur" },
  { id: "return_to_stock", label: "Retur til lager" },
  { id: "waste", label: "Svind" },
  { id: "manual_review", label: "Manuel kontrol" },
  { id: "no_stock_effect", label: "Ingen lagerpåvirkning" },
  { id: "unknown_product", label: "Ukendt produkt" },
  { id: "unknown_location", label: "Ukendt lokation" },
  { id: "duplicate", label: "Dublet" },
  { id: "duplicate_changed", label: "Dublet med ændret indhold" },
  { id: "over_10_units", label: "Over 10 enheder" },
  { id: "deposit", label: "Pant" },
  { id: "cup_fee", label: "GEBYR - Krus" },
  { id: "cup_return", label: "RETUR - Krus" },
  { id: "simulated_stock_failure", label: "Simuleret lagerfejl" },
  { id: "simulated_waste_failure", label: "Simuleret svindfejl" },
  { id: "mixed_return", label: "Blandet retur" },
  { id: "multiple_stock", label: "Flere lagerprodukter" },
  { id: "multiple_waste", label: "Flere svindprodukter" },
  { id: "parent_modifier", label: "Parent + modifier" },
  { id: "partial_failure", label: "Delvist fejlet retur" },
  { id: "over_10_split", label: "Over 10 fordelt" },
  { id: "deposit_and_products", label: "Pant og varer" },
  { id: "unit_conversion", label: "Enhedstest" },
] as const;

export type ReturnTestScenarioId = (typeof returnTestScenarios)[number]["id"];
export type ReturnTestLineType = "main" | "modifier" | "deposit" | "cup" | "fee";
export type ReturnLineEconomicDirection = "refund" | "charge" | "neutral";

export type ReturnTestProductUnitModel = {
  unit?: string | null;
  units_per_case?: number | string | null;
  purchase_unit_label?: string | null;
  units_per_purchase_unit?: number | string | null;
  stock_unit_label?: string | null;
  content_per_stock_unit?: number | string | null;
  consumption_unit_label?: string | null;
};

export type ReturnTestLineInput = {
  clientLineId: string;
  productId: string;
  quantity: number;
  inputUnit: string;
  amount: number;
  lineType: ReturnTestLineType;
  parentClientLineId?: string | null;
};

export type ReturnTestLineProduct = ReturnTestProductUnitModel & {
  id: string;
  name: string;
  return_handling?: ReturnTestReturnHandling | null;
};

export type ReturnTestReturnHandling = "return_to_stock" | "waste" | "manual_review" | "no_stock_effect";

export type ReturnTestLinePreview = {
  inputDisplay: string;
  automaticHandling: string;
  impactDisplay: string;
  secondaryImpact: string | null;
  calculatedStockQuantity: number;
  noOrdinaryStockImpact: boolean;
};

export type PreparedReturnTestLine = ReturnTestLineInput & {
  product: ReturnTestLineProduct | null;
  onlineposProductId: string;
  onlineposProductName: string;
  productGroupName: string;
  lineId: string;
  parentLineId: string | null;
  conversionFactor: number;
  calculatedStockQuantity: number;
  displayQuantity: string;
  displayStockImpact: string;
  economicDirection: ReturnLineEconomicDirection;
  signedAmount: number;
};

const scenarioIds = new Set<string>(returnTestScenarios.map((scenario) => scenario.id));

export function isReturnTestHarnessEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.BACKEVENT_ENABLE_RETURN_TEST_HARNESS === "true";
}

export function normalizeReturnTestScenario(value: unknown): ReturnTestScenarioId {
  return typeof value === "string" && scenarioIds.has(value) ? (value as ReturnTestScenarioId) : "normal_return";
}

export function isDestructiveReturnTestScenario(scenario: ReturnTestScenarioId) {
  return ["return_to_stock", "waste", "duplicate", "duplicate_changed", "mixed_return", "multiple_stock", "multiple_waste"].includes(scenario);
}

export function canCleanupReturnTestSource(source: unknown) {
  return source === "test_harness";
}

export function shouldReverseReturnTestAdjustment(input: { source: unknown; quantityDelta: unknown }) {
  const delta = typeof input.quantityDelta === "number" ? input.quantityDelta : Number(input.quantityDelta);
  return canCleanupReturnTestSource(input.source) && Number.isFinite(delta) && delta !== 0;
}

export function calculateReturnTestAdjustmentReversal(input: { currentQuantity: unknown; quantityDelta: unknown }) {
  const currentQuantity = typeof input.currentQuantity === "number" ? input.currentQuantity : Number(input.currentQuantity);
  const quantityDelta = typeof input.quantityDelta === "number" ? input.quantityDelta : Number(input.quantityDelta);
  if (!Number.isFinite(currentQuantity) || !Number.isFinite(quantityDelta)) {
    throw new Error("Testjustering kan ikke reverseres");
  }
  return currentQuantity - quantityDelta;
}

export function buildReturnTestTransaction(input: {
  scenario: ReturnTestScenarioId;
  locationName: string;
  locationId: string | null;
  receiptNumber: string;
  returnedAt: string;
  runId: string;
  lines: PreparedReturnTestLine[];
}) {
  const total = roundNumber(calculateReturnEconomy(input.lines).netAmount);
  return {
    id: `test-return-${input.runId}`,
    transaction_id: `test-return-${input.runId}`,
    return_id: `test-refund-${input.runId}`,
    receipt_number: input.receiptNumber,
    datetime: input.returnedAt,
    total,
    type: "refund",
    cash_register: {
      id: input.locationId,
      name: input.locationName,
    },
    lines: input.lines.map((line) => ({
      id: line.lineId,
      line_id: line.lineId,
      parent_line_id: line.parentLineId,
      product_id: line.onlineposProductId,
      product_name: line.onlineposProductName,
      receipt_text: line.onlineposProductName,
      product_group_name: line.productGroupName,
      input_unit: line.inputUnit,
      quantity: -Math.abs(line.quantity),
      economic_direction: line.economicDirection,
      net_price: line.signedAmount,
      price: line.signedAmount,
    })),
  };
}

export function prepareReturnTestLines(input: {
  scenario: ReturnTestScenarioId;
  runId: string;
  lines: ReturnTestLineInput[];
  products: ReturnTestLineProduct[];
}) {
  if (input.lines.length === 0) {
    throw new Error("Tilføj mindst én returlinje");
  }

  return input.lines.map((line, index) => {
    if (!["main", "modifier", "deposit", "cup", "fee"].includes(line.lineType)) {
      throw new Error("Ugyldig linjetype");
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error("Antal skal være over 0");
    }

    const product = input.scenario === "unknown_product" ? null : input.products.find((item) => item.id === line.productId) ?? null;
    if (!product && input.scenario !== "unknown_product") {
      throw new Error("Testprodukt findes ikke");
    }

    const conversion = product
      ? calculateReturnUnitConversion(product, line.quantity, line.inputUnit)
      : { conversionFactor: 0, calculatedStockQuantity: 0, displayQuantity: `${line.quantity} ${line.inputUnit}`, displayStockImpact: "Ukendt produkt" };
    const lineId = `test-line-${input.runId}-${index + 1}`;
    const parentIndex = line.parentClientLineId ? input.lines.findIndex((item) => item.clientLineId === line.parentClientLineId) : -1;
    const economicDirection = getReturnLineEconomicDirection(line.lineType, line.amount);
    const signedAmount = calculateSignedReturnAmount(line.lineType, line.amount);

    return {
      ...line,
      product,
      onlineposProductId: product ? testOnlinePosProductId(product.id, lineId) : `unknown-test-product-${input.runId}-${index + 1}`,
      onlineposProductName: scenarioProductName(input.scenario, line.lineType, product?.name ?? "Ukendt testprodukt"),
      productGroupName: scenarioProductGroup(input.scenario, line.lineType),
      lineId,
      parentLineId: parentIndex >= 0 ? `test-line-${input.runId}-${parentIndex + 1}` : null,
      economicDirection,
      signedAmount,
      ...conversion,
    };
  });
}

export function getReturnLineEconomicDirection(lineType: ReturnTestLineType, amount = 0): ReturnLineEconomicDirection {
  if (lineType === "fee") return "charge";
  if (lineType === "modifier" && Math.abs(amount) === 0) return "neutral";
  return "refund";
}

export function calculateSignedReturnAmount(lineType: ReturnTestLineType, amount: number) {
  const absoluteAmount = Math.abs(amount);
  const direction = getReturnLineEconomicDirection(lineType, amount);
  if (direction === "charge") return roundNumber(absoluteAmount);
  if (direction === "neutral") return 0;
  return -roundNumber(absoluteAmount);
}

export function calculateReturnEconomy(lines: Array<{ lineType: ReturnTestLineType; amount: number; signedAmount?: number | null }>) {
  return lines.reduce(
    (summary, line) => {
      const signedAmount = typeof line.signedAmount === "number" ? line.signedAmount : calculateSignedReturnAmount(line.lineType, line.amount);
      const absolute = Math.abs(signedAmount);
      if (line.lineType === "main" || line.lineType === "modifier") summary.productRefund += signedAmount < 0 ? absolute : 0;
      if (line.lineType === "deposit") summary.depositRefund += signedAmount < 0 ? absolute : 0;
      if (line.lineType === "cup") summary.cupRefund += signedAmount < 0 ? absolute : 0;
      if (line.lineType === "fee") summary.fees += signedAmount > 0 ? signedAmount : 0;
      summary.netAmount = roundNumber(summary.netAmount + signedAmount);
      return summary;
    },
    { productRefund: 0, depositRefund: 0, cupRefund: 0, fees: 0, netAmount: 0 },
  );
}

export function calculateReturnUnitConversion(product: ReturnTestProductUnitModel, quantity: number, inputUnit: string) {
  const unit = normalizeUnit(inputUnit);
  const options = getReturnInputUnitOptions(product);
  if (!options.some((option) => normalizeUnit(option.value) === unit)) {
    throw new Error(`Ugyldig enhed: ${inputUnit}`);
  }

  const purchaseUnit = normalizeUnit(product.purchase_unit_label ?? product.unit ?? "kasse");
  const stockUnit = normalizeUnit(product.stock_unit_label ?? "stk");
  const consumptionUnit = normalizeUnit(product.consumption_unit_label ?? "");
  const unitsPerPurchaseUnit = positiveNumber(product.units_per_purchase_unit ?? product.units_per_case) ?? 1;
  const contentPerStockUnit = positiveNumber(product.content_per_stock_unit) ?? 1;

  let calculatedStockQuantity: number;
  if (unit === purchaseUnit || unit === normalizeUnit(product.unit)) {
    calculatedStockQuantity = quantity;
  } else if (unit === stockUnit) {
    calculatedStockQuantity = quantity / unitsPerPurchaseUnit;
  } else if (consumptionUnit && unit === consumptionUnit) {
    calculatedStockQuantity = quantity / (unitsPerPurchaseUnit * contentPerStockUnit);
  } else {
    throw new Error(`Ugyldig enhed: ${inputUnit}`);
  }

  return {
    conversionFactor: calculatedStockQuantity / quantity,
    calculatedStockQuantity,
    displayQuantity: formatReturnUnitQuantity(quantity, inputUnit),
    displayStockImpact: formatReturnStockImpact(calculatedStockQuantity, product),
  };
}

export function buildReturnTestLinePreview(input: {
  product: ReturnTestLineProduct | null;
  quantity: number;
  inputUnit: string;
  lineType: ReturnTestLineType;
}) {
  const inputDisplay = formatReturnUnitQuantity(input.quantity, input.inputUnit);
  if (!input.product) {
    return {
      inputDisplay,
      automaticHandling: "Ukendt produkt",
      impactDisplay: "Kræver manuel kontrol",
      secondaryImpact: null,
      calculatedStockQuantity: 0,
      noOrdinaryStockImpact: true,
    } satisfies ReturnTestLinePreview;
  }

  if (["deposit", "cup", "fee"].includes(input.lineType)) {
    return {
      inputDisplay,
      automaticHandling: "Pant/krus/gebyr",
      impactDisplay: "Ingen almindelig lagerpåvirkning",
      secondaryImpact: inputDisplay,
      calculatedStockQuantity: 0,
      noOrdinaryStockImpact: true,
    } satisfies ReturnTestLinePreview;
  }

  const conversion = calculateReturnUnitConversion(input.product, input.quantity, input.inputUnit);
  const handling = input.product.return_handling ?? "manual_review";
  const secondaryImpact = conversion.displayStockImpact === conversion.displayQuantity ? null : `Svarer til ${conversion.displayStockImpact}`;

  if (handling === "return_to_stock") {
    return {
      inputDisplay,
      automaticHandling: "Tilbage på lager",
      impactDisplay: `Tilbage på lager: ${conversion.displayQuantity}`,
      secondaryImpact,
      calculatedStockQuantity: conversion.calculatedStockQuantity,
      noOrdinaryStockImpact: false,
    } satisfies ReturnTestLinePreview;
  }

  if (handling === "waste") {
    return {
      inputDisplay,
      automaticHandling: "Svind",
      impactDisplay: `Registreres som svind: ${conversion.displayQuantity}`,
      secondaryImpact,
      calculatedStockQuantity: conversion.calculatedStockQuantity,
      noOrdinaryStockImpact: false,
    } satisfies ReturnTestLinePreview;
  }

  if (handling === "no_stock_effect") {
    return {
      inputDisplay,
      automaticHandling: "Ingen lagerpåvirkning",
      impactDisplay: "Ingen lagerpåvirkning",
      secondaryImpact: null,
      calculatedStockQuantity: 0,
      noOrdinaryStockImpact: true,
    } satisfies ReturnTestLinePreview;
  }

  return {
    inputDisplay,
    automaticHandling: "Kræver manuel kontrol",
    impactDisplay: "Kræver manuel kontrol",
    secondaryImpact: "Ingen automatisk lagerpåvirkning",
    calculatedStockQuantity: conversion.calculatedStockQuantity,
    noOrdinaryStockImpact: true,
  } satisfies ReturnTestLinePreview;
}

export function getReturnInputUnitOptions(product: ReturnTestProductUnitModel) {
  const options = new Map<string, { value: string; label: string }>();
  const add = (value: string | null | undefined) => {
    const normalized = normalizeUnit(value);
    if (!normalized) return;
    options.set(normalized, { value: value!.trim(), label: value!.trim() });
  };

  add(product.stock_unit_label);
  add(product.consumption_unit_label);
  add(product.purchase_unit_label);
  add(product.unit);

  if (options.size === 0) {
    add("stk");
  }

  return Array.from(options.values());
}

export function defaultReturnInputUnit(product: ReturnTestProductUnitModel) {
  return product.stock_unit_label || product.consumption_unit_label || product.unit || product.purchase_unit_label || "stk";
}

export function scenarioMappingAction(scenario: ReturnTestScenarioId, lineType: ReturnTestLineType = "main"): OnlinePosMappingAction {
  if (["deposit", "cup_fee"].includes(scenario) || lineType === "deposit" || lineType === "fee") return "deposit_fee";
  if (scenario === "cup_return" || lineType === "cup") return "deposit_return";
  if (scenario === "no_stock_effect") return "ignore";
  return "consume_stock";
}

export function scenarioLineType(scenario: ReturnTestScenarioId, lineType: ReturnTestLineType = "main"): OnlinePosLineType {
  if (["deposit", "cup_fee"].includes(scenario) || lineType === "deposit" || lineType === "fee") return "deposit_fee";
  if (scenario === "cup_return" || lineType === "cup") return "deposit_return";
  if (lineType === "modifier") return "modifier_stock_item";
  return "stock_item";
}

export function scenarioProductName(scenario: ReturnTestScenarioId, lineType: ReturnTestLineType, fallback: string) {
  if (scenario === "deposit" || lineType === "deposit") return "Pant";
  if (scenario === "cup_fee" || lineType === "fee") return "GEBYR - Krus";
  if (scenario === "cup_return" || lineType === "cup") return "RETUR - Krus";
  return fallback;
}

export function scenarioProductGroup(scenario: ReturnTestScenarioId, lineType: ReturnTestLineType) {
  if (scenario === "deposit" || lineType === "deposit") return "Pant";
  if (scenario === "cup_fee" || scenario === "cup_return" || lineType === "cup" || lineType === "fee") return "Krus";
  if (lineType === "modifier") return "MSG - Test";
  return "Testretur";
}

export function testOnlinePosProductId(productId: string, lineId?: string) {
  return lineId ? `test-product-${productId}-${lineId}` : `test-product-${productId}`;
}

export function testIdempotencyKey(runId: string) {
  return `test-harness-return:${runId}`;
}

export function formatReturnStockImpact(quantity: number, product: ReturnTestProductUnitModel) {
  const purchaseUnit = product.purchase_unit_label || product.unit || "kasse";
  const stockUnit = product.stock_unit_label || product.unit || purchaseUnit;
  const unitsPerPurchaseUnit = positiveNumber(product.units_per_purchase_unit ?? product.units_per_case) ?? 1;
  const wholePurchaseUnits = Math.floor(Math.abs(quantity) + 1e-9);
  const remainderStockUnits = roundDisplay((Math.abs(quantity) - wholePurchaseUnits) * unitsPerPurchaseUnit);
  const parts = [];
  if (wholePurchaseUnits > 0) parts.push(`${wholePurchaseUnits} ${purchaseUnit}`);
  if (remainderStockUnits > 0 || parts.length === 0) parts.push(`${formatDanishNumber(remainderStockUnits)} ${stockUnit}`);
  return parts.join(" + ");
}

function formatReturnUnitQuantity(quantity: number, unit: string) {
  return `${formatDanishNumber(quantity)} ${unit}`;
}

function positiveNumber(value: number | string | null | undefined) {
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUnit(value: string | null | undefined) {
  const normalized = value
    ? value
      .trim()
      .toLocaleLowerCase("da-DK")
      .replace(/\(r\)/g, "")
      .replace(/\./g, "")
    : "";
  const aliases: Record<string, string> = {
    flasker: "flaske",
    dåser: "dåse",
    kasser: "kasse",
    dunke: "dunk",
    styk: "stk",
    styks: "stk",
    liter: "liter",
    litre: "liter",
  };
  return aliases[normalized] ?? normalized;
}

function formatDanishNumber(value: number) {
  return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 2 }).format(roundDisplay(value));
}

function roundNumber(value: number) {
  return Math.round(value * 10000) / 10000;
}

function roundDisplay(value: number) {
  return Math.round(value * 100) / 100;
}
