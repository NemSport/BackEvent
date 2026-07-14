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
  canonicalKey: string;
  incomingName: string | null;
  incomingId: string | null;
  venueId: string | null;
  normalizedName: string | null;
  incomingNames: string[];
  incomingIds: string[];
  venueValues: string[];
  selectedMappingRow: OnlinePosLocationDiagnosticCandidate | null;
  matchMethod: "id" | "exact_name" | null;
  duplicateCandidates: OnlinePosLocationDiagnosticCandidate[];
  conflictingCandidates: OnlinePosLocationDiagnosticCandidate[];
  candidateMappingsLoaded: OnlinePosLocationDiagnosticCandidate[];
};

export type OnlinePosLocationDiagnosticCandidate = {
  id: string;
  venueId: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string;
  normalizedCashRegisterName: string;
  backeventLocationId: string | null;
  active: boolean;
  hasBackeventLocation: boolean;
};

export type OnlinePosCanonicalLocationResolution = {
  canonicalKey: string;
  resolution: OnlinePosLocationResolution;
};

export type OnlinePosLocationResolver = {
  resolve: (input: OnlinePosCashRegisterRef) => OnlinePosLocationResolution;
  resolutions: OnlinePosCanonicalLocationResolution[];
};

type LocationDiagnosticSets = {
  names: string[];
  ids: string[];
  venues: string[];
};

export type OnlinePosLocationResolution =
  | {
      ok: true;
      mapping: OnlinePosLocationMapping;
      location: BackEventLocationForMapping;
      matchedBy: "cash_register_id" | "name";
      diagnostics: OnlinePosLocationDiagnostics;
    }
  | {
      ok: false;
      mapping: null;
      location: null;
      matchedBy: null;
      errorCode:
        | "ONLINEPOS_LOCATION_UNMAPPED"
        | "ONLINEPOS_LOCATION_MAPPING_INACTIVE"
        | "ONLINEPOS_LOCATION_MAPPING_CONFLICT"
        | "BACKEVENT_LOCATION_UNKNOWN";
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
  return createOnlinePosLocationResolver([input], mappings, locations).resolve(input);
}

export function createOnlinePosLocationResolver(
  inputs: OnlinePosCashRegisterRef[],
  mappings: OnlinePosLocationMapping[],
  locations: BackEventLocationForMapping[],
): OnlinePosLocationResolver {
  const sortedMappings = sortOnlinePosLocationMappings(mappings);
  const inputGroups = new Map<string, OnlinePosCashRegisterRef[]>();

  for (const input of inputs) {
    const key = buildOnlinePosCanonicalLocationKey(input, sortedMappings);
    const group = inputGroups.get(key) ?? [];
    group.push(input);
    inputGroups.set(key, group);
  }

  const cache = new Map<string, OnlinePosLocationResolution>();
  for (const [canonicalKey, group] of inputGroups) {
    cache.set(canonicalKey, resolveCanonicalLocation(canonicalKey, group, sortedMappings, locations));
  }

  return {
    resolve(input) {
      const canonicalKey = buildOnlinePosCanonicalLocationKey(input, sortedMappings);
      const cached = cache.get(canonicalKey);
      if (cached) return cached;
      const resolution = resolveCanonicalLocation(canonicalKey, [input], sortedMappings, locations);
      cache.set(canonicalKey, resolution);
      return resolution;
    },
    get resolutions() {
      return Array.from(cache.entries())
        .map(([canonicalKey, resolution]) => ({ canonicalKey, resolution }))
        .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey, "da"));
    },
  };
}

export function buildOnlinePosCanonicalLocationKey(
  input: OnlinePosCashRegisterRef,
  mappings: OnlinePosLocationMapping[] = [],
) {
  const cashRegisterId = normalizeOnlinePosCashRegisterId(input.cashRegisterId);
  const normalizedName = normalizeOnlinePosCashRegisterName(input.cashRegisterName);
  const baseKey = cashRegisterId ? `id:${cashRegisterId}` : `name:${normalizedName ?? "unknown"}`;
  const inputVenue = normalizeVenueForMatch(input.venueId);
  if (!inputVenue) return baseKey;

  const hasStoredRealVenue = mappings.some((mapping) => {
    if (!normalizeVenueForMatch(mapping.venueId)) return false;
    if (cashRegisterId && normalizeOnlinePosCashRegisterId(mapping.cashRegisterId) === cashRegisterId) return true;
    return Boolean(normalizedName && canFallbackByName(cashRegisterId, mapping) && mappingNameMatches(mapping, normalizedName));
  });
  return hasStoredRealVenue ? `${baseKey}|venue:${inputVenue}` : baseKey;
}

