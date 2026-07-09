import { NextResponse } from "next/server";

type TransactionsResponse = {
  ok: boolean;
  status: number | null;
  message: string;
  tokenRequestStatus: number | null;
  transactionsRequestStatus: number | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasVenueId: boolean;
  searchMode: "receipt_number" | "receipt_range" | "datetime" | "default-last-24h";
  datetimeMode: "query" | "default-last-24h" | "not-used";
  transactionCount: number;
  pagination: Record<string, unknown> | null;
  sample: SafeTransactionSample | null;
  discoveredFields: {
    hasCashRegister: boolean;
    hasLines: boolean;
    hasProductId: boolean;
    hasProductName: boolean;
    hasQuantity: boolean;
    hasProductGroup: boolean;
    hasLineDatetime: boolean;
  };
};

type TokenResponse = {
  access_token?: string;
};

type SafeTransactionSample = {
  transaction_id: string | number | null;
  datetime: string | null;
  cash_register: string | number | null;
  lineCount: number;
  firstLines: SafeTransactionLine[];
};

type SafeTransactionLine = {
  line_id: string | number | null;
  product_id: string | number | null;
  master_product_id: string | number | null;
  product_name: string | null;
  receipt_text: string | null;
  quantity: string | number | null;
  price: string | number | null;
  net_price: string | number | null;
  product_group_id: string | number | null;
  product_group_name: string | null;
};

const restBaseUrl = "https://rest.onlinepos.dk";
const tokenUrl = `${restBaseUrl}/auth/token`;
const transactionsUrl = `${restBaseUrl}/transactionExtended`;
const timeoutMs = 10000;

