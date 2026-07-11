import { NextResponse } from "next/server";
import { runOnlinePosReturnSync } from "@/lib/onlinepos/returns";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Ikke adgang" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, message: "Cron mangler Supabase service role" }, { status: 500 });
  }

  const now = new Date();
  const from = new Date(now.getTime() - 20 * 60 * 1000);
  const result = await runOnlinePosReturnSync({
    supabase,
    datetimeFrom: from.toISOString(),
    datetimeTo: now.toISOString(),
    source: "cron",
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.replace(/^Bearer\s+/i, "").trim();
  const headerSecret = request.headers.get("x-cron-secret") ?? "";
  return bearerToken === secret || headerSecret === secret;
}
