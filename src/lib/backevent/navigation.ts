import type { BackEventRole } from "./permissions";

export type MenuIcon = "home" | "move" | "open" | "close" | "messages" | "stock" | "history" | "return" | "review" | "test" | "admin" | "edit" | "limits" | "count" | "products" | "locations" | "users" | "pos" | "reports" | "qr";
export type MenuBadgeKey = "messages" | "returns" | "controls";
export type MenuAudience = { minimumRole?: BackEventRole; groups?: string[]; ownerOnly?: boolean };
export type MenuItem = {
  href: string; label: string; icon: MenuIcon; audience: MenuAudience; badgeKey?: MenuBadgeKey;
  visibility: "all" | "desktop" | "mobile"; order: number; match?: "exact" | "prefix";
};
export type MenuSection = { id: "drift" | "retur" | "administration"; label: string; order: number; collapsible: boolean; items: MenuItem[] };

export const financeGroupName = "Økonomiansvarlige";

export const menuSections: MenuSection[] = [
  { id: "drift", label: "Drift", order: 10, collapsible: false, items: [
    item("/", "Start", "home", 10, {} , undefined, "exact"),
    item("/flyt", "Flyt", "move", 20, {}), item("/aabning", "Åbning", "open", 30, {}), item("/lukning", "Lukning", "close", 40, {}),
    item("/notifikationer", "Beskeder", "messages", 50, {}, "messages"),
    item("/lagerstatus", "Lager", "stock", 60, { minimumRole: "ansvarlig" }), item("/historik", "Historik", "history", 70, { minimumRole: "ansvarlig" }),
  ]},
  { id: "retur", label: "Retur", order: 20, collapsible: true, items: [
    item("/retur", "Overblik", "return", 10, { minimumRole: "ansvarlig", groups: [financeGroupName] }, "returns", "exact"),
    item("/retur/afventer", "Afventer behandling", "review", 20, { minimumRole: "ansvarlig", groups: [financeGroupName] }),
    item("/retur/kontrol", "Kontrol", "review", 30, { minimumRole: "ansvarlig", groups: [financeGroupName] }, "controls"),
    item("/retur/historik", "Historik", "history", 40, { minimumRole: "ansvarlig", groups: [financeGroupName] }),
    item("/admin/onlinepos-replay", "Test og simulation", "test", 50, { ownerOnly: true }),
  ]},
  { id: "administration", label: "Administration", order: 30, collapsible: true, items: [
    item("/admin", "Overblik", "admin", 10, { minimumRole: "ansvarlig" }, undefined, "exact"),
    item("/admin/rettelser", "Ret lager", "edit", 20, { minimumRole: "ansvarlig" }), item("/admin/lagergraenser", "Lagergrænser", "limits", 30, { minimumRole: "ansvarlig" }),
    item("/admin/aabning-lukning", "Tællinger", "count", 40, { minimumRole: "ansvarlig" }), item("/admin/produkter", "Produkter", "products", 50, { ownerOnly: true }),
    item("/admin/containere", "Lokationer", "locations", 60, { ownerOnly: true }), item("/admin/medlemmer", "Brugere og roller", "users", 70, { ownerOnly: true }),
    item("/onlinepos/mapping", "OnlinePOS · Produkter", "pos", 80, { ownerOnly: true }), item("/admin/onlinepos/lokationer", "OnlinePOS · Lokationer", "locations", 90, { ownerOnly: true }),
    item("/admin/onlinepos-sync", "OnlinePOS · Sync", "test", 100, { ownerOnly: true }), item("/admin/rapport", "Rapporter", "reports", 110, { minimumRole: "ansvarlig" }),
    item("/admin/qr", "QR-koder", "qr", 120, { ownerOnly: true }),
  ]},
];

function item(href: string, label: string, icon: MenuIcon, order: number, audience: MenuAudience, badgeKey?: MenuBadgeKey, match: "exact" | "prefix" = "prefix"): MenuItem {
  return { href, label, icon, order, audience, badgeKey, match, visibility: "all" };
}

export type MenuIdentity = { role?: BackEventRole | null; groupNames?: string[] | null };
export function canSeeMenuItem(item: MenuItem, identity: MenuIdentity) {
  const role = identity.role ?? "frivillig";
  if (item.audience.ownerOnly) return role === "ejer";
  if (item.audience.groups?.some((group) => identity.groupNames?.some((name) => normalize(name) === normalize(group)))) return true;
  const rank = { frivillig: 1, ansvarlig: 2, ejer: 3 } as const;
  return rank[role] >= rank[item.audience.minimumRole ?? "frivillig"];
}
export function getVisibleMenu(identity: MenuIdentity) {
  return menuSections.map((section) => ({ ...section, items: section.items.filter((entry) => canSeeMenuItem(entry, identity)).sort((a,b) => a.order-b.order) })).filter((section) => section.items.length).sort((a,b) => a.order-b.order);
}
export function isMenuItemActive(item: MenuItem, pathname: string) {
  return item.match === "exact" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
const normalize = (value: string) => value.trim().toLocaleLowerCase("da-DK");
