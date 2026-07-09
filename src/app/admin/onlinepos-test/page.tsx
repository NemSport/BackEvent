"use client";

import { AlertTriangle, BarChart3, CheckCircle2, PackageSearch, PlugZap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { getLocationsAdmin, getProductsAdmin, updateProduct } from "@/lib/backevent/data";
import type { Location, Product, ProductTrackingMode } from "@/lib/backevent/types";

type MockOnlinePosProduct = {
  id: string;
  name: string;
  fallbackTrackingMode: ProductTrackingMode;
  fallbackSalesUnitQuantity: number;
  fallbackLitersPerSale: number | null;
};

type MockOnlinePosSale = {
  id: string;
  barName: string;
  productName: string;
  quantity: number;
  periodHours: number;
};

type SaleResult = {
  sale: MockOnlinePosSale;
  mockProduct?: MockOnlinePosProduct;
  product?: Product;
  location?: Location;
  sourceLocation?: Location;
  trackingMode?: ProductTrackingMode;
  stockDraw: number | null;
  liters: number | null;
  litersPerHour: number | null;
  warnings: string[];
  excluded: boolean;
};

type ProductMatch = {
  mockProduct: MockOnlinePosProduct;
  product?: Product;
  matchType: "manual" | "name" | "none";
};

const mockOnlinePosProducts: MockOnlinePosProduct[] = [
  {
    id: "onlinepos-pepsi-max-05",
    name: "Pepsi Max 0.5L",
    fallbackTrackingMode: "inventory",
    fallbackSalesUnitQuantity: 1,
    fallbackLitersPerSale: null,
  },
  {
    id: "onlinepos-faxe-kondi-05",
    name: "Faxe Kondi 0.5L",
    fallbackTrackingMode: "inventory",
    fallbackSalesUnitQuantity: 1,
    fallbackLitersPerSale: null,
  },
  {
    id: "onlinepos-vand-05",
    name: "Vand 0.5L",
    fallbackTrackingMode: "inventory",
    fallbackSalesUnitQuantity: 1,
    fallbackLitersPerSale: null,
  },
  {
    id: "onlinepos-royal-pilsner-fad",
    name: "Royal Pilsner fad",
    fallbackTrackingMode: "flow",
    fallbackSalesUnitQuantity: 1,
    fallbackLitersPerSale: 0.4,
  },
  {
    id: "onlinepos-royal-classic-fad",
    name: "Royal Classic fad",
    fallbackTrackingMode: "flow",
    fallbackSalesUnitQuantity: 1,
    fallbackLitersPerSale: 0.4,
  },
];

const mockOnlinePosSales: MockOnlinePosSale[] = [
  { id: "sale-rodbar-pepsi", barName: "Rødbar", productName: "Pepsi Max 0.5L", quantity: 18, periodHours: 2 },
  { id: "sale-den-lokale-pepsi", barName: "Den Lokale", productName: "Pepsi Max 0.5L", quantity: 11, periodHours: 2 },
  { id: "sale-rodbar-pilsner", barName: "Rødbar", productName: "Royal Pilsner fad", quantity: 46, periodHours: 2 },
  { id: "sale-pubben-faxe", barName: "Pubben", productName: "Faxe Kondi 0.5L", quantity: 9, periodHours: 2 },
];

export default function OnlinePosTestPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, string>>({});
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts] = await Promise.all([getLocationsAdmin(), getProductsAdmin()]);

        if (!mounted) {
          return;
        }

        setLocations(loadedLocations);
        setProducts(loadedProducts);
      } catch {
        if (mounted) {
          setMessage("Testdata kunne ikke hentes lige nu.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const saleResults = useMemo(
    () => mockOnlinePosSales.map((sale) => calculateSaleResult(sale, products, locations)),
    [locations, products],
  );
  const productMatches = useMemo(() => mockOnlinePosProducts.map((mockProduct) => findProductMatch(mockProduct, products)), [products]);
  const duplicateOnlinePosIds = useMemo(() => getDuplicateOnlinePosIds(products), [products]);
  const stockDrawResults = saleResults.filter((result) => result.trackingMode === "inventory" && !result.excluded);
  const flowResults = saleResults.filter((result) => result.trackingMode === "flow" && !result.excluded);
  const warnings = [
    ...saleResults.flatMap((result) =>
      result.warnings.map((warning) => ({
        id: `${result.sale.id}-${warning}`,
        text: `${warning}: ${result.sale.barName} / ${result.sale.productName}`,
      })),
    ),
    ...duplicateOnlinePosIds.map((duplicate) => ({
      id: `duplicate-${duplicate.onlineposProductId}`,
      text: `Flere BackEvent varer bruger samme OnlinePOS ID: ${duplicate.onlineposProductId} (${duplicate.productNames.join(", ")})`,
    })),
  ];

  async function handleSaveMatch(mockProduct: MockOnlinePosProduct) {
    const suggestedProductId = findProductMatch(mockProduct, products).product?.id ?? "";
    const selectedProductId = selectedProductIds[mockProduct.id] ?? suggestedProductId;
    const product = products.find((item) => item.id === selectedProductId);

    if (!product) {
      setMessage("Vælg en BackEvent vare først.");
      return;
    }

    setSavingProductId(mockProduct.id);
    setMessage(null);

    try {
      await updateProduct(product.id, {
        name: product.name,
        unit: product.unit,
        trackingMode: product.trackingMode ?? "inventory",
        onlineposProductId: mockProduct.id,
        onlineposName: mockProduct.name,
        salesUnitQuantity: product.salesUnitQuantity ?? 1,
        litersPerSale: product.litersPerSale ?? null,
        unitsPerCase: product.unitsPerCase ?? null,
        active: product.active ?? true,
        sortOrder: product.sortOrder ?? 999,
      });
      const refreshedProducts = await getProductsAdmin();
      setProducts(refreshedProducts);
      setSelectedProductIds((current) => ({ ...current, [mockProduct.id]: product.id }));
      setMessage("Match gemt.");
    } catch {
      setMessage("Match kunne ikke gemmes lige nu.");
    } finally {
      setSavingProductId(null);
    }
  }

  return (
    <AppShell requiredRole="ejer">
      <BackButton href="/admin" />
      <section className="my-6 rounded-[2rem] bg-soft p-6 shadow-soft lg:my-5 lg:rounded-[1.5rem] lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-ink">OnlinePOS test</h1>
            <p className="mt-2 text-lg font-medium text-muted">Mock test før rigtig API og drift</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-pantone139 px-4 py-2 text-sm font-bold text-pantone140">
            <PlugZap className="h-4 w-4" aria-hidden />
            Test mode
          </span>
        </div>
        <p className="mt-4 max-w-3xl text-sm font-medium text-muted">
          Ingen eksterne API-kald, ingen lagerbevægelser og ingen ændring af beholdning. Siden viser kun forventet
          effekt ud fra mock salg, produktmapping og barens lagerkilde.
        </p>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 p-4 text-base font-bold text-warmRed">{message}</p> : null}

      <div className="space-y-8">
        <section className="grid gap-4 xl:grid-cols-2">
          <CompactPanel title="Mock produkter" icon={PackageSearch}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-xs uppercase text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3">OnlinePOS vare</th>
                    <th className="py-2 pr-3">Test type</th>
                    <th className="py-2 pr-3">Salgsantal</th>
                    <th className="py-2">Liter pr. salg</th>
                  </tr>
                </thead>
                <tbody>
                  {mockOnlinePosProducts.map((product) => (
                    <tr key={product.id} className="border-b border-line/70 last:border-0">
                      <td className="py-2 pr-3 font-bold text-ink">{product.name}</td>
                      <td className="py-2 pr-3 text-muted">{trackingModeLabel(product.fallbackTrackingMode)}</td>
                      <td className="py-2 pr-3 text-muted">{formatNumber(product.fallbackSalesUnitQuantity)}</td>
                      <td className="py-2 text-muted">{product.fallbackLitersPerSale ? `${formatNumber(product.fallbackLitersPerSale)} L` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CompactPanel>

          <CompactPanel title="Mock salg" icon={BarChart3}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs uppercase text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3">Bar</th>
                    <th className="py-2 pr-3">Vare</th>
                    <th className="py-2 pr-3">Solgt</th>
                    <th className="py-2">Periode</th>
                  </tr>
                </thead>
                <tbody>
                  {mockOnlinePosSales.map((sale) => (
                    <tr key={sale.id} className="border-b border-line/70 last:border-0">
                      <td className="py-2 pr-3 font-bold text-ink">{sale.barName}</td>
                      <td className="py-2 pr-3 text-muted">{sale.productName}</td>
                      <td className="py-2 pr-3 text-muted">{formatNumber(sale.quantity)}</td>
                      <td className="py-2 text-muted">{formatNumber(sale.periodHours)} timer</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CompactPanel>
        </section>

        <CompactPanel title="Produktmatching" icon={CheckCircle2}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3">OnlinePOS vare</th>
                  <th className="py-2 pr-3">BackEvent vare</th>
                  <th className="py-2 pr-3">Lagerstyring</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Handling</th>
                </tr>
              </thead>
              <tbody>
                {productMatches.map(({ mockProduct, product, matchType }) => (
                  <tr key={mockProduct.id} className="border-b border-line/70 last:border-0">
                    <td className="py-2 pr-3 font-bold text-ink">{mockProduct.name}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={selectedProductIds[mockProduct.id] ?? product?.id ?? ""}
                        onChange={(event) =>
                          setSelectedProductIds((current) => ({ ...current, [mockProduct.id]: event.target.value }))
                        }
                        className="min-h-10 w-full rounded-xl border border-line bg-macro px-3 py-2 text-sm font-bold text-ink"
                      >
                        <option value="">Vælg BackEvent vare</option>
                        {products.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3 text-muted">{trackingModeLabel(product?.trackingMode ?? mockProduct.fallbackTrackingMode)}</td>
                    <td className="py-2 pr-3">
                      <MatchStatusPill matchType={matchType} />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => handleSaveMatch(mockProduct)}
                        disabled={savingProductId !== null || !(selectedProductIds[mockProduct.id] ?? product?.id)}
                        className="min-h-10 rounded-xl bg-pantone139 px-3 py-2 text-sm font-bold text-ink transition hover:bg-pantone139/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingProductId === mockProduct.id ? "Gemmer..." : "Gem match"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CompactPanel>

        <section className="grid gap-4 xl:grid-cols-2">
          <CompactPanel title="Forventet lagertræk" icon={PackageSearch}>
            {stockDrawResults.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase text-muted">
                    <tr className="border-b border-line">
                      <th className="py-2 pr-3">Bar</th>
                      <th className="py-2 pr-3">Trækker lager fra</th>
                      <th className="py-2 pr-3">Vare</th>
                      <th className="py-2">Forventet træk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockDrawResults.map((result) => (
                      <tr key={result.sale.id} className="border-b border-line/70 last:border-0">
                        <td className="py-2 pr-3 font-bold text-ink">{result.sale.barName}</td>
                        <td className="py-2 pr-3 text-muted">{result.sourceLocation?.name ?? "Mangler lagerkilde"}</td>
                        <td className="py-2 pr-3 text-muted">{result.product?.name ?? result.sale.productName}</td>
                        <td className="py-2 font-bold text-pantone140">
                          {result.stockDraw === null ? "-" : `${formatNumber(result.stockDraw)} ${result.product?.unit ?? "stk."}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm font-medium text-muted">Ingen lagerstyrede mock salg.</p>
            )}
          </CompactPanel>

          <CompactPanel title="Flow liter/time" icon={BarChart3}>
            {flowResults.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="text-xs uppercase text-muted">
                    <tr className="border-b border-line">
                      <th className="py-2 pr-3">Bar</th>
                      <th className="py-2 pr-3">Vare</th>
                      <th className="py-2 pr-3">Liter</th>
                      <th className="py-2">Liter/time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flowResults.map((result) => (
                      <tr key={result.sale.id} className="border-b border-line/70 last:border-0">
                        <td className="py-2 pr-3 font-bold text-ink">{result.sale.barName}</td>
                        <td className="py-2 pr-3 text-muted">{result.product?.name ?? result.sale.productName}</td>
                        <td className="py-2 pr-3 text-muted">{result.liters === null ? "-" : `${formatNumber(result.liters)} L`}</td>
                        <td className="py-2 font-bold text-pantone140">
                          {result.litersPerHour === null ? "-" : `${formatNumber(result.litersPerHour)} L/time`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm font-medium text-muted">Ingen flow salg i mockdata.</p>
            )}
          </CompactPanel>
        </section>

        <CompactPanel title="Advarsler" icon={AlertTriangle}>
          {warnings.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {warnings.map(({ id, text }) => (
                <div key={id} className="rounded-2xl border border-warmRed/20 bg-warmRed/10 px-4 py-3 text-sm font-bold text-warmRed">
                  {text}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-medium text-muted">Ingen advarsler i testen.</p>
          )}
        </CompactPanel>
      </div>
    </AppShell>
  );
}

function CompactPanel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof PackageSearch;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-line bg-macro p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="text-xl font-bold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function StatusPill({ children, tone }: { children: ReactNode; tone: "ok" | "warning" }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
        tone === "ok" ? "bg-green-100 text-green-800" : "bg-pantone139/30 text-pantone140"
      }`}
    >
      {children}
    </span>
  );
}

function MatchStatusPill({ matchType }: { matchType: ProductMatch["matchType"] }) {
  if (matchType === "manual") {
    return <StatusPill tone="ok">Matchet manuelt</StatusPill>;
  }

  if (matchType === "name") {
    return <StatusPill tone="warning">Matchet på navn</StatusPill>;
  }

  return <StatusPill tone="warning">Ikke matchet</StatusPill>;
}

function calculateSaleResult(sale: MockOnlinePosSale, products: Product[], locations: Location[]): SaleResult {
  const mockProduct = mockOnlinePosProducts.find((product) => normalize(product.name) === normalize(sale.productName));
  const productMatch = mockProduct ? findProductMatch(mockProduct, products) : undefined;
  const product = productMatch?.product;
  const location = findMatchingBarLocation(sale.barName, locations);
  const sourceLocation = location?.sourceLocationId
    ? locations.find((item) => item.id === location.sourceLocationId)
    : undefined;
  const trackingMode = product?.trackingMode ?? mockProduct?.fallbackTrackingMode;
  const warnings: string[] = [];

  if (!mockProduct) {
    warnings.push("Produkt findes ikke i mockdata");
  }

  if (mockProduct && !product) {
    warnings.push("Produkt ikke matchet i BackEvent");
  }

  if (!location) {
    warnings.push("Bar findes ikke i BackEvent");
  }

  if (trackingMode === "inventory" && !sourceLocation) {
    warnings.push(`${sale.barName} mangler lagerkilde`);
  }

  if (trackingMode === "ignore") {
    return {
      sale,
      mockProduct,
      product,
      location,
      sourceLocation,
      trackingMode,
      stockDraw: null,
      liters: null,
      litersPerHour: null,
      warnings,
      excluded: true,
    };
  }

  if (trackingMode === "flow") {
    const litersPerSale = product?.litersPerSale ?? mockProduct?.fallbackLitersPerSale ?? null;
    const liters = litersPerSale === null ? null : roundNumber(sale.quantity * litersPerSale);
    return {
      sale,
      mockProduct,
      product,
      location,
      sourceLocation,
      trackingMode,
      stockDraw: null,
      liters,
      litersPerHour: liters === null ? null : roundNumber(liters / sale.periodHours),
      warnings,
      excluded: false,
    };
  }

  const stockDraw = product
    ? roundNumber(sale.quantity * (product.salesUnitQuantity ?? mockProduct?.fallbackSalesUnitQuantity ?? 1))
    : null;

  return {
    sale,
    mockProduct,
    product,
    location,
    sourceLocation,
    trackingMode,
    stockDraw,
    liters: null,
    litersPerHour: null,
    warnings,
    excluded: false,
  };
}

function findProductMatch(mockProduct: MockOnlinePosProduct, products: Product[]): ProductMatch {
  const manualMatch = findManualProductMatch(mockProduct, products);

  if (manualMatch) {
    return { mockProduct, product: manualMatch, matchType: "manual" };
  }

  const nameMatch = findNameProductMatch(mockProduct, products);

  if (nameMatch) {
    return { mockProduct, product: nameMatch, matchType: "name" };
  }

  return { mockProduct, matchType: "none" };
}

function findManualProductMatch(mockProduct: MockOnlinePosProduct, products: Product[]) {
  return products.find(
    (product) =>
      normalize(product.onlineposProductId ?? "") === normalize(mockProduct.id) ||
      normalize(product.onlineposName ?? "") === normalize(mockProduct.name),
  );
}

function findNameProductMatch(mockProduct: MockOnlinePosProduct, products: Product[]) {
  const productName = normalize(mockProduct.name);
  const baseName = normalize(stripSalesSize(mockProduct.name));

  return products.find((product) => {
    const candidates = [product.name].filter(Boolean).map((value) => normalize(String(value)));
    return candidates.some(
      (candidate) =>
        candidate === productName ||
        candidate === baseName ||
        productName.startsWith(candidate) ||
        baseName.startsWith(candidate) ||
        candidate.startsWith(baseName),
    );
  });
}

function getDuplicateOnlinePosIds(products: Product[]) {
  const grouped = products.reduce<Record<string, Product[]>>((groups, product) => {
    const onlineposProductId = product.onlineposProductId?.trim();

    if (!onlineposProductId) {
      return groups;
    }

    return {
      ...groups,
      [onlineposProductId]: [...(groups[onlineposProductId] ?? []), product],
    };
  }, {});

  return Object.entries(grouped)
    .filter(([, groupedProducts]) => groupedProducts.length > 1)
    .map(([onlineposProductId, groupedProducts]) => ({
      onlineposProductId,
      productNames: groupedProducts.map((product) => product.name),
    }));
}

function findMatchingBarLocation(barName: string, locations: Location[]) {
  const normalizedBarName = normalize(barName);

  return locations.filter(isBarLocation).find((location) => {
    const normalizedLocationName = normalize(location.name);
    return (
      normalizedLocationName === normalizedBarName ||
      normalizedLocationName.startsWith(normalizedBarName) ||
      normalizedBarName.startsWith(normalizedLocationName)
    );
  });
}

function isBarLocation(location: Location) {
  return location.kind === "bar" || location.kind === "sales_point";
}

function stripSalesSize(value: string) {
  return value.replace(/\b\d+([,.]\d+)?\s*l\b/gi, "").replace(/\bfad\b/gi, "").trim();
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackingModeLabel(mode: ProductTrackingMode | undefined) {
  switch (mode) {
    case "flow":
      return "Flow";
    case "ignore":
      return "Ignorer";
    case "inventory":
    default:
      return "Lagerstyret";
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 }).format(value);
}

function roundNumber(value: number) {
  return Number(value.toFixed(1));
}
