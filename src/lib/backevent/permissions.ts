export type BackEventRole = "frivillig" | "ansvarlig" | "ejer";
export type BackEventStoredRole = BackEventRole | "admin" | string | null | undefined;
export type BackEventPermissionKey =
  | "opening"
  | "closing"
  | "move_stock"
  | "view_stock"
  | "adjust_stock"
  | "view_history"
  | "view_reports"
  | "manage_thresholds"
  | "send_notifications"
  | "manage_members"
  | "manage_onlinepos"
  | "manage_settings";

export const permissionLabels: Record<BackEventPermissionKey, string> = {
  opening: "Åbne",
  closing: "Lukke",
  move_stock: "Flytte varer",
  view_stock: "Se lager",
  adjust_stock: "Rette lager",
  view_history: "Se historik",
  view_reports: "Se rapporter",
  manage_thresholds: "Styre lagergrænser",
  send_notifications: "Sende notifikationer",
  manage_members: "Administrere medlemmer",
  manage_onlinepos: "Administrere OnlinePOS",
  manage_settings: "Administrere systemopsætning",
};

export const allPermissions = Object.keys(permissionLabels) as BackEventPermissionKey[];

export const roleDefaultPermissions: Record<BackEventRole, BackEventPermissionKey[]> = {
  frivillig: ["opening", "closing", "move_stock"],
  ansvarlig: ["opening", "closing", "move_stock", "view_stock", "adjust_stock", "view_history", "view_reports", "manage_thresholds", "send_notifications"],
  ejer: allPermissions,
};

const roleRank: Record<BackEventRole, number> = {
  frivillig: 1,
  ansvarlig: 2,
  ejer: 3,
};

export const roleLabels: Record<BackEventRole, string> = {
  frivillig: "Frivillig",
  ansvarlig: "Ansvarlig",
  ejer: "Ejer",
};

export function normalizeRole(role: BackEventStoredRole): BackEventRole {
  if (role === "admin" || role === "ejer") {
    return "ejer";
  }

  if (role === "ansvarlig") {
    return "ansvarlig";
  }

  return "frivillig";
}

export function hasRoleAtLeast(role: BackEventStoredRole, minimumRole: BackEventRole) {
  return roleRank[normalizeRole(role)] >= roleRank[minimumRole];
}

export function isOwnerRole(role: BackEventStoredRole) {
  return normalizeRole(role) === "ejer";
}

export function isResponsibleRole(role: BackEventStoredRole) {
  return hasRoleAtLeast(role, "ansvarlig");
}

export function permissionsForRole(role: BackEventStoredRole) {
  return roleDefaultPermissions[normalizeRole(role)];
}

export function hasPermission(role: BackEventStoredRole, assignedPermissions: string[] | null | undefined, permission: BackEventPermissionKey) {
  if (isOwnerRole(role)) {
    return true;
  }

  return new Set([...(assignedPermissions ?? []), ...permissionsForRole(role)]).has(permission);
}
