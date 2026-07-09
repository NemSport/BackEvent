import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  getExportSalesFallback,
  getLatestOnlinePosSales,
  getOnlinePosEnvStatus,
  getOnlinePosSalesByDate,
  getOnlinePosReportsEnvStatus,
  getReportsSalesPerProduct,
  testOnlinePosConnection,
  testOnlinePosReportsApi,
} from "@/lib/onlinepos/client";
import { isOwnerRole } from "@/lib/backevent/permissions";
import type { OnlinePosProbeAction, OnlinePosReportsParamMode } from "@/lib/onlinepos/types";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuthFailureDebug = {
  hasUser: boolean;
  profileRole: string | null;
  profileActive: boolean | null;
  userEmail: string | null;
};

export async function GET() {
  const access = await ensureAdminAccess();

  if (!access.ok) {
    return NextResponse.json({ error: access.error, debug: access.debug }, { status: access.status });
  }

  return NextResponse.json({ env: getOnlinePosEnvStatus(), reportsEnv: getOnlinePosReportsEnvStatus() });
}

export async function POST(request: Request) {
  const access = await ensureAdminAccess();

  if (!access.ok) {
    return NextResponse.json({ error: access.error, debug: access.debug }, { status: access.status });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: OnlinePosProbeAction;
    date?: string;
    reportsParamMode?: OnlinePosReportsParamMode;
  };
  const action = body.action ?? "connection";

  try {
    if (action === "reports-test") {
      return NextResponse.json({
        env: getOnlinePosEnvStatus(),
        reportsEnv: getOnlinePosReportsEnvStatus(),
        result: await testOnlinePosReportsApi(body.reportsParamMode ?? "none", body.date),
      });
    }

    if (action === "reports-sales-per-product") {
      return NextResponse.json({
        env: getOnlinePosEnvStatus(),
        reportsEnv: getOnlinePosReportsEnvStatus(),
        result: await getReportsSalesPerProduct(body.reportsParamMode ?? "none", body.date ?? new Date().toISOString().slice(0, 10)),
      });
    }

    if (action === "sales-by-date") {
      if (!body.date) {
        return NextResponse.json({ error: "Dato mangler" }, { status: 400 });
      }

      return NextResponse.json({
        env: getOnlinePosEnvStatus(),
        reportsEnv: getOnlinePosReportsEnvStatus(),
        result: await getOnlinePosSalesByDate(body.date),
      });
    }

    if (action === "latest-sales") {
      return NextResponse.json({
        env: getOnlinePosEnvStatus(),
        reportsEnv: getOnlinePosReportsEnvStatus(),
        result: await getLatestOnlinePosSales(),
      });
    }

    if (action === "export-sales-fallback") {
      return NextResponse.json({
        env: getOnlinePosEnvStatus(),
        reportsEnv: getOnlinePosReportsEnvStatus(),
        result: await getExportSalesFallback(),
      });
    }

    return NextResponse.json({
      env: getOnlinePosEnvStatus(),
      reportsEnv: getOnlinePosReportsEnvStatus(),
      result: await testOnlinePosConnection(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        env: getOnlinePosEnvStatus(),
        reportsEnv: getOnlinePosReportsEnvStatus(),
        error: error instanceof Error ? error.message : "OnlinePOS svarede med en ukendt fejl",
      },
      { status: 500 },
    );
  }
}

async function ensureAdminAccess(): Promise<{ ok: true } | { ok: false; status: number; error: string; debug: AuthFailureDebug }> {
  if (!isSupabaseConfigured()) {
    return { ok: true };
  }

  const authorization = (await headers()).get("authorization");

  if (!authorization) {
    return { ok: false, status: 401, error: "Du skal være logget ind", debug: createAuthDebug() };
  }

  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const supabase = createSupabaseServerClient(accessToken);

  if (!supabase) {
    return { ok: true };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return {
      ok: false,
      status: 401,
      error: "Du skal være logget ind",
      debug: createAuthDebug({
        hasUser: Boolean(user),
        userEmail: user?.email ?? null,
      }),
    };
  }

  const { data: profile } = await supabase.from("backevent_profiles").select("role,active").eq("id", user.id).maybeSingle();

  if (!profile?.active || !isOwnerRole(profile.role)) {
    return {
      ok: false,
      status: 403,
      error: "Kun ejer kan gøre dette",
      debug: createAuthDebug({
        hasUser: true,
        profileRole: profile?.role ?? null,
        profileActive: profile?.active ?? null,
        userEmail: user.email ?? null,
      }),
    };
  }

  return { ok: true };
}

function createAuthDebug(debug: Partial<AuthFailureDebug> = {}): AuthFailureDebug {
  return {
    hasUser: debug.hasUser ?? false,
    profileRole: debug.profileRole ?? null,
    profileActive: debug.profileActive ?? null,
    userEmail: debug.userEmail ?? null,
  };
}
