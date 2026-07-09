import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  createMockMappingId,
  mappingActions,
  mappingStatuses,
  mockOnlinePosInventoryMappings,
  toMappingIdentity,
  type OnlinePosInventoryMapping,
  type OnlinePosInventoryMappingInput,
  type OnlinePosLineType,
  type OnlinePosMappingAction,
  type OnlinePosMappingStatus,
} from "@/lib/onlinepos/inventory-mappings";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuthFailureDebug = {
  hasUser: boolean;
  profileRole: string | null;
  profileActive: boolean | null;
  userEmail: string | null;
};

const lineTypes: OnlinePosLineType[] = [
  "modifier_stock_item",
  "deposit_fee",
  "deposit_return",
  "container_product",
  "stock_item",
  "unknown",
];

export async function GET() {
  const access = await ensureAdminAccess();

  if (!access.ok) {
    return NextResponse.json({ error: access.error, debug: access.debug }, { status: access.status });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ mappings: mockOnlinePosInventoryMappings });
  }

  const supabase = createSupabaseServerClient(access.accessToken);
  const { data, error } = await supabase!
    .from("onlinepos_inventory_mappings")
    .select(
      "id,onlinepos_product_id,onlinepos_product_name,onlinepos_product_group_name,line_type,backevent_inventory_item_id,conversion_factor,mapping_action,status,created_at,updated_at",
    )
    .order("onlinepos_product_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Mappinger kunne ikke hentes" }, { status: 500 });
  }

  return NextResponse.json({ mappings: data.map(toMapping) });
}

