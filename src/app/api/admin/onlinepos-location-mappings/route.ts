import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import {
  findSuggestedBackEventLocationId,
  getLocationMappingSuggestion,
  normalizeOnlinePosCashRegisterId,
  normalizeOnlinePosCashRegisterName,
  toOnlinePosLocationMapping,
} from "@/lib/onlinepos/location-mappings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type MappingInput = {
  id?: unknown;
  venueId?: unknown;
  cashRegisterId?: unknown;
  cashRegisterName?: unknown;
  backeventLocationId?: unknown;
  active?: unknown;
};

type DiscoveryItem = {
  venueId: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  occurrenceCount: number;
};

export async function GET(request: Request) {
  const gate = await requireOwner(request);
  if (!gate.ok) return gate.response;

  const [locationsResult, mappingsResult, syncLinesResult, returnsResult] = await Promise.all([
    gate.supabase.from("backevent_locations").select("id,name,type,source_location_id,active").eq("active", true).order("sort_order", { ascending: true }),
    gate.supabase
      .from("backevent_onlinepos_location_mappings")
      .select("id,onlinepos_venue_id,onlinepos_cash_register_id,onlinepos_cash_register_name,normalized_cash_register_name,backevent_location_id,active,first_seen_at,last_seen_at,created_at,updated_at")
      .order("onlinepos_cash_register_name", { ascending: true }),
    gate.supabase
      .from("onlinepos_inventory_sync_lines")
      .select("cash_register_id,cash_register_name,created_at")
      .not("cash_register_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000),
    gate.supabase
      .from("backevent_returns")
      .select("onlinepos_venue_id,onlinepos_location_ref,created_at")
      .not("onlinepos_location_ref", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (locationsResult.error || mappingsResult.error) {
    return NextResponse.json({ ok: false, message: "Lokationsmapping kunne ikke hentes" }, { status: 500 });
  }

  const locations = (locationsResult.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    type: row.type,
    sourceLocationId: row.source_location_id,
    active: row.active !== false,
  }));
  const mappings = (mappingsResult.data ?? []).map((row) => toOnlinePosLocationMapping(row));
  const discovered = mergeDiscovery([
    ...mappings.map((mapping) => ({
      venueId: mapping.venueId,
      cashRegisterId: mapping.cashRegisterId,
      cashRegisterName: mapping.cashRegisterName,
      firstSeenAt: mapping.firstSeenAt,
      lastSeenAt: mapping.lastSeenAt,
      occurrenceCount: 0,
    })),
    ...((syncLinesResult.data ?? []) as Array<{ cash_register_id: string | null; cash_register_name: string | null; created_at: string | null }>).map((row) => ({
      venueId: process.env.ONLINEPOS_VENUE_ID ?? null,
      cashRegisterId: normalizeOnlinePosCashRegisterId(row.cash_register_id),
      cashRegisterName: row.cash_register_name ?? "Ukendt kasse",
      firstSeenAt: row.created_at,
      lastSeenAt: row.created_at,
      occurrenceCount: 1,
    })),
    ...((returnsResult.data ?? []) as Array<{ onlinepos_venue_id: string | null; onlinepos_location_ref: string | null; created_at: string | null }>).map((row) => ({
      venueId: row.onlinepos_venue_id ?? process.env.ONLINEPOS_VENUE_ID ?? null,
      cashRegisterId: null,
      cashRegisterName: row.onlinepos_location_ref ?? "Ukendt kasse",
      firstSeenAt: row.created_at,
      lastSeenAt: row.created_at,
      occurrenceCount: 1,
    })),
  ]);

  return NextResponse.json({
    ok: true,
    mappings,
    locations,
    discovered: discovered.map((item) => {
      const mapping = findMappingForDiscovery(item, mappings);
      const mappedLocationExists = mapping ? locations.some((location) => location.id === mapping.backeventLocationId) : false;
      const suggestion = getLocationMappingSuggestion(item.cashRegisterName);
      return {
        ...item,
        mapping,
        status: mapping ? (mapping.active ? (mappedLocationExists ? "mapped" : "unknown_location") : "inactive") : "missing",
        suggestion,
        suggestedBackeventLocationId: findSuggestedBackEventLocationId(item.cashRegisterName, locations.map((location) => ({
          id: location.id,
          name: location.name,
          type: location.type,
          source_location_id: location.sourceLocationId,
          active: location.active,
        }))),
      };
    }),
  });
}

export async function POST(request: Request) {
  const gate = await requireOwner(request);
  if (!gate.ok) return gate.response;
  const input = normalizeInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ ok: false, message: "Ugyldig lokationsmapping" }, { status: 400 });

  const existing = input.id ? await findExistingById(gate.supabase, input.id) : await findExistingByIdentity(gate.supabase, input);
  const payload = {
    onlinepos_venue_id: input.venueId,
    onlinepos_cash_register_id: input.cashRegisterId,
    onlinepos_cash_register_name: input.cashRegisterName,
    normalized_cash_register_name: normalizeOnlinePosCashRegisterName(input.cashRegisterName),
    backevent_location_id: input.backeventLocationId,
    active: input.active,
    first_seen_at: input.firstSeenAt,
    last_seen_at: input.lastSeenAt,
    updated_by: gate.userId,
    ...(existing ? {} : { created_by: gate.userId }),
  };
  const query = existing
    ? gate.supabase.from("backevent_onlinepos_location_mappings").update(payload).eq("id", existing.id)
    : gate.supabase.from("backevent_onlinepos_location_mappings").insert(payload);
  const { data, error } = await query
    .select("id,onlinepos_venue_id,onlinepos_cash_register_id,onlinepos_cash_register_name,normalized_cash_register_name,backevent_location_id,active,first_seen_at,last_seen_at,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, message: "Lokationsmapping kunne ikke gemmes" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, mapping: toOnlinePosLocationMapping(data) });
}

export async function DELETE(request: Request) {
  const gate = await requireOwner(request);
  if (!gate.ok) return gate.response;
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string") return NextResponse.json({ ok: false, message: "Mapping mangler" }, { status: 400 });
  const { error } = await gate.supabase.from("backevent_onlinepos_location_mappings").delete().eq("id", body.id);
  if (error) return NextResponse.json({ ok: false, message: "Lokationsmapping kunne ikke fjernes" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

async function requireOwner(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return { ok: false as const, response: NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status }) };
  }
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return { ok: false as const, response: NextResponse.json({ ok: false, message: "Supabase service role mangler" }, { status: 500 }) };
  }
  return { ok: true as const, supabase, userId: auth.userId };
}