function resolveCanonicalLocation(
  canonicalKey: string,
  inputs: OnlinePosCashRegisterRef[],
  mappings: OnlinePosLocationMapping[],
  locations: BackEventLocationForMapping[],
): OnlinePosLocationResolution {
  const input = inputs[0] ?? {};
  const venueId = normalizeVenue(input.venueId);
  const cashRegisterId = normalizeOnlinePosCashRegisterId(input.cashRegisterId);
  const normalizedName = normalizeOnlinePosCashRegisterName(input.cashRegisterName);
  const normalizedNames = distinctSorted(inputs.map((item) => normalizeOnlinePosCashRegisterName(item.cashRegisterName)));
  const approvedMappings = mappings.filter((mapping) => mapping.active && mapping.backeventLocationId && compatibleVenue(mapping.venueId, venueId));
  const inactiveMappings = mappings.filter((mapping) => !mapping.active && mapping.backeventLocationId && compatibleVenue(mapping.venueId, venueId));
  const diagnosticSets = collectDiagnosticSets(inputs);
  let matchedCandidates: OnlinePosLocationMapping[] = [];
  let matchMethod: "id" | "exact_name" | null = null;

  if (cashRegisterId) {
    matchedCandidates = approvedMappings.filter((item) => normalizeOnlinePosCashRegisterId(item.cashRegisterId) === cashRegisterId);
    if (matchedCandidates.length > 0) matchMethod = "id";
  }

  if (matchedCandidates.length === 0 && normalizedNames.length > 0) {
    matchedCandidates = approvedMappings.filter((item) =>
      canFallbackByName(cashRegisterId, item) && normalizedNames.some((name) => mappingNameMatches(item, name)),
    );
    if (matchedCandidates.length > 0) matchMethod = "exact_name";
  }

  const diagnostics = buildLocationDiagnostics(
    canonicalKey,
    input,
    venueId,
    cashRegisterId,
    normalizedName,
    normalizedNames,
    mappings,
    diagnosticSets,
    matchedCandidates,
    matchMethod,
  );

  if (matchedCandidates.length > 1) return conflictResolution(diagnostics);
  if (matchedCandidates.length === 1 && matchMethod) {
    return resolveMappedLocation(matchedCandidates[0], locations, matchMethod === "id" ? "cash_register_id" : "name", diagnostics);
  }

  const inactiveMatch = inactiveMappings.some((item) => {
    if (cashRegisterId && normalizeOnlinePosCashRegisterId(item.cashRegisterId) === cashRegisterId) return true;
    return normalizedNames.some((name) => canFallbackByName(cashRegisterId, item) && mappingNameMatches(item, name));
  });
  if (inactiveMatch) return inactiveResolution(diagnostics);
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

  return sortOnlinePosLocationMappings((data ?? []).map(toOnlinePosLocationMapping));
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
  const storedMappings = await getOnlinePosLocationMappings(supabase);
  const rows = mergeLocationDiscoveries(discoveries, storedMappings);
  for (const row of rows) {
    const existingRows = storedMappings.filter((mapping) => locationDiscoveryMatches(row, mapping));
    if (existingRows.length > 0) {
      for (const existing of existingRows) {
        await supabase
          .from("backevent_onlinepos_location_mappings")
          .update({
            onlinepos_cash_register_name: row.cashRegisterName,
            normalized_cash_register_name: row.normalizedCashRegisterName,
            first_seen_at: minDate(existing.firstSeenAt, row.firstSeenAt),
            last_seen_at: maxDate(existing.lastSeenAt, row.lastSeenAt),
          })
          .eq("id", existing.id);
      }
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

export function mergeLocationDiscoveries(
  discoveries: OnlinePosLocationDiscoveryInput[],
  storedMappings: OnlinePosLocationMapping[] = [],
) {
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
    const key = buildOnlinePosCanonicalLocationKey({ venueId, cashRegisterId, cashRegisterName }, storedMappings);
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
  diagnostics: OnlinePosLocationDiagnostics,
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
      diagnostics,
    };
  }
  return { ok: true, mapping, location, matchedBy, diagnostics };
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

function conflictResolution(diagnostics: OnlinePosLocationDiagnostics): OnlinePosLocationResolution {
  return {
    ok: false,
    mapping: null,
    location: null,
    matchedBy: null,
    errorCode: "ONLINEPOS_LOCATION_MAPPING_CONFLICT",
    errorReason: "OnlinePOS-lokationsmapping har konflikt",
    diagnostics,
  };
}

function locationDiscoveryMatches(
  row: ReturnType<typeof mergeLocationDiscoveries>[number],
  mapping: OnlinePosLocationMapping,
) {
  if (!compatibleVenue(mapping.venueId, row.venueId)) return false;
  const rowId = normalizeOnlinePosCashRegisterId(row.cashRegisterId);
  const mappingId = normalizeOnlinePosCashRegisterId(mapping.cashRegisterId);
  if (rowId || mappingId) return Boolean(rowId && mappingId && rowId === mappingId);
  return mappingNameMatches(mapping, row.normalizedCashRegisterName);
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
  canonicalKey: string,
  input: OnlinePosCashRegisterRef,
  venueId: string | null,
  cashRegisterId: string | null,
  normalizedName: string | null,
  normalizedNames: string[],
  mappings: OnlinePosLocationMapping[],
  sets: LocationDiagnosticSets,
  matchedCandidates: OnlinePosLocationMapping[],
  matchMethod: "id" | "exact_name" | null,
): OnlinePosLocationDiagnostics {
  const candidates = mappings
    .filter((mapping) => compatibleVenue(mapping.venueId, venueId))
    .filter((mapping) => {
      if (cashRegisterId && normalizeOnlinePosCashRegisterId(mapping.cashRegisterId) === cashRegisterId) return true;
      if (normalizedNames.some((name) => canFallbackByName(cashRegisterId, mapping) && mappingNameMatches(mapping, name))) return true;
      return false;
    })
    .slice(0, 20)
    .map(toDiagnosticCandidate);
  const matched = matchedCandidates.map(toDiagnosticCandidate);

  return {
    canonicalKey,
    incomingName: input.cashRegisterName ?? null,
    incomingId: cashRegisterId,
    venueId,
    normalizedName,
    incomingNames: sets.names,
    incomingIds: sets.ids,
    venueValues: sets.venues,
    selectedMappingRow: matched.length === 1 ? matched[0] : null,
    matchMethod,
    duplicateCandidates: matched.length > 1 ? matched : [],
    conflictingCandidates: matched.length > 1 ? matched : [],
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
    backeventLocationId: mapping.backeventLocationId,
    active: mapping.active,
    hasBackeventLocation: Boolean(mapping.backeventLocationId),
  };
}

function collectDiagnosticSets(inputs: OnlinePosCashRegisterRef[]): LocationDiagnosticSets {
  return {
    names: distinctSorted(inputs.map((input) => input.cashRegisterName?.trim() || null)),
    ids: distinctSorted(inputs.map((input) => normalizeOnlinePosCashRegisterId(input.cashRegisterId))),
    venues: distinctSorted(inputs.map((input) => normalizeVenue(input.venueId))),
  };
}

function distinctSorted(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
    .sort((a, b) => a.localeCompare(b, "da"));
}

function sortOnlinePosLocationMappings(mappings: OnlinePosLocationMapping[]) {
  return [...mappings].sort((a, b) => {
    const aParts = [
      normalizeOnlinePosCashRegisterId(a.cashRegisterId) ?? "",
      normalizeOnlinePosCashRegisterName(a.cashRegisterName) ?? "",
      normalizeVenueForMatch(a.venueId) ?? "",
      a.backeventLocationId ?? "",
      a.id,
    ];
    const bParts = [
      normalizeOnlinePosCashRegisterId(b.cashRegisterId) ?? "",
      normalizeOnlinePosCashRegisterName(b.cashRegisterName) ?? "",
      normalizeVenueForMatch(b.venueId) ?? "",
      b.backeventLocationId ?? "",
      b.id,
    ];
    return aParts.join("|").localeCompare(bParts.join("|"), "da");
  });
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
