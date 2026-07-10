"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton, PrimaryButton } from "@/components/backevent/buttons";
import { createProduct, getProductAlertSettings, getProductsAdmin, updateProduct, upsertProductAlertSetting } from "@/lib/backevent/data";
import type { Product, ProductAlertSetting, ProductTrackingMode } from "@/lib/backevent/types";

type ProductFormInput = {
  name: string;
  unit: string;
  trackingMode?: ProductTrackingMode;
  onlineposProductId?: string | null;
  onlineposName?: string | null;
  salesUnitQuantity?: number;
  litersPerSale?: number | null;
  unitsPerCase?: number | null;
  purchaseUnitLabel?: string | null;
  unitsPerPurchaseUnit?: number | null;
  stockUnitLabel?: string | null;
  contentPerStockUnit?: number | null;
  consumptionUnitLabel?: string | null;
  lowThreshold?: number | null;
  criticalThreshold?: number | null;
  alertsActive?: boolean;
  active?: boolean;
  sortOrder?: number;
};

type SortDirection = "asc" | "desc";
type ProductSortKey = "name" | "purchase" | "stock" | "consumption" | "trackingMode" | "onlinepos" | "sortOrder" | "active";
type ProductSort = { key: ProductSortKey; direction: SortDirection } | null;

export default function AdminProdukterPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [alertSettings, setAlertSettings] = useState<ProductAlertSetting[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [sort, setSort] = useState<ProductSort>(null);
  const sortedProducts = useMemo(() => sortProducts(products, sort), [products, sort]);

  async function reload() {
    const [loadedProducts, loadedAlertSettings] = await Promise.all([getProductsAdmin(), getProductAlertSettings()]);
    setProducts(loadedProducts);
    setAlertSettings(loadedAlertSettings);
  }

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedProducts, loadedAlertSettings] = await Promise.all([getProductsAdmin(), getProductAlertSettings()]);
        if (mounted) {
          setProducts(loadedProducts);
          setAlertSettings(loadedAlertSettings);
        }
      } catch {
        if (mounted) {
          setMessage("Produkter kunne ikke hentes.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  async function saveProduct(input: ProductFormInput) {
    let productId = editingProduct?.id ?? null;

    if (editingProduct) {
      await updateProduct(editingProduct.id, {
        ...input,
        trackingMode: input.trackingMode ?? "inventory",
        salesUnitQuantity: input.salesUnitQuantity ?? 1,
        purchaseUnitLabel: input.purchaseUnitLabel ?? input.unit,
        unitsPerPurchaseUnit: input.unitsPerPurchaseUnit ?? input.unitsPerCase,
        stockUnitLabel: input.stockUnitLabel ?? input.unit,
        contentPerStockUnit: input.contentPerStockUnit,
        consumptionUnitLabel: input.consumptionUnitLabel ?? input.unit,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? editingProduct.sortOrder ?? 999,
      });
      setMessage("Produkt gemt");
    } else {
      productId = await createProduct(input);
      setMessage("Produkt oprettet");
    }

    if (productId) {
      await upsertProductAlertSetting(productId, {
        lowThreshold: input.lowThreshold ?? null,
        criticalThreshold: input.criticalThreshold ?? null,
        active: input.alertsActive ?? true,
      });
    }

    setEditingProduct(null);
    setIsCreating(false);
    await reload();
  }

  function toggleSort(key: ProductSortKey) {
    setSort((current) => {
      if (current?.key !== key) {
        return { key, direction: "asc" };
      }

      if (current.direction === "asc") {
        return { key, direction: "desc" };
      }

      return null;
    });
  }

  return (
    <AppShell requiredRole="ejer">
      <BackButton href="/admin" />
      <section className="my-6 rounded-[2rem] bg-soft p-6 shadow-soft lg:my-5 lg:rounded-[1.5rem] lg:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-ink">Produkter</h1>
            <p className="mt-2 text-lg font-medium text-muted">Opret og ret varer</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingProduct(null);
              setIsCreating(true);
            }}
            className="min-h-11 rounded-2xl bg-pantone139 px-4 py-2 text-base font-bold text-ink shadow-soft"
          >
            Opret produkt
          </button>
        </div>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-soft p-4 text-base font-bold text-pantone140">{message}</p> : null}

      <section className="overflow-hidden rounded-[1.5rem] border border-line bg-macro shadow-soft">
        <div className="hidden grid-cols-[1.4fr_0.95fr_0.95fr_0.95fr_0.85fr_1fr_0.55fr_0.5fr_0.65fr] gap-3 border-b border-line bg-soft px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted xl:grid">
          <SortableHeader label="Navn" sortKey="name" sort={sort} onSort={toggleSort} />
          <SortableHeader label="IndkÃ¸b" sortKey="purchase" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Lager" sortKey="stock" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Forbrug" sortKey="consumption" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Lagerstyring" sortKey="trackingMode" sort={sort} onSort={toggleSort} />
          <SortableHeader label="OnlinePOS" sortKey="onlinepos" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Sortering" sortKey="sortOrder" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Aktiv" sortKey="active" sort={sort} onSort={toggleSort} />
          <span>Handling</span>
        </div>
        <div className="divide-y divide-line">
          {sortedProducts.map((product) => (
            <ProductRow key={product.id} product={product} onEdit={() => setEditingProduct(product)} />
          ))}
        </div>
      </section>

      {isCreating || editingProduct ? (
        <ProductModal
          product={editingProduct ?? undefined}
          alertSetting={editingProduct ? alertSettings.find((setting) => setting.inventoryItemId === editingProduct.id && !setting.locationId) : undefined}
          onClose={() => {
            setEditingProduct(null);
            setIsCreating(false);
          }}
          onSave={saveProduct}
        />
      ) : null}
    </AppShell>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: ProductSortKey;
  sort: ProductSort;
  onSort: (key: ProductSortKey) => void;
}) {
  const direction = sort?.key === sortKey ? sort.direction : null;

  return (
    <button type="button" onClick={() => onSort(sortKey)} className="flex min-w-0 items-center gap-1 text-left font-bold uppercase tracking-wide hover:text-ink">
      <span className="truncate">{label}</span>
      {direction ? <span aria-hidden="true">{direction === "asc" ? "â†‘" : "â†“"}</span> : null}
    </button>
  );
}

