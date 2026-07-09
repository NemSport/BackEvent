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
  canAffectInventory: boolean;
};

type PreviewResponse = {
  ok: boolean;
  message: string;
  transactionCount: number;
  lineCount: number;
  productCountBeforeMapping: number;
  mappingCount: number;
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

type SavedMapping = {
  id: string;
  onlineposProductId: string | null;
  onlineposProductName: string | null;
  onlineposProductGroupName: string | null;
  lineType: LineType;
  backeventInventoryItemId: string | null;
  conversionFactor: number | null;
  mappingAction: MappingAction;
  status: MappingStatus;
};

type DraftMapping = {
  backeventInventoryItemId: string;
  conversionFactor: string;
  mappingAction: MappingAction;
  status: MappingStatus;
};

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
  const inventoryProducts = useMemo(() => products.filter((product) => product.active !== false && product.trackingMode !== "ignore"), [products]);

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
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        datetime_from: toIso(from),
        datetime_to: toIso(to),
      });
      const response = await fetch(`/api/onlinepos/inventory-mapping-preview?${params.toString()}`, {
        headers,
        cache: "no-store",
      });
      const data = (await response.json()) as PreviewResponse;
      setPreview(data);
      setDrafts(createDrafts(data.products, savedMappings));
      setMessage(data.ok ? "Produkter hentet fra OnlinePOS" : data.message || "OnlinePOS-preview fejlede");
    } catch {
      setMessage("OnlinePOS-preview kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }

  async function saveMapping(product: PreviewProduct) {
    const key = productKey(product);
    const draft = drafts[key] ?? createDraft(product, findSavedMapping(product, savedMappings));
    setMessage(null);

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
          backeventInventoryItemId: draft.backeventInventoryItemId || null,
          conversionFactor: draft.conversionFactor ? Number(draft.conversionFactor) : null,
          mappingAction: draft.mappingAction,
          status: draft.status,
        }),
      });

      if (!response.ok) {
        throw new Error("save failed");
      }

      const data = (await response.json()) as { mapping: SavedMapping };
      const nextMappings = upsertMapping(savedMappings, data.mapping);
      setSavedMappings(nextMappings);
      setPreview((current) => current ? applySavedMappingToPreview(current, data.mapping) : current);
      setMessage("Mapping gemt");
    } catch {
      setMessage("Mapping kunne ikke gemmes.");
    }
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

      <section className="mt-5 overflow-hidden rounded-[1.5rem] border border-line bg-macro shadow-soft">
        <div className="hidden grid-cols-[0.9fr_1.4fr_0.9fr_0.9fr_1fr_0.9fr_0.7fr_0.8fr_0.8fr] gap-3 border-b border-line bg-soft px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted 2xl:grid">
          <span>OnlinePOS ID</span>
          <span>Vare</span>
          <span>Gruppe</span>
          <span>Type</span>
          <span>BackEvent vare</span>
          <span>Handling</span>
          <span>Faktor</span>
          <span>Status</span>
          <span>Gem</span>
        </div>
        <div className="divide-y divide-line">
          {(preview?.products ?? []).map((product) => (
            <MappingRow
              key={productKey(product)}
              product={product}
              inventoryProducts={inventoryProducts}
              draft={drafts[productKey(product)] ?? createDraft(product, findSavedMapping(product, savedMappings))}
              onDraft={(draft) => setDrafts((current) => ({ ...current, [productKey(product)]: draft }))}
              onSave={() => saveMapping(product)}
            />
          ))}
          {!preview ? <p className="p-5 text-base font-bold text-muted">Vælg periode og hent varer fra OnlinePOS.</p> : null}
          {preview && preview.products.length === 0 ? <p className="p-5 text-base font-bold text-muted">Ingen produkter fundet.</p> : null}
        </div>
      </section>
    </AppShell>
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

