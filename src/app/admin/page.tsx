"use client";

import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  Download,
  ListChecks,
  Mail,
  PackageSearch,
  PackagePlus,
  PencilLine,
  PlugZap,
  QrCode,
  RefreshCw,
  Repeat,
  Settings,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ActionCard } from "@/components/backevent/action-card";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { LocationCard } from "@/components/backevent/location-card";
import { MovementList } from "@/components/backevent/movement-list";
import { NotificationSettingsCard } from "@/components/backevent/notification-settings-card";
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

const setupCards = [
  { href: "/admin/setup", title: "Setup", description: "Kontrol før markedet", icon: Settings },
  { href: "/admin/medlemmer", title: "Medlemmer", description: "Roller og adgang", icon: Users },
  { href: "/admin/emails", title: "Emails", description: "Beskeder og lageralarmer", icon: Mail },
  { href: "/admin/produkter", title: "Produkter", description: "Varer og OnlinePOS-mapping", icon: PackagePlus },
  { href: "/admin/containere", title: "Steder", description: "Containere og barer", icon: PackageSearch },
  { href: "/admin/qr", title: "QR-koder", description: "Direkte links til steder", icon: QrCode },
];

const driftCards = [
  { href: "/admin/aabning-lukning", title: "Åbning/lukning", description: "Se status på optællinger", icon: ClipboardCheck },
  { href: "/admin/rettelser", title: "Ret lager", description: "Rettelser og svind", icon: PencilLine },
  { href: "/flyt", title: "Flyt varer", description: "Flyt mellem steder", icon: Repeat },
  { href: "/lagerstatus", title: "Lagerstatus", description: "Aktuel beholdning", icon: PackageSearch },
];

function controlCards(discrepancyCount: number) {
  return [
    { href: "/admin/driftstjek", title: "Driftstjek", description: "Se om systemet er klar", icon: ListChecks, ownerOnly: true },
    { href: "/admin/rapport", title: "Afvigelser", description: `${discrepancyCount} kræver tjek`, icon: AlertTriangle, ownerOnly: false },
    { href: "/admin/rapport", title: "Forbrugsrapport", description: "Forbrug pr. sted og vare", icon: BarChart3, ownerOnly: false },
    { href: "/onlinepos/mapping", title: "OnlinePOS mapping", description: "Godkend lagerpåvirkning", icon: PlugZap, ownerOnly: true },
    { href: "/admin/onlinepos-test", title: "OnlinePOS test", description: "Mock salg og mapping", icon: PlugZap, ownerOnly: true },
    { href: "/admin/onlinepos-probe", title: "OnlinePOS probe", description: "Læs rigtig API read-only", icon: RefreshCw, ownerOnly: true },
    { href: "/admin/eksport", title: "Eksport", description: "CSV og backup", icon: Download, ownerOnly: true },
  ];
}

export default function AdminDashboardPage() {
  const { profile } = useBackEventAuth();
  const isOwner = isOwnerRole(profile?.role);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [discrepancies, setDiscrepancies] = useState<StockDiscrepancy[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const lowStockText = getLowStockText(products, balances);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedProducts, loadedBalances, loadedMovements, loadedDiscrepancies] =
          await Promise.all([
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
    <AppShell requiredRole="ansvarlig" aside={<DashboardAside lowStockText={lowStockText} discrepancyCount={discrepancies.length} movements={movements.length} />}>
      <Header title="Admin-overblik" subtitle="Samlet status for containere, barer og beholdning" />

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{message}</p> : null}

      <div className="space-y-10">
        <NotificationSettingsCard />

        {isOwner ? (
          <CardSection title="Opsætning" description="Ejer kan klargøre produkter, steder, adgang og QR-koder.">
            {setupCards.map((card) => (
              <ActionCard key={card.href} {...card} />
            ))}
          </CardSection>
        ) : null}

        <CardSection title="Drift" description="Daglige lageropgaver under markedet.">
          {driftCards.map((card) => (
            <ActionCard key={card.href} {...card} />
          ))}
        </CardSection>

        <CardSection title="Kontrol" description="Tjek og rapporter.">
          {controlCards(discrepancies.length)
            .filter((card) => isOwner || !card.ownerOnly)
            .map((card) => (
              <ActionCard key={`${card.href}-${card.title}`} {...card} />
            ))}
        </CardSection>

        <section>
          <div className="mb-5">
            <h2 className="text-2xl font-bold text-ink">Status lige nu</h2>
            <p className="mt-1 text-base font-medium text-muted">Lagerstyring for containere og barer</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
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
          <h2 className="mb-5 text-2xl font-bold text-ink">Seneste flytninger</h2>
          <MovementList movements={movements} locations={locations} products={products} />
        </section>
      </div>
    </AppShell>
  );
}

function CardSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-ink">{title}</h2>
        <p className="mt-1 text-base font-medium text-muted">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">{children}</div>
    </section>
  );
}

function DashboardAside({ lowStockText, discrepancyCount, movements }: { lowStockText: string; discrepancyCount: number; movements: number }) {
  return (
    <div className="sticky top-5 space-y-3">
      <AsideCard title="Afvigelser" icon={AlertTriangle} urgent={discrepancyCount > 0}>
        <p>{discrepancyCount > 0 ? `${discrepancyCount} linjer kræver tjek.` : "Ingen afvigelser lige nu."}</p>
      </AsideCard>
      <AsideCard title="Lavt lager" icon={PackageSearch} urgent={lowStockText !== "Ingen kritiske varer lige nu."}>
        <p>{lowStockText}</p>
      </AsideCard>
      <AsideCard title="Seneste flytninger" icon={Repeat}>
        <p>{movements > 0 ? `${movements} flytninger i historikken.` : "Ingen flytninger endnu."}</p>
      </AsideCard>
      <AsideCard title="Tjekliste" icon={ListChecks}>
        <ul className="space-y-2 font-medium text-muted">
          <li>Kontroller åbning/lukning</li>
          <li>Hold øje med lavt lager</li>
          <li>Eksporter backup ved behov</li>
        </ul>
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
    <article className="rounded-[1.5rem] border border-line bg-macro p-4 shadow-soft">
      <div className="mb-2 flex items-center gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            urgent ? "bg-warmRed/10 text-warmRed" : "bg-pantone139/30 text-pantone140"
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="text-lg font-bold text-ink">{title}</h2>
      </div>
      <div className="text-sm font-medium text-muted">{children}</div>
    </article>
  );
}

function getLowStockText(products: Product[], balances: StockBalance[]) {
  const lowProducts = balances
    .map((balance) => {
      const product = products.find((item) => item.id === balance.productId);
      return product && balance.quantity <= product.lowThreshold ? product.name : null;
    })
    .filter(Boolean);

  const uniqueLowProducts = Array.from(new Set(lowProducts));

  if (uniqueLowProducts.length === 0) {
    return "Ingen kritiske varer lige nu.";
  }

  return `${uniqueLowProducts.slice(0, 3).join(", ")} kræver opmærksomhed.`;
}
