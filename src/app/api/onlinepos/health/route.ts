import { NextResponse } from "next/server";

type AuthMode = "reports-token" | "legacy-token-firmaid" | "missing-env";

type HealthResponse = {
  ok: boolean;
  onlineposReachable: boolean;
  status: number | null;
  message: string;
  authMode: AuthMode;
  hasReportsToken: boolean;
  hasLegacyToken: boolean;
  hasFirmaId: boolean;
  testedUrlHostOnly: string | null;
};

type HealthTarget = {
  url: string;
  headers: Record<string, string>;
  authMode: Exclude<AuthMode, "missing-env">;
};

const defaultOnlinePosBaseUrl = "https://api.onlinepos.dk/api";
const defaultReportsBaseUrl = "https://rest.onlinepos.dk";
const timeoutMs = 8000;

export async function GET() {
  const target = getHealthTarget();

  if (!target) {
    return jsonHealth({
      ok: false,
      onlineposReachable: false,
      status: null,
      message: "OnlinePOS API key mangler",
      authMode: "missing-env",
      testedUrlHostOnly: null,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(target.url, {
      method: "GET",
      headers: target.headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const responseMessage = safeResponseMessage(await response.text());

    clearTimeout(timeout);

    if (response.status === 401 || response.status === 403) {
      return jsonHealth({
        ok: false,
        onlineposReachable: true,
        status: response.status,
        message: responseMessage || "OnlinePOS afviser API key",
        authMode: target.authMode,
        testedUrlHostOnly: hostOnly(target.url),
      });
    }

    if (!response.ok) {
      return jsonHealth({
        ok: false,
        onlineposReachable: true,
        status: response.status,
        message: responseMessage || "OnlinePOS svarede uventet",
        authMode: target.authMode,
        testedUrlHostOnly: hostOnly(target.url),
      });
    }

    return jsonHealth({
      ok: true,
      onlineposReachable: true,
      status: response.status,
      message: responseMessage || "OnlinePOS svarer",
      authMode: target.authMode,
      testedUrlHostOnly: hostOnly(target.url),
    });
  } catch (error) {
    clearTimeout(timeout);

    return jsonHealth({
      ok: false,
      onlineposReachable: false,
      status: null,
      message: error instanceof Error && error.name === "AbortError" ? "OnlinePOS kald timeout" : "OnlinePOS kan ikke nås",
      authMode: target.authMode,
      testedUrlHostOnly: hostOnly(target.url),
    });
  }
}

function getHealthTarget(): HealthTarget | null {
  if (process.env.ONLINEPOS_REPORTS_TOKEN) {
    return {
      url: `${(process.env.ONLINEPOS_REPORTS_BASE_URL || defaultReportsBaseUrl).replace(/\/$/, "")}/reports/getSalesPerProduct`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${process.env.ONLINEPOS_REPORTS_TOKEN}`,
      },
      authMode: "reports-token",
    };
  }

  if (process.env.ONLINEPOS_TOKEN && process.env.ONLINEPOS_FIRMAID) {
    return {
      url: `${(process.env.ONLINEPOS_BASE_URL || defaultOnlinePosBaseUrl).replace(/\/$/, "")}/exportSales/v20`,
      headers: {
        Accept: "application/json",
        token: process.env.ONLINEPOS_TOKEN,
        firmaid: process.env.ONLINEPOS_FIRMAID,
      },
      authMode: "legacy-token-firmaid",
    };
  }

  return null;
}

function jsonHealth(body: Omit<HealthResponse, "hasReportsToken" | "hasLegacyToken" | "hasFirmaId">) {
  return NextResponse.json({
    ...body,
    hasReportsToken: Boolean(process.env.ONLINEPOS_REPORTS_TOKEN),
    hasLegacyToken: Boolean(process.env.ONLINEPOS_TOKEN),
    hasFirmaId: Boolean(process.env.ONLINEPOS_FIRMAID),
  } satisfies HealthResponse);
}

function hostOnly(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function safeResponseMessage(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
