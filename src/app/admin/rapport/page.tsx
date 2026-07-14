"use client";

import { ArrowRight } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import {
  getConsumptionReport,
  getLocations,
  getOpeningClosingOverview,
  getProducts,
  getRecentMovements,
  getStockAdjustments,
  getStockDiscrepancies,
} from "@/lib/backevent/data";
import { formatPlainQuantity, formatStockQuantity } from "@/lib/backevent/quantity-format";
import type {
  ConsumptionReport,
  Location,
  OpeningClosingLocationOverview,
  Product,
  StockAdjustment,
  StockDiscrepancy,
  StockMovement,
} from "@/lib/backevent/types";

export default function AdminRapportPage() {
  return (
    <Suspense fallback={null}>
      <AdminRapportContent />
    </Suspense>
  );
}

function AdminRapportContent() {
  const searchParams = useSearchParams();
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [report, setReport] = useState<ConsumptionReport>({ locations: [] });
  const [overview, setOverview] = useState<OpeningClosingLocationOverview[]>([]);
  const [discrepancies, setDiscrepancies] = useState<StockDiscrepancy[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [date, setDate] = useState(searchParams.get("date") ?? "");
  const [locationId, setLocationId] = useState(searchParams.get("location") ?? "");
  const [productId, setProductId] = useState(searchParams.get("product") ?? "");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts, loadedReport, loadedOverview, loadedDiscrepancies, loadedAdjustments, loadedMovements] =
          await Promise.all([
            getLocations(),
            getProducts(),
            getConsumptionReport(date || undefined),
            getOpeningClosingOverview(date || undefined),
            getStockDiscrepancies(date || undefined),
            getStockAdjustments(),
            getRecentMovements(),
          ]);

        if (!mounted) {
          return;
        }

        setLocations(loadedLocations);
        setProducts(loadedProducts);
        setReport(loadedReport);
        setOverview(loadedOverview);
        setDiscrepancies(loadedDiscrepancies);
        setAdjustments(loadedAdjustments);
        setMovements(loadedMovements);
      } catch {
        if (mounted) {
          setMessage("Vi kunne ikke hente rapporten lige nu. Prøv igen om lidt.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [date]);

  const visibleLocations = useMemo(
    () => report.locations.filter((location) => !locationId || location.locationId === locationId),
    [report.locations, locationId],
  );
  const visibleMovements = movements.filter(
    (movement) =>
      (!locationId || movement.fromLocationId === locationId || movement.toLocationId === locationId) &&
      (!date || movement.createdAt.slice(0, 10) === date),
  );
  const visibleAdjustments = adjustments.filter(
    (adjustment) => (!locationId || adjustment.locationId === locationId) && (!date || adjustment.createdAt.slice(0, 10) === date),
  );

  return (
    <AppShell requiredRole="ansvarlig">
      <div className="mb-5">
        <BackButton href="/admin" />
      </div>
      <section className="mb-6 rounded-[2rem] bg-soft p-6 shadow-soft">
        <h1 className="text-4xl font-bold text-ink">Forbrugsrapport</h1>
        <p className="mt-2 text-lg font-medium text-muted">Åbning + flytninger - lukning = beregnet forbrug</p>
        <Link href="/admin/rapport/flowvarer" className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-pantone123 px-4 py-3 text-sm font-bold text-ink shadow-soft">
          Se OnlinePOS-flowvarer <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>

      <section className="mb-6 grid gap-3 rounded-[2rem] border border-line bg-macro p-5 shadow-soft md:grid-cols-3">
        <Filter label="Dato">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="min-h-12 w-full rounded-2xl border border-line bg-macro px-3 py-2 text-base font-bold text-ink outline-none focus:border-pantone140"
          />
        </Filter>
        <Filter label="Container">
          <select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className="min-h-12 w-full rounded-2xl border border-line bg-macro px-3 py-2 text-base font-bold text-ink outline-none focus:border-pantone140"
          >
            <option value="">Alle</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label="Vare">
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="min-h-12 w-full rounded-2xl border border-line bg-macro px-3 py-2 text-base font-bold text-ink outline-none focus:border-pantone140"
          >
            <option value="">Alle</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </Filter>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{message}</p> : null}

      <div className="space-y-6">
        {visibleLocations.map((locationReport) => {
          const location = locations.find((item) => item.id === locationReport.locationId);
          const locationOverview = overview.find((item) => item.locationId === locationReport.locationId);
          const filteredLines = locationReport.lines.filter((line) => !productId || line.productId === productId);
          const locationDiscrepancies = discrepancies.filter(
            (item) => item.locationId === locationReport.locationId && (!productId || item.productId === productId),
          );

          return (
            <section key={locationReport.locationId} className="rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-3xl font-bold text-ink">{location?.name}</h2>
                  <p className="mt-1 text-lg font-bold text-pantone140">
                    Samlet forbrug: {formatPlainQuantity(sumConsumption(filteredLines), "enheder")}
                  </p>
                </div>
                <StatusPill overview={locationOverview} />
              </div>

              {locationDiscrepancies.length > 0 ? (
                <div className="mb-4 rounded-3xl bg-warmRed/10 p-4 text-base font-bold text-warmRed">
                  Afvigelse fundet · {locationDiscrepancies.length} linjer kræver tjek
                </div>
              ) : null}

              <div className="space-y-3">
                {filteredLines.map((line) => {
                  const product = products.find((item) => item.id === line.productId);
                  const urgent = line.warnings.includes("Afvigelse fundet") || (line.calculatedConsumption ?? 0) < 0;

                  return (
                    <article
                      key={line.productId}
                      className={`rounded-3xl border p-4 ${urgent ? "border-warmRed/30 bg-warmRed/10" : "border-line bg-soft"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-bold text-ink">{product?.name}</h3>
                          <p className={`mt-1 text-sm font-bold ${line.warnings.length ? "text-warmRed" : "text-muted"}`}>
                            {line.warnings.length ? line.warnings.join(" · ") : "Ingen data endnu"}
                          </p>
                        </div>
                        <p className={`text-3xl font-bold ${urgent ? "text-warmRed" : "text-pantone140"}`}>
                          {line.calculatedConsumption === null || !product ? "-" : formatStockQuantity(line.calculatedConsumption, product)}
                        </p>
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-5">
                        <MiniMetric label="Åbning" value={formatMaybe(line.openingQuantity, product)} />
                        <MiniMetric label="Flyttet ind" value={product ? formatStockQuantity(line.movedIn, product) : formatPlainQuantity(line.movedIn)} />
                        <MiniMetric label="Flyttet ud" value={product ? formatStockQuantity(line.movedOut, product) : formatPlainQuantity(line.movedOut)} />
                        <MiniMetric label="Lukning" value={formatMaybe(line.closingQuantity, product)} />
                        <MiniMetric label="Svind/just." value={product ? formatStockQuantity(line.adjustmentDelta, product) : formatPlainQuantity(line.adjustmentDelta)} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        <section className="rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
          <h2 className="mb-4 text-2xl font-bold text-ink">Svind og justeringer</h2>
          <div className="space-y-3">
            {visibleAdjustments.length ? (
              visibleAdjustments.slice(0, 8).map((adjustment) => {
                const product = products.find((item) => item.id === adjustment.productId);
                const location = locations.find((item) => item.id === adjustment.locationId);
                return (
                  <p key={adjustment.id} className="rounded-2xl bg-soft p-3 text-base font-bold text-ink">
                    {adjustment.type === "waste" ? "Svind" : "Rettelse"} · {product?.name} · {location?.name} ·{" "}
                    {product
                      ? `${formatStockQuantity(adjustment.quantityBefore, product)} → ${formatStockQuantity(adjustment.quantityAfter, product)}`
                      : `${formatPlainQuantity(adjustment.quantityBefore, adjustment.unit)} → ${formatPlainQuantity(adjustment.quantityAfter, adjustment.unit)}`}
                  </p>
                );
              })
            ) : (
              <p className="rounded-2xl bg-soft p-3 text-base font-bold text-muted">Ingen data endnu</p>
            )}
          </div>
        </section>

        <section className="rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
          <h2 className="mb-4 text-2xl font-bold text-ink">Seneste flytninger</h2>
          <div className="space-y-3">
            {visibleMovements.length ? (
              visibleMovements.slice(0, 8).map((movement) => {
                const product = products.find((item) => item.id === movement.productId);
                const from = locations.find((item) => item.id === movement.fromLocationId);
                const to = locations.find((item) => item.id === movement.toLocationId);
                return (
                  <p key={movement.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-soft p-3 text-base font-bold text-ink">
                    {product ? formatStockQuantity(movement.quantity, product) : formatPlainQuantity(movement.quantity, movement.unit)} {product?.name}
                    <span className="text-muted">{from?.name}</span>
                    <ArrowRight className="h-4 w-4 text-pantone140" aria-hidden />
                    <span className="text-muted">{to?.name}</span>
                  </p>
                );
              })
            ) : (
              <p className="rounded-2xl bg-soft p-3 text-base font-bold text-muted">Ingen data endnu</p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-base font-bold text-ink">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function StatusPill({ overview }: { overview?: OpeningClosingLocationOverview }) {
  const missingOpening = !overview?.latestOpening;
  const missingClosing = !overview?.latestClosing;
  const text = missingOpening ? "Mangler åbning" : missingClosing ? "Mangler lukning" : "Lukket";
  const urgent = missingOpening || missingClosing;

  return (
    <span className={`rounded-full px-3 py-1 text-sm font-bold ${urgent ? "bg-warmRed/10 text-warmRed" : "bg-green-50 text-ok"}`}>
      {text}
    </span>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-macro p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
    </div>
  );
}

function formatMaybe(value: number | null, product?: Product) {
  return value === null ? "-" : product ? formatStockQuantity(value, product) : formatPlainQuantity(value);
}

function sumConsumption(lines: Array<{ calculatedConsumption: number | null }>) {
  return lines.reduce((sum, line) => sum + Math.max(0, line.calculatedConsumption ?? 0), 0);
}
