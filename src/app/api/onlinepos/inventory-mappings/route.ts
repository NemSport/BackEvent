import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  mappingActions,
  mappingStatuses,
  type OnlinePosInventoryMapping,
  type OnlinePosInventoryMappingComponent,
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
    return NextResponse.json({ ok: false, error: "Supabase mangler. Mappinger kan ikke gemmes lokalt." }, { status: 503 });
  }

  const supabase = createSupabaseServerClient(access.accessToken);
  const { data, error } = await supabase!
    .from("onlinepos_inventory_mappings")
    .select(
      "id,onlinepos_product_id,onlinepos_product_name,onlinepos_product_group_name,line_type,backevent_inventory_item_id,conversion_factor,mapping_action,status,created_at,updated_at",
    )
    .order("onlinepos_product_name", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: "Mappinger kunne ikke hentes" }, { status: 500 });
  }

  const components = await getComponents(supabase!, data.map((row) => String(row.id)));

  return NextResponse.json({ ok: true, mappings: data.map((row) => toMapping(row, components.get(String(row.id)) ?? [])) });
}

export async function POST(request: Request) {
  return saveMapping(request);
}

export async function PUT(request: Request) {
  return saveMapping(request);
}

async function saveMapping(request: Request) {
  const access = await ensureAdminAccess();

  if (!access.ok) {
    return NextResponse.json({ error: access.error, debug: access.debug }, { status: access.status });
  }

  const input = normalizeInput(await request.json().catch(() => null));

  if (!input) {
    return NextResponse.json({ ok: false, error: "Ugyldig mapping" }, { status: 400 });
  }

  if (input.status === "approved" && input.mappingAction === "consume_stock" && !hasValidComponents(input.components)) {
    return NextResponse.json({ ok: false, error: "Godkendt lagertræk kræver mindst én varekomponent" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase mangler. Mappingen blev ikke gemt." }, { status: 503 });
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
    return NextResponse.json({ ok: false, error: "Mapping kunne ikke gemmes" }, { status: 500 });
  }

  const componentSave = await replaceComponents(supabase!, String(data.id), input.components);

  if (!componentSave.ok) {
    return NextResponse.json({ ok: false, error: "Komponenter kunne ikke gemmes" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mapping: toMapping(data, componentSave.components) });
}

async function getComponents(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
  mappingIds: string[],
) {
  const componentsByMapping = new Map<string, OnlinePosInventoryMappingComponent[]>();

  if (mappingIds.length === 0) {
    return componentsByMapping;
  }

  const { data, error } = await supabase
    .from("onlinepos_inventory_mapping_components")
    .select("id,mapping_id,backevent_inventory_item_id,conversion_factor,sort_order,created_at,updated_at")
    .in("mapping_id", mappingIds)
    .order("sort_order", { ascending: true });

  if (error) {
    return componentsByMapping;
  }

  data.forEach((row) => {
    const mappingId = String(row.mapping_id);
    const current = componentsByMapping.get(mappingId) ?? [];
    current.push(toComponent(row));
    componentsByMapping.set(mappingId, current);
  });

  return componentsByMapping;
}

async function replaceComponents(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
  mappingId: string,
  components: OnlinePosInventoryMappingComponent[],
): Promise<{ ok: true; components: OnlinePosInventoryMappingComponent[] } | { ok: false }> {
  const { error: deleteError } = await supabase.from("onlinepos_inventory_mapping_components").delete().eq("mapping_id", mappingId);

  if (deleteError) {
    return { ok: false };
  }

  const validComponents = normalizeComponents(components);

  if (validComponents.length === 0) {
    return { ok: true, components: [] };
  }

  const { data, error } = await supabase
    .from("onlinepos_inventory_mapping_components")
    .insert(
      validComponents.map((component, index) => ({
        mapping_id: mappingId,
        backevent_inventory_item_id: component.backeventInventoryItemId,
        conversion_factor: component.conversionFactor,
        sort_order: index,
      })),
    )
    .select("id,mapping_id,backevent_inventory_item_id,conversion_factor,sort_order,created_at,updated_at")
    .order("sort_order", { ascending: true });

  if (error) {
    return { ok: false };
  }

  return { ok: true, components: data.map(toComponent) };
}

async function findExistingById(supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>, id: string) {
  const { data } = await supabase.from("onlinepos_inventory_mappings").select("id").eq("id", id).maybeSingle();
  return data;
}

async function findExistingByIdentity(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
  input: OnlinePosInventoryMappingInput,
) {
  if (input.onlineposProductId) {
    const onlineposProductId = normalizeOnlinePosId(input.onlineposProductId);
    const { data } = await supabase
      .from("onlinepos_inventory_mappings")
      .select("id")
      .eq("onlinepos_product_id", onlineposProductId)
      .limit(1)
      .maybeSingle();
    return data;
  }

  const query = supabase
    .from("onlinepos_inventory_mappings")
    .select("id")
    .is("onlinepos_product_id", null)
    .eq("line_type", input.lineType);

  const { data } = input.onlineposProductName
    ? await query.eq("onlinepos_product_name", input.onlineposProductName).limit(1).maybeSingle()
    : await query.is("onlinepos_product_name", null).limit(1).maybeSingle();
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
    onlineposProductId: normalizeOnlinePosId(input.onlineposProductId),
    onlineposProductName: stringOrNull(input.onlineposProductName),
    onlineposProductGroupName: stringOrNull(input.onlineposProductGroupName),
    lineType: lineType as OnlinePosLineType,
    backeventInventoryItemId: stringOrNull(input.backeventInventoryItemId),
    conversionFactor: numberOrNull(input.conversionFactor),
    mappingAction: mappingAction as OnlinePosMappingAction,
    status: status as OnlinePosMappingStatus,
    components: normalizeComponentsInput(input),
  };
}

function normalizeComponentsInput(input: Record<string, unknown>) {
  if (Array.isArray(input.components)) {
    return normalizeComponents(input.components);
  }

  const backeventInventoryItemId = stringOrNull(input.backeventInventoryItemId);
  const conversionFactor = numberOrNull(input.conversionFactor);

  if (!backeventInventoryItemId || conversionFactor === null) {
    return [];
  }

  return [
    {
      backeventInventoryItemId,
      conversionFactor,
      sortOrder: 0,
    },
  ];
}

function normalizeComponents(values: unknown[]): OnlinePosInventoryMappingComponent[] {
  return values
    .map((value, index): OnlinePosInventoryMappingComponent | null => {
      if (!value || typeof value !== "object") {
        return null;
      }

      const component = value as Record<string, unknown>;
      const backeventInventoryItemId = stringOrNull(component.backeventInventoryItemId);
      const conversionFactor = numberOrNull(component.conversionFactor);

      if (!backeventInventoryItemId || conversionFactor === null) {
        return null;
      }

      return {
        id: stringOrNull(component.id),
        mappingId: stringOrNull(component.mappingId),
        backeventInventoryItemId,
        conversionFactor,
        sortOrder: numberOrNull(component.sortOrder) ?? index,
      };
    })
    .filter((component): component is OnlinePosInventoryMappingComponent => Boolean(component));
}

function hasValidComponents(components: OnlinePosInventoryMappingComponent[]) {
  return components.length > 0 && components.every((component) => component.backeventInventoryItemId && component.conversionFactor !== null);
}

function toMapping(row: Record<string, unknown>, components: OnlinePosInventoryMappingComponent[]): OnlinePosInventoryMapping {
  const legacyBackeventInventoryItemId = stringOrNull(row.backevent_inventory_item_id);
  const legacyConversionFactor = numberOrNull(row.conversion_factor);
  const mappedComponents = components.length > 0
    ? components
    : legacyBackeventInventoryItemId && legacyConversionFactor !== null
      ? [
          {
            backeventInventoryItemId: legacyBackeventInventoryItemId,
            conversionFactor: legacyConversionFactor,
            sortOrder: 0,
          },
        ]
      : [];

  return {
    id: String(row.id),
    onlineposProductId: stringOrNull(row.onlinepos_product_id),
    onlineposProductName: stringOrNull(row.onlinepos_product_name),
    onlineposProductGroupName: stringOrNull(row.onlinepos_product_group_name),
    lineType: row.line_type as OnlinePosLineType,
    backeventInventoryItemId: legacyBackeventInventoryItemId,
    conversionFactor: legacyConversionFactor,
    mappingAction: row.mapping_action as OnlinePosMappingAction,
    status: row.status as OnlinePosMappingStatus,
    components: mappedComponents,
    createdAt: stringOrNull(row.created_at),
    updatedAt: stringOrNull(row.updated_at),
  };
}

function toComponent(row: Record<string, unknown>): OnlinePosInventoryMappingComponent {
  return {
    id: stringOrNull(row.id),
    mappingId: stringOrNull(row.mapping_id),
    backeventInventoryItemId: stringOrNull(row.backevent_inventory_item_id),
    conversionFactor: numberOrNull(row.conversion_factor),
    sortOrder: numberOrNull(row.sort_order) ?? 0,
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

function normalizeOnlinePosId(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value).trim() || null;
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
