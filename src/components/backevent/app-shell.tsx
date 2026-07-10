"use client";

import Link from "next/link";
import {
  BarChart3,
  Bell,
  ClipboardCheck,
  DoorClosed,
  DoorOpen,
  History,
  Home,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  PackageSearch,
  PackagePlus,
  PencilLine,
  PlugZap,
  QrCode,
  Repeat,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AuthGuard } from "./auth-guard";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { hasRoleAtLeast, roleLabels, type BackEventRole } from "@/lib/backevent/permissions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type NavItem = { href: string; label: string; icon: typeof Home; minRole: BackEventRole };
type NavSection = { title: string; items: NavItem[] };

const navSections = [
  {
    title: "Drift",
    items: [
      { href: "/", label: "Start", icon: Home, minRole: "frivillig" },
      { href: "/flyt", label: "Flyt", icon: Repeat, minRole: "frivillig" },
      { href: "/aabning", label: "Åbning", icon: DoorOpen, minRole: "frivillig" },
      { href: "/lukning", label: "Lukning", icon: DoorClosed, minRole: "frivillig" },
      { href: "/notifikationer", label: "Beskeder", icon: Bell, minRole: "frivillig" },
      { href: "/lagerstatus", label: "Lager", icon: PackageSearch, minRole: "ansvarlig" },
      { href: "/historik", label: "Historik", icon: History, minRole: "ansvarlig" },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin", label: "Admin", icon: LayoutDashboard, minRole: "ansvarlig" },
      { href: "/admin/rettelser", label: "Ret lager", icon: PencilLine, minRole: "ansvarlig" },
      { href: "/admin/lagergraenser", label: "Grænser", icon: SlidersHorizontal, minRole: "ansvarlig" },
      { href: "/admin/aabning-lukning", label: "Tællinger", icon: ClipboardCheck, minRole: "ansvarlig" },
      { href: "/admin/produkter", label: "Produkter", icon: PackagePlus, minRole: "ejer" },
      { href: "/admin/containere", label: "Steder", icon: MapPin, minRole: "ejer" },
      { href: "/admin/medlemmer", label: "Medlemmer", icon: Users, minRole: "ejer" },
      { href: "/admin/notifikationer", label: "Notifikationer", icon: Bell, minRole: "ansvarlig" },
      { href: "/admin/emails", label: "Emails", icon: Mail, minRole: "ejer" },
    ],
  },
  {
    title: "Kontrol og rapporter",
    items: [
      { href: "/admin/rapport", label: "Rapport", icon: BarChart3, minRole: "ansvarlig" },
      { href: "/admin/driftstjek", label: "Driftstjek", icon: Settings, minRole: "ejer" },
      { href: "/admin/qr", label: "QR", icon: QrCode, minRole: "ejer" },
      { href: "/onlinepos/mapping", label: "OnlinePOS", icon: PlugZap, minRole: "ejer" },
      { href: "/admin/eksport", label: "Eksport", icon: PackageSearch, minRole: "ejer" },
    ],
  },
] satisfies NavSection[];

export function AppShell({
  children,
  aside,
  adminOnly = false,
  requiredRole,
  requiredPermission,
}: {
  children: ReactNode;
  aside?: ReactNode;
  adminOnly?: boolean;
  requiredRole?: BackEventRole;
  requiredPermission?: Parameters<typeof AuthGuard>[0]["requiredPermission"];
}) {
  return (
    <AuthGuard adminOnly={adminOnly} requiredRole={requiredRole} requiredPermission={requiredPermission}>
      <ShellChrome aside={aside}>{children}</ShellChrome>
    </AuthGuard>
  );
}

