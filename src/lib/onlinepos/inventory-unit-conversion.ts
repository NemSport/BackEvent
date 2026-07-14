export type OnlinePosInventoryUnitProduct = {
  unit?: string | null;
  purchaseUnitLabel?: string | null;
  unitsPerPurchaseUnit?: number | string | null;
  unitsPerCase?: number | string | null;
  stockUnitLabel?: string | null;
  contentPerStockUnit?: number | string | null;
  consumptionUnitLabel?: string | null;
};

export type OnlinePosConsumptionDiagnostics = {
  soldQuantity: number;
  consumptionPerSale: number;
  consumptionUnit: string;
  totalConsumptionQuantity: number;
  conversionDivisor: number;
  conversionMultiplier: number;
  finalStoredDelta: number;
  humanReadableDelta: string;
};

export function calculateOnlinePosInventoryConsumption(input: {
  soldQuantity: number;
  consumptionPerSale: number;
  product: OnlinePosInventoryUnitProduct;
}) {
  const soldQuantity = Math.abs(finiteNumber(input.soldQuantity));
  const consumptionPerSale = positiveNumber(input.consumptionPerSale);
  if (consumptionPerSale === null) throw new Error("Forbrug pr. salg skal være større end 0");

  const consumptionUnit = cleanUnit(input.product.consumptionUnitLabel)
    ?? cleanUnit(input.product.stockUnitLabel)
    ?? cleanUnit(input.product.unit)
    ?? "enheder";
  const storedUnit = cleanUnit(input.product.unit) ?? cleanUnit(input.product.purchaseUnitLabel);
  const stockUnit = cleanUnit(input.product.stockUnitLabel);
  const unitsPerPurchaseUnit = positiveNumber(input.product.unitsPerPurchaseUnit ?? input.product.unitsPerCase) ?? 1;
  const contentPerStockUnit = positiveNumber(input.product.contentPerStockUnit) ?? 1;

  let conversionDivisor: number;
  if (storedUnit && sameUnit(consumptionUnit, storedUnit)) {
    conversionDivisor = 1;
  } else if (stockUnit && sameUnit(consumptionUnit, stockUnit)) {
    conversionDivisor = unitsPerPurchaseUnit;
  } else {
    conversionDivisor = unitsPerPurchaseUnit * contentPerStockUnit;
  }

  const totalConsumptionQuantity = roundNumber(soldQuantity * consumptionPerSale);
  const storedQuantity = totalConsumptionQuantity / conversionDivisor;
  const diagnostics: OnlinePosConsumptionDiagnostics = {
    soldQuantity,
    consumptionPerSale,
    consumptionUnit,
    totalConsumptionQuantity,
    conversionDivisor,
    conversionMultiplier: 1 / conversionDivisor,
    finalStoredDelta: -storedQuantity,
    humanReadableDelta: `${totalConsumptionQuantity === 0 ? "" : "-"}${formatNumber(totalConsumptionQuantity)} ${consumptionUnit}`,
  };

  return { storedQuantity, diagnostics };
}

function sameUnit(left: string, right: string) {
  return normalizeUnit(left) === normalizeUnit(right);
}

function normalizeUnit(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("da-DK").replace(/[.]/g, "").replace(/\s+/g, " ");
}

function cleanUnit(value: string | null | undefined) {
  return value?.trim() || null;
}

function positiveNumber(value: number | string | null | undefined) {
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function roundNumber(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 3 }).format(value);
}
