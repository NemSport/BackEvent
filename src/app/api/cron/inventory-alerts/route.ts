import { NextResponse } from "next/server";
import { runInventoryAlerts } from "@/lib/backevent/inventory-alert-runner";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Ikke adgang" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        message: "Cron mangler Supabase service role",
      },
      { status: 500 },
    );
  }

  const result = await runInventoryAlerts(supabase, { runType: "cron" });
  return NextResponse.json(result, { status: result.runStatus === "failed" ? 500 : 200 });
}

function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.replace(/^Bearer\s+/i, "").trim();
  const headerSecret = request.headers.get("x-cron-secret") ?? "";

  return bearerToken === secret || headerSecret === secret;
}
