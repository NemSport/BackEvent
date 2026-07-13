import type { Product, ProductReturnHandling, ProductTrackingMode } from "./types";

export type BackEventProductRow = {
  id: string;
  name: string;
  unit?: string | null;
  tracking_mode?: string | null;
  return_handling?: string | null;
  onlinepos_product_id?: string | null;
  onlinepos_name?: string | null;
  sales_unit_quantity?: number | string | null;
  liters_per_sale?: number | string | null;
  units_per_case?: number | null;
  purchase_unit_label?: string | null;
  units_per_purchase_unit?: number | string | null;
  stock_unit_label?: string | null;
  content_per_stock_unit?: number | string | null;
  consumption_unit_label?: string | null;
  sort_order?: number | null;
  active?: boolean | null;
};

const validReturnHandling = new Set<ProductReturnHandling>(["waste", "return_to_stock", "manual_review", "no_stock_effect"]);
const validTrackingModes = new Set<ProductTrackingMode>(["inventory", "flow", "ignore"]);

export function normalizeReturnHandling(value: string | null | undefined): ProductReturnHandling {
  return validReturnHandling.has(value as ProductReturnHandling) ? (value as ProductReturnHandling) : "manual_review";
}

export function normalizeExplicitReturnHandling(value: string | null | undefined): ProductReturnHandling | null {
  return validReturnHandling.has(value as ProductReturnHandling) ? (value as ProductReturnHandling) : null;
}

export function normalizeTrackingMode(value: string | null | undefined): ProductTrackingMode {
  return validTrackingModes.has(value as ProductTrackingMode) ? (value as ProductTrackingMode) : "inventory";
}

export function mapProductRow(row: BackEventProductRow): Product {
  return withProductDefaults({
    id: row.id,
    name: row.name,
    unit: row.unit ?? "kasser",
    trackingMode: normalizeTrackingMode(row.tracking_mode),
    returnHandling: normalizeReturnHandling(row.return_handling),
    returnHandlingExplicit: normalizeExplicitReturnHandling(row.return_handling),
    onlineposProductId: row.onlinepos_product_id ?? null,
    onlineposName: row.onlinepos_name ?? null,
    salesUnitQuantity: Number(row.sales_unit_quantity ?? 1),
    litersPerSale: row.liters_per_sale === null || row.liters_per_sale === undefined ? null : Number(row.liters_per_sale),
    unitsPerCase: row.units_per_case ?? null,
    purchaseUnitLabel: row.purchase_unit_label ?? null,
    unitsPerPurchaseUnit: row.units_per_purchase_unit === null || row.units_per_purchase_unit === undefined ? null : Number(row.units_per_purchase_unit),
    stockUnitLabel: row.stock_unit_label ?? null,
    contentPerStockUnit: row.content_per_stock_unit === null || row.content_per_stock_unit === undefined ? null : Number(row.content_per_stock_unit),
    consumptionUnitLabel: row.consumption_unit_label ?? null,
    sortOrder: row.sort_order ?? undefined,
    active: row.active ?? true,
  });
}

export function withProductDefaults(product: Partial<Product> & { id: string; name: string; unit?: string | null }): Product {
  const hasExplicitReturnHandling = Object.prototype.hasOwnProperty.call(product, "returnHandlingExplicit");
  const explicitReturnHandling = hasExplicitReturnHandling
    ? product.returnHandlingExplicit ?? null
    : normalizeExplicitReturnHandling(product.returnHandling);

  return {
    id: product.id,
    name: product.name,
    unit: product.unit ?? "kasser",
    trackingMode: product.trackingMode ?? "inventory",
    returnHandling: normalizeReturnHandling(explicitReturnHandling ?? product.returnHandling),
    returnHandlingExplicit: explicitReturnHandling,
    onlineposProductId: product.onlineposProductId ?? null,
    onlineposName: product.onlineposName ?? null,
    salesUnitQuantity: product.salesUnitQuantity ?? 1,
    litersPerSale: product.litersPerSale ?? null,
    unitsPerCase: product.unitsPerCase ?? null,
    purchaseUnitLabel: product.purchaseUnitLabel ?? product.unit ?? "kasser",
    unitsPerPurchaseUnit: product.unitsPerPurchaseUnit ?? product.unitsPerCase ?? 1,
    stockUnitLabel: product.stockUnitLabel ?? product.unit ?? "kasser",
    contentPerStockUnit: product.contentPerStockUnit ?? 1,
    consumptionUnitLabel: product.consumptionUnitLabel ?? product.unit ?? "kasser",
    lowThreshold: product.lowThreshold ?? 10,
    criticalThreshold: product.criticalThreshold ?? 5,
    sortOrder: product.sortOrder,
    active: product.active ?? true,
  };
}