export async function POST(request: Request) {
  const access = await ensureAdminAccess();

  if (!access.ok) {
    return NextResponse.json({ error: access.error, debug: access.debug }, { status: access.status });
  }

  const input = normalizeInput(await request.json().catch(() => null));

  if (!input) {
    return NextResponse.json({ error: "Ugyldig mapping" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    const identity = toMappingIdentity(input);
    const existingIndex = mockOnlinePosInventoryMappings.findIndex((mapping) => toMappingIdentity(mapping) === identity);
    const saved: OnlinePosInventoryMapping = {
      ...input,
      id: input.id || (existingIndex >= 0 ? mockOnlinePosInventoryMappings[existingIndex].id : createMockMappingId()),
      updatedAt: new Date().toISOString(),
      createdAt: existingIndex >= 0 ? mockOnlinePosInventoryMappings[existingIndex].createdAt : new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      mockOnlinePosInventoryMappings[existingIndex] = saved;
    } else {
      mockOnlinePosInventoryMappings.push(saved);
    }

    return NextResponse.json({ mapping: saved });
  }

  const supabase = createSupabaseServerClient(access.accessToken);
  const existing = input.id ? await findExistingById(supabase!, input.id) : await findExistingByIdentity(supabase!, input);
  const payload = {
    onlinepos_product_id: input.onlineposProductId,
    onlinepos_product_name: input.onlineposProductName,
    onlinepos_product_group_name: input.onlineposProductGroupName,
    line_type: input.lineType,
    backevent_inventory_item_id: input.backeventInventoryItemId,
    conversion_factor: input.conversionFactor,
    mapping_action: input.mappingAction,
    status: input.status,
  };

  const query = existing
    ? supabase!.from("onlinepos_inventory_mappings").update(payload).eq("id", existing.id)
    : supabase!.from("onlinepos_inventory_mappings").insert(payload);

  const { data, error } = await query
    .select(
      "id,onlinepos_product_id,onlinepos_product_name,onlinepos_product_group_name,line_type,backevent_inventory_item_id,conversion_factor,mapping_action,status,created_at,updated_at",
    )
    .single();

  if (error) {
    return NextResponse.json({ error: "Mapping kunne ikke gemmes" }, { status: 500 });
  }

  return NextResponse.json({ mapping: toMapping(data) });
}

async function findExistingById(supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>, id: string) {
  const { data } = await supabase.from("onlinepos_inventory_mappings").select("id").eq("id", id).maybeSingle();
  return data;
}

async function findExistingByIdentity(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
  input: OnlinePosInventoryMappingInput,
) {
  let query = supabase
    .from("onlinepos_inventory_mappings")
    .select("id")
    .eq("line_type", input.lineType);

  query = input.onlineposProductId
    ? query.eq("onlinepos_product_id", input.onlineposProductId)
    : query.is("onlinepos_product_id", null);
  query = input.onlineposProductName
    ? query.eq("onlinepos_product_name", input.onlineposProductName)
    : query.is("onlinepos_product_name", null);
  query = input.onlineposProductGroupName
    ? query.eq("onlinepos_product_group_name", input.onlineposProductGroupName)
    : query.is("onlinepos_product_group_name", null);

  const { data } = await query.maybeSingle();
  return data;
}

function normalizeInput(value: unknown): OnlinePosInventoryMappingInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const lineType = input.lineType;
  const mappingAction = input.mappingAction;
  const status = input.status;

  if (!lineTypes.includes(lineType as OnlinePosLineType)) {
    return null;
  }

  if (!mappingActions.includes(mappingAction as OnlinePosMappingAction)) {
    return null;
  }

  if (!mappingStatuses.includes(status as OnlinePosMappingStatus)) {
    return null;
  }

  return {
    id: stringOrNull(input.id),
    onlineposProductId: stringOrNull(input.onlineposProductId),
    onlineposProductName: stringOrNull(input.onlineposProductName),
    onlineposProductGroupName: stringOrNull(input.onlineposProductGroupName),
    lineType: lineType as OnlinePosLineType,
    backeventInventoryItemId: stringOrNull(input.backeventInventoryItemId),
    conversionFactor: numberOrNull(input.conversionFactor),
    mappingAction: mappingAction as OnlinePosMappingAction,
    status: status as OnlinePosMappingStatus,
  };
}

function toMapping(row: Record<string, unknown>): OnlinePosInventoryMapping {
  return {
    id: String(row.id),
    onlineposProductId: stringOrNull(row.onlinepos_product_id),
    onlineposProductName: stringOrNull(row.onlinepos_product_name),
    onlineposProductGroupName: stringOrNull(row.onlinepos_product_group_name),
    lineType: row.line_type as OnlinePosLineType,
    backeventInventoryItemId: stringOrNull(row.backevent_inventory_item_id),
    conversionFactor: numberOrNull(row.conversion_factor),
    mappingAction: row.mapping_action as OnlinePosMappingAction,
    status: row.status as OnlinePosMappingStatus,
    createdAt: stringOrNull(row.created_at),
    updatedAt: stringOrNull(row.updated_at),
  };
}

function stringOrNull(value: unknown) {
  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  return value.trim() || null;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function ensureAdminAccess(): Promise<
  | { ok: true; accessToken?: string }
  | { ok: false; status: number; error: string; debug: AuthFailureDebug }
> {
  if (!isSupabaseConfigured()) {
    return { ok: true };
  }

  const authorization = (await headers()).get("authorization");

  if (!authorization) {
    return { ok: false, status: 401, error: "Du skal være logget ind", debug: createAuthDebug() };
  }

  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const supabase = createSupabaseServerClient(accessToken);

  if (!supabase) {
    return { ok: true };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return {
      ok: false,
      status: 401,
      error: "Du skal være logget ind",
      debug: createAuthDebug({
        hasUser: Boolean(user),
        userEmail: user?.email ?? null,
      }),
    };
  }

  const { data: profile } = await supabase.from("backevent_profiles").select("role,active").eq("id", user.id).maybeSingle();

  if (!profile?.active || profile.role !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Kun admin kan gøre dette",
      debug: createAuthDebug({
        hasUser: true,
        profileRole: profile?.role ?? null,
        profileActive: profile?.active ?? null,
        userEmail: user.email ?? null,
      }),
    };
  }

  return { ok: true, accessToken };
}

function createAuthDebug(debug: Partial<AuthFailureDebug> = {}): AuthFailureDebug {
  return {
    hasUser: debug.hasUser ?? false,
    profileRole: debug.profileRole ?? null,
    profileActive: debug.profileActive ?? null,
    userEmail: debug.userEmail ?? null,
  };
}