function ShellChrome({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const { profile } = useBackEventAuth();
  const mobileNavItems = getMobileNavItems(profile?.role);
  const unreadCount = useUnreadPushMessages(profile?.id);

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[92rem] gap-4 px-4 py-4 sm:px-6 lg:px-5 lg:py-0">
        <Sidebar unreadCount={unreadCount} />
        <main className="min-w-0 flex-1 pb-24 lg:py-5 lg:pb-8">
          <div className="lg:hidden">
            <UserHeader />
            <MobileAdminMenu />
          </div>
          {children}
        </main>
        {aside ? <aside className="hidden w-72 shrink-0 xl:block">{aside}</aside> : null}
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-macro/95 px-2 py-2 shadow-[0_-10px_30px_rgba(31,41,51,0.08)] backdrop-blur lg:hidden">
        <div className={`mx-auto grid max-w-md gap-1 ${mobileNavItems.length <= 3 ? "grid-cols-3" : mobileNavItems.length === 4 ? "grid-cols-4" : "grid-cols-5"}`}>
          {mobileNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-bold text-muted"
            >
              <item.icon className="h-5 w-5 text-pantone140" aria-hidden />
              {item.href === "/notifikationer" && unreadCount > 0 ? (
                <span className="absolute right-3 top-1 rounded-full bg-warmRed px-1.5 py-0.5 text-[10px] font-bold leading-none text-macro">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

function MobileAdminMenu() {
  const { profile } = useBackEventAuth();
  const adminSections = navSections
    .filter((section) => section.title !== "Drift")
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasRoleAtLeast(profile?.role, item.minRole)),
    }))
    .filter((section) => section.items.length > 0);

  if (!hasRoleAtLeast(profile?.role, "ansvarlig") || adminSections.length === 0) {
    return null;
  }

  return (
    <section className="mb-4 rounded-2xl border border-line bg-macro p-3 shadow-sm">
      <h2 className="mb-2 text-sm font-bold text-ink">Administration</h2>
      <div className="space-y-3">
        {adminSections.map((section) => (
          <div key={section.title}>
            <p className="mb-1 text-[11px] font-bold uppercase text-muted">{section.title}</p>
            <div className="grid grid-cols-2 gap-2">
              {section.items.map((item) => (
                <Link key={item.href} href={item.href} className="flex min-h-11 items-center gap-2 rounded-xl bg-soft px-3 text-sm font-bold text-pantone140">
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Sidebar({ unreadCount = 0 }: { unreadCount?: number }) {
  const { profile } = useBackEventAuth();
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasRoleAtLeast(profile?.role, item.minRole)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-line bg-macro p-2.5 shadow-soft lg:flex xl:w-56">
      <Link href="/" className="mb-2 block rounded-xl bg-soft px-3 py-2.5">
        <p className="text-lg font-bold text-pantone140">BackEvent</p>
        <p className="mt-0.5 text-[11px] font-medium leading-snug text-muted">Backend for events</p>
      </Link>
      <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {visibleSections.map((section) => (
          <section key={section.title}>
            <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-muted">{section.title}</p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-h-8 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-bold text-ink transition hover:bg-soft focus:outline-none focus:ring-2 focus:ring-pantone139/50 ${
                    section.title === "Drift" ? "bg-soft/60" : ""
                  }`}
                >
                  <item.icon className={`h-4 w-4 shrink-0 ${section.title === "Drift" ? "text-pantone140" : "text-pantone139"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.href === "/notifikationer" && unreadCount > 0 ? (
                    <span className="rounded-full bg-warmRed px-1.5 py-0.5 text-[10px] font-bold leading-none text-macro">{unreadCount > 9 ? "9+" : unreadCount}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </nav>
      <div className="mt-2 border-t border-line pt-2">
        <SidebarUserPanel />
      </div>
    </aside>
  );
}

function SidebarUserPanel() {
  const { profile, isMock } = useBackEventAuth();

  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-soft px-3 py-2">
        <p className="truncate text-xs font-bold text-muted">{isMock ? "Mock mode" : profile?.fullName ?? "Ukendt"}</p>
        <p className="text-sm font-bold text-pantone140">{roleLabels[profile?.role ?? "frivillig"]}</p>
      </div>
      <Link href="/logout" className="flex min-h-9 items-center justify-center gap-2 rounded-lg bg-pantone139 px-3 py-2 text-sm font-bold text-ink">
        <LogOut className="h-4 w-4" aria-hidden />
        Log ud
      </Link>
    </div>
  );
}

function UserHeader() {
  const { profile, isMock } = useBackEventAuth();

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-macro px-4 py-3 shadow-sm">
      <div>
        <p className="text-sm font-bold text-muted">{isMock ? "Mock mode" : profile?.fullName ?? "Ukendt"}</p>
        <p className="text-base font-bold text-pantone140">{roleLabels[profile?.role ?? "frivillig"]}</p>
      </div>
      <Link href="/logout" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-soft px-4 py-2 text-sm font-bold text-pantone140">
        <LogOut className="h-4 w-4" aria-hidden />
        Log ud
      </Link>
    </div>
  );
}

function getMobileNavItems(role: BackEventRole | undefined) {
  const driftItems = navSections[0].items;

  if (!hasRoleAtLeast(role, "ansvarlig")) {
    return driftItems.filter((item) => ["/flyt", "/aabning", "/lukning", "/notifikationer"].includes(item.href));
  }

  return [...driftItems.filter((item) => ["/flyt", "/lagerstatus", "/historik", "/notifikationer"].includes(item.href)), navSections[1].items[0]].filter((item) =>
    hasRoleAtLeast(role, item.minRole),
  );
}

function useUnreadPushMessages(profileId: string | undefined) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!profileId) {
      return;
    }

    let mounted = true;

    async function loadUnreadCount() {
      const token = await getAccessToken();
      const response = await fetch("/api/push/messages?limit=1", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }).catch(() => null);
      const data = response ? ((await response.json().catch(() => null)) as { ok?: boolean; unreadCount?: number } | null) : null;

      if (mounted && data?.ok) {
        setUnreadCount(data.unreadCount ?? 0);
      }
    }

    void loadUnreadCount();
    const interval = window.setInterval(() => {
      void loadUnreadCount();
    }, 60000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [profileId]);

  return profileId ? unreadCount : 0;
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
