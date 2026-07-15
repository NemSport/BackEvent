import { NextResponse } from "next/server";
import { locations as mockLocations, products as mockProducts, stockBalances as mockBalances } from "@/lib/backevent/mock-data";
import { isUuid } from "@/lib/backevent/qr-move-request";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

type LocationRow = {
  id: string;
  name: string;
  type: string | null;
  active: boolean | null;
};

type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  active: boolean | null;
  units_per_case?: number | null;
  purchase_unit_label?: string | null;
  units_per_purchase_unit?: number | string | null;
  stock_unit_label?: string | null;
  content_per_stock_unit?: number | string | null;
  consumption_unit_label?: string | null;
};

type BalanceRow = {
  product_id: string;
  location_id: string;
  quantity: number | string | null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const suggestedLocationId = searchParams.get("locationId")?.trim() ?? "";

  if (!suggestedLocationId || suggestedLocationId.length > 100) {
    return NextResponse.json({ ok: false, message: "QR-linket er ugyldigt" }, { status: 400 });
  }

  // Authentication is optional on this one narrowly scoped endpoint. A valid
  // session only adds the user's own name and stock quantities to the response.
  const auth = await requireBackEventRole(request, "frivillig");
  const isAuthenticated = auth.ok;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    if (isSupabaseConfigured()) {
      return NextResponse.json({ ok: false, message: "Vi kunne ikke hente lagerflowet lige nu" }, { status: 500 });
    }

    const startLocation = mockLocations.find((location) => location.id === suggestedLocationId);

    if (!startLocation || startLocation.active === false) {
      return NextResponse.json({ ok: false, message: "QR-lokationen findes ikke eller er deaktiveret" }, { status: 404 });
    }

    const activeLocations = mockLocations.filter((location) => location.active !== false);
    const activeProducts = mockProducts.filter(
      (product) => product.active !== false && product.trackingMode === "inventory",
    );

    return NextResponse.json({
      ok: true,
      suggestedLocationId,
      authenticated: isAuthenticated,
      actorName: isAuthenticated && auth.ok ? auth.userEmail ?? "Mock mode" : null,
      locations: activeLocations.map((location) => ({ id: location.id, name: location.name, type: location.kind })),
      products: activeProducts.map(toMockProduct),
      ...(isAuthenticated
        ? {
            balances: mockBalances.map((balance) => ({
              productId: balance.productId,
              locationId: balance.locationId,
              quantity: balance.quantity,
            })),
          }
        : {}),
    });
  }

  if (!isUuid(suggestedLocationId)) {
    return NextResponse.json({ ok: false, message: "QR-linket er ugyldigt" }, { status: 400 });
  }

  const [startResponse, locationsResponse, productsResponse, balancesResponse, profileResponse] = await Promise.all([
    supabase.from("backevent_locations").select("id,name,type,active").eq("id", suggestedLocationId).maybeSingle(),
    supabase.from("backevent_locations").select("id,name,type,active").eq("active", true).order("sort_order"),
    supabase
      .from("backevent_products")
      .select("id,name,unit,active,units_per_case,purchase_unit_label,units_per_purchase_unit,stock_unit_label,content_per_stock_unit,consumption_unit_label")
      .eq("active", true)
      .eq("tracking_mode", "inventory")
      .order("sort_order"),
    isAuthenticated
      ? supabase.from("backevent_stock_balances").select("product_id,location_id,quantity")
      : Promise.resolve({ data: null, error: null }),
    isAuthenticated && auth.ok
      ? supabase.from("backevent_profiles").select("full_name,email").eq("id", auth.userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (startResponse.error || locationsResponse.error || productsResponse.error || balancesResponse.error || profileResponse.error) {
    return NextResponse.json({ ok: false, message: "Vi kunne ikke hente lagerflowet lige nu" }, { status: 500 });
  }

  const startLocation = startResponse.data as LocationRow | null;
  if (!startLocation || startLocation.active === false) {
    return NextResponse.json({ ok: false, message: "QR-lokationen findes ikke eller er deaktiveret" }, { status: 404 });
  }

  const locations = (locationsResponse.data ?? []) as LocationRow[];
  const products = (productsResponse.data ?? []) as ProductRow[];
  const balances = (balancesResponse.data ?? []) as BalanceRow[];
  const profile = profileResponse.data as { full_name?: string | null; email?: string | null } | null;

  return NextResponse.json({
    ok: true,
    suggestedLocationId,
    authenticated: isAuthenticated,
    actorName: isAuthenticated && auth.ok
      ? profile?.full_name || profile?.email || auth.userEmail || "Ukendt bruger"
      : null,
    locations: locations.map((location) => ({ id: location.id, name: location.name, type: location.type ?? "container" })),
    products: products.map(toProduct),
    ...(isAuthenticated
      ? {
          balances: balances.map((balance) => ({
            productId: balance.product_id,
            locationId: balance.location_id,
            quantity: Number(balance.quantity ?? 0),
          })),
        }
      : {}),
  });
}

function toMockProduct(product: (typeof mockProducts)[number]) {
  return {
    id: product.id,
    name: product.name,
    unit: product.unit,
    purchaseUnitLabel: product.purchaseUnitLabel,
    unitsPerPurchaseUnit: product.unitsPerPurchaseUnit,
    unitsPerCase: product.unitsPerCase,
    stockUnitLabel: product.stockUnitLabel,
    contentPerStockUnit: product.contentPerStockUnit,
    consumptionUnitLabel: product.consumptionUnitLabel,
  };
}

function toProduct(product: ProductRow) {
  return {
    id: product.id,
    name: product.name,
    unit: product.unit ?? "kasser",
    purchaseUnitLabel: product.purchase_unit_label,
    unitsPerPurchaseUnit: product.units_per_purchase_unit === null ? null : Number(product.units_per_purchase_unit),
    unitsPerCase: product.units_per_case,
    stockUnitLabel: product.stock_unit_label,
    contentPerStockUnit: product.content_per_stock_unit === null ? null : Number(product.content_per_stock_unit),
    consumptionUnitLabel: product.consumption_unit_label,
  };
}