function ProductRow({ product, onEdit }: { product: Product; onEdit: () => void }) {
  return (
    <article className="grid gap-2 px-4 py-3 text-sm font-medium text-ink xl:grid-cols-[1.4fr_0.95fr_0.95fr_0.95fr_0.85fr_1fr_0.55fr_0.5fr_0.65fr] xl:items-center">
      <div>
        <p className="font-bold">{product.name}</p>
        <p className="text-xs text-muted xl:hidden">{trackingLabel(product.trackingMode)} · {formatPackage(product)}</p>
      </div>
      <span className="hidden xl:block">{formatPurchase(product)}</span>
      <span className="hidden xl:block">{formatStock(product)}</span>
      <span className="hidden xl:block">{formatConsumption(product)}</span>
      <span className="hidden xl:block">{trackingLabel(product.trackingMode)}</span>
      <span className="text-muted xl:text-ink">{product.onlineposName || product.onlineposProductId || "-"}</span>
      <span className="hidden xl:block">{product.sortOrder ?? "-"}</span>
      <span className="hidden xl:block">{product.active === false ? "Nej" : "Ja"}</span>
      <button type="button" onClick={onEdit} className="w-fit rounded-xl bg-soft px-3 py-2 text-sm font-bold text-pantone140">
        Rediger
      </button>
    </article>
  );
}

