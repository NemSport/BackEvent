"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AuthGuard } from "./auth-guard";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { roleLabels, type BackEventRole } from "@/lib/backevent/permissions";
import { getVisibleMenu, isMenuItemActive, type MenuBadgeKey, type MenuIcon, type MenuItem } from "@/lib/backevent/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const iconMap: Record<MenuIcon, typeof Icons.Home> = {
  home: Icons.Home, move: Icons.Repeat, open: Icons.DoorOpen, close: Icons.DoorClosed, messages: Icons.Bell,
  stock: Icons.PackageSearch, history: Icons.History, return: Icons.RotateCcw, review: Icons.ClipboardCheck,
  test: Icons.RefreshCw, admin: Icons.LayoutDashboard, edit: Icons.PencilLine, limits: Icons.SlidersHorizontal,
  count: Icons.ClipboardCheck, products: Icons.PackagePlus, locations: Icons.MapPin, users: Icons.Users,
  pos: Icons.PlugZap, reports: Icons.BarChart3, qr: Icons.QrCode,
};

export function AppShell({ children, aside, adminOnly = false, requiredRole, requiredPermission }: {
  children: ReactNode; aside?: ReactNode; adminOnly?: boolean; requiredRole?: BackEventRole;
  requiredPermission?: Parameters<typeof AuthGuard>[0]["requiredPermission"];
}) {
  return <AuthGuard adminOnly={adminOnly} requiredRole={requiredRole} requiredPermission={requiredPermission}><ShellChrome aside={aside}>{children}</ShellChrome></AuthGuard>;
}

function ShellChrome({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const { profile } = useBackEventAuth();
  const pathname = usePathname();
  const sections = getVisibleMenu({ role: profile?.role, groupNames: profile?.groupNames });
  const unreadCount = useUnreadPushMessages(profile?.id);
  const returnCounts = useReturnControlCounts(profile?.id);
  const badges: Record<MenuBadgeKey, number> = { messages: unreadCount, returns: returnCounts.openTotal, controls: returnCounts.openReceiptControls };
  const mobilePrimary = sections.flatMap((section) => section.items).filter((entry) => ["/flyt", "/aabning", "/lukning", "/notifikationer", "/retur"].includes(entry.href)).slice(0, 5);

  return <div className="min-h-screen">
    <div className="mx-auto flex w-full max-w-[92rem] gap-4 px-4 py-4 sm:px-6 lg:px-5 lg:py-0">
      <Sidebar sections={sections} pathname={pathname} badges={badges} />
      <main className="min-w-0 flex-1 pb-24 lg:py-5 lg:pb-8">
        <div className="lg:hidden"><UserHeader /><MobileMenu sections={sections} pathname={pathname} badges={badges} /></div>
        {children}
      </main>
      {aside ? <aside className="hidden w-72 shrink-0 xl:block">{aside}</aside> : null}
    </div>
    <nav aria-label="Primær mobilnavigation" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-macro/95 px-2 py-2 shadow-[0_-10px_30px_rgba(31,41,51,0.08)] backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">{mobilePrimary.map((item) => <NavLink key={item.href} item={item} active={isMenuItemActive(item, pathname)} badge={item.badgeKey ? badges[item.badgeKey] : 0} mobile />)}</div>
    </nav>
  </div>;
}

type VisibleSections = ReturnType<typeof getVisibleMenu>;
function Sidebar({ sections, pathname, badges }: { sections: VisibleSections; pathname: string; badges: Record<MenuBadgeKey, number> }) {
  return <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-macro p-3 shadow-soft lg:flex">
    <Link href="/" className="mb-3 block rounded-xl bg-soft px-3 py-2.5"><p className="text-lg font-bold text-pantone140">BackEvent</p><p className="text-[11px] font-medium text-muted">Backend for events</p></Link>
    <nav aria-label="Hovedmenu" className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">{sections.map((section) => {
      const active = section.items.some((entry) => isMenuItemActive(entry, pathname));
      const content = <div className="space-y-0.5">{section.items.map((item) => <NavLink key={item.href} item={item} active={isMenuItemActive(item, pathname)} badge={item.badgeKey ? badges[item.badgeKey] : 0} />)}</div>;
      return section.collapsible ? <details key={section.id} open={active || section.id === "retur"} className="group rounded-xl"><summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pantone139/50">{section.label}<Icons.ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden /></summary>{content}</details> : <section key={section.id}><p className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">{section.label}</p>{content}</section>;
    })}</nav>
    <div className="mt-2 border-t border-line pt-2"><SidebarUserPanel /></div>
  </aside>;
}

