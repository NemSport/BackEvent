"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { LocationPicker } from "@/components/backevent/pickers";
import { StatusBadge } from "@/components/backevent/status-badge";
import {
  getLocationStatus,
  getLocationTotal,
  getLocations,
  getProducts,
  getStockBalances,
  isPhysicalStockLocation,
} from "@/lib/backevent/data";
import type { Location, Product, StockBalance } from "@/lib/backevent/types";

export function InventoryStatus() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [locationId, setLocationId] = useState<string>();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts, loadedBalances] = await Promise.all([
          getLocations(),
          getProducts(),
          getStockBalances(),
        ]);
        const stockLocations = loadedLocations.filter(isPhysicalStockLocation);

        if (!mounted) {
          return;
        }

        setLocations(stockLocations);
        setProducts(loadedProducts);
        setBalances(loadedBalances);
        setLocationId((current) =>
          stockLocations.some((location) => location.id === current) ? current : stockLocations[0]?.id,
        );
      } catch {
        if (mounted) {
          setMessage("Vi kunne ikke hente lagerstatus lige nu. Prøv igen om lidt.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const location = locations.find((item) => item.id === locationId) ?? locations[0];
  const stock = useMemo(() => {
    if (!location) {
      return [];
    }

    return products.map((product) => ({
      product,
      balance:
        balances.find((item) => item.locationId === location.id && item.productId === product.id)?.quantity ?? 0,
    }));
  }, [location, products, balances]);
  const total = location ? getLocationTotal(location.id, balances) : 0;
  const status = location ? getLocationStatus(location.id, products, balances) : "good";

  return (
    <AppShell>
      <div className="mb-5">
        <BackButton />
      </div>
      <section className="mb-6 rounded-[2rem] bg-soft p-6 shadow-soft">
        <h1 className="text-4xl font-bold text-ink">Lagerstatus</h1>
        <p className="mt-2 text-lg font-medium text-muted">Se fysisk lager for container/lagersteder</p>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{message}</p> : null}

      <section className="mb-6 rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
        <LocationPicker locations={locations} selectedId={locationId} onSelect={setLocationId} />
      </section>

      {location ? (
        <section className="rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-3xl font-bold text-ink">{location.name}</h2>
              <p className="mt-1 text-lg font-bold text-pantone140">{total.toLocaleString("da-DK")} kasser i alt</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={status} />
              <Link
                href="/admin/rettelser"
                className="inline-flex min-h-11 items-center rounded-2xl border border-line bg-macro px-4 py-2 text-base font-bold text-pantone140"
              >
                Ret lager
              </Link>
            </div>
          </div>
          <div className="space-y-3">
            {stock.map(({ product, balance }) => {
              const critical = balance <= product.criticalThreshold || balance < 0;
              const low = !critical && balance <= product.lowThreshold;
              return (
                <article
                  key={product.id}
                  className={`flex items-center justify-between gap-4 rounded-3xl border p-4 ${
                    critical
                      ? "border-warmRed/30 bg-warmRed/10"
                      : low
                        ? "border-pantone139 bg-pantone139/15"
                        : "border-line bg-macro"
                  }`}
                >
                  <div>
                    <h3 className="text-xl font-bold text-ink">{product.name}</h3>
                    <p className={`text-sm font-bold ${critical ? "text-warmRed" : "text-muted"}`}>
                      {critical ? "Kritisk lavt" : low ? "Hold øje" : "OK"}
                    </p>
                  </div>
                  <p className={`text-3xl font-bold ${critical ? "text-warmRed" : "text-pantone140"}`}>
                    {balance.toLocaleString("da-DK")}
                    <span className="ml-1 text-base text-muted">{product.unit}</span>
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
