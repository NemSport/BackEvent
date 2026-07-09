import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuthFailureDebug = {
  hasUser: boolean;
  profileRole: string | null;
  profileActive: boolean | null;
  userEmail: string | null;
};

type MappingRow = {
  onlinepos_product_id: string | null;
  onlinepos_product_name: string | null;
  onlinepos_product_group_name: string | null;
  line_type: string | null;
  mapping_action: string | null;
  status: string | null;
  backevent_inventory_item_id: string | null;
  conversion_factor: number | null;
  created_at: string | null;
  updated_at: string | null;
};

const mappingColumns =
  "onlinepos_product_id,onlinepos_product_name,onlinepos_product_group_name,line_type,mapping_action,status,backevent_inventory_item_id,conversion_factor,created_at,updated_at";

export async function GET(request: Request) {
  const access = await ensureAdminAccess();

  if (!access.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: access.error,
        errorStep: "auth",
        debug: access.debug,
      },
      { status: access.status },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        message: "Supabase mangler. Mappinger kan ikke hentes.",
        errorStep: "missing_supabase",
      },
      { status: 503 },
    );
  }

  const supabase = createSupabaseServerClient(access.accessToken);

  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        message: "Supabase kunne ikke oprettes.",
        errorStep: "supabase_client",
      },
      { status: 500 },
    );
  }

  const onlineposProductId = new URL(request.url).searchParams.get("onlinepos_product_id");
  const result = onlineposProductId
    ? await getRowsByProductId(supabase, onlineposProductId)
    : await supabase
        .from("onlinepos_inventory_mappings")
        .select(mappingColumns)
        .order("onlinepos_product_name", { ascending: true });

  if (result.error) {
    return NextResponse.json(
      {
        ok: false,
        message: "Mappinger kunne ikke hentes.",
        errorStep: "select_mappings",
      },
      { status: 500 },
    );
  }

  const rows = (result.data ?? []).map(toSafeRow);

  return NextResponse.json({
    ok: true,
    source: "supabase",
    rowCount: rows.length,
    rows,
  });
}

async function getRowsByProductId(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
  onlineposProductId: string,
) {
  const ids = Array.from(new Set([onlineposProductId, normalizeOnlinePosId(onlineposProductId)].filter(Boolean)));
  const rows: Record<string, unknown>[] = [];

  for (const id of ids) {
    const { data, error } = await supabase
      .from("onlinepos_inventory_mappings")
      .select(mappingColumns)
      .eq("onlinepos_product_id", id)
      .order("onlinepos_product_name", { ascending: true });

    if (error) {
      return { data: null, error };
    }

    rows.push(...(data ?? []));
  }

  return { data: dedupeRows(rows), error: null };
}

function dedupeRows(rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.onlinepos_product_id,
      row.onlinepos_product_name,
      row.onlinepos_product_group_name,
      row.line_type,
      row.mapping_action,
      row.status,
      row.backevent_inventory_item_id,
      row.conversion_factor,
      row.created_at,
      row.updated_at,
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function toSafeRow(row: Record<string, unknown>): MappingRow {
  return {
    onlinepos_product_id: stringOrNull(row.onlinepos_product_id),
    onlinepos_product_name: stringOrNull(row.onlinepos_product_name),
    onlinepos_product_group_name: stringOrNull(row.onlinepos_product_group_name),
    line_type: stringOrNull(row.line_type),
    mapping_action: stringOrNull(row.mapping_action),
    status: stringOrNull(row.status),
    backevent_inventory_item_id: stringOrNull(row.backevent_inventory_item_id),
    conversion_factor: numberOrNull(row.conversion_factor),
    created_at: stringOrNull(row.created_at),
    updated_at: stringOrNull(row.updated_at),
  };
}

function normalizeOnlinePosId(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value).trim() || null;
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
    return { ok: false, status: 401, error: "Du skal vÃ¦re logget ind", debug: createAuthDebug() };
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
      error: "Du skal vÃ¦re logget ind",
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
      error: "Kun admin kan gÃ¸re dette",
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
