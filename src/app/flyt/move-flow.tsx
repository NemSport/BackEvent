"use client";

import { RotateCcw } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton, PrimaryButton } from "@/components/backevent/buttons";
import { LocationPicker, ProductPicker, QuantityControl } from "@/components/backevent/pickers";
import { createStockMovement, getLocations, getProducts, isPhysicalStockLocation, reverseStockMovement } from "@/lib/backevent/data";
import { formatStockQuantity } from "@/lib/backevent/quantity-format";
import { useBackEventAuth } from "@/lib/backevent/auth";
import type { Location, Product } from "@/lib/backevent/types";

type LastMove = {
  movementId: string;
  summaryText: string;
};

export function MoveFlow() {
  return (
    <Suspense fallback={null}>
      <MoveFlowContent />
    </Suspense>
  );
}

function MoveFlowContent() {
  const searchParams = useSearchParams();
  const { isAdmin } = useBackEventAuth();
  const initialFromLocationId = searchParams.get("fromLocationId") ?? undefined;
  const initialToLocationId = searchParams.get("toLocationId") ?? undefined;
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [fromId, setFromId] = useState<string | undefined>(initialFromLocationId);
  const [toId, setToId] = useState<string | undefined>(
    initialToLocationId && initialToLocationId !== initialFromLocationId ? initialToLocationId : undefined,
  );
  const [productId, setProductId] = useState<string>();
  const [quantity, setQuantity] = useState(1);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [showMobileConfirm, setShowMobileConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
        setFromId((current) => (stockLocations.some((location) => location.id === current) ? current : undefined));
        setToId((current) =>
          stockLocations.some((location) => location.id === current) && current !== initialFromLocationId ? current : undefined,
        );
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
  }, [initialFromLocationId]);

  const from = useMemo(() => locations.find((location) => location.id === fromId), [fromId, locations]);
  const to = useMemo(() => locations.find((location) => location.id === toId), [toId, locations]);
  const product = useMemo(() => products.find((item) => item.id === productId), [productId, products]);
  const toLocations = useMemo(() => locations.filter((location) => location.id !== fromId), [fromId, locations]);
  const canSave = Boolean(from && to && product && quantity > 0 && fromId !== toId && !isSaving);
  const formattedQuantity = product ? formatStockQuantity(quantity, product) : `${quantity.toLocaleString("da-DK")} kasser`;
  const summaryText = `${formattedQuantity} ${product?.name ?? "vare"} fra ${
    from?.name ?? "ikke valgt"
  } til ${to?.name ?? "ikke valgt"}`;

  function chooseFrom(id: string) {
    setFromId(id);
    setMessage(null);

    if (toId === id) {
      setToId(undefined);
    }
  }

  function resetFlow() {
    setFromId(initialFromLocationId);
    setToId(initialToLocationId && initialToLocationId !== initialFromLocationId ? initialToLocationId : undefined);
    setProductId(products[0]?.id);
    setQuantity(1);
    setLastMove(null);
    setShowMobileConfirm(false);
    setMessage(null);
  }

  async function saveMovement() {
    if (!from || !to || !product || !canSave) {
      setMessage("Vælg fra, til, vare og antal først.");
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      setShowMobileConfirm(false);
      const movementId = await createStockMovement({
        productId: product.id,
        fromLocationId: from.id,
        toLocationId: to.id,
        quantity,
        unit: product.unit,
        createdByName: "Frivillig",
      });

      setLastMove({ movementId, summaryText });
    } catch {
      setMessage("Flytningen kunne ikke gemmes. Prøv igen.");
    } finally {
      setIsSaving(false);
    }
  }

  async function undoMovement() {
    if (!lastMove) {
      return;
    }

    setIsReversing(true);
    setMessage(null);

    try {
      await reverseStockMovement(lastMove.movementId, "Frivillig", "Fortrudt fra flyt-siden");
      setLastMove(null);
      setMessage("Flytningen er fortrudt.");
    } catch {
      setMessage("Flytningen kunne ikke fortrydes. Prøv igen.");
    } finally {
      setIsReversing(false);
    }
  }

  if (lastMove) {
    return (
      <AppShell>
        <div className="mb-5">
          <BackButton />
        </div>
        <section className="grid min-h-[60vh] place-items-center rounded-[2rem] bg-soft p-4 sm:p-8">
          <div className="w-full max-w-3xl rounded-[2rem] bg-macro p-6 text-center shadow-soft sm:p-10">
            <p className="text-5xl font-bold text-ok">Flyttet ✅</p>
            <p className="mx-auto mt-5 max-w-2xl text-2xl font-bold leading-snug text-ink">{lastMove.summaryText}</p>
            {message ? <p className="mt-4 text-base font-bold text-pantone140">{message}</p> : null}
            <div className="mx-auto mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
              {isAdmin ? (
                <button
                  type="button"
                  data-testid="undo-move"
                  onClick={undoMovement}
                  disabled={isReversing}
                  className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-line bg-macro px-5 py-4 text-lg font-bold text-pantone140 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw className="h-5 w-5" aria-hidden />
                  {isReversing ? "Fortryder..." : "Fortryd"}
                </button>
              ) : null}
              <PrimaryButton data-testid="move-more" onClick={resetFlow}>
                Flyt mere
              </PrimaryButton>
            </div>
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-5">
        <BackButton />
      </div>

      <div className="mb-6 rounded-[2rem] bg-pantone139 px-5 py-6 text-ink shadow-soft sm:px-8">
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl">Flyt varer</h1>
        <p className="mt-2 text-lg font-medium text-pantone140">Kun mellem lager/container steder</p>
      </div>

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{message}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="space-y-5 pb-36 lg:space-y-7 lg:pb-0">
          <FlowStep title="Hvor flytter du fra?" label="Fra">
            <LocationPicker locations={locations} selectedId={fromId} onSelect={chooseFrom} testIdPrefix="from-location" />
          </FlowStep>

          <FlowStep title="Hvor skal det hen?" label="Til">
            <LocationPicker locations={toLocations} selectedId={toId} onSelect={setToId} testIdPrefix="to-location" />
          </FlowStep>

          <FlowStep title="Hvad flytter du?" label="Vare">
            <ProductPicker products={products} selectedId={productId} onSelect={setProductId} />
          </FlowStep>

          <FlowStep title="Hvor meget?" label="Antal">
            <QuantityControl value={quantity} onChange={setQuantity} unit={product?.unit ?? "kasser"} product={product} />
          </FlowStep>
        </div>

        <div className="hidden lg:block">
          <MoveSummaryCard
            fromName={from?.name}
            toName={to?.name}
            productName={product?.name}
            product={product}
            quantity={quantity}
            unit={product?.unit ?? "kasser"}
            canSave={canSave}
            isSaving={isSaving}
            onSave={saveMovement}
          />
        </div>
      </div>

      <div className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 rounded-[1.5rem] border border-line bg-macro p-3 shadow-soft lg:hidden">
        <PrimaryButton data-testid="continue-move-mobile" disabled={!canSave} onClick={() => setShowMobileConfirm(true)}>
          Fortsæt
        </PrimaryButton>
      </div>

      {showMobileConfirm ? (
        <MobileConfirmSheet
          toName={to?.name}
          productName={product?.name}
          product={product}
          quantity={quantity}
          unit={product?.unit ?? "kasser"}
          isSaving={isSaving}
          onCancel={() => setShowMobileConfirm(false)}
          onConfirm={saveMovement}
        />
      ) : null}
    </AppShell>
  );
}

