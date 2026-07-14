import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

type HealthResponse = {
  ok: boolean;
  onlineposReachable: boolean;
  status: number | null;
  message: string;
  authMode: "oauth-client-credentials";
  tokenRequestStatus: number | null;
  reportRequestStatus: number | null;
  testedUrlHostOnly: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasVenueId: boolean;
  hasTimeFilter: boolean;
  salesRowCount: number;
};

type TokenResponse = {
  access_token?: string;
};

const restBaseUrl = "https://rest.onlinepos.dk";
const tokenUrl = `${restBaseUrl}/auth/token`;
const reportUrl = `${restBaseUrl}/reports/getSalesPerProduct`;
const timeFilter = "Last7Days";
const timeoutMs = 8000;

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  const hasClientId = Boolean(process.env.ONLINEPOS_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.ONLINEPOS_CLIENT_SECRET);
  const hasVenueId = Boolean(process.env.ONLINEPOS_VENUE_ID);

  if (!hasClientId || !hasClientSecret || !hasVenueId) {
    return jsonHealth({
      ok: false,
      onlineposReachable: false,
      status: null,
      message: missingEnvMessage({ hasClientId, hasClientSecret, hasVenueId }),
      tokenRequestStatus: null,
      reportRequestStatus: null,
      salesRowCount: 0,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.ONLINEPOS_CLIENT_ID,
        client_secret: process.env.ONLINEPOS_CLIENT_SECRET,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const tokenText = await tokenResponse.text();
    const tokenMessage = safeResponseMessage(tokenText);

    if (!tokenResponse.ok) {
      clearTimeout(timeout);

      return jsonHealth({
        ok: false,
        onlineposReachable: true,
        status: tokenResponse.status,
        message: tokenMessage || tokenFailureMessage(tokenResponse.status),
        tokenRequestStatus: tokenResponse.status,
        reportRequestStatus: null,
        salesRowCount: 0,
      });
    }

    const accessToken = parseAccessToken(tokenText);

    if (!accessToken) {
      clearTimeout(timeout);

      return jsonHealth({
        ok: false,
        onlineposReachable: true,
        status: tokenResponse.status,
        message: "OnlinePOS token response manglede access_token",
        tokenRequestStatus: tokenResponse.status,
        reportRequestStatus: null,
        salesRowCount: 0,
      });
    }

    const reportResponse = await fetch(reportUrlWithVenueAndFilter(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const reportText = await reportResponse.text();
    const reportMessage = safeResponseMessage(reportText);

    clearTimeout(timeout);

    if ([400, 401, 403, 422].includes(reportResponse.status)) {
      return jsonHealth({
        ok: false,
        onlineposReachable: true,
        status: reportResponse.status,
        message: reportMessage || reportFailureMessage(reportResponse.status),
        tokenRequestStatus: tokenResponse.status,
        reportRequestStatus: reportResponse.status,
        salesRowCount: 0,
      });
    }

    if (!reportResponse.ok) {
      return jsonHealth({
        ok: false,
        onlineposReachable: true,
        status: reportResponse.status,
        message: reportMessage || "OnlinePOS report endpoint svarede uventet",
        tokenRequestStatus: tokenResponse.status,
        reportRequestStatus: reportResponse.status,
        salesRowCount: 0,
      });
    }

    return jsonHealth({
      ok: true,
      onlineposReachable: true,
      status: reportResponse.status,
      message: "Sales per product fetched",
      tokenRequestStatus: tokenResponse.status,
      reportRequestStatus: reportResponse.status,
      salesRowCount: getSalesRowCount(reportText),
    });
  } catch (error) {
    clearTimeout(timeout);

    return jsonHealth({
      ok: false,
      onlineposReachable: false,
      status: null,
      message: error instanceof Error && error.name === "AbortError" ? "OnlinePOS kald timeout" : "OnlinePOS kan ikke nås",
      tokenRequestStatus: null,
      reportRequestStatus: null,
      salesRowCount: 0,
    });
  }
}

function jsonHealth(
  body: Omit<
    HealthResponse,
    "authMode" | "testedUrlHostOnly" | "hasClientId" | "hasClientSecret" | "hasVenueId" | "hasTimeFilter"
  >,
) {
  return NextResponse.json({
    ...body,
    authMode: "oauth-client-credentials",
    testedUrlHostOnly: "rest.onlinepos.dk",
    hasClientId: Boolean(process.env.ONLINEPOS_CLIENT_ID),
    hasClientSecret: Boolean(process.env.ONLINEPOS_CLIENT_SECRET),
    hasVenueId: Boolean(process.env.ONLINEPOS_VENUE_ID),
    hasTimeFilter: true,
  } satisfies HealthResponse);
}

function reportUrlWithVenueAndFilter() {
  const url = new URL(reportUrl);
  url.searchParams.set("venue", process.env.ONLINEPOS_VENUE_ID ?? "");
  url.searchParams.set("predefined_filter", timeFilter);
  url.searchParams.set("sorting", "DESC");
  url.searchParams.set("sorting_base", "revenue");
  return url;
}

function parseAccessToken(text: string) {
  try {
    const json = JSON.parse(text) as TokenResponse;
    return typeof json.access_token === "string" && json.access_token ? json.access_token : null;
  } catch {
    return null;
  }
}

function getSalesRowCount(text: string) {
  try {
    const json = JSON.parse(text) as { data?: { sales?: unknown } };
    return Array.isArray(json.data?.sales) ? json.data.sales.length : 0;
  } catch {
    return 0;
  }
}

function tokenFailureMessage(status: number) {
  if (status === 401) {
    return "OnlinePOS afviser client credentials";
  }

  return "OnlinePOS token request fejlede";
}

function reportFailureMessage(status: number) {
  if (status === 400) {
    return "OnlinePOS report request mangler eller afviser parametre";
  }

  if (status === 422) {
    return "OnlinePOS report request afviser venue eller parametre";
  }

  if (status === 401 || status === 403) {
    return "OnlinePOS report endpoint afviser access token";
  }

  return "OnlinePOS report endpoint fejlede";
}

function missingEnvMessage({
  hasClientId,
  hasClientSecret,
  hasVenueId,
}: {
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasVenueId: boolean;
}) {
  const missing = [
    !hasClientId ? "ONLINEPOS_CLIENT_ID" : null,
    !hasClientSecret ? "ONLINEPOS_CLIENT_SECRET" : null,
    !hasVenueId ? "ONLINEPOS_VENUE_ID" : null,
  ].filter(Boolean);

  return `OnlinePOS env mangler: ${missing.join(", ")}`;
}

function safeResponseMessage(text: string) {
  if (containsSensitiveOnlinePosData(text)) {
    return "OnlinePOS svarede, men body er skjult af hensyn til følsomme data";
  }

  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function containsSensitiveOnlinePosData(text: string) {
  return /business_number|access_token|client_secret|client_id/i.test(text);
}
