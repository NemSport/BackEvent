import type {
  OnlinePosEnvStatus,
  OnlinePosProbeResult,
  OnlinePosReportsEnvStatus,
  OnlinePosReportsParamMode,
  OnlinePosSaleLine,
} from "./types";

const defaultBaseUrl = "https://api.onlinepos.dk/api";
const defaultReportsBaseUrl = "https://rest.onlinepos.dk";

export function getOnlinePosEnvStatus(): OnlinePosEnvStatus {
  const baseUrl = process.env.ONLINEPOS_BASE_URL || defaultBaseUrl;
  const token = process.env.ONLINEPOS_TOKEN;
  const firmaId = process.env.ONLINEPOS_FIRMAID;

  return {
    configured: Boolean(baseUrl && token && firmaId),
    hasBaseUrl: Boolean(baseUrl),
    hasToken: Boolean(token),
    hasFirmaId: Boolean(firmaId),
    baseUrl,
  };
}

export function getOnlinePosReportsEnvStatus(): OnlinePosReportsEnvStatus {
  const baseUrl = process.env.ONLINEPOS_REPORTS_BASE_URL || defaultReportsBaseUrl;
  const token = process.env.ONLINEPOS_REPORTS_TOKEN;

  return {
    configured: Boolean(baseUrl && token),
    hasBaseUrl: Boolean(baseUrl),
    hasToken: Boolean(token),
    baseUrl,
  };
}

export async function testOnlinePosConnection() {
  return getOnlinePosSalesByDate(new Date().toISOString().slice(0, 10));
}

export async function getLatestOnlinePosSales() {
  return getOnlinePosSalesByDate(new Date().toISOString().slice(0, 10));
}

export async function getOnlinePosSalesByDate(date: string) {
  const unixRange = getDateUnixRange(date);
  return requestOnlinePos(`/getByUnixTimeSales/${unixRange.from}/${unixRange.to}`, unixRange);
}

export async function getExportSalesFallback() {
  return requestOnlinePos("/exportSales/v20");
}

export async function testOnlinePosReportsApi(paramMode: OnlinePosReportsParamMode = "none", date = new Date().toISOString().slice(0, 10)) {
  return getReportsSalesPerProduct(paramMode, date);
}

export async function getReportsSalesPerProduct(paramMode: OnlinePosReportsParamMode, date: string) {
  const path = buildReportsSalesPerProductPath(paramMode, date);
  return requestOnlinePosReports(path);
}