function MappingRow({
  product,
  inventoryProducts,
  draft,
  onDraft,
  onSave,
}: {
  product: PreviewProduct;
  inventoryProducts: Product[];
  draft: DraftMapping;
  onDraft: (draft: DraftMapping) => void;
  onSave: () => void;
}) {
  return (
    <article className="grid gap-3 px-4 py-4 text-sm font-medium text-ink 2xl:grid-cols-[0.9fr_1.4fr_0.9fr_0.9fr_1fr_0.9fr_0.7fr_0.8fr_0.8fr] 2xl:items-center">
      <span className="font-bold text-muted">{product.onlinepos_product_id ?? "-"}</span>
      <div>
        <p className="font-bold">{product.onlinepos_product_name ?? "Ukendt vare"}</p>
        <p className="text-xs text-muted 2xl:hidden">{product.onlinepos_product_group_name ?? "-"} · {lineTypeLabel(product.lineType)}</p>
      </div>
      <span className="hidden 2xl:block">{product.onlinepos_product_group_name ?? "-"}</span>
      <span className="rounded-xl bg-soft px-3 py-2 text-xs font-bold text-pantone140">{lineTypeLabel(product.lineType)}</span>
      <select
        value={draft.backeventInventoryItemId}
        onChange={(event) => onDraft({ ...draft, backeventInventoryItemId: event.target.value })}
        className="min-h-10 rounded-xl border border-line bg-macro px-3 py-2 font-bold outline-none focus:border-pantone140"
      >
        <option value="">Ingen valgt</option>
        {inventoryProducts.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
      <select
        value={draft.mappingAction}
        onChange={(event) => onDraft({ ...draft, mappingAction: event.target.value as MappingAction })}
        className="min-h-10 rounded-xl border border-line bg-macro px-3 py-2 font-bold outline-none focus:border-pantone140"
      >
        {mappingActions.map((action) => (
          <option key={action.value} value={action.value}>{action.label}</option>
        ))}
      </select>
      <input
        value={draft.conversionFactor}
        onChange={(event) => onDraft({ ...draft, conversionFactor: event.target.value })}
        className="min-h-10 rounded-xl border border-line bg-macro px-3 py-2 font-bold outline-none focus:border-pantone140"
        inputMode="decimal"
      />
      <select
        value={draft.status}
        onChange={(event) => onDraft({ ...draft, status: event.target.value as MappingStatus })}
        className="min-h-10 rounded-xl border border-line bg-macro px-3 py-2 font-bold outline-none focus:border-pantone140"
      >
        <option value="unmapped">Ikke godkendt</option>
        <option value="approved">Godkendt</option>
      </select>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSave} className="rounded-xl bg-pantone139 px-3 py-2 text-sm font-bold text-ink">
          Gem
        </button>
        <span className={`rounded-xl px-3 py-2 text-xs font-bold ${product.canAffectInventory ? "bg-green-100 text-green-800" : "bg-soft text-muted"}`}>
          {product.canAffectInventory ? "Kan trække" : "Trækker ikke"}
        </span>
      </div>
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

async function fetchSavedMappings(): Promise<SavedMapping[]> {
  const response = await fetch("/api/onlinepos/inventory-mappings", {
    headers: await getAuthHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { mappings?: SavedMapping[] };
  return data.mappings ?? [];
}

function createDrafts(products: PreviewProduct[], mappings: SavedMapping[]) {
  return Object.fromEntries(products.map((product) => [productKey(product), createDraft(product, findSavedMapping(product, mappings))]));
}

function createDraft(product: PreviewProduct, saved?: SavedMapping): DraftMapping {
  return {
    backeventInventoryItemId: saved?.backeventInventoryItemId ?? product.backeventInventoryItemId ?? "",
    conversionFactor: (saved?.conversionFactor ?? product.conversionFactor ?? 1).toString(),
    mappingAction: saved?.mappingAction ?? product.mappingAction,
    status: saved?.status ?? product.mappingStatus,
  };
}

function findSavedMapping(product: PreviewProduct, mappings: SavedMapping[]) {
  return mappings.find((mapping) => mappingKey(mapping) === productKey(product));
}

function applySavedMappingToPreview(preview: PreviewResponse, mapping: SavedMapping): PreviewResponse {
  const products = preview.products.map((product) => {
    if (productKey(product) !== mappingKey(mapping)) {
      return product;
    }

    const canAffectInventory = mapping.status === "approved" && mapping.mappingAction === "consume_stock";
    return {
      ...product,
      mappingStatus: mapping.status,
      mappingAction: mapping.mappingAction,
      backeventInventoryItemId: mapping.backeventInventoryItemId,
      conversionFactor: mapping.conversionFactor,
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

function upsertMapping(mappings: SavedMapping[], mapping: SavedMapping) {
  const next = mappings.filter((item) => mappingKey(item) !== mappingKey(mapping));
  return [...next, mapping];
}

function productKey(product: PreviewProduct) {
  return [
    product.onlinepos_product_id ?? "",
    product.onlinepos_product_name ?? "",
    product.onlinepos_product_group_name ?? "",
    product.lineType,
  ].join(":");
}

function mappingKey(mapping: SavedMapping) {
  return [
    mapping.onlineposProductId ?? "",
    mapping.onlineposProductName ?? "",
    mapping.onlineposProductGroupName ?? "",
    mapping.lineType,
  ].join(":");
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