function ProductModal({
  product,
  alertSetting,
  onClose,
  onSave,
}: {
  product?: Product;
  alertSetting?: ProductAlertSetting;
  onClose: () => void;
  onSave: (input: ProductFormInput) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [trackingMode, setTrackingMode] = useState<ProductTrackingMode>(product?.trackingMode ?? "inventory");
  const [salesUnitQuantity, setSalesUnitQuantity] = useState((product?.salesUnitQuantity ?? 1).toString());
  const [litersPerSale, setLitersPerSale] = useState(product?.litersPerSale?.toString() ?? "");
  const [onlineposProductId, setOnlineposProductId] = useState(product?.onlineposProductId ?? "");
  const [onlineposName, setOnlineposName] = useState(product?.onlineposName ?? "");
  const [purchaseUnitLabel, setPurchaseUnitLabel] = useState(product?.purchaseUnitLabel ?? product?.unit ?? "kasse");
  const [unitsPerPurchaseUnit, setUnitsPerPurchaseUnit] = useState((product?.unitsPerPurchaseUnit ?? product?.unitsPerCase ?? 1).toString());
  const [stockUnitLabel, setStockUnitLabel] = useState(product?.stockUnitLabel ?? product?.unit ?? "stk");
  const [contentPerStockUnit, setContentPerStockUnit] = useState((product?.contentPerStockUnit ?? 1).toString());
  const [consumptionUnitLabel, setConsumptionUnitLabel] = useState(product?.consumptionUnitLabel ?? product?.unit ?? "stk");
  const [lowThreshold, setLowThreshold] = useState(formatInputNumber(alertSetting?.lowThreshold ?? product?.lowThreshold ?? ""));
  const [criticalThreshold, setCriticalThreshold] = useState(formatInputNumber(alertSetting?.criticalThreshold ?? product?.criticalThreshold ?? ""));
  const [alertsActive, setAlertsActive] = useState(alertSetting?.active ?? true);
  const [active, setActive] = useState(product?.active ?? true);
  const [sortOrder, setSortOrder] = useState((product?.sortOrder ?? 999).toString());
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    setIsSaving(true);
    await onSave({
      name,
      unit: purchaseUnitLabel || "kasser",
      trackingMode,
      salesUnitQuantity: salesUnitQuantity ? Number(salesUnitQuantity) : 1,
      litersPerSale: litersPerSale ? Number(litersPerSale) : null,
      onlineposProductId: onlineposProductId.trim() || null,
      onlineposName: onlineposName.trim() || null,
      unitsPerCase: unitsPerPurchaseUnit ? Number(unitsPerPurchaseUnit) : null,
      purchaseUnitLabel: purchaseUnitLabel.trim() || null,
      unitsPerPurchaseUnit: unitsPerPurchaseUnit ? Number(unitsPerPurchaseUnit) : null,
      stockUnitLabel: stockUnitLabel.trim() || null,
      contentPerStockUnit: contentPerStockUnit ? Number(contentPerStockUnit) : null,
      consumptionUnitLabel: consumptionUnitLabel.trim() || null,
      lowThreshold: parseDecimalInput(lowThreshold),
      criticalThreshold: parseDecimalInput(criticalThreshold),
      alertsActive,
      active,
      sortOrder: Number(sortOrder),
    });
    setIsSaving(false);
  }

  return (
    <Modal title={product ? "Rediger produkt" : "Opret produkt"} onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Navn" value={name} onChange={setName} />
        <label className="block">
          <span className="text-base font-bold text-ink">Lagerstyring</span>
          <select value={trackingMode} onChange={(event) => setTrackingMode(event.target.value as ProductTrackingMode)} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-3 py-2 font-bold outline-none focus:border-pantone140">
            <option value="inventory">Lagerstyret</option>
            <option value="flow">Flow</option>
            <option value="ignore">Ignorer</option>
          </select>
        </label>
      </div>

      <section className="mt-5 rounded-2xl border border-line bg-soft p-4">
        <h3 className="text-lg font-bold text-ink">Indkøb og optælling</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Input label="Indkøbsenhed" value={purchaseUnitLabel} onChange={setPurchaseUnitLabel} />
          <Input label="Antal pr. indkøbsenhed" value={unitsPerPurchaseUnit} onChange={setUnitsPerPurchaseUnit} />
          <Input label="Lagerenhed" value={stockUnitLabel} onChange={setStockUnitLabel} />
          <Input label="Indhold pr. lagerenhed" value={contentPerStockUnit} onChange={setContentPerStockUnit} />
          <Input label="Forbrugsenhed" value={consumptionUnitLabel} onChange={setConsumptionUnitLabel} />
        </div>
        <p className="mt-3 text-sm font-bold text-muted">
          1 {purchaseUnitLabel || "indkøbsenhed"} = {formatCalculatedConsumption(unitsPerPurchaseUnit, contentPerStockUnit)} {consumptionUnitLabel || "forbrugsenheder"}
        </p>
      </section>

      <details className="mt-5 rounded-2xl border border-line bg-macro p-4">
        <summary className="cursor-pointer text-lg font-bold text-ink">Direkte OnlinePOS kobling</summary>
        <p className="mt-2 text-sm font-bold text-muted">Valgfrit. Bruges kun hvis varen selv skal kobles direkte til OnlinePOS.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Input label="OnlinePOS ID" value={onlineposProductId} onChange={setOnlineposProductId} />
          <Input label="OnlinePOS navn" value={onlineposName} onChange={setOnlineposName} />
          <Input label="Forbrug pr. salg" value={salesUnitQuantity} onChange={setSalesUnitQuantity} />
          <Input label="Liter pr. salg" value={litersPerSale} onChange={setLitersPerSale} />
        </div>
      </details>

      <section className="mt-5 rounded-2xl border border-line bg-soft p-4">
        <h3 className="text-lg font-bold text-ink">Lageralarmer</h3>
        <p className="mt-1 text-sm font-bold text-muted">Bruges når ejer manuelt kører lageralarm til Lageransvarlige.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Input label="Lavt lager ved" value={lowThreshold} onChange={setLowThreshold} />
          <Input label="Kritisk lager ved" value={criticalThreshold} onChange={setCriticalThreshold} />
          <label className="flex items-center gap-2 text-base font-bold text-ink md:col-span-2">
            <input type="checkbox" checked={alertsActive} onChange={(event) => setAlertsActive(event.target.checked)} />
            Lageralarmer aktive
          </label>
        </div>
      </section>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Input label="Sortering" value={sortOrder} onChange={setSortOrder} />
        <label className="flex items-center gap-2 text-lg font-bold text-ink">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Aktiv
        </label>
      </div>
      <div className="mt-5 flex gap-3">
        <PrimaryButton onClick={save} disabled={isSaving}>{isSaving ? "Gemmer..." : "Gem"}</PrimaryButton>
        <button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-line px-4 py-2 font-bold text-pantone140">Annuller</button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 px-4 py-6">
      <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[1.5rem] bg-macro p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-pantone140">Luk</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-base font-bold text-ink">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-3 py-2 font-bold outline-none focus:border-pantone140" />
    </label>
  );
}

