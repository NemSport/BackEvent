import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  locations as mockLocations,
  products as mockProducts,
  stockBalances as mockBalances,
} from "@/lib/backevent/mock-data";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

type AlertItem = {
  locationId: string;
  locationName: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  threshold: number;
};

type LocationRow = { id: string; name: string; type: string | null; active: boolean | null };
type ProductRow = { id: string; name: string; unit: string | null; tracking_mode: string | null; active: boolean | null };
type BalanceRow = { product_id: string; location_id: string; quantity: number | string | null };

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ansvarlig");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  try {
    const { lowStockItems, criticalStockItems } = auth.supabase ? await getSupabaseAlertItems(auth.supabase) : getMockAlertItems();
    const previewSubject =
      criticalStockItems.length > 0
        ? `BackEvent: ${criticalStockItems.length} kritiske lagerlinjer`
        : `BackEvent: ${lowStockItems.length} varer med lavt lager`;
    const previewText = buildPreviewText(lowStockItems, criticalStockItems);

    return NextResponse.json({
      ok: true,
      lowStockItems,
      criticalStockItems,
      previewSubject,
      previewText,
    });
  } catch {
    return NextResponse.json({ ok: false, message: "Kunne ikke lave lager-preview" }, { status: 500 });
  }
}

async function getSupabaseAlertItems(supabase: SupabaseClient) {
  const [locationsResponse, productsResponse, balancesResponse] = await Promise.all([
    supabase.from("backevent_locations").select("id,name,type,active").eq("active", true),
    supabase.from("backevent_products").select("id,name,unit,tracking_mode,active").eq("active", true).eq("tracking_mode", "inventory"),
    supabase.from("backevent_stock_balances").select("product_id,location_id,quantity"),
  ]);

  if (locationsResponse.error || productsResponse.error || balancesResponse.error) {
    throw new Error("Lagerdata kunne ikke hentes");
  }

  const locations = ((locationsResponse.data ?? []) as LocationRow[]).filter((location) => location.type === "container");
  const products = (productsResponse.data ?? []) as ProductRow[];
  const balances = (balancesResponse.data ?? []) as BalanceRow[];

  return buildAlertItems(
    locations.map((location) => ({ id: location.id, name: location.name })),
    products.map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit ?? "kasser",
      ...thresholdsForProduct(product.name),
    })),
    balances.map((balance) => ({
      locationId: balance.location_id,
      productId: balance.product_id,
      quantity: Number(balance.quantity ?? 0),
    })),
  );
}

function getMockAlertItems() {
  return buildAlertItems(
    mockLocations.filter((location) => location.kind === "container").map((location) => ({ id: location.id, name: location.name })),
    mockProducts.map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
      lowThreshold: product.lowThreshold,
      criticalThreshold: product.criticalThreshold,
    })),
    mockBalances.map((balance) => ({
      locationId: balance.locationId,
      productId: balance.productId,
      quantity: balance.quantity,
    })),
  );
}

function buildAlertItems(
  locations: Array<{ id: string; name: string }>,
  products: Array<{ id: string; name: string; unit: string; lowThreshold: number; criticalThreshold: number }>,
  balances: Array<{ locationId: string; productId: string; quantity: number }>,
) {
  const lowStockItems: AlertItem[] = [];
  const criticalStockItems: AlertItem[] = [];

  for (const balance of balances) {
    const location = locations.find((item) => item.id === balance.locationId);
    const product = products.find((item) => item.id === balance.productId);

    if (!location || !product) {
      continue;
    }

    if (balance.quantity <= product.criticalThreshold || balance.quantity < 0) {
      criticalStockItems.push({
        locationId: location.id,
        locationName: location.name,
        productId: product.id,
        productName: product.name,
        quantity: balance.quantity,
        unit: product.unit,
        threshold: product.criticalThreshold,
      });
    } else if (balance.quantity <= product.lowThreshold) {
      lowStockItems.push({
        locationId: location.id,
        locationName: location.name,
        productId: product.id,
        productName: product.name,
        quantity: balance.quantity,
        unit: product.unit,
        threshold: product.lowThreshold,
      });
    }
  }

  return {
    lowStockItems: lowStockItems.sort(sortAlertItems),
    criticalStockItems: criticalStockItems.sort(sortAlertItems),
  };
}

function buildPreviewText(lowStockItems: AlertItem[], criticalStockItems: AlertItem[]) {
  if (lowStockItems.length === 0 && criticalStockItems.length === 0) {
    return "Ingen lave eller kritiske lagerlinjer lige nu.";
  }

  const lines = ["BackEvent lageralarm", ""];

  if (criticalStockItems.length > 0) {
    lines.push("Kritisk lavt lager:");
    criticalStockItems.slice(0, 20).forEach((item) => {
      lines.push(`- ${item.productName} i ${item.locationName}: ${item.quantity.toLocaleString("da-DK")} ${item.unit}`);
    });
    lines.push("");
  }

  if (lowStockItems.length > 0) {
    lines.push("Lavt lager:");
    lowStockItems.slice(0, 20).forEach((item) => {
      lines.push(`- ${item.productName} i ${item.locationName}: ${item.quantity.toLocaleString("da-DK")} ${item.unit}`);
    });
  }

  return lines.join("\n");
}

function sortAlertItems(a: AlertItem, b: AlertItem) {
  return a.locationName.localeCompare(b.locationName, "da") || a.productName.localeCompare(b.productName, "da");
}

function thresholdsForProduct(name: string) {
  switch (name) {
    case "Tuborg 33 cl":
      return { lowThreshold: 16, criticalThreshold: 8 };
    case "Tuborg Classic":
      return { lowThreshold: 12, criticalThreshold: 6 };
    case "Pepsi Max":
    case "Faxe Kondi":
      return { lowThreshold: 10, criticalThreshold: 5 };
    case "Vand":
      return { lowThreshold: 14, criticalThreshold: 7 };
    case "Somersby":
      return { lowThreshold: 8, criticalThreshold: 4 };
    case "Fadøl 25L":
      return { lowThreshold: 5, criticalThreshold: 2 };
    default:
      return { lowThreshold: 10, criticalThreshold: 5 };
  }
}