function normalizeInput(body: MappingInput | null) {
  if (!body || typeof body.cashRegisterName !== "string" || typeof body.backeventLocationId !== "string") return null;
  const normalizedName = normalizeOnlinePosCashRegisterName(body.cashRegisterName);
  if (!normalizedName) return null;
  return {
    id: typeof body.id === "string" && body.id.trim() ? body.id.trim() : null,
    venueId: typeof body.venueId === "string" && body.venueId.trim() ? body.venueId.trim() : process.env.ONLINEPOS_VENUE_ID ?? null,
    cashRegisterId: normalizeOnlinePosCashRegisterId(typeof body.cashRegisterId === "string" ? body.cashRegisterId : null),
    cashRegisterName: body.cashRegisterName.trim(),
    backeventLocationId: body.backeventLocationId.trim(),
    active: body.active !== false,
    firstSeenAt: null as string | null,
    lastSeenAt: new Date().toISOString(),
  };
}

async function findExistingById(supabase: ReturnType<typeof createSupabaseAdminClient> extends infer T ? NonNullable<T> : never, id: string) {
  const { data } = await supabase.from("backevent_onlinepos_location_mappings").select("id").eq("id", id).maybeSingle();
  return data;
}

async function findExistingByIdentity(supabase: ReturnType<typeof createSupabaseAdminClient> extends infer T ? NonNullable<T> : never, input: ReturnType<typeof normalizeInput> & {}) {
  if (!input) return null;
  if (input.cashRegisterId) {
    let query = supabase
      .from("backevent_onlinepos_location_mappings")
      .select("id")
      .eq("onlinepos_cash_register_id", input.cashRegisterId)
      .limit(1);
    query = input.venueId ? query.eq("onlinepos_venue_id", input.venueId) : query.is("onlinepos_venue_id", null);
    const { data } = await query.maybeSingle();
    return data;
  }
  let query = supabase
    .from("backevent_onlinepos_location_mappings")
    .select("id")
    .eq("normalized_cash_register_name", normalizeOnlinePosCashRegisterName(input.cashRegisterName))
    .is("onlinepos_cash_register_id", null)
    .limit(1);
  query = input.venueId ? query.eq("onlinepos_venue_id", input.venueId) : query.is("onlinepos_venue_id", null);
  const { data } = await query.maybeSingle();
  return data;
}

function mergeDiscovery(items: DiscoveryItem[]) {
  const merged = new Map<string, DiscoveryItem>();
  for (const item of items) {
    const id = normalizeOnlinePosCashRegisterId(item.cashRegisterId);
    const name = normalizeOnlinePosCashRegisterName(item.cashRegisterName) ?? "unknown";
    const key = `${item.venueId ?? ""}:${id ? `id:${id}` : `name:${name}`}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }
    existing.occurrenceCount += item.occurrenceCount;
    existing.firstSeenAt = minDate(existing.firstSeenAt, item.firstSeenAt);
    existing.lastSeenAt = maxDate(existing.lastSeenAt, item.lastSeenAt);
  }
  return Array.from(merged.values()).sort((a, b) => a.cashRegisterName.localeCompare(b.cashRegisterName, "da"));
}

function findMappingForDiscovery(item: DiscoveryItem, mappings: ReturnType<typeof toOnlinePosLocationMapping>[]) {
  const id = normalizeOnlinePosCashRegisterId(item.cashRegisterId);
  if (id) {
    return mappings.find((mapping) => mapping.active && mapping.venueId === item.venueId && normalizeOnlinePosCashRegisterId(mapping.cashRegisterId) === id)
      ?? mappings.find((mapping) => mapping.venueId === item.venueId && normalizeOnlinePosCashRegisterId(mapping.cashRegisterId) === id)
      ?? null;
  }
  const name = normalizeOnlinePosCashRegisterName(item.cashRegisterName);
  return mappings.find((mapping) => mapping.venueId === item.venueId && !mapping.cashRegisterId && mapping.normalizedCashRegisterName === name) ?? null;
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
