"use client";

import { ArrowDown, ArrowUp, Copy, Save, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import {
  getLocationProductThresholds,
  getLocations,
  getProductsAdmin,
  getStockBalances,
  isPhysicalStockLocation,
  saveLocationProductThresholds,
} from "@/lib/backevent/data";
import type { Location, LocationProductThreshold, Product, StockBalance } from "@/lib/backevent/types";

type DraftThreshold = {
  low: string;
  critical: string;
  enabled: boolean;
  selected: boolean;
};

type RowStatus = "critical" | "low" | "ok" | "missing" | "inactive";
type SortKey = "product" | "location" | "category" | "stock" | "low" | "critical" | "status" | "missing";
type SortDirection = "asc" | "desc";

type ThresholdRow = {
  key: string;
  product: Product;
  location: Location;
  stock: number;
  original?: LocationProductThreshold;
  draft: DraftThreshold;
  lowValue: number | null;
  criticalValue: number | null;
  status: RowStatus;
  category: string;
  changed: boolean;
  missingSetup: boolean;
};

const allLocations = "all";
const allCategories = "all";
const allAlarmStates = "all";

export default function LagergraenserPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [thresholds, setThresholds] = useState<LocationProductThreshold[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftThreshold>>({});
  const [locationFilter, setLocationFilter] = useState(allLocations);
  const [categoryFilter, setCategoryFilter] = useState(allCategories);
  const [alarmFilter, setAlarmFilter] = useState(allAlarmStates);
  const [onlyLow, setOnlyLow] = useState(false);
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("product");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [copySourceLocationId, setCopySourceLocationId] = useState("");
  const [fillLow, setFillLow] = useState("");
  const [fillCritical, setFillCritical] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts, loadedBalances, loadedThresholds] = await Promise.all([
          getLocations(),
          getProductsAdmin(),
          getStockBalances(),
          getLocationProductThresholds(),
        ]);

        if (!mounted) return;

        const physicalLocations = loadedLocations.filter(isPhysicalStockLocation);
        const inventoryProducts = loadedProducts
          .filter((product) => product.active !== false && (product.trackingMode ?? "inventory") === "inventory")
          .sort((a, b) => a.name.localeCompare(b.name, "da"));

        setLocations(physicalLocations);
        setProducts(inventoryProducts);
        setBalances(loadedBalances);
        setThresholds(loadedThresholds);
        setDrafts(buildDrafts(physicalLocations, inventoryProducts, loadedThresholds));
        setCopySourceLocationId(physicalLocations[0]?.id ?? "");
      } catch {
        if (mounted) {
          setMessage("Kunne ikke hente lagergrænser lige nu.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const rows = useMemo(() => buildRows({ locations, products, balances, thresholds, drafts }), [balances, drafts, locations, products, thresholds]);
  const categories = useMemo(() => Array.from(new Set(rows.map((row) => row.category))).sort((a, b) => a.localeCompare(b, "da")), [rows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const visible = rows.filter((row) => {
      if (locationFilter !== allLocations && row.location.id !== locationFilter) return false;
      if (categoryFilter !== allCategories && row.category !== categoryFilter) return false;
      if (alarmFilter === "active" && !row.draft.enabled) return false;
      if (alarmFilter === "inactive" && row.draft.enabled) return false;
      if (onlyLow && row.status !== "low") return false;
      if (onlyCritical && row.status !== "critical") return false;
      if (onlyMissing && !row.missingSetup) return false;
      if (normalizedQuery && !`${row.product.name} ${row.location.name} ${row.category}`.toLowerCase().includes(normalizedQuery)) return false;
      return true;
    });

    return visible.sort((a, b) => compareRows(a, b, sortKey, sortDirection));
  }, [alarmFilter, categoryFilter, locationFilter, onlyCritical, onlyLow, onlyMissing, query, rows, sortDirection, sortKey]);

  const activeFilterCount = [locationFilter !== allLocations, categoryFilter !== allCategories, alarmFilter !== allAlarmStates, onlyLow, onlyCritical, onlyMissing, query.trim().length > 0].filter(Boolean).length;
  const changedRows = rows.filter((row) => row.changed);
  const selectedRows = filteredRows.filter((row) => row.draft.selected);

  function updateDraft(key: string, patch: Partial<DraftThreshold>) {
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { low: "", critical: "", enabled: false, selected: false }),
        ...patch,
      },
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function resetFilters() {
    setLocationFilter(allLocations);
    setCategoryFilter(allCategories);
    setAlarmFilter(allAlarmStates);
    setOnlyLow(false);
    setOnlyCritical(false);
    setOnlyMissing(false);
    setQuery("");
  }

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "missing" ? "desc" : "asc");
  }

  function applyToVisible() {
    const parsedLow = parseOptionalNumber(fillLow);
    const parsedCritical = parseOptionalNumber(fillCritical);

    if (!parsedLow.ok || !parsedCritical.ok || hasInvalidThresholds(parsedLow.value, parsedCritical.value)) {
      setMessage("Tjek felterne: kritisk må ikke være højere end lav, og tal må ikke være negative.");
      return;
    }

    setDrafts((current) => {
      const next = { ...current };
      for (const row of filteredRows) {
        next[row.key] = {
          ...(next[row.key] ?? row.draft),
          low: fillLow.trim(),
          critical: fillCritical.trim(),
          enabled: true,
        };
      }
      return next;
    });
    setMessage(`${filteredRows.length} viste rækker er udfyldt. Husk at gemme.`);
  }

  function copyFromLocation() {
    if (!copySourceLocationId) return;

    const sourceByProduct = new Map<string, LocationProductThreshold>();
    thresholds
      .filter((threshold) => threshold.locationId === copySourceLocationId)
      .forEach((threshold) => sourceByProduct.set(threshold.productId, threshold));

    setDrafts((current) => {
      const next = { ...current };
      for (const row of filteredRows) {
        if (row.location.id === copySourceLocationId) continue;
        const source = sourceByProduct.get(row.product.id);
        if (!source) continue;
        next[row.key] = {
          ...(next[row.key] ?? row.draft),
          low: formatInputNumber(source.lowThreshold),
          critical: formatInputNumber(source.criticalThreshold),
          enabled: source.alertsEnabled,
        };
      }
      return next;
    });
    setMessage("Grænser kopieret til de viste rækker. Husk at gemme.");
  }

  function setSelectedAlerts(enabled: boolean) {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of selectedRows) {
        next[row.key] = { ...(next[row.key] ?? row.draft), enabled };
      }
      return next;
    });
  }

  async function saveChanges() {
    const validation = validateRows(changedRows);
    setErrors(validation.errors);
    setMessage(validation.message);

    if (!validation.ok) {
      return;
    }

    setSaving(true);
    try {
      await saveLocationProductThresholds(
        changedRows.map((row) => ({
          locationId: row.location.id,
          productId: row.product.id,
          lowThreshold: row.lowValue,
          criticalThreshold: row.criticalValue,
          alertsEnabled: row.draft.enabled,
        })),
      );
      const refreshed = await getLocationProductThresholds();
      setThresholds(refreshed);
      setDrafts(buildDrafts(locations, products, refreshed));
      setMessage(`${changedRows.length} ændringer gemt.`);
    } catch {
      setMessage("Kunne ikke gemme ændringerne. Dine rettelser er stadig på skærmen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell requiredRole="ansvarlig">
      <Header title="Lagergrænser" subtitle="Lav og kritisk grænse pr. vare og lagersted" />

      <section className="mb-4 rounded-2xl border border-line bg-macro p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 text-xs font-bold text-muted">
            Lokation
            <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink">
              <option value={allLocations}>Alle</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-36 text-xs font-bold text-muted">
            Kategori
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink">
              <option value={allCategories}>Alle</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-32 text-xs font-bold text-muted">
            Alarm
            <select value={alarmFilter} onChange={(event) => setAlarmFilter(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink">
              <option value={allAlarmStates}>Alle</option>
              <option value="active">Aktiv</option>
              <option value="inactive">Inaktiv</option>
            </select>
          </label>
          <label className="min-w-52 flex-1 text-xs font-bold text-muted">
            Søg
            <span className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-line bg-macro px-2">
              <Search className="h-4 w-4 text-muted" aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-bold text-ink outline-none" placeholder="Vare eller lokation" />
            </span>
          </label>
          <CompactCheckbox label="Kun lave" checked={onlyLow} onChange={setOnlyLow} />
          <CompactCheckbox label="Kun kritiske" checked={onlyCritical} onChange={setOnlyCritical} />
          <CompactCheckbox label="Mangler grænser" checked={onlyMissing} onChange={setOnlyMissing} />
          <button type="button" onClick={resetFilters} className="h-9 rounded-lg border border-line bg-soft px-3 text-sm font-bold text-pantone140">
            Nulstil filtre {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </button>
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-line bg-soft p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold text-muted">
            Kopiér fra
            <select value={copySourceLocationId} onChange={(event) => setCopySourceLocationId(event.target.value)} className="mt-1 h-9 w-56 rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink">
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={copyFromLocation} className="inline-flex h-9 items-center gap-2 rounded-lg border border-pantone140/40 bg-macro px-3 text-sm font-bold text-pantone140">
            <Copy className="h-4 w-4" aria-hidden />
            Kopiér grænser fra anden lokation
          </button>
          <label className="text-xs font-bold text-muted">
            Lav
            <input value={fillLow} onChange={(event) => setFillLow(event.target.value)} className="mt-1 h-9 w-24 rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink" />
          </label>
          <label className="text-xs font-bold text-muted">
            Kritisk
            <input value={fillCritical} onChange={(event) => setFillCritical(event.target.value)} className="mt-1 h-9 w-24 rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink" />
          </label>
          <button type="button" onClick={applyToVisible} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-macro px-3 text-sm font-bold text-pantone140">
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Udfyld alle viste rækker
          </button>
          <button type="button" onClick={() => setSelectedAlerts(true)} disabled={selectedRows.length === 0} className="h-9 rounded-lg border border-line bg-macro px-3 text-sm font-bold text-pantone140 disabled:opacity-40">
            Alarm til
          </button>
          <button type="button" onClick={() => setSelectedAlerts(false)} disabled={selectedRows.length === 0} className="h-9 rounded-lg border border-line bg-macro px-3 text-sm font-bold text-pantone140 disabled:opacity-40">
            Alarm fra
          </button>
        </div>
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-muted">
          Viser {filteredRows.length} af {rows.length} rækker · {changedRows.length} ændringer · {selectedRows.length} valgt
        </p>
        <button
          type="button"
          onClick={saveChanges}
          disabled={saving || changedRows.length === 0}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-pantone139 px-4 text-sm font-bold text-ink shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden />
          {saving ? "Gemmer..." : "Gem ændringer"}
        </button>
      </div>

      {message ? <p className="mb-3 rounded-xl border border-line bg-macro px-3 py-2 text-sm font-bold text-pantone140">{message}</p> : null}

      {loading ? (
        <p className="rounded-2xl border border-line bg-macro p-4 text-sm font-bold text-muted">Henter lagergrænser...</p>
      ) : (
        <>
          <div className="hidden overflow-auto rounded-2xl border border-line bg-macro shadow-sm md:block">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10 bg-soft text-xs font-bold uppercase text-muted">
                <tr>
                  <th className="sticky left-0 z-20 w-8 border-b border-line bg-soft px-2 py-2"></th>
                  <SortableHeader label="Produkt" sortKey="product" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} sticky />
                  <SortableHeader label="Kategori" sortKey="category" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Lokation" sortKey="location" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Aktuel" sortKey="stock" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Lav" sortKey="low" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Kritisk" sortKey="critical" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <th className="border-b border-line px-2 py-2">Alarm</th>
                  <SortableHeader label="Status" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Mangler først" sortKey="missing" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <ThresholdTableRow key={row.key} row={row} error={errors[row.key]} onChange={updateDraft} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {filteredRows.map((row) => (
              <MobileThresholdRow key={row.key} row={row} error={errors[row.key]} onChange={updateDraft} />
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}

function ThresholdTableRow({ row, error, onChange }: { row: ThresholdRow; error?: string; onChange: (key: string, patch: Partial<DraftThreshold>) => void }) {
  return (
    <tr className={`border-b border-line/70 ${row.changed ? "bg-pantone139/10" : "bg-macro"} last:border-0`}>
      <td className="sticky left-0 z-10 border-b border-line/70 bg-inherit px-2 py-1.5">
        <input type="checkbox" checked={row.draft.selected} onChange={(event) => onChange(row.key, { selected: event.target.checked })} className="h-4 w-4 accent-pantone140" aria-label="Vælg række" />
      </td>
      <td className="sticky left-8 z-10 min-w-56 border-b border-line/70 bg-inherit px-2 py-1.5 font-bold text-ink">{row.product.name}</td>
      <td className="border-b border-line/70 px-2 py-1.5 text-muted">{row.category}</td>
      <td className="min-w-44 border-b border-line/70 px-2 py-1.5 text-ink">{row.location.name}</td>
      <td className="border-b border-line/70 px-2 py-1.5 font-bold text-ink">
        {formatNumber(row.stock)} <span className="text-xs font-medium text-muted">{row.product.unit}</span>
      </td>
      <td className="border-b border-line/70 px-2 py-1.5">
        <ThresholdInput value={row.draft.low} unit={row.product.unit} onChange={(value) => onChange(row.key, { low: value })} />
      </td>
      <td className="border-b border-line/70 px-2 py-1.5">
        <ThresholdInput value={row.draft.critical} unit={row.product.unit} onChange={(value) => onChange(row.key, { critical: value })} />
      </td>
      <td className="border-b border-line/70 px-2 py-1.5">
        <label className="inline-flex items-center gap-2 text-xs font-bold text-muted">
          <input type="checkbox" checked={row.draft.enabled} onChange={(event) => onChange(row.key, { enabled: event.target.checked })} className="h-4 w-4 accent-pantone140" />
          Aktiv
        </label>
      </td>
      <td className="border-b border-line/70 px-2 py-1.5">
        <StatusBadge status={row.status} />
        {error ? <p className="mt-1 text-xs font-bold text-warmRed">{error}</p> : null}
      </td>
      <td className="border-b border-line/70 px-2 py-1.5 text-center text-muted">{row.missingSetup ? "Ja" : ""}</td>
    </tr>
  );
}

function MobileThresholdRow({ row, error, onChange }: { row: ThresholdRow; error?: string; onChange: (key: string, patch: Partial<DraftThreshold>) => void }) {
  return (
    <article className={`rounded-xl border border-line bg-macro p-3 shadow-sm ${row.changed ? "ring-2 ring-pantone139/60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">{row.product.name}</p>
          <p className="text-xs font-bold text-muted">{row.location.name} · {row.category}</p>
        </div>
        <StatusBadge status={row.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <p className="text-xs font-bold text-muted">
          Aktuel
          <span className="block text-sm text-ink">{formatNumber(row.stock)} {row.product.unit}</span>
        </p>
        <label className="flex items-center justify-end gap-2 text-xs font-bold text-muted">
          <input type="checkbox" checked={row.draft.enabled} onChange={(event) => onChange(row.key, { enabled: event.target.checked })} className="h-4 w-4 accent-pantone140" />
          Alarm aktiv
        </label>
        <label className="text-xs font-bold text-muted">
          Lav
          <ThresholdInput value={row.draft.low} unit={row.product.unit} onChange={(value) => onChange(row.key, { low: value })} />
        </label>
        <label className="text-xs font-bold text-muted">
          Kritisk
          <ThresholdInput value={row.draft.critical} unit={row.product.unit} onChange={(value) => onChange(row.key, { critical: value })} />
        </label>
      </div>
      {error ? <p className="mt-2 text-xs font-bold text-warmRed">{error}</p> : null}
    </article>
  );
}

function ThresholdInput({ value, unit, onChange }: { value: string; unit: string; onChange: (value: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input value={value} onChange={(event) => onChange(event.target.value)} inputMode="decimal" className="h-8 w-20 rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-pantone139/50" />
      <span className="text-[11px] font-medium text-muted">{unit}</span>
    </span>
  );
}

function CompactCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-macro px-3 text-sm font-bold text-muted">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-pantone140" />
      {label}
    </label>
  );
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  sticky = false,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  sticky?: boolean;
}) {
  const active = activeKey === sortKey;
  const Icon = direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <th className={`${sticky ? "sticky left-8 z-20 bg-soft" : ""} border-b border-line px-2 py-2`}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 font-bold text-muted hover:text-pantone140">
        {label}
        {active ? <Icon className="h-3 w-3" aria-hidden /> : null}
      </button>
    </th>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  const labels: Record<RowStatus, string> = {
    critical: "Kritisk",
    low: "Lav",
    ok: "OK",
    missing: "Mangler",
    inactive: "Inaktiv",
  };
  const classes: Record<RowStatus, string> = {
    critical: "bg-warmRed/10 text-warmRed",
    low: "bg-pantone139/25 text-pantone140",
    ok: "bg-green-50 text-green-700",
    missing: "bg-soft text-muted",
    inactive: "bg-soft text-muted",
  };

  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${classes[status]}`}>{labels[status]}</span>;
}

function buildDrafts(locations: Location[], products: Product[], thresholds: LocationProductThreshold[]) {
  const drafts: Record<string, DraftThreshold> = {};
  for (const location of locations) {
    for (const product of products) {
      const threshold = thresholds.find((item) => item.locationId === location.id && item.productId === product.id);
      drafts[rowKey(location.id, product.id)] = {
        low: formatInputNumber(threshold?.lowThreshold ?? null),
        critical: formatInputNumber(threshold?.criticalThreshold ?? null),
        enabled: threshold?.alertsEnabled ?? false,
        selected: false,
      };
    }
  }
  return drafts;
}

function buildRows(input: {
  locations: Location[];
  products: Product[];
  balances: StockBalance[];
  thresholds: LocationProductThreshold[];
  drafts: Record<string, DraftThreshold>;
}): ThresholdRow[] {
  const rows: ThresholdRow[] = [];

  for (const product of input.products) {
    for (const location of input.locations) {
      const key = rowKey(location.id, product.id);
      const original = input.thresholds.find((item) => item.locationId === location.id && item.productId === product.id);
      const draft = input.drafts[key] ?? {
        low: formatInputNumber(original?.lowThreshold ?? null),
        critical: formatInputNumber(original?.criticalThreshold ?? null),
        enabled: original?.alertsEnabled ?? false,
        selected: false,
      };
      const lowValue = parseOptionalNumber(draft.low).value;
      const criticalValue = parseOptionalNumber(draft.critical).value;
      const stock = input.balances.find((balance) => balance.locationId === location.id && balance.productId === product.id)?.quantity ?? 0;
      const missingSetup = lowValue === null && criticalValue === null;
      const status = getRowStatus({ stock, lowValue, criticalValue, enabled: draft.enabled, missingSetup });

      rows.push({
        key,
        product,
        location,
        stock,
        original,
        draft,
        lowValue,
        criticalValue,
        status,
        category: categoryLabel(product),
        changed: hasChanged(original, draft),
        missingSetup,
      });
    }
  }

  return rows;
}

function compareRows(a: ThresholdRow, b: ThresholdRow, sortKey: SortKey, direction: SortDirection) {
  const multiplier = direction === "asc" ? 1 : -1;
  const result = compareRowValue(a, b, sortKey);
  return result === 0 ? a.product.name.localeCompare(b.product.name, "da") || a.location.name.localeCompare(b.location.name, "da") : result * multiplier;
}

function compareRowValue(a: ThresholdRow, b: ThresholdRow, sortKey: SortKey) {
  if (sortKey === "product") return a.product.name.localeCompare(b.product.name, "da");
  if (sortKey === "location") return a.location.name.localeCompare(b.location.name, "da");
  if (sortKey === "category") return a.category.localeCompare(b.category, "da");
  if (sortKey === "stock") return a.stock - b.stock;
  if (sortKey === "low") return valueForSort(a.lowValue) - valueForSort(b.lowValue);
  if (sortKey === "critical") return valueForSort(a.criticalValue) - valueForSort(b.criticalValue);
  if (sortKey === "status") return statusRank(a.status) - statusRank(b.status);
  return Number(a.missingSetup) - Number(b.missingSetup);
}

function validateRows(rows: ThresholdRow[]) {
  const errors: Record<string, string> = {};

  for (const row of rows) {
    const low = parseOptionalNumber(row.draft.low);
    const critical = parseOptionalNumber(row.draft.critical);

    if (!low.ok || !critical.ok) {
      errors[row.key] = "Brug kun tal.";
      continue;
    }

    if (hasInvalidThresholds(low.value, critical.value)) {
      errors[row.key] = "Kritisk må ikke være højere end lav.";
    }
  }

  const errorCount = Object.keys(errors).length;
  return {
    ok: errorCount === 0,
    errors,
    message: errorCount > 0 ? `${errorCount} rækker skal rettes før gem.` : null,
  };
}

function parseOptionalNumber(value: string): { ok: boolean; value: number | null } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false, value: null };
}

function hasInvalidThresholds(low: number | null, critical: number | null) {
  return low !== null && critical !== null && critical > low;
}

function hasChanged(original: LocationProductThreshold | undefined, draft: DraftThreshold) {
  const originalLow = formatInputNumber(original?.lowThreshold ?? null);
  const originalCritical = formatInputNumber(original?.criticalThreshold ?? null);
  const originalEnabled = original?.alertsEnabled ?? false;
  return draft.low.trim() !== originalLow || draft.critical.trim() !== originalCritical || draft.enabled !== originalEnabled;
}

function getRowStatus(input: { stock: number; lowValue: number | null; criticalValue: number | null; enabled: boolean; missingSetup: boolean }): RowStatus {
  if (!input.enabled) return "inactive";
  if (input.missingSetup) return "missing";
  if (input.criticalValue !== null && input.stock <= input.criticalValue) return "critical";
  if (input.lowValue !== null && input.stock <= input.lowValue) return "low";
  return "ok";
}

function categoryLabel(product: Product) {
  if (product.trackingMode === "flow") return "Flow";
  if (product.trackingMode === "ignore") return "Ignorer";
  return "Lagerstyret";
}

function statusRank(status: RowStatus) {
  const ranks: Record<RowStatus, number> = { critical: 1, low: 2, missing: 3, inactive: 4, ok: 5 };
  return ranks[status];
}

function valueForSort(value: number | null) {
  return value ?? Number.MAX_SAFE_INTEGER;
}

function rowKey(locationId: string, productId: string) {
  return `${locationId}:${productId}`;
}

function formatInputNumber(value: number | null) {
  if (value === null) return "";
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toLocaleString("da-DK", { maximumFractionDigits: 1 });
}