export async function GET(request: Request) {
  const hasClientId = Boolean(process.env.ONLINEPOS_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.ONLINEPOS_CLIENT_SECRET);
  const hasVenueId = Boolean(process.env.ONLINEPOS_VENUE_ID);
  const transactionQuery = getTransactionQuery(request);

  if (!hasClientId || !hasClientSecret || !hasVenueId) {
    return jsonTransactions({
      ok: false,
      status: null,
      message: missingEnvMessage({ hasClientId, hasClientSecret, hasVenueId }),
      tokenRequestStatus: null,
      transactionsRequestStatus: null,
      searchMode: transactionQuery.searchMode,
      datetimeMode: transactionQuery.datetimeMode,
      transactionCount: 0,
      pagination: null,
      sample: null,
      discoveredFields: emptyDiscoveredFields(),
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
      return jsonTransactions({
        ok: false,
        status: tokenResponse.status,
        message: tokenMessage || tokenFailureMessage(tokenResponse.status),
        tokenRequestStatus: tokenResponse.status,
        transactionsRequestStatus: null,
        searchMode: transactionQuery.searchMode,
        datetimeMode: transactionQuery.datetimeMode,
        transactionCount: 0,
        pagination: null,
        sample: null,
        discoveredFields: emptyDiscoveredFields(),
      });
    }

    const accessToken = parseAccessToken(tokenText);

    if (!accessToken) {
      clearTimeout(timeout);
      return jsonTransactions({
        ok: false,
        status: tokenResponse.status,
        message: "OnlinePOS token response manglede access_token",
        tokenRequestStatus: tokenResponse.status,
        transactionsRequestStatus: null,
        searchMode: transactionQuery.searchMode,
        datetimeMode: transactionQuery.datetimeMode,
        transactionCount: 0,
        pagination: null,
        sample: null,
        discoveredFields: emptyDiscoveredFields(),
      });
    }

    const transactionsResponse = await fetch(transactionsUrlWithQuery(transactionQuery), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const transactionsText = await transactionsResponse.text();
    const transactionsMessage = safeResponseMessage(transactionsText);

    clearTimeout(timeout);

    if (!transactionsResponse.ok) {
      return jsonTransactions({
        ok: false,
        status: transactionsResponse.status,
        message: transactionsMessage || transactionsFailureMessage(transactionsResponse.status),
        tokenRequestStatus: tokenResponse.status,
        transactionsRequestStatus: transactionsResponse.status,
        searchMode: transactionQuery.searchMode,
        datetimeMode: transactionQuery.datetimeMode,
        transactionCount: 0,
        pagination: null,
        sample: null,
        discoveredFields: emptyDiscoveredFields(),
      });
    }

    const parsed = parseTransactions(transactionsText);

    return jsonTransactions({
      ok: true,
      status: transactionsResponse.status,
      message: "Transactions fetched",
      tokenRequestStatus: tokenResponse.status,
      transactionsRequestStatus: transactionsResponse.status,
      searchMode: transactionQuery.searchMode,
      datetimeMode: transactionQuery.datetimeMode,
      transactionCount: parsed.transactions.length,
      pagination: parsed.pagination,
      sample: buildSample(parsed.transactions[0] ?? null),
      discoveredFields: discoverFields(parsed.transactions),
    });
  } catch (error) {
    clearTimeout(timeout);
    return jsonTransactions({
      ok: false,
      status: null,
      message: error instanceof Error && error.name === "AbortError" ? "OnlinePOS kald timeout" : "OnlinePOS kan ikke nås",
      tokenRequestStatus: null,
      transactionsRequestStatus: null,
      searchMode: transactionQuery.searchMode,
      datetimeMode: transactionQuery.datetimeMode,
      transactionCount: 0,
      pagination: null,
      sample: null,
      discoveredFields: emptyDiscoveredFields(),
    });
  }
}

function jsonTransactions(
  body: Omit<TransactionsResponse, "hasClientId" | "hasClientSecret" | "hasVenueId">,
) {
  return NextResponse.json({
    ...body,
    hasClientId: Boolean(process.env.ONLINEPOS_CLIENT_ID),
    hasClientSecret: Boolean(process.env.ONLINEPOS_CLIENT_SECRET),
    hasVenueId: Boolean(process.env.ONLINEPOS_VENUE_ID),
  } satisfies TransactionsResponse);
}

function transactionsUrlWithQuery(transactionQuery: {
  searchMode: TransactionsResponse["searchMode"];
  datetimeMode: TransactionsResponse["datetimeMode"];
  params: Record<string, string>;
}) {
  const url = new URL(transactionsUrl);
  url.searchParams.set("venue", process.env.ONLINEPOS_VENUE_ID ?? "");

  Object.entries(transactionQuery.params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url;
}

function getTransactionQuery(request: Request): {
  searchMode: TransactionsResponse["searchMode"];
  datetimeMode: TransactionsResponse["datetimeMode"];
  params: Record<string, string>;
} {
  const url = new URL(request.url);
  const receiptNumber = url.searchParams.get("receipt_number");
  const receiptNumberFrom = url.searchParams.get("receipt_number_from");
  const receiptNumberTo = url.searchParams.get("receipt_number_to");
  const datetimeFrom = url.searchParams.get("datetime_from");
  const datetimeTo = url.searchParams.get("datetime_to");

  if (receiptNumber) {
    return {
      searchMode: "receipt_number",
      datetimeMode: "not-used",
      params: {
        receipt_number: receiptNumber,
      },
    };
  }

  if (receiptNumberFrom || receiptNumberTo) {
    return {
      searchMode: "receipt_range",
      datetimeMode: "not-used",
      params: {
        ...(receiptNumberFrom ? { receipt_number_from: receiptNumberFrom } : {}),
        ...(receiptNumberTo ? { receipt_number_to: receiptNumberTo } : {}),
      },
    };
  }

  if (datetimeFrom && datetimeTo) {
    return {
      searchMode: "datetime",
      datetimeMode: "query",
      params: {
        datetime_from: datetimeFrom,
        datetime_to: datetimeTo,
      },
    };
  }

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return {
    searchMode: "default-last-24h",
    datetimeMode: "default-last-24h",
    params: {
      datetime_from: from.toISOString(),
      datetime_to: now.toISOString(),
    },
  };
}

function parseAccessToken(text: string) {
  try {
    const json = JSON.parse(text) as TokenResponse;
    return typeof json.access_token === "string" && json.access_token ? json.access_token : null;
  } catch {
    return null;
  }
}

function parseTransactions(text: string) {
  try {
    const json = JSON.parse(text) as unknown;
    return {
      transactions: findRows(json),
      pagination: findPagination(json),
    };
  } catch {
    return {
      transactions: [],
      pagination: null,
    };
  }
}

function buildSample(transaction: Record<string, unknown> | null): SafeTransactionSample | null {
  if (!transaction) {
    return null;
  }

  const lines = findTransactionLines(transaction);

  return {
    transaction_id: pickScalarField(transaction, ["transaction_id", "transactionId", "id"]),
    datetime: stringifyValue(pickField(transaction, ["datetime", "dateTime", "created_at", "createdAt", "time"])),
    cash_register: pickScalarField(transaction, ["cash_register", "cashRegister", "cash_register_id", "register", "register_id"]),
    lineCount: lines.length,
    firstLines: lines.slice(0, 5).map(toSafeLine),
  };
}

function toSafeLine(line: Record<string, unknown>): SafeTransactionLine {
  return {
    line_id: pickScalarField(line, ["line_id", "lineId", "id", "orderlineid"]),
    product_id: pickScalarField(line, ["product_id", "productId", "productid"]),
    master_product_id: pickScalarField(line, ["master_product_id", "masterProductId", "masterproductid"]),
    product_name: stringifyValue(pickField(line, ["product_name", "productName", "productname", "name"])),
    receipt_text: stringifyValue(pickField(line, ["receipt_text", "receiptText", "receipttext", "text"])),
    quantity: pickScalarField(line, ["quantity", "qty", "count", "amount"]),
    price: pickScalarField(line, ["price", "gross_price", "grossPrice"]),
    net_price: pickScalarField(line, ["net_price", "netPrice", "netprice"]),
    product_group_id: pickScalarField(line, ["product_group_id", "productGroupId", "productgroupid"]),
    product_group_name: stringifyValue(pickField(line, ["product_group_name", "productGroupName", "productgroupname"])),
  };
}

function discoverFields(transactions: Record<string, unknown>[]): TransactionsResponse["discoveredFields"] {
  const allLines = transactions.flatMap(findTransactionLines);
  return {
    hasCashRegister: transactions.some((transaction) =>
      hasAnyField(transaction, ["cash_register", "cashRegister", "cash_register_id", "register", "register_id"]),
    ),
    hasLines: allLines.length > 0,
    hasProductId: allLines.some((line) => hasAnyField(line, ["product_id", "productId", "productid"])),
    hasProductName: allLines.some((line) => hasAnyField(line, ["product_name", "productName", "productname", "name"])),
    hasQuantity: allLines.some((line) => hasAnyField(line, ["quantity", "qty", "count", "amount"])),
    hasProductGroup: allLines.some((line) =>
      hasAnyField(line, ["product_group_id", "productGroupId", "productgroupid", "product_group_name", "productGroupName", "productgroupname"]),
    ),
    hasLineDatetime: allLines.some((line) => hasAnyField(line, ["datetime", "dateTime", "created_at", "createdAt", "time"])),
  };
}

function emptyDiscoveredFields(): TransactionsResponse["discoveredFields"] {
  return {
    hasCashRegister: false,
    hasLines: false,
    hasProductId: false,
    hasProductName: false,
    hasQuantity: false,
    hasProductGroup: false,
    hasLineDatetime: false,
  };
}

function findRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of ["transactions", "transactionExtended", "data", "items", "result", "results"]) {
    const child = value[key];
    if (Array.isArray(child)) {
      return child.filter(isRecord);
    }

    if (isRecord(child)) {
      const nested = findRows(child);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
}

function findTransactionLines(transaction: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["lines", "line_items", "lineItems", "products", "sales", "items"]) {
    const child = transaction[key];
    if (Array.isArray(child)) {
      return child.filter(isRecord);
    }
  }

  return [];
}

function findPagination(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const pagination = pickField(value, ["pagination", "page", "paging", "meta"]);
  if (isRecord(pagination)) {
    return sanitizePagination(pagination);
  }

  const direct = sanitizePagination(value);
  return Object.keys(direct).length > 0 ? direct : null;
}

function sanitizePagination(value: Record<string, unknown>) {
  const allowed = ["page", "per_page", "limit", "offset", "total", "total_count", "next", "previous", "cursor"];
  return Object.fromEntries(
    Object.entries(value).filter(([key, item]) => allowed.includes(normalizeKey(key)) && isSafeScalar(item)),
  );
}

function pickField(row: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(row);

  for (const key of keys) {
    const found = entries.find(([entryKey]) => normalizeKey(entryKey) === normalizeKey(key));
    if (found) {
      return found[1] as string | number | boolean | null | Record<string, unknown> | undefined;
    }
  }

  return null;
}

function pickScalarField(row: Record<string, unknown>, keys: string[]) {
  const value = pickField(row, keys);
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function hasAnyField(row: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => pickField(row, [key]) !== null && pickField(row, [key]) !== undefined);
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined || typeof value === "object") {
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

function isSafeScalar(value: unknown) {
  return ["string", "number", "boolean"].includes(typeof value) || value === null;
}

function tokenFailureMessage(status: number) {
  if (status === 401) {
    return "OnlinePOS afviser client credentials";
  }

  return "OnlinePOS token request fejlede";
}

function transactionsFailureMessage(status: number) {
  if (status === 401 || status === 403) {
    return "OnlinePOS transactionExtended endpoint afviser access token";
  }

  if (status === 400 || status === 422) {
    return "OnlinePOS transactionExtended request afviser venue eller dato";
  }

  return "OnlinePOS transactionExtended endpoint fejlede";
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
  return /payment_data|applied_card_number|applied_card_name|clerk_name|clerk_number|card_campaign_id|discount_family_id|business_number|access_token|client_secret|client_id|notes/i.test(
    text,
  );
}

