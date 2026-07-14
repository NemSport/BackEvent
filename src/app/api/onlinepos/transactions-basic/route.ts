import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

type SearchMode = "receipt_number" | "receipt_range" | "datetime" | "default-last-24h";

type TransactionsBasicResponse = {
  ok: boolean;
  status: number | null;
  message: string;
  tokenRequestStatus: number | null;
  transactionsRequestStatus: number | null;
  searchMode: SearchMode;
  extendedViewModeTried: ExtendedViewMode | null;
  pageRequested: string | null;
  transactionCount: number;
  pagination: SafePagination;
  hasMorePages: boolean;
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

type SafePagination = {
  total: string | number | null;
  per_page: string | number | null;
  current_page: string | number | null;
  last_page: string | number | null;
};

type TokenResponse = {
  access_token?: string;
};

type ExtendedViewMode = "1" | "true" | "none";

type SafeTransactionSample = {
  transaction_id: string | number | null;
  receipt_number: string | number | null;
  datetime: string | null;
  cash_register: {
    id: string | number | null;
    name: string | null;
  } | null;
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
const transactionsUrl = `${restBaseUrl}/transactions`;
const timeoutMs = 10000;

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
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
      extendedViewModeTried: null,
      pageRequested: transactionQuery.pageRequested,
      transactionCount: 0,
      pagination: emptyPagination(),
      hasMorePages: false,
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
        extendedViewModeTried: null,
        pageRequested: transactionQuery.pageRequested,
        transactionCount: 0,
        pagination: emptyPagination(),
        hasMorePages: false,
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
        extendedViewModeTried: null,
        pageRequested: transactionQuery.pageRequested,
        transactionCount: 0,
        pagination: emptyPagination(),
        hasMorePages: false,
        sample: null,
        discoveredFields: emptyDiscoveredFields(),
      });
    }

    const transactionsResult = await fetchTransactions(accessToken, transactionQuery, controller.signal);
    const transactionsResponse = transactionsResult.response;
    const transactionsText = transactionsResult.text;
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
        extendedViewModeTried: transactionsResult.extendedViewMode,
        pageRequested: transactionQuery.pageRequested,
        transactionCount: 0,
        pagination: emptyPagination(),
        hasMorePages: false,
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
      extendedViewModeTried: transactionsResult.extendedViewMode,
      pageRequested: transactionQuery.pageRequested,
      transactionCount: parsed.transactions.length,
      pagination: parsed.pagination,
      hasMorePages: hasMorePages(parsed.pagination),
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
      extendedViewModeTried: null,
      pageRequested: transactionQuery.pageRequested,
      transactionCount: 0,
      pagination: emptyPagination(),
      hasMorePages: false,
      sample: null,
      discoveredFields: emptyDiscoveredFields(),
    });
  }
}

function jsonTransactions(body: TransactionsBasicResponse) {
  return NextResponse.json(body);
}

function transactionsUrlWithQuery(transactionQuery: {
  searchMode: SearchMode;
  pageRequested: string | null;
  params: Record<string, string>;
}, extendedViewMode: ExtendedViewMode) {
  const url = new URL(transactionsUrl);
  url.searchParams.set("venue", process.env.ONLINEPOS_VENUE_ID ?? "");

  if (extendedViewMode !== "none") {
    url.searchParams.set("extended_view", extendedViewMode);
  }

  Object.entries(transactionQuery.params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url;
}

async function fetchTransactions(
  accessToken: string,
  transactionQuery: {
    searchMode: SearchMode;
    pageRequested: string | null;
    params: Record<string, string>;
  },
  signal: AbortSignal,
): Promise<{
  response: Response;
  text: string;
  extendedViewMode: ExtendedViewMode;
}> {
  const modes: ExtendedViewMode[] = ["1", "true", "none"];
  let lastResult: {
    response: Response;
    text: string;
    extendedViewMode: ExtendedViewMode;
  } | null = null;

  for (const extendedViewMode of modes) {
    const response = await fetch(transactionsUrlWithQuery(transactionQuery, extendedViewMode), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal,
    });
    const text = await response.text();

    lastResult = {
      response,
      text,
      extendedViewMode,
    };

    if (!isExtendedViewValidationError(response.status, text)) {
      return lastResult;
    }
  }

  if (!lastResult) {
    throw new Error("OnlinePOS extended_view modes mangler");
  }

  return lastResult;
}

