import type { Product, ProductReturnHandling, ProductTrackingMode } from "./types";

export const returnHandlingOptions: Array<{ value: ProductReturnHandling; label: string }> = [
  { value: "waste", label: "Svind" },
  { value: "return_to_stock", label: "Tilbage på lager" },
  { value: "manual_review", label: "Kræver manuel kontrol" },
  { value: "no_stock_effect", label: "Ingen lagerpåvirkning" },
];

export type ReturnHandlingFilter = "all" | "missing" | ProductReturnHandling;
export type ActiveProductFilter = "all" | "active" | "inactive";
export type ProductGroupFilter = "all" | ProductTrackingMode;

export type ReturnHandlingAudit = {
  total: number;
  waste: number;
  returnToStock: number;
  manualReview: number;
  noStockEffect: number;
  missing: number;
};

export function getExplicitReturnHandling(product: Product): ProductReturnHandling | null {
  return product.returnHandlingExplicit ?? null;
}

export function hasExplicitReturnHandling(product: Product) {
  return getExplicitReturnHandling(product) !== null;
}

export function getReturnHandlingLabel(value: ProductReturnHandling | null | undefined) {
  if (value === "waste") return "Svind";
  if (value === "return_to_stock") return "Tilbage på lager";
  if (value === "manual_review") return "Kræver manuel kontrol";
  if (value === "no_stock_effect") return "Ingen lagerpåvirkning";
  return "Mangler beslutning";
}

export function getTrackingModeLabel(mode?: ProductTrackingMode) {
  if (mode === "flow") return "Flow";
  if (mode === "ignore") return "Ignorer";
  return "Lagerstyret";
}

export function buildReturnHandlingAudit(products: Product[]): ReturnHandlingAudit {
  return products.reduce<ReturnHandlingAudit>((audit, product) => {
    audit.total += 1;

    const explicit = getExplicitReturnHandling(product);
    if (explicit === "waste") audit.waste += 1;
    else if (explicit === "return_to_stock") audit.returnToStock += 1;
    else if (explicit === "manual_review") audit.manualReview += 1;
    else if (explicit === "no_stock_effect") audit.noStockEffect += 1;
    else audit.missing += 1;

    return audit;
  }, {
    total: 0,
    waste: 0,
    returnToStock: 0,
    manualReview: 0,
    noStockEffect: 0,
    missing: 0,
  });
}

export function recommendReturnHandling(product: Product): ProductReturnHandling | null {
  const name = normalizeText(product.name);
  const onlinePosName = normalizeText(product.onlineposName ?? "");
  const combined = `${name} ${onlinePosName}`.trim();

  if (product.trackingMode === "ignore") {
    return "no_stock_effect";
  }

  if (matchesAny(combined, ["pant", "gebyr", "retur krus", "krus"])) {
    return "no_stock_effect";
  }

  if (matchesAny(combined, ["sodavand", "kildevand", "vand", "rør", "roer", "flugel", "flügel", "pepsi", "faxe", "kondi", "cola"])) {
    return "return_to_stock";
  }

  if (matchesAny(combined, ["øl", "oel", "beer", "drink", "drinks", "shaker sport", "mokai", "tuborg", "royal", "somersby"])) {
    return "waste";
  }

  return null;
}

export function filterProductsForReturnSetup(
  products: Product[],
  filters: {
    returnHandling: ReturnHandlingFilter;
    active: ActiveProductFilter;
    group: ProductGroupFilter;
    search?: string;
  },
) {
  const search = normalizeText(filters.search ?? "");

  return products.filter((product) => {
    const explicit = getExplicitReturnHandling(product);

    if (filters.returnHandling === "missing" && explicit !== null) return false;
    if (filters.returnHandling !== "all" && filters.returnHandling !== "missing" && explicit !== filters.returnHandling) return false;
    if (filters.active === "active" && product.active === false) return false;
    if (filters.active === "inactive" && product.active !== false) return false;
    if (filters.group !== "all" && (product.trackingMode ?? "inventory") !== filters.group) return false;
    if (search && !normalizeText(`${product.name} ${product.onlineposName ?? ""} ${product.onlineposProductId ?? ""}`).includes(search)) return false;

    return true;
  });
}

function matchesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(normalizeText(needle)));
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}
