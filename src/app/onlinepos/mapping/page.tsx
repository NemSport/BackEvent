"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton, PrimaryButton } from "@/components/backevent/buttons";
import { getProductsAdmin } from "@/lib/backevent/data";
import type { Product } from "@/lib/backevent/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type LineType = "modifier_stock_item" | "deposit_fee" | "deposit_return" | "container_product" | "stock_item" | "unknown";
type MappingAction = "consume_stock" | "ignore" | "deposit_fee" | "deposit_return" | "container_only";
type MappingStatus = "unmapped" | "approved";

type PreviewProduct = {
  onlinepos_product_id: string | number | null;
  onlinepos_product_name: string | null;
  onlinepos_product_group_name: string | null;
  lineType: LineType;
  inventoryRelevant: boolean;
  needsMapping: boolean;
  mappingStatus: MappingStatus;
  mappingAction: MappingAction;
  backeventInventoryItemId: string | null;
  conversionFactor: number | null;
  components: MappingComponent[];
  canAffectInventory: boolean;
  matchedMappingId?: string | null;
  matchedBy?: "product_id" | "name" | null;
};

type PreviewResponse = {
  ok: boolean;
  message: string;
  transactionCount: number;
  lineCount: number;
  productCountBeforeMapping: number;
  mappingCount: number;
  matchedMappingCount: number;
  mappedProductIds: string[];
  mappingReadDebug?: {
    hasUser: boolean;
    userEmail: string | null;
    profileRole: string | null;
    profileActive: boolean | null;
    readErrorStep: string | null;
  };
  errorStep: string | null;
  summary: {
    totalProducts: number;
    approvedMappings: number;
    missingMappings: number;
    inventoryRelevantMissingMappings: number;
    ignoredProducts: number;
    depositProducts: number;
    containerProducts: number;
  };
  products: PreviewProduct[];
};

