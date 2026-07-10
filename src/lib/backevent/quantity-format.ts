import type { Product } from "./types";

export type QuantityFormatMode = "friendly" | "raw";

export function formatStockQuantity(quantity: number, product: Pick<Product, "unit" | "purchaseUnitLabel" | "unitsPerPurchaseUnit" | "unitsPerCase" | "stockUnitLabel" | "contentPerStockUnit" | "consumptionUnitLabel">, mode: QuantityFormatMode = "friendly") {
  if (mode === "raw") {
    return `${formatNumber(quantity)} ${product.unit || product.purchaseUnitLabel || "enheder"}`;
  }

  const purchaseUnitLabel = product.purchaseUnitLabel || product.unit || "enheder";
  const unitsPerPurchaseUnit = positiveNumber(product.unitsPerPurchaseUnit ?? product.unitsPerCase) ?? 1;
  const contentPerStockUnit = positiveNumber(product.contentPerStockUnit) ?? 1;
  const remainderUnitLabel = contentPerStockUnit === 1
    ? product.stockUnitLabel || product.unit || purchaseUnitLabel
    : product.consumptionUnitLabel || product.stockUnitLabel || product.unit || purchaseUnitLabel;

  const sign = quantity < 0 ? "-" : "";
  const absoluteQuantity = Math.abs(quantity);
  const wholePurchaseUnits = Math.floor(absoluteQuantity + 1e-9);
  const remainderPurchaseUnits = Math.max(0, absoluteQuantity - wholePurchaseUnits);
  const remainderUnits = roundDisplay(remainderPurchaseUnits * unitsPerPurchaseUnit * contentPerStockUnit);

  if (wholePurchaseUnits === 0 && nearlyZero(remainderUnits)) {
    return `0 ${purchaseUnitLabel}`;
  }

  const parts: string[] = [];
  if (wholePurchaseUnits > 0) {
    parts.push(`${sign}${formatNumber(wholePurchaseUnits)} ${purchaseUnitLabel}`);
  }

  if (!nearlyZero(remainderUnits)) {
    parts.push(`${wholePurchaseUnits > 0 ? "" : sign}${formatNumber(remainderUnits)} ${remainderUnitLabel}`);
  }

  return parts.join(" + ");
}

export function formatPlainQuantity(quantity: number, unit?: string | null) {
  return `${formatNumber(quantity)} ${unit ?? ""}`.trim();
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: 2,
  }).format(roundDisplay(value));
}

function positiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nearlyZero(value: number) {
  return Math.abs(value) < 0.005;
}

function roundDisplay(value: number) {
  return Math.round(value * 100) / 100;
}
