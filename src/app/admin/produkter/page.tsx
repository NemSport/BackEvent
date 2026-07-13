"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton, PrimaryButton } from "@/components/backevent/buttons";
import {
  createProduct,
  deactivateProductAdmin,
  deleteProductAdmin,
  getProductAlertSettings,
  getProductDeletePreview,
  getProductsAdmin,
  updateProduct,
  upsertProductAlertSetting,
  type AdminDeletePreview,
} from "@/lib/backevent/data";
import {
  buildReturnHandlingAudit,
  filterProductsForReturnSetup,
  getExplicitReturnHandling,
  getReturnHandlingLabel,
  getTrackingModeLabel,
  hasExplicitReturnHandling,
  recommendReturnHandling,
  returnHandlingOptions,
  type ActiveProductFilter,
  type ProductGroupFilter,
  type ReturnHandlingFilter,
} from "@/lib/backevent/return-handling";
import type { Product, ProductAlertSetting, ProductReturnHandling, ProductTrackingMode } from "@/lib/backevent/types";

type ProductFormInput = {
  name: string;
  unit: string;
  trackingMode?: ProductTrackingMode;
  returnHandling: ProductReturnHandling;
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
type ProductSortKey = "name" | "purchase" | "stock" | "consumption" | "trackingMode" | "returnHandling" | "onlinepos" | "sortOrder" | "active";
type ProductSort = { key: ProductSortKey; direction: SortDirection } | null;
type BulkReturnHandling = ProductReturnHandling | "";

export default function AdminProdukterPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [alertSettings, setAlertSettings] = useState<ProductAlertSetting[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [sort, setSort] = useState<ProductSort>(null);
  const [returnFilter, setReturnFilter] = useState<ReturnHandlingFilter>("all");
  const [activeFilter, setActiveFilter] = useState<ActiveProductFilter>("all");
  const [groupFilter, setGroupFilter] = useState<ProductGroupFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkReturnHandling, setBulkReturnHandling] = useState<BulkReturnHandling>("");
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deletePreview, setDeletePreview] = useState<AdminDeletePreview | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const audit = useMemo(() => buildReturnHandlingAudit(products), [products]);
  const visibleProducts = useMemo(
    () => filterProductsForReturnSetup(products, {
      returnHandling: returnFilter,
      active: activeFilter,
      group: groupFilter,
      search,
    }),
    [activeFilter, groupFilter, products, returnFilter, search],
  );
  const sortedProducts = useMemo(() => sortProducts(visibleProducts, sort), [visibleProducts, sort]);
  const selectedVisibleCount = sortedProducts.filter((product) => selectedIds.has(product.id)).length;

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
    try {
      let productId = editingProduct?.id ?? null;

      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          ...input,
          trackingMode: input.trackingMode ?? "inventory",
          returnHandling: input.returnHandling,
          salesUnitQuantity: input.salesUnitQuantity ?? 1,
          purchaseUnitLabel: input.purchaseUnitLabel ?? input.unit,
          unitsPerPurchaseUnit: input.unitsPerPurchaseUnit ?? input.unitsPerCase,
          stockUnitLabel: input.stockUnitLabel ?? input.unit,
          contentPerStockUnit: input.contentPerStockUnit,
          consumptionUnitLabel: input.consumptionUnitLabel ?? input.unit,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? editingProduct.sortOrder ?? 999,
        });
      } else {
        productId = await createProduct(input);
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
      setSelectedIds(new Set());
      setMessage(editingProduct ? "Produkt gemt" : "Produkt oprettet");
    } catch (error) {
      setMessage(error instanceof Error ? `Produkt kunne ikke gemmes: ${error.message}` : "Produkt kunne ikke gemmes.");
      throw error;
    }
  }

  async function bulkUpdateReturnHandling() {
    if (!bulkReturnHandling || selectedIds.size === 0) {
      setMessage("Vælg produkter og returbehandling først.");
      return;
    }

    const selectedProducts = products.filter((product) => selectedIds.has(product.id));
    const label = getReturnHandlingLabel(bulkReturnHandling);
    const confirmed = window.confirm(`Sæt ${selectedProducts.length} produkter til "${label}"?`);
    if (!confirmed) return;

    setIsBulkSaving(true);
    setMessage(null);
    try {
      for (const product of selectedProducts) {
        await updateProduct(product.id, {
          name: product.name,
          unit: product.unit,
          trackingMode: product.trackingMode ?? "inventory",
          returnHandling: bulkReturnHandling,
          onlineposProductId: product.onlineposProductId ?? null,
          onlineposName: product.onlineposName ?? null,
          salesUnitQuantity: product.salesUnitQuantity ?? 1,
          litersPerSale: product.litersPerSale ?? null,
          unitsPerCase: product.unitsPerCase ?? null,
          purchaseUnitLabel: product.purchaseUnitLabel ?? product.unit,
          unitsPerPurchaseUnit: product.unitsPerPurchaseUnit ?? product.unitsPerCase ?? null,
          stockUnitLabel: product.stockUnitLabel ?? product.unit,
          contentPerStockUnit: product.contentPerStockUnit ?? null,
          consumptionUnitLabel: product.consumptionUnitLabel ?? product.unit,
          active: product.active ?? true,
          sortOrder: product.sortOrder ?? 999,
        });
      }

      await reload();
      setSelectedIds(new Set());
      setBulkReturnHandling("");
      setMessage(`${selectedProducts.length} produkter opdateret til ${label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Masseændring fejlede: ${error.message}` : "Masseændring fejlede.");
    } finally {
      setIsBulkSaving(false);
    }
  }

  function toggleSelected(productId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
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

  async function openDeleteProduct(product: Product) {
    setDeleteTarget(product);
    setDeletePreview(null);
    setMessage(null);
    try {
      setDeletePreview(await getProductDeletePreview(product.id));
    } catch {
      setDeletePreview({ ok: false, message: "Sletteinfo kunne ikke hentes." });
    }
  }

  async function runDeleteProduct(action: "delete" | "deactivate") {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setMessage(null);
    try {
      const result = action === "delete" ? await deleteProductAdmin(deleteTarget.id) : await deactivateProductAdmin(deleteTarget.id);
      if (!result.ok) {
        setDeletePreview(result.plan && result.summary ? { ok: true, plan: result.plan, summary: result.summary } : { ok: false, message: result.message });
        setMessage(result.message);
        return;
      }
      setMessage(result.message);
      setDeleteTarget(null);
      setDeletePreview(null);
      if (editingProduct?.id === deleteTarget.id) setEditingProduct(null);
      await reload();
    } finally {
      setIsDeleting(false);
    }
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

      <section className="mb-4 rounded-2xl border border-line bg-macro p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <AuditTile label="Produkter i alt" value={audit.total} />
          <AuditTile label="Svind" value={audit.waste} />
          <AuditTile label="Tilbage på lager" value={audit.returnToStock} />
          <AuditTile label="Manuel kontrol" value={audit.manualReview} />
          <AuditTile label="Ingen lagerpåvirkning" value={audit.noStockEffect} />
          <AuditTile label="Mangler beslutning" value={audit.missing} tone={audit.missing > 0 ? "warning" : "neutral"} />
        </div>
        <p className="mt-3 text-xs font-bold text-muted">
          “Mangler beslutning” er reel database-null. Den tæller ikke som færdig, selv om visning kan falde tilbage til manuel kontrol andre steder.
        </p>
      </section>

      <section className="mb-4 rounded-2xl border border-line bg-macro p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block text-sm font-bold text-ink">
            Returbehandling
            <select value={returnFilter} onChange={(event) => setReturnFilter(event.target.value as ReturnHandlingFilter)} className="mt-1 min-h-10 w-full rounded-xl border border-line px-3 py-2 text-sm font-bold outline-none focus:border-pantone140">
              <option value="all">Alle</option>
              <option value="missing">Mangler beslutning</option>
              {returnHandlingOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-ink">
            Aktiv
            <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as ActiveProductFilter)} className="mt-1 min-h-10 w-full rounded-xl border border-line px-3 py-2 text-sm font-bold outline-none focus:border-pantone140">
              <option value="all">Alle</option>
              <option value="active">Aktive</option>
              <option value="inactive">Inaktive</option>
            </select>
          </label>
          <label className="block text-sm font-bold text-ink">
            Produktgruppe
            <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value as ProductGroupFilter)} className="mt-1 min-h-10 w-full rounded-xl border border-line px-3 py-2 text-sm font-bold outline-none focus:border-pantone140">
              <option value="all">Alle</option>
              <option value="inventory">Lagerstyret</option>
              <option value="flow">Flow</option>
              <option value="ignore">Ignorer</option>
            </select>
          </label>
          <label className="block text-sm font-bold text-ink xl:col-span-2">
            Søg
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-line px-3 py-2 text-sm font-bold outline-none focus:border-pantone140" placeholder="Produkt, OnlinePOS eller ID" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <label className="block min-w-56 text-sm font-bold text-ink">
            Sæt valgte til
            <select value={bulkReturnHandling} onChange={(event) => setBulkReturnHandling(event.target.value as BulkReturnHandling)} className="mt-1 min-h-10 w-full rounded-xl border border-line px-3 py-2 text-sm font-bold outline-none focus:border-pantone140">
              <option value="">Vælg returbehandling</option>
              {returnHandlingOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={bulkUpdateReturnHandling}
            disabled={isBulkSaving || selectedIds.size === 0 || !bulkReturnHandling}
            className="min-h-10 rounded-xl bg-pantone139 px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBulkSaving ? "Gemmer..." : "Masseopdater"}
          </button>
          <button
            type="button"
            onClick={() => {
              setReturnFilter("all");
              setActiveFilter("all");
              setGroupFilter("all");
              setSearch("");
              setSelectedIds(new Set());
            }}
            className="min-h-10 rounded-xl border border-line bg-macro px-4 py-2 text-sm font-bold text-pantone140"
          >
            Nulstil filtre
          </button>
          <p className="text-sm font-bold text-muted">
            {sortedProducts.length} vist · {selectedIds.size} valgt {selectedVisibleCount !== selectedIds.size ? `(${selectedVisibleCount} synlige)` : ""}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.5rem] border border-line bg-macro shadow-soft">
        <div className="hidden grid-cols-[0.28fr_1.35fr_0.78fr_0.85fr_0.78fr_0.9fr_0.9fr_0.45fr_0.45fr_0.65fr] gap-3 border-b border-line bg-soft px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted xl:grid">
          <span>Vælg</span>
          <SortableHeader label="Navn" sortKey="name" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Lagerstyring" sortKey="trackingMode" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Retur" sortKey="returnHandling" sort={sort} onSort={toggleSort} />
          <span>Forslag</span>
          <SortableHeader label="Indkøb" sortKey="purchase" sort={sort} onSort={toggleSort} />
          <SortableHeader label="OnlinePOS" sortKey="onlinepos" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Sortering" sortKey="sortOrder" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Aktiv" sortKey="active" sort={sort} onSort={toggleSort} />
          <span>Handling</span>
        </div>
        <div className="divide-y divide-line">
          {sortedProducts.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              selected={selectedIds.has(product.id)}
              onSelect={() => toggleSelected(product.id)}
              onEdit={() => setEditingProduct(product)}
              onDelete={() => openDeleteProduct(product)}
            />
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
          onDelete={editingProduct ? () => openDeleteProduct(editingProduct) : undefined}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteObjectModal
          name={deleteTarget.name}
          objectLabel="produkt"
          preview={deletePreview}
          isWorking={isDeleting}
          onClose={() => {
            setDeleteTarget(null);
            setDeletePreview(null);
          }}
          onDelete={() => runDeleteProduct("delete")}
          onDeactivate={() => runDeleteProduct("deactivate")}
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

function AuditTile({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "warning" }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${tone === "warning" ? "border-pantone139 bg-pantone139/20" : "border-line bg-soft"}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function ProductRow({
  product,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  product: Product;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const explicitReturnHandling = getExplicitReturnHandling(product);
  const recommendation = recommendReturnHandling(product);

  return (
    <article className="grid gap-2 px-4 py-3 text-sm font-medium text-ink xl:grid-cols-[0.28fr_1.35fr_0.78fr_0.85fr_0.78fr_0.9fr_0.9fr_0.45fr_0.45fr_0.65fr] xl:items-center">
      <label className="flex items-center">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Vælg ${product.name}`} />
      </label>
      <div>
        <p className="font-bold">{product.name}</p>
        <p className="text-xs text-muted xl:hidden">
          {trackingLabel(product.trackingMode)} · {returnHandlingLabel(explicitReturnHandling)} · Forslag: {recommendation ? getReturnHandlingLabel(recommendation) : "-"} · {formatPackage(product)}
        </p>
      </div>
      <span className="hidden xl:block">{trackingLabel(product.trackingMode)}</span>
      <span className={`hidden rounded-full px-2 py-1 text-xs font-bold xl:inline-block ${explicitReturnHandling ? "bg-soft text-ink" : "bg-pantone139/25 text-pantone140"}`}>
        {returnHandlingLabel(explicitReturnHandling)}
      </span>
      <span className="hidden text-xs font-bold text-muted xl:block">{recommendation ? getReturnHandlingLabel(recommendation) : "-"}</span>
      <span className="hidden xl:block">{formatPurchase(product)}</span>
      <span className="text-muted xl:text-ink">{product.onlineposName || product.onlineposProductId || "-"}</span>
      <span className="hidden xl:block">{product.sortOrder ?? "-"}</span>
      <span className="hidden xl:block">{product.active === false ? "Nej" : "Ja"}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className="w-fit rounded-xl bg-soft px-3 py-2 text-sm font-bold text-pantone140">
          Rediger
        </button>
        <button type="button" onClick={onDelete} className="w-fit rounded-xl bg-warmRed px-3 py-2 text-sm font-bold text-macro">
          Slet
        </button>
      </div>
    </article>
  );
}

function ProductModal({
  product,
  alertSetting,
  onClose,
  onSave,
  onDelete,
}: {
  product?: Product;
  alertSetting?: ProductAlertSetting;
  onClose: () => void;
  onSave: (input: ProductFormInput) => Promise<void>;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [trackingMode, setTrackingMode] = useState<ProductTrackingMode>(product?.trackingMode ?? "inventory");
  const [returnHandling, setReturnHandling] = useState<ProductReturnHandling | "">(product ? (product.returnHandlingExplicit ?? "") : "");
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
  const [localError, setLocalError] = useState<string | null>(null);

  async function save() {
    if (!returnHandling) {
      setLocalError("Vælg behandling ved retur.");
      return;
    }

    setLocalError(null);
    setIsSaving(true);
    try {
      await onSave({
        name,
        unit: purchaseUnitLabel || "kasser",
        trackingMode,
        returnHandling,
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
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Produkt kunne ikke gemmes.");
    } finally {
      setIsSaving(false);
    }
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

      <section className="mt-5 rounded-2xl border border-line bg-soft p-4">
        <h3 className="text-lg font-bold text-ink">Retur fra OnlinePOS</h3>
        <p className="mt-1 text-sm font-bold text-muted">Vælg hvad BackEvent må gøre, når varen kommer retur.</p>
        <label className="mt-3 block">
          <span className="text-base font-bold text-ink">Behandling ved retur</span>
          <select value={returnHandling} onChange={(event) => setReturnHandling(event.target.value as ProductReturnHandling | "")} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-3 py-2 font-bold outline-none focus:border-pantone140">
            <option value="">Mangler beslutning</option>
            {returnHandlingOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {product && !hasExplicitReturnHandling(product) ? (
          <p className="mt-2 rounded-xl bg-pantone139/20 px-3 py-2 text-sm font-bold text-pantone140">
            Produktet mangler en bevidst returbehandling i databasen.
          </p>
        ) : null}
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
        {localError ? <p className="self-center text-sm font-bold text-warmRed">{localError}</p> : null}
        <PrimaryButton onClick={save} disabled={isSaving}>{isSaving ? "Gemmer..." : "Gem"}</PrimaryButton>
        {onDelete ? <button type="button" onClick={onDelete} className="min-h-11 rounded-2xl bg-warmRed px-4 py-2 font-bold text-macro">Slet</button> : null}
        <button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-line px-4 py-2 font-bold text-pantone140">Annuller</button>
      </div>
    </Modal>
  );
}

function DeleteObjectModal({
  name,
  objectLabel,
  preview,
  isWorking,
  onClose,
  onDelete,
  onDeactivate,
}: {
  name: string;
  objectLabel: string;
  preview: AdminDeletePreview | null;
  isWorking: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDeactivate: () => void;
}) {
  const okPreview = preview?.ok ? preview : null;
  const plan = okPreview?.plan ?? null;
  return (
    <Modal title={`Slet ${objectLabel}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-base font-bold text-ink">
          Vil du slette {objectLabel}et <span className="text-warmRed">{name}</span>?
        </p>
        {!preview ? <p className="rounded-2xl bg-soft p-4 text-sm font-bold text-muted">Tjekker historik og beholdning...</p> : null}
        {preview && !preview.ok ? <p className="rounded-2xl bg-warmRed/10 p-4 text-sm font-bold text-warmRed">{preview.message}</p> : null}
        {plan ? (
          <div className="rounded-2xl border border-line bg-soft p-4">
            <p className="text-sm font-bold text-ink">{plan.reason}</p>
            {okPreview ? (
              <p className="mt-2 text-xs font-bold text-muted">
                Beholdning: {formatNumber(okPreview.summary.activeStockQuantity)} · Historik: {okPreview.summary.historyCount} · Relationer: {okPreview.summary.relationCount}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {plan?.action === "delete" ? (
            <button type="button" onClick={onDelete} disabled={isWorking} className="min-h-11 rounded-2xl bg-warmRed px-4 py-2 font-bold text-macro disabled:opacity-50">
              {isWorking ? "Sletter..." : "Slet permanent"}
            </button>
          ) : null}
          {plan?.canDeactivate ? (
            <button type="button" onClick={onDeactivate} disabled={isWorking} className="min-h-11 rounded-2xl border border-warmRed bg-macro px-4 py-2 font-bold text-warmRed disabled:opacity-50">
              {isWorking ? "Deaktiverer..." : "Deaktivér"}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-line px-4 py-2 font-bold text-pantone140">Annuller</button>
        </div>
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
  return getTrackingModeLabel(mode);
}

function returnHandlingLabel(mode?: ProductReturnHandling | null) {
  return getReturnHandlingLabel(mode);
}

function formatPurchase(product: Product) {
  const label = product.purchaseUnitLabel ?? product.unit;
  const amount = product.unitsPerPurchaseUnit ?? product.unitsPerCase ?? 1;
  return `${amount} pr. ${label}`;
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
  if (key === "returnHandling") return returnHandlingLabel(product.returnHandling);
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
