export type BackEventRole = "frivillig" | "ansvarlig" | "ejer";
export type BackEventStoredRole = BackEventRole | "admin" | string | null | undefined;

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
