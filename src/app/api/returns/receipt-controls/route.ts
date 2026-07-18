import { NextResponse } from "next/server";
import { requireReturnAccess } from "@/lib/backevent/return-access";
import {
  fetchReceiptControls,
  mapReceiptControlRow,
  parseReceiptControlFilters,
} from "@/lib/backevent/receipt-control-query";

export async function GET(request: Request) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  if (!auth.canControl) return NextResponse.json({ ok: false, message: "Du har ikke adgang til bonkontroller" }, { status: 403 });
  if (!auth.supabase) return NextResponse.json({ ok: true, items: [], total: 0, page: 1, pageSize: 25, locations: [], handlers: [] });

  const url = new URL(request.url);
  const filters = parseReceiptControlFilters(url.searchParams);
  const page = positiveInteger(url.searchParams.get("page"), 1);
  const pageSize = positiveInteger(url.searchParams.get("pageSize"), 25);
  const [result, locationsResult, handlersResult] = await Promise.all([
    fetchReceiptControls(auth.supabase, filters, { page, pageSize, currentUserId: auth.userId }),
    auth.supabase.from("backevent_locations").select("id,name").eq("active", true).order("name"),
    auth.supabase.from("backevent_profiles").select("id,full_name,email").eq("active", true).order("full_name"),
  ]);

  if (result.error) {
    console.error("[receipt-control-list-api] query failed", { code: result.error.code, message: result.error.message });
    return NextResponse.json({ ok: false, message: "Bonkontroller kunne ikke hentes" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    items: (result.data ?? []).map((row) => mapReceiptControlRow(row as Record<string, unknown>)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    locations: (locationsResult.data ?? []).map((item) => ({ id: String(item.id), name: String(item.name) })),
    handlers: (handlersResult.data ?? []).map((item) => ({
      id: String(item.id),
      name: item.full_name?.trim() || item.email || "Ukendt bruger",
    })),
    currentUserId: auth.userId,
  });
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
