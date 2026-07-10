"use client";

import Link from "next/link";
import { DoorClosed, DoorOpen, PackageSearch, Repeat } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGuard } from "@/components/backevent/auth-guard";
import { BackButton } from "@/components/backevent/buttons";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { hasRoleAtLeast } from "@/lib/backevent/permissions";
import {
  getLocationTotal,
  getLocations,
  getOpeningClosingOverview,
  getProducts,
  getStockBalances,
} from "@/lib/backevent/data";
import type { Location, OpeningClosingLocationOverview, Product, StockBalance } from "@/lib/backevent/types";

export default function LocationQuickPage() {
  const { profile } = useBackEventAuth();
  const params = useParams<{ locationId: string }>();
  const locationId = params.locationId;
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [overview, setOverview] = useState<OpeningClosingLocationOverview[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const canSeeStock = hasRoleAtLeast(profile?.role, "ansvarlig");

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts] = await Promise.all([getLocations(), getProducts()]);
        const [loadedBalances, loadedOverview] = canSeeStock
          ? await Promise.all([getStockBalances(), getOpeningClosingOverview()])
          : [[], []];

        if (!mounted) {
          return;
        }

        setLocations(loadedLocations);
        setProducts(loadedProducts);
        setBalances(loadedBalances);
        setOverview(loadedOverview);
      } catch {
        if (mounted) {
          setMessage("Vi kunne ikke hente stedet lige nu. Prøv igen om lidt.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [canSeeStock]);

  const location = locations.find((item) => item.id === locationId);
  const locationOverview = overview.find((item) => item.locationId === locationId);
  const stock = useMemo(
    () =>
      products.map((product) => ({
        product,
        balance: balances.find((item) => item.locationId === locationId && item.productId === product.id)?.quantity ?? 0,
      })),
    [balances, locationId, products],
  );
  const total = getLocationTotal(locationId, balances);

  if (!location && locations.length > 0) {
    return (
      <AuthGuard>
        <main className="min-h-screen px-4 py-5 sm:px-6 lg:py-6">
          <div className="mx-auto max-w-3xl">
            <section className="rounded-[2rem] bg-soft p-6 text-center shadow-soft lg:rounded-[1.5rem] lg:p-5">
              <h1 className="text-4xl font-bold text-ink lg:text-3xl">Sted ikke fundet</h1>
              <Link
                href="/"
                className="mt-6 inline-flex min-h-14 items-center justify-center rounded-2xl bg-pantone139 px-5 py-4 text-lg font-bold text-ink"
              >
                Gå til Start
              </Link>
            </section>
          </div>
        </main>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <main className="min-h-screen px-4 py-5 sm:px-6 lg:py-6">
        <div className="mx-auto max-w-4xl">
        <div className="mb-5">
          <BackButton />
        </div>

        <section className="mb-6 rounded-[2rem] bg-pantone139 p-6 shadow-soft lg:rounded-[1.5rem] lg:p-5">
          <h1 className="text-4xl font-bold text-ink lg:text-3xl">{location?.name ?? "Henter sted..."}</h1>
          <div className="mt-4 flex flex-wrap gap-3">
            <StatusPill overview={locationOverview} />
            {canSeeStock ? (
              <span className="rounded-full bg-macro px-3 py-1 text-sm font-bold text-pantone140">
                {total.toLocaleString("da-DK")} kasser i alt
              </span>
            ) : null}
          </div>
        </section>

        {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{message}</p> : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:gap-5">
          <QuickAction href={`/aabning?locationId=${locationId}`} title="Åbn denne" text="Gem åbningstal" icon={DoorOpen} />
          <QuickAction href={`/lukning?locationId=${locationId}`} title="Luk denne" text="Gem lukketal" icon={DoorClosed} />
          <QuickAction href={`/qr/flyt/${locationId}?start=1`} title="Flyt varer" text="Start lagerflyt" icon={Repeat} primary />
          {canSeeStock ? <QuickAction href="#lager" title="Se lager her" text="Vis varer på stedet" icon={PackageSearch} /> : null}
        </section>

        {canSeeStock ? (
        <section id="lager" className="mt-10 rounded-[2rem] border border-line bg-macro p-5 shadow-soft lg:rounded-[1.5rem] lg:p-4">
          <h2 className="mb-4 text-2xl font-bold text-ink">Lager her</h2>
          <div className="space-y-3">
            {stock.map(({ product, balance }) => (
              <article key={product.id} className="flex items-center justify-between gap-4 rounded-3xl bg-soft p-4">
                <h3 className="text-xl font-bold text-ink">{product.name}</h3>
                <p className={`text-3xl font-bold ${balance < 0 ? "text-warmRed" : "text-pantone140"}`}>
                  {balance.toLocaleString("da-DK")}
                  <span className="ml-1 text-base text-muted">{product.unit}</span>
                </p>
              </article>
            ))}
          </div>
        </section>
        ) : null}
        </div>
      </main>
    </AuthGuard>
  );
}

function QuickAction({
  href,
  title,
  text,
  icon: Icon,
  primary = false,
}: {
  href: string;
  title: string;
  text: string;
  icon: typeof DoorOpen;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-28 items-center gap-4 rounded-[1.75rem] p-5 shadow-soft lg:min-h-24 lg:p-4 ${
        primary ? "border border-pantone139 bg-pantone139/80" : "bg-macro"
      }`}
    >
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-pantone140 lg:h-11 lg:w-11 lg:rounded-xl ${primary ? "bg-macro/70" : "bg-pantone139"}`}>
        <Icon className="h-7 w-7 lg:h-5 lg:w-5" aria-hidden />
      </span>
      <span>
        <span className="block text-2xl font-bold text-ink lg:text-xl">{title}</span>
        <span className="mt-1 block text-base font-medium text-muted">{text}</span>
      </span>
    </Link>
  );
}

function StatusPill({ overview }: { overview?: OpeningClosingLocationOverview }) {
  const label = overview?.latestClosing ? "Lukket" : overview?.latestOpening ? "Åben" : "Ukendt";
  const urgent = label === "Ukendt";

  return (
    <span className={`rounded-full px-3 py-1 text-sm font-bold ${urgent ? "bg-warmRed/10 text-warmRed" : "bg-macro text-pantone140"}`}>
      {label}
    </span>
  );
}
