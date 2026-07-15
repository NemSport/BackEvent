"use client";

import Link from "next/link";
import { ArrowRight, ClipboardCheck, PencilLine, Repeat, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { getHistoryEntries, getLocations, getProducts } from "@/lib/backevent/data";
import { formatPlainQuantity, formatStockQuantity } from "@/lib/backevent/quantity-format";
import type { HistoryEntry, Location, Product } from "@/lib/backevent/types";

export default function HistorikPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts, loadedEntries] = await Promise.all([
          getLocations(),
          getProducts(),
          getHistoryEntries(),
        ]);

        if (!mounted) {
          return;
        }

        setLocations(loadedLocations);
        setProducts(loadedProducts);
        setEntries(loadedEntries);
      } catch {
        if (mounted) {
          setMessage("Vi kunne ikke hente historikken lige nu. Prøv igen om lidt.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <AppShell requiredRole="ansvarlig">
      <div className="mb-5">
        <BackButton />
      </div>
      <section className="mb-6 rounded-[2rem] bg-soft p-6 shadow-soft">
        <h1 className="text-4xl font-bold text-ink">Historik</h1>
        <p className="mt-2 text-lg font-medium text-muted">Flytninger, rettelser, svind og optællinger</p>
      </section>
      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{message}</p> : null}
      <div className="space-y-3">
        {entries.map((entry) => (
          <HistoryCard key={`${entry.kind}-${entry.id}`} entry={entry} locations={locations} products={products} />
        ))}
      </div>
    </AppShell>
  );
}

function HistoryCard({
  entry,
  locations,
  products,
}: {
  entry: HistoryEntry;
  locations: Location[];
  products: Product[];
}) {
  if (entry.kind === "movement") {
    const product = products.find((item) => item.id === entry.productId);
    const from = locations.find((item) => item.id === entry.fromLocationId);
    const to = locations.find((item) => item.id === entry.toLocationId);

    return (
      <article className="rounded-3xl border border-line bg-macro p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <IconBubble icon={Repeat} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-ink">
              {product ? formatStockQuantity(entry.quantity, product) : formatPlainQuantity(entry.quantity, entry.unit)} {product?.name}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-muted">
              {from?.name}
              <ArrowRight className="h-4 w-4 text-pantone140" aria-hidden />
              {to?.name}
            </p>
            {entry.reversedAt ? <p className="mt-2 text-sm font-bold text-warmRed">Fortrudt</p> : null}
            <Meta createdBy={entry.createdBy} createdAt={entry.createdAt} performedByType={entry.performedByType} />
          </div>
        </div>
      </article>
    );
  }

  if (entry.kind === "adjustment") {
    const product = products.find((item) => item.id === entry.productId);
    const location = locations.find((item) => item.id === entry.locationId);
    const isWaste = entry.adjustmentType === "waste";

    return (
      <article className="rounded-3xl border border-line bg-macro p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <IconBubble icon={PencilLine} urgent={isWaste} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-ink">
              {isWaste ? "Svind" : "Lager rettet"}: {product?.name}
            </p>
            <p className="mt-1 text-sm font-medium text-muted">{location?.name}</p>
            <p className={`mt-2 text-base font-bold ${isWaste ? "text-warmRed" : "text-pantone140"}`}>
              {product
                ? `${formatStockQuantity(entry.quantityBefore, product)} → ${formatStockQuantity(entry.quantityAfter, product)}`
                : `${formatPlainQuantity(entry.quantityBefore, entry.unit)} → ${formatPlainQuantity(entry.quantityAfter, entry.unit)}`}
            </p>
            {entry.note ? <p className="mt-1 text-sm font-medium text-muted">{entry.note}</p> : null}
            <Meta createdBy={entry.createdBy} createdAt={entry.createdAt} />
          </div>
        </div>
      </article>
    );
  }

  if (entry.kind === "return") {
    return (
      <article className="rounded-3xl border border-line bg-macro p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <IconBubble icon={RotateCcw} urgent={Boolean(entry.errorMessage)} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-ink">{returnActionLabel(entry.action)}</p>
            {entry.errorMessage ? <p className="mt-1 text-sm font-bold text-warmRed">{entry.errorMessage}</p> : null}
            <Link href={`/retur/${entry.returnId}`} className="mt-2 inline-flex text-sm font-bold text-pantone140">
              Åbn retur
            </Link>
            <Meta createdBy={entry.actorName ?? "BackEvent"} createdAt={entry.createdAt} />
          </div>
        </div>
      </article>
    );
  }

  const location = locations.find((item) => item.id === entry.locationId);

  return (
    <article className="rounded-3xl border border-line bg-macro p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <IconBubble icon={ClipboardCheck} />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-ink">
            {entry.statusType === "opening" ? "Åbning gemt" : "Lukning gemt"}
          </p>
          <p className="mt-1 text-sm font-medium text-muted">
            {location?.name} · {entry.lineCount} varer
          </p>
          <Meta createdBy={entry.createdBy} createdAt={entry.createdAt} />
        </div>
      </div>
    </article>
  );
}

function IconBubble({ icon: Icon, urgent = false }: { icon: typeof Repeat; urgent?: boolean }) {
  return (
    <span
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
        urgent ? "bg-warmRed/10 text-warmRed" : "bg-pantone139/30 text-pantone140"
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function Meta({
  createdBy,
  createdAt,
  performedByType,
}: {
  createdBy: string;
  createdAt: string;
  performedByType?: "user" | "guest" | null;
}) {
  return (
    <div className="mt-2 text-xs font-bold text-muted">
      <p>{createdBy} · {new Date(createdAt).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" })}</p>
      {performedByType === "guest" ? <p className="mt-1 text-pantone140">Gæst / manuel registrering</p> : null}
    </div>
  );
}

function returnActionLabel(action: string) {
  if (action === "registered") return "Retur registreret";
  if (action === "return_to_stock") return "Lagt tilbage på lager";
  if (action === "waste_registered") return "Registreret som svind";
  if (action === "marked_reviewed") return "Retur kontrolleret";
  if (action === "reopened") return "Retur genåbnet";
  if (action === "reprocessed") return "Retur genbehandlet";
  return "Returhændelse";
}
