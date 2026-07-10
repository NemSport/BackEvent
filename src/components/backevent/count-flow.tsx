"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "./app-shell";
import { BackButton, PrimaryButton } from "./buttons";
import { LocationPicker, ProductStepper } from "./pickers";
import { createOpeningClosingStatus, getLocations, getProducts, isPhysicalStockLocation } from "@/lib/backevent/data";
import type { Location, Product } from "@/lib/backevent/types";

export function CountFlow(props: {
  title: string;
  intro: string;
  buttonLabel: string;
  savedLabel: string;
}) {
  return (
    <Suspense fallback={null}>
      <CountFlowContent {...props} />
    </Suspense>
  );
}

function CountFlowContent({
  title,
  intro,
  buttonLabel,
  savedLabel,
}: {
  title: string;
  intro: string;
  buttonLabel: string;
  savedLabel: string;
}) {
  const searchParams = useSearchParams();
  const initialLocationId = searchParams.get("locationId") ?? undefined;
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locationId, setLocationId] = useState<string | undefined>(initialLocationId);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts] = await Promise.all([getLocations(), getProducts()]);
        const stockLocations = loadedLocations.filter(isPhysicalStockLocation);

        if (!mounted) {
          return;
        }

        setLocations(stockLocations);
        setProducts(loadedProducts);
        setLocationId((current) =>
          stockLocations.some((location) => location.id === current)
            ? current
            : stockLocations.find((location) => location.name === "Pub Container")?.id ?? stockLocations[0]?.id,
        );
        setCounts(
          Object.fromEntries(
            loadedProducts.map((product) => [product.id, product.name === "Fadøl 25L" ? 4 : 10]),
          ),
        );
      } catch {
        if (mounted) {
          setMessage("Vi kunne ikke hente lageret lige nu. Prøv igen om lidt.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  async function saveStatus() {
    if (!locationId) {
      setMessage("Vælg hvor du er først.");
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      await createOpeningClosingStatus({
        locationId,
        type: title === "Åbningsstatus" ? "opening" : "closing",
        createdByName: "Frivillig",
        counts: products.map((product) => ({
          productId: product.id,
          quantity: counts[product.id] ?? 0,
          unit: product.unit,
        })),
      });
      setSaved(true);
    } catch {
      setMessage("Tallene kunne ikke gemmes. Prøv igen.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5">
        <BackButton />
      </div>
      <section className="mb-6 rounded-2xl bg-pantone139 px-5 py-5 text-ink shadow-sm md:px-6">
        <h1 className="text-3xl font-bold text-ink md:text-4xl">{title}</h1>
        <p className="mt-2 text-base font-medium text-pantone140">Vælg lager/container</p>
      </section>

      <div className="space-y-6">
        <section className="rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
          <LocationPicker locations={locations} selectedId={locationId} onSelect={setLocationId} />
        </section>

        <section className="rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
          <h2 className="mb-4 text-2xl font-bold text-ink">{intro}</h2>
          <div className="space-y-3">
            {products.map((product) => (
              <ProductStepper
                key={product.id}
                product={product}
                value={counts[product.id] ?? 0}
                onChange={(value) => setCounts((current) => ({ ...current, [product.id]: value }))}
              />
            ))}
          </div>
        </section>

        {saved ? (
          <div className="rounded-2xl border border-green-100 bg-green-50 px-4 py-3 text-sm font-bold text-ok">
            {savedLabel} ✅
          </div>
        ) : null}

        {message ? (
          <div className="rounded-2xl border border-warmRed/20 bg-warmRed/10 px-4 py-3 text-sm font-bold text-warmRed">
            {message}
          </div>
        ) : null}

        <PrimaryButton disabled={isSaving} onClick={saveStatus}>
          {isSaving ? "Gemmer..." : buttonLabel}
        </PrimaryButton>
      </div>
    </AppShell>
  );
}