function MobileConfirmSheet({
  toName,
  productName,
  product,
  quantity,
  unit,
  isSaving,
  onCancel,
  onConfirm,
}: {
  toName?: string;
  productName?: string;
  product?: Product;
  quantity: number;
  unit: string;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/35 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:hidden">
      <section className="w-full rounded-[1.75rem] bg-macro p-5 shadow-soft">
        <p className="text-sm font-bold uppercase tracking-wide text-pantone140">Bekræft</p>
        <h2 className="mt-1 text-2xl font-bold text-ink">Du er ved at flytte</h2>
        <p className="mt-4 rounded-2xl bg-soft p-4 text-xl font-bold text-ink">
          {productName ?? "Ikke valgt endnu"} · {product ? formatStockQuantity(quantity, product) : `${quantity.toLocaleString("da-DK")} ${unit}`}
        </p>
        <p className="mt-3 text-base font-bold text-muted">Til: {toName ?? "Ikke valgt endnu"}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-14 rounded-2xl border border-line bg-macro px-4 py-3 text-lg font-bold text-pantone140"
          >
            Annuller
          </button>
          <PrimaryButton data-testid="confirm-move-mobile" disabled={isSaving} onClick={onConfirm}>
            {isSaving ? "Gemmer..." : "Ja, flyt varer"}
          </PrimaryButton>
        </div>
      </section>
    </div>
  );
}

function FlowStep({
  title,
  label,
  children,
}: {
  title: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[2rem] bg-macro p-4 shadow-soft sm:p-6">
      <div className="mb-4 flex items-baseline gap-3">
        <p className="rounded-full bg-pantone139/35 px-3 py-1 text-sm font-bold uppercase tracking-wide text-pantone140">
          {label}
        </p>
        <h2 className="text-2xl font-bold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function MoveSummaryCard({
  fromName,
  toName,
  productName,
  product,
  quantity,
  unit,
  canSave,
  isSaving,
  onSave,
}: {
  fromName?: string;
  toName?: string;
  productName?: string;
  product?: Product;
  quantity: number;
  unit: string;
  canSave: boolean;
  isSaving: boolean;
  onSave: () => void;
}) {
  return (
    <aside className="sticky top-4 rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
      <p className="text-sm font-bold uppercase tracking-wide text-pantone140">Bekræft</p>
      <h2 className="mt-1 text-3xl font-bold text-ink">Du er ved at flytte</h2>

      <dl className="mt-6 space-y-4">
        <SummaryRow label="Fra" value={fromName} />
        <SummaryRow label="Til" value={toName} />
        <SummaryRow label="Vare" value={productName} />
        <SummaryRow label="Antal" value={product ? formatStockQuantity(quantity, product) : `${quantity.toLocaleString("da-DK")} ${unit}`} />
      </dl>

      <div className="mt-6 rounded-[1.5rem] bg-soft p-4">
        <p className="text-lg font-bold leading-snug text-ink">
          {productName ?? "Ikke valgt endnu"}
          <br />
          <span className="text-pantone140">
            {product ? formatStockQuantity(quantity, product) : `${quantity.toLocaleString("da-DK")} ${unit}`}
          </span>
        </p>
      </div>

      <div className="mt-5">
        <PrimaryButton data-testid="confirm-move" disabled={!canSave} onClick={onSave}>
          {isSaving ? "Gemmer..." : "Ja, flyt varer"}
        </PrimaryButton>
      </div>
    </aside>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-2xl bg-soft p-4">
      <dt className="text-sm font-bold uppercase tracking-wide text-pantone140">{label}</dt>
      <dd className={`mt-1 text-lg font-bold ${value ? "text-ink" : "text-muted"}`}>{value ?? "Ikke valgt endnu"}</dd>
    </div>
  );
}
