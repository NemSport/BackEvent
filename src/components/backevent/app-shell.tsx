"use client";

import Link from "next/link";
import {
  BarChart3,
  ClipboardCheck,
  DoorClosed,
  History,
  Home,
  LayoutDashboard,
  LogOut,
  MapPin,
  PackageSearch,
  PackagePlus,
  PencilLine,
  PlugZap,
  QrCode,
  Repeat,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { AuthGuard } from "./auth-guard";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { hasRoleAtLeast, roleLabels, type BackEventRole } from "@/lib/backevent/permissions";

const navItems = [
  { href: "/", label: "Start", icon: Home, minRole: "frivillig" },
  { href: "/admin", label: "Admin-overblik", icon: LayoutDashboard, minRole: "ansvarlig" },
  { href: "/admin/medlemmer", label: "Medlemmer", icon: Users, minRole: "ejer" },
  { href: "/admin/produkter", label: "Produkter", icon: PackagePlus, minRole: "ejer" },
  { href: "/admin/containere", label: "Steder", icon: MapPin, minRole: "ejer" },
  { href: "/admin/rettelser", label: "Ret lager", icon: PencilLine, minRole: "ansvarlig" },
  { href: "/admin/rapport", label: "Rapport", icon: BarChart3, minRole: "ansvarlig" },
  { href: "/admin/qr", label: "QR-koder", icon: QrCode, minRole: "ejer" },
  { href: "/onlinepos/mapping", label: "OnlinePOS", icon: PlugZap, minRole: "ejer" },
  { href: "/flyt", label: "Flyt", icon: Repeat, minRole: "frivillig" },
  { href: "/lagerstatus", label: "Lager", icon: PackageSearch, minRole: "ansvarlig" },
  { href: "/aabning", label: "Åbning", icon: ClipboardCheck, minRole: "frivillig" },
  { href: "/lukning", label: "Lukning", icon: DoorClosed, minRole: "frivillig" },
  { href: "/historik", label: "Historik", icon: History, minRole: "ansvarlig" },
] satisfies Array<{ href: string; label: string; icon: typeof Home; minRole: BackEventRole }>;

const mobileNavHrefs = ["/", "/admin", "/flyt", "/lagerstatus", "/aabning"];

export function AppShell({
  children,
  aside,
  adminOnly = false,
  requiredRole,
}: {
  children: ReactNode;
  aside?: ReactNode;
  adminOnly?: boolean;
  requiredRole?: BackEventRole;
}) {
  return (
    <AuthGuard adminOnly={adminOnly} requiredRole={requiredRole}>
      <ShellChrome aside={aside}>{children}</ShellChrome>
    </AuthGuard>
  );
}

function ShellChrome({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const { profile } = useBackEventAuth();
  const mobileNavItems = navItems.filter((item) => mobileNavHrefs.includes(item.href) && hasRoleAtLeast(profile?.role, item.minRole));

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[92rem] gap-4 px-4 py-4 sm:px-6 lg:px-5 lg:py-0">
        <Sidebar />
        <main className="min-w-0 flex-1 pb-24 lg:py-5 lg:pb-8">
          <div className="lg:hidden">
            <UserHeader />
          </div>
          {children}
        </main>
        {aside ? <aside className="hidden w-72 shrink-0 xl:block">{aside}</aside> : null}
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-macro/95 px-2 py-2 shadow-[0_-10px_30px_rgba(31,41,51,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {mobileNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-bold text-muted"
            >
              <item.icon className="h-5 w-5 text-pantone140" aria-hidden />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function Sidebar() {
  const { profile } = useBackEventAuth();
  const visibleItems = navItems.filter((item) => hasRoleAtLeast(profile?.role, item.minRole));

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-macro p-3 shadow-soft lg:flex xl:w-60">
      <Link href="/" className="mb-3 block rounded-2xl bg-soft p-3">
        <p className="text-xl font-bold text-pantone140">BackEvent</p>
        <p className="mt-1 text-xs font-medium leading-snug text-muted">Backend for events, barer og beholdning</p>
      </Link>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink transition hover:bg-soft"
          >
            <item.icon className="h-4 w-4 shrink-0 text-pantone139" aria-hidden />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-3 border-t border-line pt-3">
        <SidebarUserPanel />
      </div>
    </aside>
  );
}

function SidebarUserPanel() {
  const { profile, isMock } = useBackEventAuth();

  return (
    <div className="space-y-2">
      <div className="rounded-2xl bg-soft px-3 py-2">
        <p className="truncate text-xs font-bold text-muted">{isMock ? "Mock mode" : profile?.fullName ?? "Ukendt"}</p>
        <p className="text-sm font-bold text-pantone140">{roleLabels[profile?.role ?? "frivillig"]}</p>
      </div>
      <Link href="/logout" className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-pantone139 px-3 py-2 text-sm font-bold text-ink">
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
      <Link href="/logout" className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-soft px-4 py-2 text-base font-bold text-pantone140">
        <LogOut className="h-4 w-4" aria-hidden />
        Log ud
      </Link>
    </div>
  );
}
