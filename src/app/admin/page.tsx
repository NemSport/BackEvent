"use client";

import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  History,
  ListChecks,
  PackageSearch,
  PencilLine,
  PlugZap,
  Repeat,
  RotateCcw,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActionCard } from "@/components/backevent/action-card";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { LocationCard } from "@/components/backevent/location-card";
import { MovementList } from "@/components/backevent/movement-list";
import { useBackEventAuth } from "@/lib/backevent/auth";
import {
  getFillPercentageFromTotal,
  getLocationStatus,
  getLocationTotal,
  getLocations,
  getProducts,
  getRecentMovements,
  getStockBalances,
  getStockDiscrepancies,
  isPhysicalStockLocation,
} from "@/lib/backevent/data";
import { isOwnerRole } from "@/lib/backevent/permissions";
import type { Location, Product, StockBalance, StockDiscrepancy, StockMovement } from "@/lib/backevent/types";

const quickActions = [
  { href: "/lagerstatus", title: "Lagerstatus", description: "Aktuel beholdning", icon: PackageSearch, tone: "primary" as const },
  { href: "/admin/rettelser", title: "Ret lager", description: "Rettelser og svind", icon: PencilLine },
  { href: "/admin/lagergraenser", title: "Lagergrænser", description: "Lav og kritisk", icon: SlidersHorizontal },
  { href: "/flyt", title: "Flyt varer", description: "Mellem containere", icon: Repeat },
];

const ownerLinks = [
  { href: "/admin/setup", title: "Setup", description: "Klargøring", icon: Settings },
  { href: "/admin/produkter", title: "Produkter", description: "Varer og grænser", icon: PackageSearch },
  { href: "/admin/containere", title: "Steder", description: "Containere og barer", icon: PackageSearch },
  { href: "/admin/driftstjek", title: "Driftstjek", description: "Systemstatus", icon: ListChecks },
];

