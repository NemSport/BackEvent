import type { SupabaseClient } from "@supabase/supabase-js";

export type OnlinePosLocationMapping = {
  id: string;
  venueId: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string;
  normalizedCashRegisterName: string;
  backeventLocationId: string;
  active: boolean;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BackEventLocationForMapping = {
  id: string;
  name: string;
  type: string | null;
  source_location_id: string | null;
  active: boolean | null;
};

export type OnlinePosCashRegisterRef = {
  venueId?: string | null;
  cashRegisterId?: string | null;
  cashRegisterName?: string | null;
};

export type OnlinePosLocationResolution =
  | {
      ok: true;
      mapping: OnlinePosLocationMapping;
      location: BackEventLocationForMapping;
      matchedBy: "cash_register_id" | "name";
    }
  | {
      ok: false;
      mapping: null;
      location: null;
      matchedBy: null;
      errorCode: "ONLINEPOS_LOCATION_UNMAPPED" | "ONLINEPOS_LOCATION_MAPPING_INACTIVE" | "BACKEVENT_LOCATION_UNKNOWN";
      errorReason: string;
    };

export type OnlinePosLocationMappingSuggestion = {
  label: string;
  locationNameHint: "Blå" | "Grøn" | "Rød" | "Pub" | "Street";
};

export function normalizeOnlinePosCashRegisterName(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("da-DK").replace(/[^a-z0-9æøå]+/g, "-").replace(/^-|-$/g, "") || null;
}

export function normalizeOnlinePosCashRegisterId(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || null;
}

export function getLocationMappingSuggestion(cashRegisterName: string | null | undefined): OnlinePosLocationMappingSuggestion | null {
  const normalized = normalizeOnlinePosCashRegisterName(cashRegisterName);
  const lowerName = cashRegisterName?.trim().toLocaleLowerCase("da-DK") ?? "";
  if (!normalized) return null;
  if (normalized.includes("bla-bar") || normalized.includes("blaa-bar") || lowerName.includes("blå bar")) {
    return { label: "Forslag: Blå bar → Blå", locationNameHint: "Blå" };
  }
  if (normalized.includes("gron-bar") || normalized.includes("groen-bar") || lowerName.includes("grøn bar")) {
    return { label: "Forslag: Grøn Bar → Grøn", locationNameHint: "Grøn" };
  }
  if (normalized.includes("rod-bar") || normalized.includes("roed-bar") || lowerName.includes("rød bar")) {
    return { label: "Forslag: Rød Bar → Rød", locationNameHint: "Rød" };
  }
  if (normalized === "pubben" || normalized.includes("pubben")) {
    return { label: "Forslag: Pubben → Pub", locationNameHint: "Pub" };
  }
  if (normalized === "street" || normalized.includes("street")) {
    return { label: "Forslag: Street → Street", locationNameHint: "Street" };
  }
  return null;
}

export function findSuggestedBackEventLocationId(
  cashRegisterName: string | null | undefined,
  locations: BackEventLocationForMapping[],
) {
  const suggestion = getLocationMappingSuggestion(cashRegisterName);
  if (!suggestion) return null;
  const hint = suggestion.locationNameHint.toLocaleLowerCase("da-DK");
  return locations.find((location) => location.name.toLocaleLowerCase("da-DK").includes(hint))?.id ?? null;
}

export function resolveOnlinePosLocation(
  input: OnlinePosCashRegisterRef,
  mappings: OnlinePosLocationMapping[],
  locations: BackEventLocationForMapping[],
): OnlinePosLocationResolution {
  const venueId = normalizeVenue(input.venueId);
  const cashRegisterId = normalizeOnlinePosCashRegisterId(input.cashRegisterId);
  const normalizedName = normalizeOnlinePosCashRegisterName(input.cashRegisterName);
  const activeMappings = mappings.filter((mapping) => mapping.active && sameVenue(mapping.venueId, venueId));
  const inactiveMappings = mappings.filter((mapping) => !mapping.active && sameVenue(mapping.venueId, venueId));

  if (cashRegisterId) {
    const mapping = activeMappings.find((item) => normalizeOnlinePosCashRegisterId(item.cashRegisterId) === cashRegisterId);
    if (mapping) return resolveMappedLocation(mapping, locations, "cash_register_id");
    const inactive = inactiveMappings.find((item) => normalizeOnlinePosCashRegisterId(item.cashRegisterId) === cashRegisterId);
    if (inactive) return inactiveResolution();
    return unmappedResolution();
  }

  if (normalizedName) {
    const mapping = activeMappings.find((item) => item.normalizedCashRegisterName === normalizedName);
    if (mapping) return resolveMappedLocation(mapping, locations, "name");
    const inactive = inactiveMappings.find((item) => item.normalizedCashRegisterName === normalizedName);
    if (inactive) return inactiveResolution();
  }

  return unmappedResolution();
}

export async function getOnlinePosLocationMappings(supabase: SupabaseClient): Promise<OnlinePosLocationMapping[]> {
  const { data, error } = await supabase
    .from("backevent_onlinepos_location_mappings")
    .select("id,onlinepos_venue_id,onlinepos_cash_register_id,onlinepos_cash_register_name,normalized_cash_register_name,backevent_location_id,active,first_seen_at,last_seen_at,created_at,updated_at")
    .order("onlinepos_cash_register_name", { ascending: true });

  if (error) {
    throw new Error("OnlinePOS-lokationsmappinger kunne ikke hentes");
  }

  return (data ?? []).map(toOnlinePosLocationMapping);
}

export function toOnlinePosLocationMapping(row: Record<string, unknown>): OnlinePosLocationMapping {
  return {
    id: String(row.id),
    venueId: stringOrNull(row.onlinepos_venue_id),
    cashRegisterId: stringOrNull(row.onlinepos_cash_register_id),
    cashRegisterName: stringOrNull(row.onlinepos_cash_register_name) ?? "Ukendt kasse",
    normalizedCashRegisterName: stringOrNull(row.normalized_cash_register_name) ?? "",
    backeventLocationId: String(row.backevent_location_id),
    active: row.active !== false,
    firstSeenAt: stringOrNull(row.first_seen_at),
    lastSeenAt: stringOrNull(row.last_seen_at),
    createdAt: stringOrNull(row.created_at),
    updatedAt: stringOrNull(row.updated_at),
  };
}

function resolveMappedLocation(
  mapping: OnlinePosLocationMapping,
  locations: BackEventLocationForMapping[],
  matchedBy: "cash_register_id" | "name",
): OnlinePosLocationResolution {
  const location = locations.find((item) => item.id === mapping.backeventLocationId && item.active !== false);
  if (!location) {
    return {
      ok: false,
      mapping: null,
      location: null,
      matchedBy: null,
      errorCode: "BACKEVENT_LOCATION_UNKNOWN",
      errorReason: "Ukendt BackEvent-lokation",
    };
  }
  return { ok: true, mapping, location, matchedBy };
}

function inactiveResolution(): OnlinePosLocationResolution {
  return {
    ok: false,
    mapping: null,
    location: null,
    matchedBy: null,
    errorCode: "ONLINEPOS_LOCATION_MAPPING_INACTIVE",
    errorReason: "OnlinePOS-lokationsmapping er inaktiv",
  };
}

function unmappedResolution(): OnlinePosLocationResolution {
  return {
    ok: false,
    mapping: null,
    location: null,
    matchedBy: null,
    errorCode: "ONLINEPOS_LOCATION_UNMAPPED",
    errorReason: "OnlinePOS-kasse mangler lokationsmapping",
  };
}

function sameVenue(mappingVenue: string | null, inputVenue: string | null) {
  return normalizeVenue(mappingVenue) === inputVenue;
}

function normalizeVenue(value: string | null | undefined) {
  return value?.trim() || null;
}

function stringOrNull(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}
