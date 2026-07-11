import { NextResponse } from "next/server";
import { requireReturnAccess } from "@/lib/backevent/return-access";

export async function GET(request: Request, context: { params: Promise<{ returnId: string }> }) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  const { returnId } = await context.params;

  if (!auth.supabase) {
    return NextResponse.json({ ok: false, message: "Ingen data endnu" }, { status: 404 });
  }

  const { data: returnRow, error } = await auth.supabase
    .from("backevent_returns")
    .select("*, backevent_locations(name)")
    .eq("id", returnId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, message: "Retur kunne ikke hentes" }, { status: 500 });
  if (!returnRow) return NextResponse.json({ ok: false, message: "Retur ikke fundet" }, { status: 404 });

  const [{ data: lines }, { data: history }] = await Promise.all([
    auth.supabase.from("backevent_return_lines").select("*, backevent_products(name,unit,purchase_unit_label,stock_unit_label,consumption_unit_label)").eq("return_id", returnId).order("created_at"),
    auth.supabase.from("backevent_return_history").select("*").eq("return_id", returnId).order("created_at", { ascending: false }),
  ]);

  return NextResponse.json({
    ok: true,
    canControl: auth.canControl,
    return: {
      ...returnRow,
      locationName: relationName(returnRow.backevent_locations) ?? returnRow.onlinepos_location_ref ?? "Ukendt sted",
    },
    lines: lines ?? [],
    history: history ?? [],
  });
}

function relationName(value: unknown) {
  if (Array.isArray(value)) return relationName(value[0]);
  if (value && typeof value === "object" && "name" in value) return String((value as { name: unknown }).name ?? "");
  return null;
}