function getTransactionQuery(request: Request): {
  searchMode: SearchMode;
  pageRequested: string | null;
  params: Record<string, string>;
} {
  const url = new URL(request.url);
  const receiptNumber = url.searchParams.get("receipt_number");
  const receiptNumberFrom = url.searchParams.get("receipt_number_from");
  const receiptNumberTo = url.searchParams.get("receipt_number_to");
  const datetimeFrom = url.searchParams.get("datetime_from");
  const datetimeTo = url.searchParams.get("datetime_to");
  const page = url.searchParams.get("page");

  const providedParams = {
    ...(datetimeFrom ? { datetime_from: datetimeFrom } : {}),
    ...(datetimeTo ? { datetime_to: datetimeTo } : {}),
    ...(receiptNumber ? { receipt_number: receiptNumber } : {}),
    ...(receiptNumberFrom ? { receipt_number_from: receiptNumberFrom } : {}),
    ...(receiptNumberTo ? { receipt_number_to: receiptNumberTo } : {}),
    ...(page ? { page } : {}),
  };

  if (receiptNumber) {
    return {
      searchMode: "receipt_number",
      pageRequested: page,
      params: providedParams,
    };
  }

  if (receiptNumberFrom && receiptNumberTo) {
    return {
      searchMode: "receipt_range",
      pageRequested: page,
      params: providedParams,
    };
  }

  if (datetimeFrom && datetimeTo) {
    return {
      searchMode: "datetime",
      pageRequested: page,
      params: providedParams,
    };
  }

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return {
    searchMode: "default-last-24h",
    pageRequested: page,
    params: {
      datetime_from: from.toISOString(),
      datetime_to: now.toISOString(),
      ...(page ? { page } : {}),
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
      transactions: findTransactions(json),
      pagination: findPagination(json),
    };
  } catch {
    return {
      transactions: [],
      pagination: emptyPagination(),
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
    receipt_number: pickScalarField(transaction, ["receipt_number", "receiptNumber"]),
    datetime: stringifyValue(pickField(transaction, ["datetime", "dateTime", "created_at", "createdAt", "time"])),
    cash_register: toSafeCashRegister(pickField(transaction, ["cash_register", "cashRegister"])),
    lineCount: lines.length,
    firstLines: lines.slice(0, 5).map(toSafeLine),
  };
}

function toSafeCashRegister(value: unknown): SafeTransactionSample["cash_register"] {
  if (isRecord(value)) {
    return {
      id: pickScalarField(value, ["id", "cash_register_id", "cashRegisterId"]),
      name: stringifyValue(pickField(value, ["name", "cash_register_name", "cashRegisterName"])),
    };
  }

  if (typeof value === "string" || typeof value === "number") {
    return {
      id: value,
      name: null,
    };
  }

  return null;
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

function discoverFields(transactions: Record<string, unknown>[]): TransactionsBasicResponse["discoveredFields"] {
  const allLines = transactions.flatMap(findTransactionLines);
  return {
    hasCashRegister: transactions.some((transaction) => hasAnyField(transaction, ["cash_register", "cashRegister"])),
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

function emptyDiscoveredFields(): TransactionsBasicResponse["discoveredFields"] {
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

function findTransactions(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return [];
  }

  return value.data.filter(isRecord);
}

function findTransactionLines(transaction: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(transaction.lines) ? transaction.lines.filter(isRecord) : [];
}

function findPagination(value: unknown): SafePagination {
  if (!isRecord(value)) {
    return emptyPagination();
  }

  const pagination = pickField(value, ["pagination"]);
  return isRecord(pagination) ? sanitizePagination(pagination) : emptyPagination();
}

function sanitizePagination(value: Record<string, unknown>): SafePagination {
  return {
    total: pickScalarField(value, ["total", "total_count", "totalCount"]),
    per_page: pickScalarField(value, ["per_page", "perPage", "limit"]),
    current_page: pickScalarField(value, ["current_page", "currentPage", "page"]),
    last_page: pickScalarField(value, ["last_page", "lastPage"]),
  };
}

function emptyPagination(): SafePagination {
  return {
    total: null,
    per_page: null,
    current_page: null,
    last_page: null,
  };
}

function hasMorePages(pagination: SafePagination) {
  const currentPage = numberValue(pagination.current_page);
  const lastPage = numberValue(pagination.last_page);
  return currentPage !== null && lastPage !== null ? currentPage < lastPage : false;
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

function numberValue(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function tokenFailureMessage(status: number) {
  if (status === 401) {
    return "OnlinePOS afviser client credentials";
  }

  return "OnlinePOS token request fejlede";
}

function transactionsFailureMessage(status: number) {
  if (status === 401 || status === 403) {
    return "OnlinePOS transactions endpoint afviser access token";
  }

  if (status === 400 || status === 422) {
    return "OnlinePOS transactions request afviser venue eller filter";
  }

  return "OnlinePOS transactions endpoint fejlede";
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

function isExtendedViewValidationError(status: number, text: string) {
  return status === 422 && /extended[_\s-]?view/i.test(text);
}