function trackingLabel(mode?: ProductTrackingMode) {
  if (mode === "flow") return "Flow";
  if (mode === "ignore") return "Ignorer";
  return "Lagerstyret";
}

function formatPurchase(product: Product) {
  const label = product.purchaseUnitLabel ?? product.unit;
  const amount = product.unitsPerPurchaseUnit ?? product.unitsPerCase ?? 1;
  return `${amount} pr. ${label}`;
}

function formatStock(product: Product) {
  return product.stockUnitLabel ?? product.unit;
}

function formatConsumption(product: Product) {
  const content = product.contentPerStockUnit ?? 1;
  const stockUnit = product.stockUnitLabel ?? product.unit;
  const consumptionUnit = product.consumptionUnitLabel ?? product.unit;
  return `${content} ${consumptionUnit}/${stockUnit}`;
}

function formatPackage(product: Product) {
  const purchaseUnit = product.purchaseUnitLabel ?? product.unit;
  const stockUnit = product.stockUnitLabel ?? product.unit;
  const consumptionUnit = product.consumptionUnitLabel ?? product.unit;
  const total = (product.unitsPerPurchaseUnit ?? product.unitsPerCase ?? 1) * (product.contentPerStockUnit ?? 1);
  return `1 ${purchaseUnit} = ${formatNumber(total)} ${consumptionUnit} (${stockUnit})`;
}

function formatCalculatedConsumption(unitsPerPurchaseUnit: string, contentPerStockUnit: string) {
  const units = Number(unitsPerPurchaseUnit);
  const content = Number(contentPerStockUnit);

  if (!Number.isFinite(units) || !Number.isFinite(content)) {
    return "-";
  }

  return formatNumber(units * content);
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toLocaleString("da-DK", { maximumFractionDigits: 2 });
}

function formatInputNumber(value: number | string | null) {
  if (value === null || value === "") {
    return "";
  }

  return String(value).replace(".", ",");
}

function parseDecimalInput(value: string) {
  const normalized = value.trim().replace(",", ".");

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortProducts(products: Product[], sort: ProductSort) {
  if (!sort) {
    return products;
  }

  return [...products].sort((a, b) => compareSortValues(productSortValue(a, sort.key), productSortValue(b, sort.key), sort.direction));
}

function productSortValue(product: Product, key: ProductSortKey) {
  if (key === "name") return product.name;
  if (key === "purchase") return product.purchaseUnitLabel ?? product.unit;
  if (key === "stock") return product.stockUnitLabel ?? product.unit;
  if (key === "consumption") return product.consumptionUnitLabel ?? product.unit;
  if (key === "trackingMode") return trackingLabel(product.trackingMode);
  if (key === "onlinepos") return product.onlineposName || product.onlineposProductId;
  if (key === "sortOrder") return product.sortOrder;
  return product.active === false ? "Nej" : "Ja";
}

function compareSortValues(a: string | number | null | undefined, b: string | number | null | undefined, direction: SortDirection) {
  const aEmpty = isEmptySortValue(a);
  const bEmpty = isEmptySortValue(b);

  if (aEmpty || bEmpty) {
    if (aEmpty && bEmpty) return 0;
    return aEmpty ? 1 : -1;
  }

  const result = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), "da-DK", { numeric: true, sensitivity: "base" });

  return direction === "asc" ? result : -result;
}

function isEmptySortValue(value: string | number | null | undefined) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}