function MobileMenu({ sections, pathname, badges }: { sections: VisibleSections; pathname: string; badges: Record<MenuBadgeKey, number> }) {
  return <details className="mb-4 rounded-2xl border border-line bg-macro shadow-sm">
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-bold text-pantone140 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pantone139/50">Hele menuen <Icons.Menu className="h-5 w-5" aria-hidden /></summary>
    <nav aria-label="Mobilmenu" className="max-h-[60vh] space-y-4 overflow-y-auto border-t border-line p-3">{sections.map((section) => <section key={section.id}><p className="mb-1 px-2 text-[11px] font-bold uppercase text-muted">{section.label}</p><div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{section.items.map((item) => <NavLink key={item.href} item={item} active={isMenuItemActive(item, pathname)} badge={item.badgeKey ? badges[item.badgeKey] : 0} />)}</div></section>)}</nav>
  </details>;
}

function NavLink({ item, active, badge = 0, mobile = false }: { item: MenuItem; active: boolean; badge?: number; mobile?: boolean }) {
  const Icon = iconMap[item.icon];
  return <Link href={item.href} aria-current={active ? "page" : undefined} className={mobile
    ? `relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pantone139/50 ${active ? "bg-soft text-pantone140" : "text-muted"}`
    : `flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pantone139/50 ${active ? "bg-soft text-pantone140" : "text-ink hover:bg-soft/70"}`}>
    <Icon className="h-4 w-4 shrink-0 text-pantone139" aria-hidden /><span className={mobile ? "max-w-full truncate" : "min-w-0 flex-1 truncate"}>{item.label}</span><BadgeSlot count={badge} mobile={mobile} />
  </Link>;
}
function BadgeSlot({ count, mobile }: { count: number; mobile?: boolean }) {
  return <span aria-label={count ? `${count} åbne` : undefined} className={`${mobile ? "absolute right-2 top-1" : "ml-auto"} inline-flex h-5 min-w-7 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${count ? "bg-warmRed text-macro" : "invisible"}`}>{count > 99 ? "99+" : count}</span>;
}

function SidebarUserPanel() { const { profile, isMock } = useBackEventAuth(); return <div className="space-y-2"><div className="rounded-xl bg-soft px-3 py-2"><p className="truncate text-xs font-bold text-muted">{isMock ? "Mock mode" : profile?.fullName ?? "Ukendt"}</p><p className="text-sm font-bold text-pantone140">{roleLabels[profile?.role ?? "frivillig"]}</p></div><Link href="/logout" className="flex min-h-9 items-center justify-center gap-2 rounded-lg bg-pantone139 px-3 py-2 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pantone139/50"><Icons.LogOut className="h-4 w-4" aria-hidden />Log ud</Link></div>; }
function UserHeader() { const { profile, isMock } = useBackEventAuth(); return <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-macro px-4 py-3 shadow-sm"><div className="min-w-0"><p className="truncate text-sm font-bold text-muted">{isMock ? "Mock mode" : profile?.fullName ?? "Ukendt"}</p><p className="font-bold text-pantone140">{roleLabels[profile?.role ?? "frivillig"]}</p></div><Link href="/logout" className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-pantone140">Log ud</Link></div>; }

function useUnreadPushMessages(profileId?: string) { const [count,setCount]=useState(0); useEffect(()=>pollCount(profileId,"/api/push/messages?limit=1",data=>Number(data.unreadCount??0),setCount),[profileId]); return count; }
function useReturnControlCounts(profileId?: string) { const [counts,setCounts]=useState({openTotal:0,openReceiptControls:0}); useEffect(()=>pollCount(profileId,"/api/returns/summary",data=>({openTotal:Number(data.openTotal??0),openReceiptControls:Number(data.openReceiptControls??0)}),setCounts),[profileId]); return counts; }
function pollCount<T>(profileId: string|undefined, url: string, select: (data: Record<string,unknown>)=>T, update: (value:T)=>void) { if(!profileId) return; let active=true; const load=async()=>{ const token=await getAccessToken(); const response=await fetch(url,{headers:token?{Authorization:`Bearer ${token}`}:{}}).catch(()=>null); const data=response?await response.json().catch(()=>null):null; if(active&&data?.ok) update(select(data)); }; void load(); const timer=window.setInterval(load,60000); return()=>{active=false;window.clearInterval(timer);}; }
async function getAccessToken(){const supabase=createSupabaseBrowserClient();if(!supabase)return null;const {data:{session}}=await supabase.auth.getSession();return session?.access_token??null;}
