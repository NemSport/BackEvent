import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { runOnlinePosReturnSync } from "@/lib/onlinepos/returns";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as { datetimeFrom?: string; datetimeTo?: string };
  if (!body.datetimeFrom || !body.datetimeTo) {
    return NextResponse.json({ ok: false, message: "Vælg periode" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, message: "Supabase service role mangler" }, { status: 500 });
  }

  const result = await runOnlinePosReturnSync({
    supabase,
    datetimeFrom: body.datetimeFrom,
    datetimeTo: body.datetimeTo,
    source: "manual",
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