type MappingDebugRow = {
  onlinepos_product_id: string | null;
  onlinepos_product_name: string | null;
  onlinepos_product_group_name: string | null;
  line_type: string | null;
  mapping_action: string | null;
  status: string | null;
  backevent_inventory_item_id: string | null;
  conversion_factor: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type MappingDebugResponse = {
  ok: boolean;
  source?: "supabase";
  rowCount?: number;
  rows?: MappingDebugRow[];
  message?: string;
  errorStep?: string;
};

type SavedMapping = {
  id: string;
  onlineposProductId: string | null;
  onlineposProductName: string | null;
  onlineposProductGroupName: string | null;
  lineType: LineType;
  backeventInventoryItemId: string | null;
  conversionFactor: number | null;
  components: MappingComponent[];
  mappingAction: MappingAction;
  status: MappingStatus;
};

type MappingComponent = {
  id?: string | null;
  mappingId?: string | null;
  backeventInventoryItemId: string | null;
  conversionFactor: number | null;
  sortOrder: number;
};

type DraftComponent = {
  backeventInventoryItemId: string;
  conversionFactor: string;
};

type DraftMapping = {
  backeventInventoryItemId: string;
  conversionFactor: string;
  components: DraftComponent[];
  mappingAction: MappingAction;
  status: MappingStatus;
};

type SortDirection = "asc" | "desc";
type MappingSortKey = "productName" | "groupName" | "lineType" | "selectedProduct" | "mappingAction" | "conversionFactor" | "status";
type MappingSort = { key: MappingSortKey; direction: SortDirection } | null;

const mappingActions: Array<{ value: MappingAction; label: string }> = [
  { value: "consume_stock", label: "Træk lager" },
  { value: "ignore", label: "Ignorer" },
  { value: "deposit_fee", label: "Pant/gebyr" },
  { value: "deposit_return", label: "Pant retur" },
  { value: "container_only", label: "Kun container-vare" },
];

export default function OnlinePosMappingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [savedMappings, setSavedMappings] = useState<SavedMapping[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftMapping>>({});
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewDebugLoading, setPreviewDebugLoading] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [mappingDebug, setMappingDebug] = useState<MappingDebugResponse | null>(null);
  const [rowDebugs, setRowDebugs] = useState<Record<string, MappingDebugResponse>>({});
  const [rowDebugLoading, setRowDebugLoading] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<MappingSort>(null);
  const inventoryProducts = useMemo(() => products.filter((product) => product.active !== false && product.trackingMode !== "ignore"), [products]);
  const sortedPreviewProducts = useMemo(
    () => sortMappingProducts(preview?.products ?? [], sort, drafts, savedMappings, inventoryProducts),
    [drafts, inventoryProducts, preview?.products, savedMappings, sort],
  );

  useEffect(() => {
    let mounted = true;

    async function loadBaseData() {
      try {
        const [loadedProducts, mappings] = await Promise.all([getProductsAdmin(), fetchSavedMappings()]);

        if (mounted) {
          setProducts(loadedProducts);
          setSavedMappings(mappings);
        }
      } catch {
        if (mounted) {
          setMessage("Mapping-data kunne ikke hentes.");
        }
      }
    }

    loadBaseData();

    return () => {
      mounted = false;
    };
  }, []);

  async function loadPreview() {
    setLoading(true);
    setMessage(null);

    try {
      const data = await fetchMappingPreview(from, to);
      setPreview(data);
      setDrafts(createDrafts(data.products, savedMappings));
      setMessage(data.ok ? "Produkter hentet fra OnlinePOS" : data.message || "OnlinePOS-preview fejlede");
    } catch {
      setMessage("OnlinePOS-preview kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }

  async function checkPreviewWithMappings() {
    setPreviewDebugLoading(true);
    setMessage(null);

    try {
      const data = await fetchMappingPreview(from, to);
      setPreview(data);
      setDrafts(createDrafts(data.products, savedMappings));
      setMessage(data.ok ? "Preview med mappings hentet" : data.message || "Preview med mappings fejlede");
    } catch {
      setMessage("Preview med mappings kunne ikke hentes.");
    } finally {
      setPreviewDebugLoading(false);
    }
  }

  async function saveMapping(product: PreviewProduct) {
    const key = productKey(product);
    const draft = drafts[key] ?? createDraft(product, findSavedMapping(product, savedMappings));
    setMessage(null);

    if (draft.status === "approved" && draft.mappingAction === "consume_stock" && !hasValidDraftComponents(draft.components)) {
      setMessage("Godkendt lagertræk kræver mindst én varekomponent.");
      return;
    }

    try {
      const response = await fetch("/api/onlinepos/inventory-mappings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify({
          onlineposProductId: product.onlinepos_product_id === null ? null : String(product.onlinepos_product_id),
          onlineposProductName: product.onlinepos_product_name,
          onlineposProductGroupName: product.onlinepos_product_group_name,
          lineType: product.lineType,
          backeventInventoryItemId: draft.components[0]?.backeventInventoryItemId || draft.backeventInventoryItemId || null,
          conversionFactor: draft.components[0]?.conversionFactor ? Number(draft.components[0].conversionFactor) : draft.conversionFactor ? Number(draft.conversionFactor) : null,
          components: draft.components.map((component, index) => ({
            backeventInventoryItemId: component.backeventInventoryItemId || null,
            conversionFactor: component.conversionFactor ? Number(component.conversionFactor) : null,
            sortOrder: index,
          })),
          mappingAction: draft.mappingAction,
          status: draft.status,
        }),
      });

      if (!response.ok) {
        throw new Error("save failed");
      }

      const data = (await response.json()) as { ok?: boolean; error?: string; mapping?: SavedMapping };

      if (!data.ok || !data.mapping) {
        throw new Error(data.error || "save failed");
      }

      const savedMapping = data.mapping;
      const freshMappings = await fetchSavedMappings();
      setSavedMappings(freshMappings);
      setPreview((current) => current ? applySavedMappingToPreview(current, savedMapping) : current);
      setMessage("Gemt i Supabase");
    } catch {
      setMessage("Mapping kunne ikke gemmes.");
    }
  }

  async function checkSavedMappings() {
    setDebugLoading(true);
    setMappingDebug(null);

    try {
      setMappingDebug(await fetchMappingDebug());
    } catch {
      setMappingDebug({ ok: false, message: "Debug kunne ikke hentes.", errorStep: "client_fetch" });
    } finally {
      setDebugLoading(false);
    }
  }

  async function checkProductMapping(product: PreviewProduct) {
    const key = productKey(product);
    const productId = normalizeOnlinePosId(product.onlinepos_product_id);

    if (!productId) {
      setRowDebugs((current) => ({
        ...current,
        [key]: { ok: false, message: "Produktet mangler OnlinePOS ID.", errorStep: "missing_product_id" },
      }));
      return;
    }

    setRowDebugLoading((current) => ({ ...current, [key]: true }));

    try {
      const debug = await fetchMappingDebug(productId);
      setRowDebugs((current) => ({ ...current, [key]: debug }));
    } catch {
      setRowDebugs((current) => ({
        ...current,
        [key]: { ok: false, message: "Debug kunne ikke hentes.", errorStep: "client_fetch" },
      }));
    } finally {
      setRowDebugLoading((current) => ({ ...current, [key]: false }));
    }
  }

  function toggleSort(key: MappingSortKey) {
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
    <AppShell adminOnly>
      <BackButton href="/admin" />
      <section className="my-6 rounded-[2rem] bg-soft p-6 shadow-soft lg:my-5 lg:rounded-[1.5rem] lg:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-ink">OnlinePOS mapping</h1>
            <p className="mt-2 text-lg font-medium text-muted">Godkend hvilke OnlinePOS varer der må påvirke lager</p>
          </div>
          <PrimaryButton onClick={loadPreview} disabled={loading}>
            {loading ? "Henter..." : "Hent varer"}
          </PrimaryButton>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <DateInput label="Fra" value={from} onChange={setFrom} />
          <DateInput label="Til" value={to} onChange={setTo} />
          <p className="rounded-2xl bg-macro px-4 py-3 text-sm font-bold text-muted">Ingen lagerændring her</p>
        </div>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-soft p-4 text-base font-bold text-pantone140">{message}</p> : null}

      {preview ? <SummaryCards preview={preview} /> : null}

      <MappingDebugPanel
        debug={mappingDebug}
        preview={preview}
        loading={debugLoading}
        previewLoading={previewDebugLoading}
        onCheck={checkSavedMappings}
        onCheckPreview={checkPreviewWithMappings}
      />

      <section className="mt-5 max-h-[76vh] overflow-auto rounded-[1.25rem] border border-line bg-macro shadow-soft">
        <div className="sticky top-0 z-10 hidden grid-cols-[4.75rem_minmax(16rem,2.4fr)_7rem_6.5rem_minmax(10rem,1fr)_7.75rem_4.5rem_6.25rem_10rem] gap-1.5 border-b border-line bg-soft px-2.5 py-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-muted xl:grid">
          <span>ID</span>
          <SortableMappingHeader label="Vare" sortKey="productName" sort={sort} onSort={toggleSort} />
          <SortableMappingHeader label="Gruppe" sortKey="groupName" sort={sort} onSort={toggleSort} />
          <SortableMappingHeader label="Type" sortKey="lineType" sort={sort} onSort={toggleSort} />
          <SortableMappingHeader label="Vare" sortKey="selectedProduct" sort={sort} onSort={toggleSort} />
          <SortableMappingHeader label="Handling" sortKey="mappingAction" sort={sort} onSort={toggleSort} />
          <SortableMappingHeader label="Faktor" sortKey="conversionFactor" sort={sort} onSort={toggleSort} />
          <SortableMappingHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
          <span>Gem</span>
        </div>
        <div className="divide-y divide-line">
          {sortedPreviewProducts.map((product) => (
            <MappingRow
              key={productKey(product)}
              product={product}
              inventoryProducts={inventoryProducts}
              draft={drafts[productKey(product)] ?? createDraft(product, findSavedMapping(product, savedMappings))}
              onDraft={(draft) => setDrafts((current) => ({ ...current, [productKey(product)]: draft }))}
              onSave={() => saveMapping(product)}
              onDebug={() => checkProductMapping(product)}
              debug={rowDebugs[productKey(product)] ?? null}
              debugLoading={Boolean(rowDebugLoading[productKey(product)])}
            />
          ))}
          {!preview ? <p className="p-5 text-base font-bold text-muted">Vælg periode og hent varer fra OnlinePOS.</p> : null}
          {preview && preview.products.length === 0 ? <p className="p-5 text-base font-bold text-muted">Ingen produkter fundet.</p> : null}
        </div>
      </section>
    </AppShell>
  );
}

function SortableMappingHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: MappingSortKey;
  sort: MappingSort;
  onSort: (key: MappingSortKey) => void;
}) {
  const direction = sort?.key === sortKey ? sort.direction : null;

  return (
    <button type="button" onClick={() => onSort(sortKey)} className="flex min-w-0 items-center gap-1 text-left font-bold uppercase tracking-wide hover:text-ink">
      <span className="truncate">{label}</span>
      {direction ? <span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span> : null}
    </button>
  );
}

function SummaryCards({ preview }: { preview: PreviewResponse }) {
  const items = [
    ["Produkter", preview.summary.totalProducts],
    ["Godkendt", preview.summary.approvedMappings],
    ["Mangler mapping", preview.summary.missingMappings],
    ["Lager mangler", preview.summary.inventoryRelevantMissingMappings],
    ["Kan påvirke lager", preview.products.filter((product) => product.canAffectInventory).length],
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {items.map(([label, value]) => (
        <article key={label} className="rounded-2xl border border-line bg-macro p-4 shadow-sm">
          <p className="text-sm font-bold text-muted">{label}</p>
          <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
        </article>
      ))}
    </section>
  );
}

function MappingDebugPanel({
  debug,
  preview,
  loading,
  previewLoading,
  onCheck,
  onCheckPreview,
}: {
  debug: MappingDebugResponse | null;
  preview: PreviewResponse | null;
  loading: boolean;
  previewLoading: boolean;
  onCheck: () => void;
  onCheckPreview: () => void;
}) {
  const kildevand = preview?.products.find(
    (product) => normalizeOnlinePosId(product.onlinepos_product_id) === "23300358" || normalizeName(product.onlinepos_product_name) === "kildevand",
  );

  return (
    <section className="mt-4 rounded-[1.25rem] border border-line bg-macro p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Mapping debug</h2>
          <p className="text-xs font-bold text-muted">Viser gemte rækker fra Supabase for din login-session.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCheck}
            disabled={loading}
            className="rounded-lg bg-pantone139 px-3 py-2 text-xs font-bold text-ink disabled:opacity-60"
          >
            {loading ? "Tjekker..." : "Tjek gemte mappings"}
          </button>
          <button
            type="button"
            onClick={onCheckPreview}
            disabled={previewLoading}
            className="rounded-lg border border-line bg-macro px-3 py-2 text-xs font-bold text-muted disabled:opacity-60"
          >
            {previewLoading ? "Tjekker..." : "Tjek preview med mappings"}
          </button>
        </div>
      </div>

      {preview ? (
        <div className="mt-3 rounded-xl bg-soft p-3 text-xs font-bold text-muted">
          <div className="grid gap-2 sm:grid-cols-4">
            <span>mappingCount: {preview.mappingCount}</span>
            <span>matchedMappingCount: {preview.matchedMappingCount}</span>
            <span>mappedProductIds: {preview.mappedProductIds?.join(", ") || "-"}</span>
            <span>readErrorStep: {preview.mappingReadDebug?.readErrorStep ?? "-"}</span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <span>hasUser: {String(preview.mappingReadDebug?.hasUser ?? false)}</span>
            <span>userEmail: {preview.mappingReadDebug?.userEmail ?? "-"}</span>
            <span>role: {preview.mappingReadDebug?.profileRole ?? "-"}</span>
            <span>active: {String(preview.mappingReadDebug?.profileActive ?? "-")}</span>
          </div>
          {kildevand ? (
            <div className="mt-3 rounded-lg bg-macro p-2">
              <p className="text-ink">Kildevand</p>
              <p>
                status: {kildevand.mappingStatus} · action: {kildevand.mappingAction} · factor: {kildevand.conversionFactor ?? "-"} · kan trække:{" "}
                {String(kildevand.canAffectInventory)} · matchedBy: {kildevand.matchedBy ?? "-"}
              </p>
              <p>mappingId: {kildevand.matchedMappingId ?? "-"} · vare: {kildevand.backeventInventoryItemId ?? "-"}</p>
            </div>
          ) : (
            <p className="mt-2">Kildevand ikke fundet i preview.</p>
          )}
        </div>
      ) : null}

      {debug ? (
        <div className="mt-3 rounded-xl bg-soft p-3 text-xs font-bold text-muted">
          <div className="grid gap-2 sm:grid-cols-3">
            <span>ok: {String(debug.ok)}</span>
            <span>rowCount: {debug.rowCount ?? 0}</span>
            <span>source: {debug.source ?? "-"}</span>
          </div>
          {!debug.ok ? <p className="mt-2 text-warmRed">{debug.message ?? "Debug fejlede"} ({debug.errorStep ?? "ukendt"})</p> : null}
          {debug.rows?.length ? <DebugRows rows={debug.rows.slice(0, 10)} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function RowDebugBox({ debug }: { debug: MappingDebugResponse }) {
  return (
    <div className="rounded-xl bg-soft p-3 text-xs font-bold text-muted xl:col-span-full xl:mt-1">
      <div className="flex flex-wrap gap-3">
        <span>ok: {String(debug.ok)}</span>
        <span>rowCount: {debug.rowCount ?? 0}</span>
        <span>source: {debug.source ?? "-"}</span>
      </div>
      {!debug.ok ? <p className="mt-2 text-warmRed">{debug.message ?? "Debug fejlede"} ({debug.errorStep ?? "ukendt"})</p> : null}
      {debug.rows?.length ? <DebugRows rows={debug.rows.slice(0, 10)} /> : null}
    </div>
  );
}

function DebugRows({ rows }: { rows: MappingDebugRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-[0.68rem]">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-1 pr-2">ID</th>
            <th className="py-1 pr-2">Navn</th>
            <th className="py-1 pr-2">Gruppe</th>
            <th className="py-1 pr-2">Type</th>
            <th className="py-1 pr-2">Handling</th>
            <th className="py-1 pr-2">Status</th>
            <th className="py-1 pr-2">Vare</th>
            <th className="py-1 pr-2">Faktor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.onlinepos_product_id ?? "missing"}-${index}`} className="border-b border-line/70 last:border-0">
              <td className="max-w-24 truncate py-1 pr-2">{row.onlinepos_product_id ?? "-"}</td>
              <td className="max-w-48 truncate py-1 pr-2">{row.onlinepos_product_name ?? "-"}</td>
              <td className="max-w-36 truncate py-1 pr-2">{row.onlinepos_product_group_name ?? "-"}</td>
              <td className="py-1 pr-2">{row.line_type ?? "-"}</td>
              <td className="py-1 pr-2">{row.mapping_action ?? "-"}</td>
              <td className="py-1 pr-2">{row.status ?? "-"}</td>
              <td className="max-w-36 truncate py-1 pr-2">{row.backevent_inventory_item_id ?? "-"}</td>
              <td className="py-1 pr-2">{row.conversion_factor ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MappingRow({
  product,
  inventoryProducts,
  draft,
  onDraft,
  onSave,
  onDebug,
  debug,
  debugLoading,
}: {
  product: PreviewProduct;
  inventoryProducts: Product[];
  draft: DraftMapping;
  onDraft: (draft: DraftMapping) => void;
  onSave: () => void;
  onDebug: () => void;
  debug: MappingDebugResponse | null;
  debugLoading: boolean;
}) {
  const components = draft.components.length > 0 ? draft.components : [{ backeventInventoryItemId: draft.backeventInventoryItemId, conversionFactor: draft.conversionFactor }];
  const canApprove = draft.mappingAction !== "consume_stock" || hasValidDraftComponents(components);

  function updateComponent(index: number, component: DraftComponent) {
    onDraft({ ...draft, components: components.map((item, itemIndex) => itemIndex === index ? component : item) });
  }

  function removeComponent(index: number) {
    const nextComponents = components.filter((_, itemIndex) => itemIndex !== index);
    onDraft({ ...draft, components: nextComponents.length > 0 ? nextComponents : [{ backeventInventoryItemId: "", conversionFactor: "1" }] });
  }

  function addComponent() {
    onDraft({ ...draft, components: [...components, { backeventInventoryItemId: "", conversionFactor: "1" }] });
  }

  return (
    <article className="grid gap-3 px-4 py-4 text-sm font-medium text-ink xl:grid-cols-[4.75rem_minmax(16rem,2.4fr)_7rem_6.5rem_minmax(10rem,1fr)_7.75rem_4.5rem_6.25rem_10rem] xl:items-center xl:gap-1.5 xl:px-2.5 xl:py-1 xl:text-xs">
      <span className="truncate font-bold text-muted" title={String(product.onlinepos_product_id ?? "-")}>{product.onlinepos_product_id ?? "-"}</span>
      <div className="min-w-0">
        <p className="truncate font-bold" title={product.onlinepos_product_name ?? "Ukendt vare"}>{product.onlinepos_product_name ?? "Ukendt vare"}</p>
        <p className="text-xs text-muted xl:hidden">{product.onlinepos_product_group_name ?? "-"} · {lineTypeLabel(product.lineType)}</p>
      </div>
      <span className="hidden truncate xl:block" title={product.onlinepos_product_group_name ?? "-"}>{product.onlinepos_product_group_name ?? "-"}</span>
      <span className="w-fit rounded-lg bg-soft px-2 py-1 text-[0.68rem] font-bold text-pantone140 xl:max-w-full xl:truncate xl:px-1.5 xl:py-0.5 xl:text-[0.65rem]" title={lineTypeLabel(product.lineType)}>{lineTypeLabel(product.lineType)}</span>
      <div className="grid gap-1">
        {components.map((component, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_4.25rem_auto] gap-1">
            <select
              value={component.backeventInventoryItemId}
              onChange={(event) => updateComponent(index, { ...component, backeventInventoryItemId: event.target.value })}
              className="min-h-10 rounded-xl border border-line bg-macro px-3 py-2 font-bold outline-none focus:border-pantone140 xl:min-h-7 xl:rounded-lg xl:px-1.5 xl:py-0.5 xl:text-xs"
            >
              <option value="">Ingen valgt</option>
              {inventoryProducts.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <input
              value={component.conversionFactor}
              onChange={(event) => updateComponent(index, { ...component, conversionFactor: event.target.value })}
              className="min-h-10 rounded-xl border border-line bg-macro px-3 py-2 font-bold outline-none focus:border-pantone140 xl:min-h-7 xl:rounded-lg xl:px-1.5 xl:py-0.5 xl:text-xs"
              inputMode="decimal"
              aria-label="Faktor"
            />
            <button
              type="button"
              onClick={() => removeComponent(index)}
              className="rounded-xl border border-line bg-macro px-2 text-xs font-bold text-muted xl:rounded-lg"
              aria-label="Fjern komponent"
            >
              -
            </button>
          </div>
        ))}
      </div>
      <select
        value={draft.mappingAction}
        onChange={(event) => {
          const mappingAction = event.target.value as MappingAction;
          const nextStatus = mappingAction === "consume_stock" && draft.status === "approved" && !hasValidDraftComponents(components) ? "unmapped" : draft.status;
          onDraft({ ...draft, mappingAction, status: nextStatus });
        }}
        className="min-h-10 rounded-xl border border-line bg-macro px-3 py-2 font-bold outline-none focus:border-pantone140 xl:min-h-7 xl:rounded-lg xl:px-1.5 xl:py-0.5 xl:text-xs"
      >
        {mappingActions.map((action) => (
          <option key={action.value} value={action.value}>{action.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={addComponent}
        className="min-h-10 rounded-xl border border-line bg-macro px-3 py-2 text-xs font-bold text-muted outline-none hover:border-pantone140 xl:min-h-7 xl:rounded-lg xl:px-1.5 xl:py-0.5"
      >
        + komponent
      </button>
      <select
        value={draft.status}
        onChange={(event) => onDraft({ ...draft, status: event.target.value as MappingStatus })}
        className="min-h-10 rounded-xl border border-line bg-macro px-3 py-2 font-bold outline-none focus:border-pantone140 xl:min-h-7 xl:rounded-lg xl:px-1.5 xl:py-0.5 xl:text-xs"
      >
        <option value="unmapped">Afventer</option>
        <option value="approved" disabled={!canApprove}>Godkendt</option>
      </select>
      <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap xl:gap-1">
        <button type="button" onClick={onSave} className="rounded-xl bg-pantone139 px-3 py-2 text-sm font-bold text-ink xl:rounded-lg xl:px-2 xl:py-1 xl:text-xs">
          Gem
        </button>
        <button type="button" onClick={onDebug} className="rounded-xl border border-line bg-macro px-3 py-2 text-sm font-bold text-muted xl:rounded-lg xl:px-2 xl:py-1 xl:text-xs">
          {debugLoading ? "..." : "Tjek"}
        </button>
        <span className={`rounded-xl px-3 py-2 text-xs font-bold xl:rounded-lg xl:px-1.5 xl:py-0.5 xl:text-[0.65rem] ${product.canAffectInventory ? "bg-green-50 text-green-700" : "bg-soft text-muted"}`}>
          {product.canAffectInventory ? "Kan trække" : "Trækker ikke"}
        </span>
      </div>
      {debug ? <RowDebugBox debug={debug} /> : null}
    </article>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-base font-bold text-ink">{label}</span>
      <input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-11 w-full rounded-2xl border border-line px-3 py-2 font-bold outline-none focus:border-pantone140"
      />
    </label>
  );
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return {};
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchMappingPreview(from: string, to: string): Promise<PreviewResponse> {
  const params = new URLSearchParams({
    datetime_from: toIso(from),
    datetime_to: toIso(to),
  });

  const response = await fetch(`/api/onlinepos/inventory-mapping-preview?${params.toString()}`, {
    headers: await getAuthHeaders(),
    cache: "no-store",
  });

  return (await response.json()) as PreviewResponse;
}

async function fetchSavedMappings(): Promise<SavedMapping[]> {
  const response = await fetch("/api/onlinepos/inventory-mappings", {
    headers: await getAuthHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { ok?: boolean; mappings?: SavedMapping[] };
  if (!data.ok) {
    return [];
  }
  return data.mappings ?? [];
}

async function fetchMappingDebug(onlineposProductId?: string): Promise<MappingDebugResponse> {
  const params = new URLSearchParams();

  if (onlineposProductId) {
    params.set("onlinepos_product_id", onlineposProductId);
  }

  const response = await fetch(`/api/onlinepos/inventory-mappings/debug${params.size ? `?${params.toString()}` : ""}`, {
    headers: await getAuthHeaders(),
    cache: "no-store",
  });
  const data = (await response.json()) as MappingDebugResponse;

  if (!response.ok && data.ok !== false) {
    return {
      ok: false,
      message: "Debug kunne ikke hentes.",
      errorStep: `http_${response.status}`,
    };
  }

  return data;
}

function createDrafts(products: PreviewProduct[], mappings: SavedMapping[]) {
  return Object.fromEntries(products.map((product) => [productKey(product), createDraft(product, findSavedMapping(product, mappings))]));
}

function createDraft(product: PreviewProduct, saved?: SavedMapping): DraftMapping {
  const components = draftComponentsFromMapping(saved?.components ?? product.components, saved, product);

  return {
    backeventInventoryItemId: components[0]?.backeventInventoryItemId ?? "",
    conversionFactor: components[0]?.conversionFactor ?? "1",
    components,
    mappingAction: saved?.mappingAction ?? product.mappingAction,
    status: saved?.status ?? product.mappingStatus,
  };
}

function draftComponentsFromMapping(components: MappingComponent[] | undefined, saved?: SavedMapping, product?: PreviewProduct): DraftComponent[] {
  if (components?.length) {
    return components.map((component) => ({
      backeventInventoryItemId: component.backeventInventoryItemId ?? "",
      conversionFactor: (component.conversionFactor ?? 1).toString(),
    }));
  }

  const backeventInventoryItemId = saved?.backeventInventoryItemId ?? product?.backeventInventoryItemId ?? "";
  const conversionFactor = saved?.conversionFactor ?? product?.conversionFactor ?? 1;

  return [
    {
      backeventInventoryItemId,
      conversionFactor: conversionFactor.toString(),
    },
  ];
}

function sortMappingProducts(
  products: PreviewProduct[],
  sort: MappingSort,
  drafts: Record<string, DraftMapping>,
  mappings: SavedMapping[],
  inventoryProducts: Product[],
) {
  if (!sort) {
    return products;
  }

  return [...products].sort((a, b) => {
    const aDraft = drafts[productKey(a)] ?? createDraft(a, findSavedMapping(a, mappings));
    const bDraft = drafts[productKey(b)] ?? createDraft(b, findSavedMapping(b, mappings));

    return compareSortValues(
      mappingSortValue(a, aDraft, inventoryProducts, sort.key),
      mappingSortValue(b, bDraft, inventoryProducts, sort.key),
      sort.direction,
    );
  });
}

function mappingSortValue(product: PreviewProduct, draft: DraftMapping, inventoryProducts: Product[], key: MappingSortKey) {
  if (key === "productName") return product.onlinepos_product_name;
  if (key === "groupName") return product.onlinepos_product_group_name;
  if (key === "lineType") return lineTypeLabel(product.lineType);
  if (key === "selectedProduct") return inventoryProducts.find((item) => item.id === draft.components[0]?.backeventInventoryItemId)?.name;
  if (key === "mappingAction") return mappingActionLabel(draft.mappingAction);
  if (key === "conversionFactor") return draft.components[0]?.conversionFactor.trim() ? Number(draft.components[0].conversionFactor) : null;
  return statusLabel(draft.status);
}

function findSavedMapping(product: PreviewProduct, mappings: SavedMapping[]) {
  const productId = normalizeOnlinePosId(product.onlinepos_product_id);

  if (productId) {
    return mappings.find((mapping) => normalizeOnlinePosId(mapping.onlineposProductId) === productId);
  }

  const productName = normalizeName(product.onlinepos_product_name);

  if (!productName) {
    return undefined;
  }

  return mappings.find(
    (mapping) =>
      !normalizeOnlinePosId(mapping.onlineposProductId) &&
      normalizeName(mapping.onlineposProductName) === productName &&
      mapping.lineType === product.lineType,
  );
}

function applySavedMappingToPreview(preview: PreviewResponse, mapping: SavedMapping): PreviewResponse {
  const products = preview.products.map((product) => {
    if (!mappingMatchesProduct(mapping, product)) {
      return product;
    }

    const canAffectInventory =
      mapping.status === "approved" &&
      mapping.mappingAction === "consume_stock" &&
      hasValidMappingComponents(mapping.components);
    return {
      ...product,
      mappingStatus: mapping.status,
      mappingAction: mapping.mappingAction,
      backeventInventoryItemId: mapping.backeventInventoryItemId,
      conversionFactor: mapping.conversionFactor,
      components: mapping.components,
      canAffectInventory,
    };
  });

  return {
    ...preview,
    mappingCount: products.filter((product) => product.mappingStatus === "approved").length,
    summary: {
      ...preview.summary,
      approvedMappings: products.filter((product) => product.mappingStatus === "approved").length,
      missingMappings: products.filter((product) => product.mappingStatus === "unmapped").length,
      inventoryRelevantMissingMappings: products.filter((product) => product.inventoryRelevant && product.mappingStatus === "unmapped").length,
      ignoredProducts: products.filter((product) => product.mappingAction === "ignore").length,
      depositProducts: products.filter((product) => product.mappingAction === "deposit_fee" || product.mappingAction === "deposit_return").length,
      containerProducts: products.filter((product) => product.mappingAction === "container_only").length,
    },
    products,
  };
}

function hasValidDraftComponents(components: DraftComponent[]) {
  return components.length > 0 && components.every((component) => component.backeventInventoryItemId && component.conversionFactor.trim());
}

function hasValidMappingComponents(components: MappingComponent[]) {
  return components.length > 0 && components.every((component) => component.backeventInventoryItemId && component.conversionFactor !== null);
}

function productKey(product: PreviewProduct) {
  return [
    product.onlinepos_product_id ?? "",
    product.onlinepos_product_name ?? "",
    product.onlinepos_product_group_name ?? "",
    product.lineType,
  ].join(":");
}

function mappingMatchesProduct(mapping: SavedMapping, product: PreviewProduct) {
  const mappingId = normalizeOnlinePosId(mapping.onlineposProductId);
  const productId = normalizeOnlinePosId(product.onlinepos_product_id);

  if (productId) {
    return mappingId === productId;
  }

  return (
    !mappingId &&
    normalizeName(mapping.onlineposProductName) === normalizeName(product.onlinepos_product_name) &&
    mapping.lineType === product.lineType
  );
}

function normalizeOnlinePosId(value: string | number | null) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value).trim() || null;
}

function normalizeName(value: string | null) {
  return value?.trim().toLocaleLowerCase("da-DK") || null;
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function defaultFrom() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return toDateTimeLocal(date);
}

function defaultTo() {
  return toDateTimeLocal(new Date());
}

function toDateTimeLocal(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function lineTypeLabel(type: LineType) {
  if (type === "modifier_stock_item") return "MSG lager";
  if (type === "deposit_fee") return "Pant/gebyr";
  if (type === "deposit_return") return "Pant retur";
  if (type === "container_product") return "Container-vare";
  if (type === "unknown") return "Ukendt";
  return "Lagervare";
}

function mappingActionLabel(action: MappingAction) {
  return mappingActions.find((item) => item.value === action)?.label ?? action;
}

function statusLabel(status: MappingStatus) {
  if (status === "approved") return "Godkendt";
  return "Afventer";
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
