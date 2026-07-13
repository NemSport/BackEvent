import type { SupabaseClient } from "@supabase/supabase-js";

export type OnlinePosLocationMapping = {
  id: string;
  venueId: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string;
  normalizedCashRegisterName: string;
  backeventLocationId: string | null;
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

export type OnlinePosLocationDiagnostics = {
  incomingName: string | null;
  incomingId: string | null;
  venueId: string | null;
  normalizedName: string | null;
  candidateMappingsLoaded: Array<{
    id: string;
    venueId: string | null;
    cashRegisterId: string | null;
    cashRegisterName: string;
    normalizedCashRegisterName: string;
    active: boolean;
    hasBackeventLocation: boolean;
  }>;
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
      diagnostics: OnlinePosLocationDiagnostics;
    };

export type OnlinePosLocationMappingSuggestion = {
  label: string;
  locationNameHint: "Bla" | "Gron" | "Rod" | "Pub" | "Street";
};

export type OnlinePosLocationDiscoveryInput = {
  venueId?: string | null;
  cashRegisterId?: string | null;
  cashRegisterName?: string | null;
  seenAt?: string | null;
};

export function normalizeOnlinePosCashRegisterName(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("da-DK").replace(/\s+/g, " ") || null;
}

export function normalizeOnlinePosCashRegisterId(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || null;
}

export function getLocationMappingSuggestion(cashRegisterName: string | null | undefined): OnlinePosLocationMappingSuggestion | null {
  const normalized = normalizeOnlinePosCashRegisterName(cashRegisterName);
  const lowerName = cashRegisterName?.trim().toLocaleLowerCase("da-DK") ?? "";
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, "");
  if (compact.includes("blabar") || compact.includes("blaabar") || lowerName.includes("blå bar")) {
    return { label: "Forslag: Blå bar ligner Blåbar", locationNameHint: "Bla" };
  }
  if (compact.includes("gronbar") || compact.includes("groenbar") || lowerName.includes("grøn bar")) {
    return { label: "Forslag: Grøn Bar ligner Grønbar", locationNameHint: "Gron" };
  }
  if (compact.includes("rodbar") || compact.includes("roedbar") || lowerName.includes("rød bar")) {
    return { label: "Forslag: Rød Bar ligner Rødbar", locationNameHint: "Rod" };
  }
  if (compact === "pubben" || compact.includes("pubben")) {
    return { label: "Forslag: Pubben ligner Pub", locationNameHint: "Pub" };
  }
  if (compact === "street" || compact.includes("street")) {
    return { label: "Forslag: Street ligner Street", locationNameHint: "Street" };
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
  return locations.find((location) => normalizeLocationNameForSuggestion(location.name).includes(hint))?.id ?? null;
}

export function resolveOnlinePosLocation(
  input: OnlinePosCashRegisterRef,
  mappings: OnlinePosLocationMapping[],
  locations: BackEventLocationForMapping[],
): OnlinePosLocationResolution {
  const venueId = normalizeVenue(input.venueId);
  const cashRegisterId = normalizeOnlinePosCashRegisterId(input.cashRegisterId);
  const normalizedName = normalizeOnlinePosCashRegisterName(input.cashRegisterName);
  const approvedMappings = mappings.filter((mapping) => mapping.backeventLocationId && compatibleVenue(mapping.venueId, venueId));
  const activeMappings = approvedMappings.filter((mapping) => mapping.active);
  const inactiveMappings = approvedMappings.filter((mapping) => !mapping.active);
  const diagnostics = buildLocationDiagnostics(input, venueId, cashRegisterId, normalizedName, mappings);

  if (cashRegisterId) {
    const mapping = activeMappings.find((item) => normalizeOnlinePosCashRegisterId(item.cashRegisterId) === cashRegisterId);
    if (mapping) return resolveMappedLocation(mapping, locations, "cash_register_id");
    const inactive = inactiveMappings.find((item) => normalizeOnlinePosCashRegisterId(item.cashRegisterId) === cashRegisterId);
    if (inactive) return inactiveResolution(diagnostics);
  }

  if (normalizedName) {
    const mapping = activeMappings.find((item) => canFallbackByName(cashRegisterId, item) && mappingNameMatches(item, normalizedName));
    if (mapping) return resolveMappedLocation(mapping, locations, "name");
    const inactive = inactiveMappings.find((item) => canFallbackByName(cashRegisterId, item) && mappingNameMatches(item, normalizedName));
    if (inactive) return inactiveResolution(diagnostics);
  }

  return unmappedResolution(diagnostics);
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
    backeventLocationId: stringOrNull(row.backevent_location_id),
    active: row.active !== false,
    firstSeenAt: stringOrNull(row.first_seen_at),
    lastSeenAt: stringOrNull(row.last_seen_at),
    createdAt: stringOrNull(row.created_at),
    updatedAt: stringOrNull(row.updated_at),
  };
}

