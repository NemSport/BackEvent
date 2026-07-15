"use client";

import { Check, Minus, Plus } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Notice, PageHeader, cn } from "@/components/backevent/ui";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { isResponsibleRole } from "@/lib/backevent/permissions";
import { formatStockQuantity } from "@/lib/backevent/quantity-format";
import { clampQrMoveQuantity, validateQrMoveLines } from "@/lib/backevent/qr-move-validation";
import type { Product } from "@/lib/backevent/types";
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
} & Pick<Product, "purchaseUnitLabel" | "unitsPerPurchaseUnit" | "unitsPerCase" | "stockUnitLabel" | "contentPerStockUnit" | "consumptionUnitLabel">;

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
  performedByType?: "user" | "guest";
  message?: string;
};

export default function QrMovePage() {
  const params = useParams<{ locationId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qrLocationId = params.locationId;
  const forceFlow = searchParams.get("start") === "1";
  const { profile, isAuthenticated, loading } = useBackEventAuth();
  const [locations, setLocations] = useState<QrLocation[]>([]);
  const [products, setProducts] = useState<QrProduct[]>([]);
  const [balances, setBalances] = useState<QrBalance[]>([]);
  const [viewerAuthenticated, setViewerAuthenticated] = useState(false);
  const [serverActorName, setServerActorName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
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
    if (!forceFlow && !loading && isAuthenticated && isResponsibleRole(profile?.role)) {
      router.replace(`/sted/${qrLocationId}`);
    }
  }, [forceFlow, isAuthenticated, loading, profile?.role, qrLocationId, router]);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const token = await getAccessToken();
        const response = await fetch(`/api/qr/move-flow?locationId=${encodeURIComponent(qrLocationId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = (await response.json()) as {
          ok: boolean;
          authenticated?: boolean;
          actorName?: string | null;
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
        setViewerAuthenticated(Boolean(data.authenticated));
        setServerActorName(data.actorName ?? "");
        setFromId(qrLocationId);
        setStep("confirm-start");
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : "Vi kunne ikke hente lagerflowet lige nu.");
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
  const accountName = serverActorName || profile?.fullName || profile?.email || "";
  const isGuest = !viewerAuthenticated;
  const selectedLines = useMemo(
    () =>
      products
        .map((product) => ({
          product,
          quantity: quantities[product.id] ?? 0,
          available: viewerAuthenticated ? getAvailable(product.id, fromId, balances) : undefined,
        }))
        .filter((line) => line.quantity > 0),
    [balances, fromId, products, quantities, viewerAuthenticated],
  );
  const movableProducts = useMemo(
    () =>
      products
        .map((product) => ({
          product,
          available: viewerAuthenticated ? getAvailable(product.id, fromId, balances) : undefined,
          quantity: quantities[product.id] ?? 0,
        }))
        .filter((line) => !viewerAuthenticated || (line.available ?? 0) > 0),
    [balances, fromId, products, quantities, viewerAuthenticated],
  );
  const canContinueDestination = Boolean(fromId && toId && fromId !== toId);
  const canContinueProducts = selectedLines.length > 0;
  const finalName = isGuest ? anonymousName.trim() : accountName;
  const canAccept = Boolean(finalName.length >= 2 && fromLocation && toLocation && selectedLines.length > 0 && !isSaving);

  function chooseStart(id: string) {
    setFromId(id);
    setToId((current) => (current === id ? "" : current));
    setQuantities({});
    setMessage(null);
  }

  function changeQuantity(productId: string, change: number, available?: number) {
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
        available: viewerAuthenticated ? getAvailable(product.id, fromId, balances) : undefined,
      })),
    );

    if (!validation.ok) {
      setMessage(validation.message);
      return;
    }

    if (!canAccept || !fromLocation || !toLocation) {
      setMessage(isGuest ? "Skriv dit navn før godkendelse." : "Tjek flytningen igen.");
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
    setStep("confirm-start");
  }

  function moveAgain() {
    setToId("");
    setQuantities({});
    setSaveResult(null);
    setMessage(null);
    setStep("destination");
  }

  if (!forceFlow && !loading && isAuthenticated && isResponsibleRole(profile?.role)) {
    return (
      <main className="grid min-h-screen place-items-center bg-macro px-4 text-center text-ink">
        <p className="rounded-2xl bg-soft px-4 py-3 text-base font-bold text-muted">Åbner lokationsside...</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center bg-macro px-4 text-center text-ink">
        <Notice tone="danger" className="max-w-xl">{loadError}</Notice>
      </main>
    );
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
        <PageHeader title="Flyt varer" kicker="QR lagerflyt" className="mb-4">
          <StepIndicator step={step} />
        </PageHeader>

        {message ? <Notice tone="danger" className="mb-4">{message}</Notice> : null}

        {step === "confirm-start" ? (
          <Panel title={`Du står ved ${fromLocation?.name ?? "dette sted"} - er det korrekt?`}>
            <div className="grid gap-3">
              <Button type="button" onClick={() => setStep("destination")}>
                Ja, fortsæt
              </Button>
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
              <Notice tone="info">Ingen varer med beholdning på startlokationen.</Notice>
            ) : (
              <div className="space-y-3 pb-4">
                {movableProducts.map(({ product, available, quantity }) => (
                  <Card key={product.id} as="article" className="p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold text-ink">{product.name}</h2>
                        <p className="text-sm font-bold text-muted">
                          {viewerAuthenticated && available !== undefined
                            ? `Enhed: ${product.unit} · Aktuel beholdning: ${formatStockQuantity(available, product)}`
                            : `Enhed: ${product.unit}`}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-pantone140">{product.unit}</p>
                    </div>
                    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-3">
                      <RoundButton label="Minus" disabled={quantity <= 0} onClick={() => changeQuantity(product.id, -1, available)}>
                        <Minus className="h-5 w-5" aria-hidden />
                      </RoundButton>
                      <p className="rounded-2xl bg-soft px-4 py-3 text-center text-2xl font-bold text-ink">{formatStockQuantity(quantity, product)}</p>
                      <RoundButton
                        label="Plus"
                        disabled={available !== undefined && quantity >= available}
                        onClick={() => changeQuantity(product.id, 1, available)}
                      >
                        <Plus className="h-5 w-5" aria-hidden />
                      </RoundButton>
                    </div>
                  </Card>
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
              {!isGuest ? (
                <Notice tone="pending" className="mt-4">Flytningen registreres som {accountName}</Notice>
              ) : (
                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-bold text-ink">Dit navn</span>
                  <input
                    value={anonymousName}
                    onChange={(event) => setAnonymousName(event.target.value)}
                    className="min-h-12 w-full rounded-2xl border border-line px-4 text-base font-bold outline-none focus:border-pantone140"
                    placeholder="Skriv dit for- og efternavn"
                  />
                  <span className="mt-2 block text-sm font-medium text-muted">
                    Navnet gemmes i historikken, så flytningen kan spores.
                  </span>
                </label>
              )}
              <div className="mt-5 grid gap-3">
                <Button
                  type="button"
                  onClick={acceptMove}
                  disabled={!canAccept}
                >
                  {isSaving ? "Gemmer..." : "Godkend"}
                </Button>
                <Button type="button" tone="secondary" onClick={() => setStep("products")}>
                  Ret
                </Button>
                <Button type="button" tone="quiet" onClick={resetToStart}>
                  Annuller
                </Button>
              </div>
            </Panel>
          </section>
        ) : null}

        {step === "success" ? (
          <Panel title="Lagerflyt registreret">
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-ok/15 text-ok">
                <Check className="h-10 w-10" aria-hidden />
              </div>
              <p className="text-4xl font-bold text-ok">Lagerflyt registreret</p>
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
            <Button type="button" onClick={moveAgain} className="mt-5">
              Lav nyt flyt
            </Button>
          </Panel>
        ) : null}
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 shadow-soft">
      <h2 className="mb-5 text-2xl font-bold text-ink">{title}</h2>
      {children}
    </Card>
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
            className={cn(
              "flex min-h-[3.25rem] items-center justify-between rounded-2xl border px-4 py-3 text-left text-base font-bold transition focus:outline-none focus:ring-2 focus:ring-pantone140/35 focus:ring-offset-2 focus:ring-offset-macro",
              selected ? "border-pantone140 bg-pantone139/80 text-ink" : "border-line bg-macro text-ink hover:border-pantone139 hover:bg-soft/70",
            )}
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
      <Button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </Button>
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
      className="flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-2xl border border-pantone139 bg-pantone139 text-ink transition focus:outline-none focus:ring-2 focus:ring-pantone140/35 focus:ring-offset-2 focus:ring-offset-macro disabled:cursor-not-allowed disabled:opacity-40"
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
        <p>
          Fra: <span className="text-ink">{fromName}</span>
        </p>
        <p>
          Til: <span className="text-ink">{toName}</span>
        </p>
        <p>
          Tidspunkt: <span className="text-ink">{new Date(createdAt).toLocaleString("da-DK")}</span>
        </p>
        <p>
          Navn: <span className="text-ink">{createdByName || "Mangler"}</span>
        </p>
      </div>
      <div className="mt-4 space-y-2">
        {selectedLines.map((line) => (
          <div key={line.product.id} className="flex items-center justify-between gap-3 rounded-2xl bg-macro px-3 py-2">
            <p className="font-bold text-ink">{line.product.name}</p>
            <p className="font-bold text-pantone140">
              {formatStockQuantity(line.quantity, line.product)}
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
