import { NextResponse } from "next/server";

type HealthResponse = {
  ok: boolean;
  onlineposReachable: boolean;
  status: number | null;
  message: string;
};

type HealthTarget = {
  url: string;
  headers: Record<string, string>;
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

    clearTimeout(timeout);

    if (response.status === 401 || response.status === 403) {
      return jsonHealth({
        ok: false,
        onlineposReachable: true,
        status: response.status,
        message: "OnlinePOS afviser API key",
      });
    }

    if (!response.ok) {
      return jsonHealth({
        ok: false,
        onlineposReachable: true,
        status: response.status,
        message: "OnlinePOS svarede uventet",
      });
    }

    return jsonHealth({
      ok: true,
      onlineposReachable: true,
      status: response.status,
      message: "OnlinePOS svarer",
    });
  } catch (error) {
    clearTimeout(timeout);

    return jsonHealth({
      ok: false,
      onlineposReachable: false,
      status: null,
      message: error instanceof Error && error.name === "AbortError" ? "OnlinePOS kald timeout" : "OnlinePOS kan ikke nås",
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
    };
  }

  return null;
}

function jsonHealth(body: HealthResponse) {
  return NextResponse.json(body);
}
