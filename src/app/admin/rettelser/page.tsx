"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton, PrimaryButton } from "@/components/backevent/buttons";
import { LocationPicker, ProductPicker } from "@/components/backevent/pickers";
import {
  createStockAdjustment,
  getLocations,
  getProducts,
  getStockBalances,
} from "@/lib/backevent/data";
import type { Location, Product, StockAdjustmentType, StockBalance } from "@/lib/backevent/types";

export default function AdminRettelserPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [locationId, setLocationId] = useState<string>();
  const [productId, setProductId] = useState<string>();
  const [type, setType] = useState<StockAdjustmentType>("correction");
  const [amount, setAmount] = useState("0");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts, loadedBalances] = await Promise.all([
          getLocations(),
          getProducts(),
          getStockBalances(),
        ]);

        if (!mounted) {
          return;
        }

        setLocations(loadedLocations);
        setProducts(loadedProducts);
        setBalances(loadedBalances);
        setLocationId((current) => current ?? loadedLocations[0]?.id);
        setProductId((current) => current ?? loadedProducts[0]?.id);
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

  const product = products.find((item) => item.id === productId);
  const currentBalance = useMemo(
    () => balances.find((item) => item.locationId === locationId && item.productId === productId)?.quantity ?? 0,
    [balances, locationId, productId],
  );
  const numericAmount = Number(amount.replace(",", "."));
  const canSave = Boolean(locationId && productId && numericAmount >= 0 && !isSaving);

  async function saveAdjustment() {
    if (!locationId || !productId || !product || !canSave) {
      setMessage("Vælg sted, vare og antal først.");
      return;
    }

    if (type === "waste" && numericAmount <= 0) {
      setMessage("Svind skal være større end 0.");
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      await createStockAdjustment({
        productId,
        locationId,
        type,
        newQuantity: type === "correction" ? numericAmount : undefined,
        quantityDelta: type === "waste" ? numericAmount : undefined,
        unit: product.unit,
        note: note.trim() || null,
        createdByName: "Ansvarlig",
      });

      const updatedBalances = await getStockBalances();
      setBalances(updatedBalances);
      setMessage(type === "correction" ? "Lageret er rettet ✅" : "Svind er registreret ✅");
      setNote("");
      if (type === "waste") {
        setAmount("0");
      }
    } catch {
      setMessage("Rettelsen kunne ikke gemmes. Prøv igen.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell adminOnly>
      <div className="mb-5">
        <BackButton href="/admin" />
      </div>
      <section className="mb-6 rounded-[2rem] bg-soft p-6 shadow-soft">
        <h1 className="text-4xl font-bold text-ink">Ret lager</h1>
        <p className="mt-2 text-lg font-medium text-muted">Ret antal eller registrer svind</p>
      </section>

      <div className="space-y-6">
        <section className="rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
          <h2 className="mb-4 text-2xl font-bold text-ink">Hvor?</h2>
          <LocationPicker locations={locations} selectedId={locationId} onSelect={setLocationId} />
        </section>

        <section className="rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
          <h2 className="mb-4 text-2xl font-bold text-ink">Hvilken vare?</h2>
          <ProductPicker products={products} selectedId={productId} onSelect={setProductId} />
        </section>

        <section className="rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
          <h2 className="mb-4 text-2xl font-bold text-ink">Hvad skal der ske?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceButton selected={type === "correction"} onClick={() => setType("correction")}>
              Ret til nyt antal
            </ChoiceButton>
            <ChoiceButton selected={type === "waste"} onClick={() => setType("waste")}>
              Registrer svind
            </ChoiceButton>
          </div>
          <div className="mt-5 rounded-3xl bg-soft p-4">
            <p className="text-base font-bold text-muted">Nuværende lager</p>
            <p className="mt-1 text-4xl font-bold text-pantone140">
              {currentBalance.toLocaleString("da-DK")} {product?.unit ?? "kasser"}
            </p>
          </div>
          <label className="mt-5 block">
            <span className="text-lg font-bold text-ink">{type === "correction" ? "Nyt antal" : "Antal svind"}</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-macro px-4 py-3 text-2xl font-bold text-ink outline-none focus:border-pantone140"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-lg font-bold text-ink">Note</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Fx optalt ved baren"
              className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-macro px-4 py-3 text-lg font-bold text-ink outline-none focus:border-pantone140"
            />
          </label>
        </section>

        {message ? (
          <div className="rounded-3xl border border-line bg-soft p-4 text-lg font-bold text-pantone140">
            {message}
          </div>
        ) : null}

        <PrimaryButton disabled={!canSave} onClick={saveAdjustment}>
          {isSaving ? "Gemmer..." : type === "correction" ? "Gem rettelse" : "Gem svind"}
        </PrimaryButton>
      </div>
    </AppShell>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-16 rounded-2xl border-2 px-4 py-3 text-lg font-bold ${
        selected ? "border-pantone140 bg-pantone139 text-ink" : "border-line bg-macro text-ink"
      }`}
    >
      {children}
    </button>
  );
}
