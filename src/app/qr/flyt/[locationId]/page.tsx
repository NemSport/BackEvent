"use client";

import { Check, Minus, Plus } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { clampQrMoveQuantity, validateQrMoveLines } from "@/lib/backevent/qr-move-validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type QrLocation = {
  id: string;
  name: string;
  type: string;
};

type QrProduct = {
  id: string;
  name: string;
  unit: string;
};

type QrBalance = {
  productId: string;
  locationId: string;
  quantity: number;
};

type FlowStep = "confirm-start" | "choose-start" | "destination" | "products" | "receipt" | "success";

type SaveResult = {
  ok: boolean;
  batchId?: string;
  createdAt?: string;
  createdByName?: string;
  message?: string;
};

export default function QrMovePage() {
  const params = useParams<{ locationId: string }>();
  const qrLocationId = params.locationId;
  const { profile, isAuthenticated } = useBackEventAuth();
  const [locations, setLocations] = useState<QrLocation[]>([]);
  const [products, setProducts] = useState<QrProduct[]>([]);
  const [balances, setBalances] = useState<QrBalance[]>([]);
  const [step, setStep] = useState<FlowStep>("confirm-start");
  const [fromId, setFromId] = useState(qrLocationId);
  const [toId, setToId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [anonymousName, setAnonymousName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [receiptLeaving, setReceiptLeaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const response = await fetch(`/api/qr/move-flow?locationId=${encodeURIComponent(qrLocationId)}`);
        const data = (await response.json()) as {
          ok: boolean;
          locations?: QrLocation[];
          products?: QrProduct[];
          balances?: QrBalance[];
          message?: string;
        };

        if (!response.ok || !data.ok) {
          throw new Error(data.message ?? "Kunne ikke hente QR-flow");
        }

        if (!mounted) {
          return;
        }

        const loadedLocations = data.locations ?? [];
        setLocations(loadedLocations);
        setProducts(data.products ?? []);
        setBalances(data.balances ?? []);
        setFromId(loadedLocations.some((location) => location.id === qrLocationId) ? qrLocationId : "");
        setStep(loadedLocations.some((location) => location.id === qrLocationId) ? "confirm-start" : "choose-start");
      } catch {
        if (mounted) {
          setMessage("Vi kunne ikke hente lagerflowet lige nu.");
          setStep("choose-start");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [qrLocationId]);

  const fromLocation = locations.find((location) => location.id === fromId);
  const toLocation = locations.find((location) => location.id === toId);
  const destinationLocations = locations.filter((location) => location.id !== fromId);
  const actorName = profile?.fullName || profile?.email || "";
  const selectedLines = useMemo(
    () =>
      products
        .map((product) => ({
          product,
          quantity: quantities[product.id] ?? 0,
          available: getAvailable(product.id, fromId, balances),
        }))
        .filter((line) => line.quantity > 0),
    [balances, fromId, products, quantities],
  );
  const movableProducts = useMemo(
    () =>
      products
        .map((product) => ({
          product,
          available: getAvailable(product.id, fromId, balances),
          quantity: quantities[product.id] ?? 0,
        }))
        .filter((line) => line.available > 0),
    [balances, fromId, products, quantities],
  );
  const canContinueDestination = Boolean(fromId && toId && fromId !== toId);
  const canContinueProducts = selectedLines.length > 0;
  const finalName = isAuthenticated ? actorName : anonymousName.trim();
  const canAccept = Boolean(finalName && fromLocation && toLocation && selectedLines.length > 0 && !isSaving);

  function chooseStart(id: string) {
    setFromId(id);
    setToId((current) => (current === id ? "" : current));
    setQuantities({});
    setMessage(null);
  }

  function changeQuantity(productId: string, change: number, available: number) {
    setQuantities((current) => {
      const next = clampQrMoveQuantity((current[productId] ?? 0) + change, available);
      return { ...current, [productId]: next };
    });
  }

  async function acceptMove() {
    const validation = validateQrMoveLines(
      products.map((product) => ({
        productId: product.id,
        quantity: quantities[product.id] ?? 0,
        available: getAvailable(product.id, fromId, balances),
      })),
    );

    if (!validation.ok) {
      setMessage(validation.message);
      return;
    }

    if (!canAccept || !fromLocation || !toLocation) {
      setMessage(isAuthenticated ? "Tjek flytningen igen." : "Skriv dit navn før godkendelse.");
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/qr/stock-movements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fromLocationId: fromLocation.id,
          toLocationId: toLocation.id,
          actorName: finalName,
          lines: selectedLines.map((line) => ({
            productId: line.product.id,
            quantity: line.quantity,
            unit: line.product.unit,
          })),
        }),
      });
      const data = (await response.json()) as SaveResult;

      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Flytningen kunne ikke gemmes");
      }

      setSaveResult(data);
      setReceiptLeaving(true);
      window.setTimeout(() => {
        setStep("success");
        setReceiptLeaving(false);
      }, 520);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Flytningen kunne ikke gemmes.");
    } finally {
      setIsSaving(false);
    }
  }

  function resetToStart() {
    setFromId(qrLocationId);
    setToId("");
    setQuantities({});
    setAnonymousName("");
    setSaveResult(null);
    setMessage(null);
    setStep(locations.some((location) => location.id === qrLocationId) ? "confirm-start" : "choose-start");
  }

  function moveAgain() {
    setToId("");
    setQuantities({});
    setSaveResult(null);
    setMessage(null);
    setStep("destination");
  }

  return (
    <main className="min-h-screen bg-macro px-4 py-5 text-ink">
      <style jsx global>{`
        @keyframes qrReceiptAway {
          to {
            opacity: 0;
            transform: translateY(-26px) rotate(-1deg);
            clip-path: inset(0 0 100% 0);
          }
        }
      `}</style>
      <div className="mx-auto max-w-2xl pb-28">
        <header className="mb-4 rounded-3xl bg-pantone139 p-5 shadow-soft">
          <p className="text-sm font-bold uppercase text-pantone140">QR lagerflyt</p>
          <h1 className="mt-1 text-3xl font-bold">Flyt varer</h1>
          <StepIndicator step={step} />
        </header>

        {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-sm font-bold text-warmRed">{message}</p> : null}

        {step === "confirm-start" ? (
          <Panel title={`Står du i ${fromLocation?.name ?? "dette sted"}?`}>
            <div className="grid gap-3">
              <button type="button" onClick={() => setStep("destination")} className="min-h-14 rounded-2xl bg-pantone139 px-5 py-3 text-lg font-bold text-ink">
                Ja
              </button>
              <button type="button" onClick={() => setStep("choose-start")} className="min-h-14 rounded-2xl border border-line bg-macro px-5 py-3 text-lg font-bold text-pantone140">
                Nej
              </button>
            </div>
          </Panel>
        ) : null}

        {step === "choose-start" ? (
          <Panel title="Vælg korrekt startlokation">
            <LocationGrid locations={locations} selectedId={fromId} onSelect={chooseStart} />
            <StickyButton disabled={!fromId} onClick={() => setStep("destination")}>
              Fortsæt
            </StickyButton>
          </Panel>
        ) : null}

        {step === "destination" ? (
          <Panel title="Hvor skal varerne flyttes hen?">
            <LocationGrid locations={destinationLocations} selectedId={toId} onSelect={setToId} />
            <StickyButton disabled={!canContinueDestination} onClick={() => setStep("products")}>
              Fortsæt
            </StickyButton>
          </Panel>
        ) : null}

        {step === "products" ? (
          <Panel title="Vælg varer og antal">
            {movableProducts.length === 0 ? (
              <p className="rounded-2xl bg-soft p-4 text-base font-bold text-muted">Ingen varer med beholdning på startlokationen.</p>
            ) : (
              <div className="space-y-3 pb-4">
                {movableProducts.map(({ product, available, quantity }) => (
                  <article key={product.id} className="rounded-2xl border border-line bg-macro p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold text-ink">{product.name}</h2>
                        <p className="text-sm font-bold text-muted">På lager: {available.toLocaleString("da-DK")} {product.unit}</p>
                      </div>
                      <p className="text-sm font-bold text-pantone140">{product.unit}</p>
                    </div>
                    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-3">
                      <RoundButton label="Minus" disabled={quantity <= 0} onClick={() => changeQuantity(product.id, -1, available)}>
                        <Minus className="h-5 w-5" aria-hidden />
                      </RoundButton>
                      <p className="rounded-2xl bg-soft px-4 py-3 text-center text-3xl font-bold text-ink">{quantity.toLocaleString("da-DK")}</p>
                      <RoundButton label="Plus" disabled={quantity >= available} onClick={() => changeQuantity(product.id, 1, available)}>
                        <Plus className="h-5 w-5" aria-hidden />
                      </RoundButton>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <StickyButton disabled={!canContinueProducts} onClick={() => setStep("receipt")}>
              Næste
            </StickyButton>
          </Panel>
        ) : null}

        {step === "receipt" ? (
          <section className={receiptLeaving ? "animate-[qrReceiptAway_520ms_ease-in_forwards]" : ""}>
            <Panel title="Kvittering">
              <ReceiptSummary
                fromName={fromLocation?.name}
                toName={toLocation?.name}
                selectedLines={selectedLines}
                createdByName={finalName}
                createdAt={new Date().toISOString()}
              />
              {isAuthenticated ? (
                <p className="mt-4 rounded-2xl bg-soft p-4 text-base font-bold text-pantone140">Flytningen registreres som {actorName}</p>
              ) : (
                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-bold text-ink">Dit navn</span>
                  <input
                    value={anonymousName}
                    onChange={(event) => setAnonymousName(event.target.value)}
                    className="min-h-12 w-full rounded-2xl border border-line px-4 text-base font-bold outline-none focus:border-pantone140"
                    placeholder="Skriv navn"
                  />
                </label>
              )}
              <div className="mt-5 grid gap-3">
                <button
                  type="button"
                  onClick={acceptMove}
                  disabled={!canAccept}
                  className="min-h-14 rounded-2xl bg-pantone139 px-5 py-3 text-lg font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? "Gemmer..." : "Accepter"}
                </button>
                <button type="button" onClick={() => setStep("products")} className="min-h-12 rounded-2xl border border-line bg-macro px-5 py-3 text-base font-bold text-pantone140">
                  Ret
                </button>
                <button type="button" onClick={resetToStart} className="min-h-12 rounded-2xl bg-soft px-5 py-3 text-base font-bold text-muted">
                  Fortryd
                </button>
              </div>
            </Panel>
          </section>
        ) : null}

        {step === "success" ? (
          <Panel title="Godkendt">
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-pantone139 text-pantone140">
                <Check className="h-10 w-10" aria-hidden />
              </div>
              <p className="text-4xl font-bold text-ink">Godkendt</p>
              <p className="mt-3 text-base font-bold text-muted">{saveResult?.createdAt ? new Date(saveResult.createdAt).toLocaleString("da-DK") : new Date().toLocaleString("da-DK")}</p>
            </div>
            <ReceiptSummary
              fromName={fromLocation?.name}
              toName={toLocation?.name}
              selectedLines={selectedLines}
              createdByName={saveResult?.createdByName ?? finalName}
              createdAt={saveResult?.createdAt ?? new Date().toISOString()}
              compact
            />
            <button type="button" onClick={moveAgain} className="mt-5 min-h-14 w-full rounded-2xl bg-pantone139 px-5 py-3 text-lg font-bold text-ink">
              Lav nyt flyt
            </button>
          </Panel>
        ) : null}
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-macro p-5 shadow-soft">
      <h2 className="mb-5 text-2xl font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function LocationGrid({ locations, selectedId, onSelect }: { locations: QrLocation[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="grid gap-3">
      {locations.map((location) => {
        const selected = selectedId === location.id;
        return (
          <button
            key={location.id}
            type="button"
            onClick={() => onSelect(location.id)}
            className={`flex min-h-14 items-center justify-between rounded-2xl border px-4 py-3 text-left text-base font-bold ${
              selected ? "border-pantone140 bg-pantone139/80 text-ink" : "border-line bg-macro text-ink"
            }`}
          >
            {location.name}
            {selected ? <Check className="h-5 w-5 text-pantone140" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

function StickyButton({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <div className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-2xl rounded-2xl border border-line bg-macro p-3 shadow-soft">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="min-h-14 w-full rounded-2xl bg-pantone139 px-5 py-3 text-lg font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </button>
    </div>
  );
}

function RoundButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pantone139 text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ReceiptSummary({
  fromName,
  toName,
  selectedLines,
  createdByName,
  createdAt,
  compact = false,
}: {
  fromName?: string;
  toName?: string;
  selectedLines: Array<{ product: QrProduct; quantity: number }>;
  createdByName: string;
  createdAt: string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-3xl bg-soft ${compact ? "mt-5 p-4" : "p-4"}`}>
      <div className="grid gap-2 text-sm font-bold text-muted">
        <p>Fra: <span className="text-ink">{fromName}</span></p>
        <p>Til: <span className="text-ink">{toName}</span></p>
        <p>Tidspunkt: <span className="text-ink">{new Date(createdAt).toLocaleString("da-DK")}</span></p>
        <p>Navn: <span className="text-ink">{createdByName || "Mangler"}</span></p>
      </div>
      <div className="mt-4 space-y-2">
        {selectedLines.map((line) => (
          <div key={line.product.id} className="flex items-center justify-between gap-3 rounded-2xl bg-macro px-3 py-2">
            <p className="font-bold text-ink">{line.product.name}</p>
            <p className="font-bold text-pantone140">
              {line.quantity.toLocaleString("da-DK")} {line.product.unit}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: FlowStep }) {
  const steps: FlowStep[] = ["confirm-start", "destination", "products", "receipt", "success"];
  const currentIndex = Math.max(0, steps.indexOf(step === "choose-start" ? "confirm-start" : step));

  return (
    <div className="mt-4 flex gap-2">
      {steps.slice(0, 4).map((item, index) => (
        <span key={item} className={`h-2 flex-1 rounded-full ${index <= currentIndex ? "bg-pantone140" : "bg-macro/70"}`} />
      ))}
    </div>
  );
}

function getAvailable(productId: string, locationId: string, balances: QrBalance[]) {
  return balances.find((balance) => balance.productId === productId && balance.locationId === locationId)?.quantity ?? 0;
}

async function getAccessToken() {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return null;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.access_token ?? null;
}