export default function AdminDashboardPage() {
  const { profile } = useBackEventAuth();
  const isOwner = isOwnerRole(profile?.role);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [discrepancies, setDiscrepancies] = useState<StockDiscrepancy[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const lowStockItems = useMemo(() => getLowStockItems(products, balances, locations), [balances, locations, products]);
  const criticalCount = lowStockItems.filter((item) => item.severity === "critical").length;
  const warningCount = lowStockItems.length + discrepancies.length;

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts, loadedBalances, loadedMovements, loadedDiscrepancies] = await Promise.all([
          getLocations(),
          getProducts(),
          getStockBalances(),
          getRecentMovements(),
          getStockDiscrepancies(),
        ]);

        if (!mounted) {
          return;
        }

        setLocations(loadedLocations.filter(isPhysicalStockLocation));
        setProducts(loadedProducts);
        setBalances(loadedBalances);
        setMovements(loadedMovements);
        setDiscrepancies(loadedDiscrepancies);
      } catch {
        if (mounted) {
          setMessage("Vi kunne ikke hente admin-overblikket lige nu. Prøv igen om lidt.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <AppShell requiredRole="ansvarlig" aside={<DashboardAside lowStockItems={lowStockItems} discrepancyCount={discrepancies.length} movements={movements.length} />}>
      <Header title="Admin-overblik" subtitle="Samlet status for containere, barer og beholdning" />

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-sm font-bold text-warmRed">{message}</p> : null}

      {warningCount > 0 ? (
        <section className="mb-6 rounded-2xl border border-warmRed/25 bg-warmRed/10 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-macro text-warmRed">
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink">Kræver handling</h2>
              <p className="mt-1 text-sm font-bold text-warmRed">
                {criticalCount > 0 ? `${criticalCount} kritiske beholdninger` : `${warningCount} punkter kræver tjek`}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="space-y-8">
        <section>
          <SectionHeader title="Hurtige handlinger" description="De mest brugte opgaver under drift." />
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {quickActions.map((card) => (
              <ActionCard key={card.href} {...card} />
            ))}
          </div>
        </section>

        <section>
          <SectionHeader title="Lagerstatus" description="Fysiske lagersteder lige nu." />
          <div className="grid gap-3 xl:grid-cols-2">
            {locations.map((location) => {
              const total = getLocationTotal(location.id, balances);
              return (
                <LocationCard
                  key={location.id}
                  location={location}
                  href="/lagerstatus"
                  total={total}
                  status={getLocationStatus(location.id, products, balances)}
                  fill={getFillPercentageFromTotal(total)}
                />
              );
            })}
          </div>
        </section>

        <section>
          <SectionHeader title="Seneste aktivitet" description="Nyeste lagerbevægelser." />
          <MovementList movements={movements.slice(0, 5)} locations={locations} products={products} />
        </section>

        <section>
          <SectionHeader title="Kontrol og rapporter" description="Overblik uden at fylde forsiden." />
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <ActionCard href="/admin/rapport" title="Rapport" description="Forbrug og afvigelser" icon={BarChart3} />
            <ActionCard href="/historik" title="Historik" description="Handlinger og rettelser" icon={History} />
            <ActionCard href="/retur" title="Retur" description="Kontrol af OnlinePOS-retur" icon={RotateCcw} />
            {isOwner
              ? ownerLinks.slice(0, 1).map((card) => <ActionCard key={card.href} {...card} />)
              : null}
            {isOwner ? <ActionCard href="/admin/onlinepos-sync" title="OnlinePOS-sync" description="Salg til lager" icon={PlugZap} /> : null}
          </div>
        </section>

        {isOwner ? (
          <section>
            <SectionHeader title="Ejer" description="Sjældnere opsætning og kontrol." />
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {ownerLinks.slice(2).map((card) => (
                <ActionCard key={card.href} {...card} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      <p className="mt-0.5 text-sm font-medium text-muted">{description}</p>
    </div>
  );
}

function DashboardAside({
  lowStockItems,
  discrepancyCount,
  movements,
}: {
  lowStockItems: Array<{ productName: string; locationName: string; severity: "low" | "critical" }>;
  discrepancyCount: number;
  movements: number;
}) {
  return (
    <div className="sticky top-5 space-y-3">
      <AsideCard title="Lavt lager" icon={PackageSearch} urgent={lowStockItems.length > 0}>
        <p>{lowStockItems.length > 0 ? `${lowStockItems.slice(0, 3).map((item) => item.productName).join(", ")} kræver opmærksomhed.` : "Ingen kritiske varer lige nu."}</p>
      </AsideCard>
      <AsideCard title="Afvigelser" icon={AlertTriangle} urgent={discrepancyCount > 0}>
        <p>{discrepancyCount > 0 ? `${discrepancyCount} linjer kræver tjek.` : "Ingen afvigelser lige nu."}</p>
      </AsideCard>
      <AsideCard title="Aktivitet" icon={Repeat}>
        <p>{movements > 0 ? `${movements} flytninger i historikken.` : "Ingen flytninger endnu."}</p>
      </AsideCard>
    </div>
  );
}

function AsideCard({
  title,
  icon: Icon,
  children,
  urgent = false,
}: {
  title: string;
  icon: typeof ClipboardCheck;
  children: React.ReactNode;
  urgent?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-line bg-macro p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${urgent ? "bg-warmRed/10 text-warmRed" : "bg-pantone139/30 text-pantone140"}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="text-base font-bold text-ink">{title}</h2>
      </div>
      <div className="text-sm font-medium text-muted">{children}</div>
    </article>
  );
}

type LowStockItem = { productName: string; locationName: string; severity: "low" | "critical" };

function getLowStockItems(products: Product[], balances: StockBalance[], locations: Location[]): LowStockItem[] {
  return balances
    .map((balance) => {
      const product = products.find((item) => item.id === balance.productId);
      const location = locations.find((item) => item.id === balance.locationId);

      if (!product || !location || balance.quantity > product.lowThreshold) {
        return null;
      }

      return {
        productName: product.name,
        locationName: location.name,
        severity: balance.quantity <= product.criticalThreshold || balance.quantity < 0 ? ("critical" as const) : ("low" as const),
      };
    })
    .filter((item): item is LowStockItem => item !== null);
}
