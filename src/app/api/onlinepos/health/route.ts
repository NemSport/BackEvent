import { NextResponse } from "next/server";

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
};

type TokenResponse = {
  access_token?: string;
};

const restBaseUrl = "https://rest.onlinepos.dk";
const tokenUrl = `${restBaseUrl}/auth/token`;
const reportUrl = `${restBaseUrl}/reports/getSalesPerProduct`;
const timeoutMs = 8000;

export async function GET() {
  const hasClientId = Boolean(process.env.ONLINEPOS_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.ONLINEPOS_CLIENT_SECRET);

  if (!hasClientId || !hasClientSecret) {
    return jsonHealth({
      ok: false,
      onlineposReachable: false,
      status: null,
      message: "OnlinePOS client credentials mangler",
      tokenRequestStatus: null,
      reportRequestStatus: null,
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
      });
    }

    const reportResponse = await fetch(reportUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const reportMessage = safeResponseMessage(await reportResponse.text());

    clearTimeout(timeout);

    if (reportResponse.status === 400 || reportResponse.status === 401 || reportResponse.status === 403) {
      return jsonHealth({
        ok: false,
        onlineposReachable: true,
        status: reportResponse.status,
        message: reportMessage || reportFailureMessage(reportResponse.status),
        tokenRequestStatus: tokenResponse.status,
        reportRequestStatus: reportResponse.status,
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
      });
    }

    return jsonHealth({
      ok: true,
      onlineposReachable: true,
      status: reportResponse.status,
      message: reportMessage || "OnlinePOS OAuth og report endpoint svarer",
      tokenRequestStatus: tokenResponse.status,
      reportRequestStatus: reportResponse.status,
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
    });
  }
}

function jsonHealth(body: Omit<HealthResponse, "authMode" | "testedUrlHostOnly" | "hasClientId" | "hasClientSecret">) {
  return NextResponse.json({
    ...body,
    authMode: "oauth-client-credentials",
    testedUrlHostOnly: "rest.onlinepos.dk",
    hasClientId: Boolean(process.env.ONLINEPOS_CLIENT_ID),
    hasClientSecret: Boolean(process.env.ONLINEPOS_CLIENT_SECRET),
  } satisfies HealthResponse);
}

function parseAccessToken(text: string) {
  try {
    const json = JSON.parse(text) as TokenResponse;
    return typeof json.access_token === "string" && json.access_token ? json.access_token : null;
  } catch {
    return null;
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

  if (status === 401 || status === 403) {
    return "OnlinePOS report endpoint afviser access token";
  }

  return "OnlinePOS report endpoint fejlede";
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
