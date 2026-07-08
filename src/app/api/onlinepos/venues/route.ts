import { NextResponse } from "next/server";

type VenuesResponse = {
  ok: boolean;
  status: number | null;
  message: string;
  tokenRequestStatus: number | null;
  venuesRequestStatus: number | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasConcern: boolean;
  venueCount: number;
  venues: SafeVenue[];
};

type TokenResponse = {
  access_token?: string;
};

type SafeVenue = {
  venue_id: string | number | null;
  venue_name: string | null;
  status: string | null;
  country_code: string | null;
  city: string | null;
};

const restBaseUrl = "https://rest.onlinepos.dk";
const tokenUrl = `${restBaseUrl}/auth/token`;
const venuesUrl = `${restBaseUrl}/concern/venues`;
const timeoutMs = 8000;

export async function GET() {
  const hasClientId = Boolean(process.env.ONLINEPOS_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.ONLINEPOS_CLIENT_SECRET);
  const hasConcern = Boolean(process.env.ONLINEPOS_CONCERN);

  if (!hasClientId || !hasClientSecret || !hasConcern) {
    return jsonVenues({
      ok: false,
      status: null,
      message: missingEnvMessage({ hasClientId, hasClientSecret, hasConcern }),
      tokenRequestStatus: null,
      venuesRequestStatus: null,
      venueCount: 0,
      venues: [],
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
      return jsonVenues({
        ok: false,
        status: tokenResponse.status,
        message: tokenMessage || tokenFailureMessage(tokenResponse.status),
        tokenRequestStatus: tokenResponse.status,
        venuesRequestStatus: null,
        venueCount: 0,
        venues: [],
      });
    }

    const accessToken = parseAccessToken(tokenText);

    if (!accessToken) {
      clearTimeout(timeout);
      return jsonVenues({
        ok: false,
        status: tokenResponse.status,
        message: "OnlinePOS token response manglede access_token",
        tokenRequestStatus: tokenResponse.status,
        venuesRequestStatus: null,
        venueCount: 0,
        venues: [],
      });
    }

    const url = new URL(venuesUrl);
    url.searchParams.set("concern", process.env.ONLINEPOS_CONCERN ?? "");

    const venuesResponse = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const venuesText = await venuesResponse.text();
    const venuesMessage = safeResponseMessage(venuesText);
    const venues = venuesResponse.ok ? parseVenues(venuesText) : [];

    clearTimeout(timeout);

    if (!venuesResponse.ok) {
      return jsonVenues({
        ok: false,
        status: venuesResponse.status,
        message: venuesMessage || venuesFailureMessage(venuesResponse.status),
        tokenRequestStatus: tokenResponse.status,
        venuesRequestStatus: venuesResponse.status,
        venueCount: 0,
        venues: [],
      });
    }

    return jsonVenues({
      ok: true,
      status: venuesResponse.status,
      message: venuesMessage || "OnlinePOS venues svarer",
      tokenRequestStatus: tokenResponse.status,
      venuesRequestStatus: venuesResponse.status,
      venueCount: venues.length,
      venues,
    });
  } catch (error) {
    clearTimeout(timeout);
    return jsonVenues({
      ok: false,
      status: null,
      message: error instanceof Error && error.name === "AbortError" ? "OnlinePOS kald timeout" : "OnlinePOS kan ikke nås",
      tokenRequestStatus: null,
      venuesRequestStatus: null,
      venueCount: 0,
      venues: [],
    });
  }
}

function jsonVenues(body: Omit<VenuesResponse, "hasClientId" | "hasClientSecret" | "hasConcern">) {
  return NextResponse.json({
    ...body,
    hasClientId: Boolean(process.env.ONLINEPOS_CLIENT_ID),
    hasClientSecret: Boolean(process.env.ONLINEPOS_CLIENT_SECRET),
    hasConcern: Boolean(process.env.ONLINEPOS_CONCERN),
  } satisfies VenuesResponse);
}

function parseAccessToken(text: string) {
  try {
    const json = JSON.parse(text) as TokenResponse;
    return typeof json.access_token === "string" && json.access_token ? json.access_token : null;
  } catch {
    return null;
  }
}

function parseVenues(text: string): SafeVenue[] {
  try {
    const json = JSON.parse(text) as unknown;
    const rows = findRows(json);
    return rows.map((row) => ({
      venue_id: pickField(row, ["venue_id", "venueId", "id"]) ?? null,
      venue_name: stringifyValue(pickField(row, ["venue_name", "venueName", "name"])),
      status: stringifyValue(pickField(row, ["status"])),
      country_code: stringifyValue(pickField(row, ["country_code", "countryCode", "country"])),
      city: stringifyValue(pickField(row, ["city"])),
    }));
  } catch {
    return [];
  }
}

function findRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of ["venues", "data", "items", "result", "results"]) {
    const child = value[key];
    if (Array.isArray(child)) {
      return child.filter(isRecord);
    }
  }

  return [];
}

function pickField(row: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(row);

  for (const key of keys) {
    const found = entries.find(([entryKey]) => normalizeKey(entryKey) === normalizeKey(key));
    if (found) {
      return found[1] as string | number | null | undefined;
    }
  }

  return null;
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function tokenFailureMessage(status: number) {
  if (status === 401) {
    return "OnlinePOS afviser client credentials";
  }

  return "OnlinePOS token request fejlede";
}

function venuesFailureMessage(status: number) {
  if (status === 401 || status === 403) {
    return "OnlinePOS venues endpoint afviser access token";
  }

  if (status === 400 || status === 422) {
    return "OnlinePOS venues request afviser concern";
  }

  return "OnlinePOS venues endpoint fejlede";
}

function missingEnvMessage({
  hasClientId,
  hasClientSecret,
  hasConcern,
}: {
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasConcern: boolean;
}) {
  const missing = [
    !hasClientId ? "ONLINEPOS_CLIENT_ID" : null,
    !hasClientSecret ? "ONLINEPOS_CLIENT_SECRET" : null,
    !hasConcern ? "ONLINEPOS_CONCERN" : null,
  ].filter(Boolean);

  return `OnlinePOS env mangler: ${missing.join(", ")}`;
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
