import { NextResponse } from "next/server";
import { locations as mockLocations, products as mockProducts, stockBalances as mockBalances } from "@/lib/backevent/mock-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
  tracking_mode: string | null;
  active: boolean | null;
  sort_order: number | null;
};

type BalanceRow = {
  product_id: string;
  location_id: string;
  quantity: number | string | null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const suggestedLocationId = searchParams.get("locationId");
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    const activeLocations = mockLocations.filter((location) => location.active !== false);
    const activeProducts = mockProducts.filter((product) => product.active !== false && product.trackingMode !== "flow" && product.trackingMode !== "ignore");

    return NextResponse.json({
      ok: true,
      suggestedLocationId,
      locations: activeLocations.map((location) => ({ id: location.id, name: location.name, type: location.kind })),
      products: activeProducts.map((product) => ({ id: product.id, name: product.name, unit: product.unit })),
      balances: mockBalances.map((balance) => ({ productId: balance.productId, locationId: balance.locationId, quantity: balance.quantity })),
    });
  }

  const [locationsResponse, productsResponse, balancesResponse] = await Promise.all([
    supabase.from("backevent_locations").select("id,name,type,active").eq("active", true).order("sort_order"),
    supabase
      .from("backevent_products")
      .select("id,name,unit,tracking_mode,active,sort_order")
      .eq("active", true)
      .eq("tracking_mode", "inventory")
      .order("sort_order"),
    supabase.from("backevent_stock_balances").select("product_id,location_id,quantity"),
  ]);

  if (locationsResponse.error || productsResponse.error || balancesResponse.error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente lagerdata" }, { status: 500 });
  }

  const locations = ((locationsResponse.data ?? []) as LocationRow[]).filter((location) => location.active !== false);
  const products = ((productsResponse.data ?? []) as ProductRow[]).filter((product) => product.active !== false);
  const balances = (balancesResponse.data ?? []) as BalanceRow[];

  return NextResponse.json({
    ok: true,
    suggestedLocationId,
    locations: locations.map((location) => ({ id: location.id, name: location.name, type: location.type ?? "container" })),
    products: products.map((product) => ({ id: product.id, name: product.name, unit: product.unit ?? "kasser" })),
    balances: balances.map((balance) => ({
      productId: balance.product_id,
      locationId: balance.location_id,
      quantity: Number(balance.quantity ?? 0),
    })),
  });
}