export async function recordOnlinePosLocationDiscoveries(
  supabase: SupabaseClient,
  discoveries: OnlinePosLocationDiscoveryInput[],
) {
  const rows = mergeLocationDiscoveries(discoveries);
  for (const row of rows) {
    const existing = await findExistingLocationDiscovery(supabase, row);
    if (existing) {
      await supabase
        .from("backevent_onlinepos_location_mappings")
        .update({
          onlinepos_cash_register_name: row.cashRegisterName,
          normalized_cash_register_name: row.normalizedCashRegisterName,
          first_seen_at: minDate(existing.first_seen_at, row.firstSeenAt),
          last_seen_at: maxDate(existing.last_seen_at, row.lastSeenAt),
        })
        .eq("id", existing.id);
      continue;
    }

    await supabase.from("backevent_onlinepos_location_mappings").insert({
      onlinepos_venue_id: row.venueId,
      onlinepos_cash_register_id: row.cashRegisterId,
      onlinepos_cash_register_name: row.cashRegisterName,
      normalized_cash_register_name: row.normalizedCashRegisterName,
      backevent_location_id: null,
      active: false,
      first_seen_at: row.firstSeenAt,
      last_seen_at: row.lastSeenAt,
    });
  }
}

export function mergeLocationDiscoveries(discoveries: OnlinePosLocationDiscoveryInput[]) {
  const merged = new Map<string, {
    venueId: string | null;
    cashRegisterId: string | null;
    cashRegisterName: string;
    normalizedCashRegisterName: string;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  }>();

  for (const discovery of discoveries) {
    const cashRegisterName = discovery.cashRegisterName?.trim();
    const normalizedCashRegisterName = normalizeOnlinePosCashRegisterName(cashRegisterName);
    if (!cashRegisterName || !normalizedCashRegisterName) continue;

    const venueId = normalizeVenue(discovery.venueId);
    const cashRegisterId = normalizeOnlinePosCashRegisterId(discovery.cashRegisterId);
    const key = `${venueId ?? ""}:${cashRegisterId ? `id:${cashRegisterId}` : `name:${normalizedCashRegisterName}`}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        venueId,
        cashRegisterId,
        cashRegisterName,
        normalizedCashRegisterName,
        firstSeenAt: discovery.seenAt ?? null,
        lastSeenAt: discovery.seenAt ?? null,
      });
      continue;
    }

    existing.firstSeenAt = minDate(existing.firstSeenAt, discovery.seenAt ?? null);
    existing.lastSeenAt = maxDate(existing.lastSeenAt, discovery.seenAt ?? null);
    if (cashRegisterId) {
      existing.cashRegisterName = cashRegisterName;
      existing.normalizedCashRegisterName = normalizedCashRegisterName;
    }
  }

  return Array.from(merged.values());
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
      diagnostics: {
        incomingName: mapping.cashRegisterName,
        incomingId: mapping.cashRegisterId,
        venueId: mapping.venueId,
        normalizedName: mapping.normalizedCashRegisterName,
        candidateMappingsLoaded: [toDiagnosticCandidate(mapping)],
      },
    };
  }
  return { ok: true, mapping, location, matchedBy };
}

function inactiveResolution(diagnostics: OnlinePosLocationDiagnostics): OnlinePosLocationResolution {
  return {
    ok: false,
    mapping: null,
    location: null,
    matchedBy: null,
    errorCode: "ONLINEPOS_LOCATION_MAPPING_INACTIVE",
    errorReason: "OnlinePOS-lokationsmapping er inaktiv",
    diagnostics,
  };
}

function unmappedResolution(diagnostics: OnlinePosLocationDiagnostics): OnlinePosLocationResolution {
  return {
    ok: false,
    mapping: null,
    location: null,
    matchedBy: null,
    errorCode: "ONLINEPOS_LOCATION_UNMAPPED",
    errorReason: "OnlinePOS-kasse mangler lokationsmapping",
    diagnostics,
  };
}

async function findExistingLocationDiscovery(
  supabase: SupabaseClient,
  row: ReturnType<typeof mergeLocationDiscoveries>[number],
) {
  if (row.cashRegisterId) {
    const { data } = await supabase
      .from("backevent_onlinepos_location_mappings")
      .select("id,onlinepos_venue_id,first_seen_at,last_seen_at")
      .eq("onlinepos_cash_register_id", row.cashRegisterId)
      .limit(20);
    return (data ?? []).find((item) => compatibleVenue(stringOrNull(item.onlinepos_venue_id), row.venueId)) ?? null;
  }

  const exactName = await supabase
    .from("backevent_onlinepos_location_mappings")
    .select("id,onlinepos_venue_id,first_seen_at,last_seen_at")
    .is("onlinepos_cash_register_id", null)
    .eq("normalized_cash_register_name", row.normalizedCashRegisterName)
    .limit(20);
  const exactNameMatch = (exactName.data ?? []).find((item) => compatibleVenue(stringOrNull(item.onlinepos_venue_id), row.venueId));
  if (exactNameMatch) return exactNameMatch;

  const storedName = await supabase
    .from("backevent_onlinepos_location_mappings")
    .select("id,onlinepos_venue_id,first_seen_at,last_seen_at")
    .is("onlinepos_cash_register_id", null)
    .eq("onlinepos_cash_register_name", row.cashRegisterName)
    .limit(20);
  return (storedName.data ?? []).find((item) => compatibleVenue(stringOrNull(item.onlinepos_venue_id), row.venueId)) ?? null;
}

function compatibleVenue(mappingVenue: string | null, inputVenue: string | null) {
  const normalizedMappingVenue = normalizeVenueForMatch(mappingVenue);
  const normalizedInputVenue = normalizeVenueForMatch(inputVenue);
  if (!normalizedMappingVenue || !normalizedInputVenue) return true;
  return normalizedMappingVenue === normalizedInputVenue;
}

function canFallbackByName(incomingCashRegisterId: string | null, mapping: OnlinePosLocationMapping) {
  return !incomingCashRegisterId || !normalizeOnlinePosCashRegisterId(mapping.cashRegisterId);
}

function mappingNameMatches(mapping: OnlinePosLocationMapping, normalizedName: string) {
  return mapping.normalizedCashRegisterName === normalizedName
    || normalizeOnlinePosCashRegisterName(mapping.cashRegisterName) === normalizedName;
}

function normalizeVenue(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeVenueForMatch(value: string | null | undefined) {
  const normalized = normalizeVenue(value)?.toLocaleLowerCase("da-DK");
  if (!normalized || normalized === "-" || normalized === "all" || normalized === "default" || normalized === "generic" || normalized === "unknown" || normalized === "null" || normalized === "undefined") {
    return null;
  }
  return normalized;
}

function normalizeLocationNameForSuggestion(value: string) {
  return value
    .toLocaleLowerCase("da-DK")
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae");
}

function buildLocationDiagnostics(
  input: OnlinePosCashRegisterRef,
  venueId: string | null,
  cashRegisterId: string | null,
  normalizedName: string | null,
  mappings: OnlinePosLocationMapping[],
): OnlinePosLocationDiagnostics {
  const candidates = mappings
    .filter((mapping) => compatibleVenue(mapping.venueId, venueId))
    .filter((mapping) => {
      if (cashRegisterId && normalizeOnlinePosCashRegisterId(mapping.cashRegisterId) === cashRegisterId) return true;
      if (normalizedName && canFallbackByName(cashRegisterId, mapping) && mappingNameMatches(mapping, normalizedName)) return true;
      return false;
    })
    .slice(0, 10)
    .map(toDiagnosticCandidate);

  return {
    incomingName: input.cashRegisterName ?? null,
    incomingId: cashRegisterId,
    venueId,
    normalizedName,
    candidateMappingsLoaded: candidates,
  };
}

function toDiagnosticCandidate(mapping: OnlinePosLocationMapping) {
  return {
    id: mapping.id,
    venueId: mapping.venueId,
    cashRegisterId: mapping.cashRegisterId,
    cashRegisterName: mapping.cashRegisterName,
    normalizedCashRegisterName: mapping.normalizedCashRegisterName,
    active: mapping.active,
    hasBackeventLocation: Boolean(mapping.backeventLocationId),
  };
}

function minDate(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) <= new Date(b) ? a : b;
}

function maxDate(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

function stringOrNull(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}