async function requestOnlinePos(path: string, unixRange?: OnlinePosProbeResult["unixRange"]): Promise<OnlinePosProbeResult> {
  const env = getOnlinePosEnvStatus();

  if (!env.configured) {
    return {
      ok: false,
      endpoint: path,
      status: 0,
      statusText: "Ikke konfigureret",
      contentType: null,
      unixRange,
      summary: emptySummary("ONLINEPOS_TOKEN eller ONLINEPOS_FIRMAID mangler"),
      lines: [],
      distinctDepartments: [],
      distinctProducts: [],
      error: "OnlinePOS env mangler. Sæt ONLINEPOS_TOKEN og ONLINEPOS_FIRMAID server-side.",
    };
  }

  const url = new URL(`${env.baseUrl.replace(/\/$/, "")}${path}`);
  const response = await fetch(url, {
    method: "GET",
    headers: createOnlinePosHeaders(),
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type");
  const rawText = await response.text();
  const parsed = parseResponse(rawText, contentType);
  const lines = normalizeSaleLines(parsed.value);
  const rawPreview = parsed.type === "text" ? summarizeTextResponse(rawText) : rawText.slice(0, 1200);

  return {
    ok: response.ok,
    endpoint: path,
    status: response.status,
    statusText: response.statusText,
    contentType,
    unixRange,
    summary: {
      responseType: rawText ? parsed.type : "empty",
      topLevelType: getTopLevelType(parsed.value),
      lineCount: lines.length,
      firstKeys: getFirstKeys(parsed.value),
      hasDepartmentFields: hasDepartmentFields(parsed.value),
      hasPaginationInfo: Boolean(findPaginationInfo(parsed.value)),
      paginationInfo: findPaginationInfo(parsed.value),
      rawPreview,
    },
    lines: lines.slice(0, 20),
    distinctDepartments: distinctValues(lines.map((line) => line.department)),
    distinctProducts: distinctValues(lines.map((line) => line.productname ?? stringifyValue(line.productid))),
    error: response.ok ? undefined : getOnlinePosErrorMessage(response.status, rawText, response.statusText),
  };
}

async function requestOnlinePosReports(path: string): Promise<OnlinePosProbeResult> {
  const env = getOnlinePosReportsEnvStatus();

  if (!env.configured) {
    return {
      ok: false,
      endpoint: path,
      status: 0,
      statusText: "Ikke konfigureret",
      contentType: null,
      summary: emptySummary("ONLINEPOS_REPORTS_TOKEN mangler"),
      lines: [],
      distinctDepartments: [],
      distinctProducts: [],
      error: "OnlinePOS Reports env mangler. Sæt ONLINEPOS_REPORTS_TOKEN server-side.",
    };
  }

  const url = new URL(`${env.baseUrl.replace(/\/$/, "")}${path}`);
  const response = await fetch(url, {
    method: "GET",
    headers: createOnlinePosReportsHeaders(),
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type");
  const rawText = await response.text();
  const parsed = parseResponse(rawText, contentType);
  const lines = normalizeSaleLines(parsed.value);
  const rawPreview = parsed.type === "text" ? summarizeTextResponse(rawText) : rawText.slice(0, 1200);

  return {
    ok: response.ok,
    endpoint: path,
    status: response.status,
    statusText: response.statusText,
    contentType,
    summary: {
      responseType: rawText ? parsed.type : "empty",
      topLevelType: getTopLevelType(parsed.value),
      lineCount: lines.length,
      firstKeys: getFirstKeys(parsed.value),
      hasDepartmentFields: hasDepartmentFields(parsed.value),
      hasPaginationInfo: Boolean(findPaginationInfo(parsed.value)),
      paginationInfo: findPaginationInfo(parsed.value),
      rawPreview,
    },
    lines: lines.slice(0, 20),
    distinctDepartments: distinctValues(lines.map((line) => line.department)),
    distinctProducts: distinctValues(lines.map((line) => line.productname ?? stringifyValue(line.productid))),
    error: response.ok ? undefined : summarizeTextResponse(rawText).slice(0, 500) || response.statusText,
  };
}

function createOnlinePosHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/json",
    token: process.env.ONLINEPOS_TOKEN ?? "",
  };

  if (process.env.ONLINEPOS_FIRMAID) {
    headers.firmaid = process.env.ONLINEPOS_FIRMAID;
  }

  return headers;
}

function createOnlinePosReportsHeaders() {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${process.env.ONLINEPOS_REPORTS_TOKEN ?? ""}`,
  };
}

function parseResponse(rawText: string, contentType: string | null): { type: "json" | "text"; value: unknown } {
  if (!rawText) {
    return { type: "text", value: null };
  }

  if (contentType?.includes("json") || rawText.trim().startsWith("{") || rawText.trim().startsWith("[")) {
    try {
      return { type: "json", value: JSON.parse(rawText) };
    } catch {
      return { type: "text", value: rawText };
    }
  }

  return { type: "text", value: rawText };
}

function normalizeSaleLines(value: unknown): OnlinePosSaleLine[] {
  const rows = findLikelyRows(value);

  return rows.map((row) => ({
    datetime: stringifyValue(pickField(row, ["datetime", "dateTime", "created", "created_at", "time", "date", "salesdate"])),
    productid: pickField(row, ["productid", "productId", "product_id", "vareid", "itemid"]),
    productname: stringifyValue(
      pickField(row, ["productname", "productName", "product_name", "product", "name", "varenavn", "itemname"]),
    ),
    department: stringifyValue(pickField(row, ["department", "departmentname", "departmentName", "bar", "location", "shop", "afdeling"])),
    count: pickField(row, ["count", "quantity", "qty", "amount", "antal"]),
    price: pickField(row, ["price", "total", "totalprice", "amounttotal", "belob"]),
    firmaid: pickField(row, ["firmaid", "firmaId", "companyid"]),
    orderid: pickField(row, ["orderid", "orderId", "order_id", "receiptid"]),
    orderlineid: pickField(row, ["orderlineid", "orderLineId", "orderline_id", "lineid"]),
  }));
}

function findLikelyRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  const directKeys = ["data", "sales", "saleLines", "lines", "items", "result", "results", "orders"];

  for (const key of directKeys) {
    const child = value[key];
    if (Array.isArray(child)) {
      return child.filter(isRecord);
    }
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child) && child.some(isRecord)) {
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

function getFirstKeys(value: unknown) {
  if (Array.isArray(value) && isRecord(value[0])) {
    return Object.keys(value[0]).slice(0, 16);
  }

  if (isRecord(value)) {
    return Object.keys(value).slice(0, 16);
  }

  return [];
}

function findPaginationInfo(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const paginationKeys = ["page", "pages", "next", "cursor", "offset", "limit", "total", "totalCount"];
  const entries = Object.entries(value).filter(([key]) => paginationKeys.includes(key));

  if (entries.length === 0) {
    return null;
  }

  return Object.fromEntries(entries);
}

function emptySummary(rawPreview: string): OnlinePosProbeResult["summary"] {
  return {
    responseType: "empty",
    topLevelType: "none",
    lineCount: 0,
    firstKeys: [],
    hasDepartmentFields: false,
    hasPaginationInfo: false,
    paginationInfo: null,
    rawPreview,
  };
}

function buildReportsSalesPerProductPath(paramMode: OnlinePosReportsParamMode, date: string) {
  const url = new URL(`${defaultReportsBaseUrl}/reports/getSalesPerProduct`);
  const range = getIsoDateRange(date);

  if (paramMode === "from_to_iso") {
    url.searchParams.set("from", range.from);
    url.searchParams.set("to", range.to);
  }

  if (paramMode === "startDate_endDate_iso") {
    url.searchParams.set("startDate", range.from);
    url.searchParams.set("endDate", range.to);
  }

  if (paramMode === "dateFrom_dateTo_iso") {
    url.searchParams.set("dateFrom", range.from);
    url.searchParams.set("dateTo", range.to);
  }

  return `${url.pathname}${url.search}`;
}

function getTopLevelType(value: unknown) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}

function getDateUnixRange(date: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59`);

  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
  };
}

function getIsoDateRange(date: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59`);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function hasDepartmentFields(value: unknown) {
  const keys = getFirstKeysFromRows(value).map(normalizeKey);
  return keys.some((key) => ["department", "departmentname", "bar", "location", "shop", "afdeling"].includes(key));
}

function getFirstKeysFromRows(value: unknown) {
  const rows = findLikelyRows(value);

  if (rows[0]) {
    return Object.keys(rows[0]).slice(0, 32);
  }

  return getFirstKeys(value);
}

function getOnlinePosErrorMessage(status: number, rawText: string, statusText: string) {
  if (status === 403) {
    return "OnlinePOS afviser token/firmaid. Tjek at token og firmaID hører sammen.";
  }

  return summarizeTextResponse(rawText).slice(0, 500) || statusText;
}

function summarizeTextResponse(rawText: string) {
  return rawText
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function distinctValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).sort((a, b) =>
    a.localeCompare(b, "da"),
  );
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
