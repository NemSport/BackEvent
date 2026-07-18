import { NextResponse } from "next/server";
import { requireReturnAccess } from "@/lib/backevent/return-access";
import { buildReceiptControlWorkbook } from "@/lib/backevent/receipt-control-export";
import {
  fetchReceiptControls,
  mapReceiptControlRow,
  parseReceiptControlFilters,
} from "@/lib/backevent/receipt-control-query";

export async function GET(request: Request) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  if (!auth.canControl) return NextResponse.json({ ok: false, message: "Du har ikke adgang til eksport" }, { status: 403 });
  if (!auth.supabase) return NextResponse.json({ ok: false, message: "Ingen data at eksportere" }, { status: 404 });

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "filtered";
  const filters = parseReceiptControlFilters(scope === "all" ? new URLSearchParams({ status: "all" }) : url.searchParams);
  const selectedIds = scope === "selected"
    ? (url.searchParams.get("ids") ?? "").split(",").filter(isUuid).slice(0, 1000)
    : undefined;
  if (scope === "selected" && !selectedIds?.length) {
    return NextResponse.json({ ok: false, message: "Vælg mindst én bon" }, { status: 400 });
  }

  const items: Array<ReturnType<typeof mapReceiptControlRow>> = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await fetchReceiptControls(auth.supabase, filters, {
      all: true,
      page,
      selectedIds,
      currentUserId: auth.userId,
    });
    if (result.error) {
      console.error("[receipt-control-export-api] query failed", { code: result.error.code, message: result.error.message });
      return NextResponse.json({ ok: false, message: "Eksporten kunne ikke dannes" }, { status: 500 });
    }
    items.push(...(result.data ?? []).map((row) => mapReceiptControlRow(row as Record<string, unknown>)));
    if ((result.data?.length ?? 0) < result.pageSize || items.length >= result.total) break;
  }
  const workbook = await buildReceiptControlWorkbook(items);
  const filename = exportFilename(filters.dateFrom, filters.dateTo);
  return new Response(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function exportFilename(from: string, to: string) {
  if (from && to) return `backevent-returkontrol-${from}-til-${to}.xlsx`;
  return `backevent-returkontrol-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
