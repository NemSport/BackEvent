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
  const suggestedLocationId = searchParams.get("locationId");
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    const activeLocations = mockLocations.filter((location) => location.active !== false);
    const activeProducts = mockProducts.filter((product) => product.active !== false && product.trackingMode !== "flow" && product.trackingMode !== "ignore");

    return NextResponse.json({
      ok: true,
      suggestedLocationId,
      locations: activeLocations.map((location) => ({ id: location.id, name: location.name, type: location.kind })),
      products: activeProducts.map((product) => ({
        id: product.id,
        name: product.name,
        unit: product.unit,
        purchaseUnitLabel: product.purchaseUnitLabel,
        unitsPerPurchaseUnit: product.unitsPerPurchaseUnit,
        unitsPerCase: product.unitsPerCase,
        stockUnitLabel: product.stockUnitLabel,
        contentPerStockUnit: product.contentPerStockUnit,
        consumptionUnitLabel: product.consumptionUnitLabel,
      })),
      balances: mockBalances.map((balance) => ({ productId: balance.productId, locationId: balance.locationId, quantity: balance.quantity })),
    });
  }

  const [locationsResponse, productsResponse, balancesResponse] = await Promise.all([
    supabase.from("backevent_locations").select("id,name,type,active").eq("active", true).order("sort_order"),
    supabase
      .from("backevent_products")
      .select("id,name,unit,tracking_mode,active,sort_order,units_per_case,purchase_unit_label,units_per_purchase_unit,stock_unit_label,content_per_stock_unit,consumption_unit_label")
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
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit ?? "kasser",
      purchaseUnitLabel: product.purchase_unit_label,
      unitsPerPurchaseUnit: product.units_per_purchase_unit === null ? null : Number(product.units_per_purchase_unit),
      unitsPerCase: product.units_per_case,
      stockUnitLabel: product.stock_unit_label,
      contentPerStockUnit: product.content_per_stock_unit === null ? null : Number(product.content_per_stock_unit),
      consumptionUnitLabel: product.consumption_unit_label,
    })),
    balances: balances.map((balance) => ({
      productId: balance.product_id,
      locationId: balance.location_id,
      quantity: Number(balance.quantity ?? 0),
    })),
  });
}
