import { NextResponse } from "next/server";

type InventoryConsumptionPreviewResponse = {
  ok: boolean;
  status: number | null;
  message: string;
  tokenRequestStatus: number | null;
  transactionsRequestStatus: number | null;
  datetimeMode: "query";
  pageRequested: string | null;
  transactionCount: number;
  lineCount: number;
  pagination: SafePagination;
  hasMorePages: boolean;
  summary: ConsumptionSummary;
  groups: ConsumptionGroup[];
};

type ConsumptionGroup = {
  cash_register_id: string | number | null;
  cash_register_name: string | null;
  products: ConsumptionProduct[];
};

type ConsumptionProduct = {
  product_id: string | number | null;
  product_name: string | null;
  product_group_id: string | number | null;
  product_group_name: string | null;
  quantity_sold: number;
  revenue: number;
  lineType: LineType;
  inventoryRelevant: boolean;
  needsMapping: boolean;
};

type LineType = "modifier_stock_item" | "deposit_fee" | "deposit_return" | "container_product" | "stock_item";

type ConsumptionSummary = {
  totalProducts: number;
  inventoryRelevantProducts: number;
  modifierProducts: number;
  depositProducts: number;
  unknownProducts: number;
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

const restBaseUrl = "https://rest.onlinepos.dk";
const tokenUrl = `${restBaseUrl}/auth/token`;
const transactionsUrl = `${restBaseUrl}/transactions`;
const timeoutMs = 10000;

export async function GET(request: Request) {
  const hasClientId = Boolean(process.env.ONLINEPOS_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.ONLINEPOS_CLIENT_SECRET);
  const hasVenueId = Boolean(process.env.ONLINEPOS_VENUE_ID);
  const transactionQuery = getTransactionQuery(request);

  if (!transactionQuery) {
    return jsonPreview(
      {
        ok: false,
        status: 400,
        message: "datetime_from og datetime_to er påkrævet",
        tokenRequestStatus: null,
        transactionsRequestStatus: null,
        datetimeMode: "query",
        pageRequested: new URL(request.url).searchParams.get("page"),
        transactionCount: 0,
        lineCount: 0,
        pagination: emptyPagination(),
        hasMorePages: false,
        summary: emptySummary(),
        groups: [],
      },
      400,
    );
  }

  if (!hasClientId || !hasClientSecret || !hasVenueId) {
    return jsonPreview({
      ok: false,
      status: null,
      message: missingEnvMessage({ hasClientId, hasClientSecret, hasVenueId }),
      tokenRequestStatus: null,
      transactionsRequestStatus: null,
      datetimeMode: "query",
      pageRequested: transactionQuery.pageRequested,
      transactionCount: 0,
      lineCount: 0,
      pagination: emptyPagination(),
      hasMorePages: false,
      summary: emptySummary(),
      groups: [],
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
      return jsonPreview({
        ok: false,
        status: tokenResponse.status,
        message: tokenMessage || tokenFailureMessage(tokenResponse.status),
        tokenRequestStatus: tokenResponse.status,
        transactionsRequestStatus: null,
        datetimeMode: "query",
        pageRequested: transactionQuery.pageRequested,
        transactionCount: 0,
        lineCount: 0,
        pagination: emptyPagination(),
        hasMorePages: false,
        summary: emptySummary(),
        groups: [],
      });
    }

    const accessToken = parseAccessToken(tokenText);

    if (!accessToken) {
      clearTimeout(timeout);
      return jsonPreview({
        ok: false,
        status: tokenResponse.status,
        message: "OnlinePOS token response manglede access_token",
        tokenRequestStatus: tokenResponse.status,
        transactionsRequestStatus: null,
        datetimeMode: "query",
        pageRequested: transactionQuery.pageRequested,
        transactionCount: 0,
        lineCount: 0,
        pagination: emptyPagination(),
        hasMorePages: false,
        summary: emptySummary(),
        groups: [],
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
      return jsonPreview({
        ok: false,
        status: transactionsResponse.status,
        message: transactionsMessage || transactionsFailureMessage(transactionsResponse.status),
        tokenRequestStatus: tokenResponse.status,
        transactionsRequestStatus: transactionsResponse.status,
        datetimeMode: "query",
        pageRequested: transactionQuery.pageRequested,
        transactionCount: 0,
        lineCount: 0,
        pagination: emptyPagination(),
        hasMorePages: false,
        summary: emptySummary(),
        groups: [],
      });
    }

    const parsed = parseTransactions(transactionsText);
    const allLines = parsed.transactions.flatMap(findTransactionLines);
    const groups = aggregateConsumption(parsed.transactions);

    return jsonPreview({
      ok: true,
      status: transactionsResponse.status,
      message: "Inventory consumption preview fetched",
      tokenRequestStatus: tokenResponse.status,
      transactionsRequestStatus: transactionsResponse.status,
      datetimeMode: "query",
      pageRequested: transactionQuery.pageRequested,
      transactionCount: parsed.transactions.length,
      lineCount: allLines.length,
      pagination: parsed.pagination,
      hasMorePages: hasMorePages(parsed.pagination),
      summary: buildSummary(groups),
      groups,
    });
  } catch (error) {
    clearTimeout(timeout);
    return jsonPreview({
      ok: false,
      status: null,
      message: error instanceof Error && error.name === "AbortError" ? "OnlinePOS kald timeout" : "OnlinePOS kan ikke nås",
      tokenRequestStatus: null,
      transactionsRequestStatus: null,
      datetimeMode: "query",
      pageRequested: transactionQuery.pageRequested,
      transactionCount: 0,
      lineCount: 0,
      pagination: emptyPagination(),
      hasMorePages: false,
      summary: emptySummary(),
      groups: [],
    });
  }
}

function jsonPreview(body: InventoryConsumptionPreviewResponse, status?: number) {
  return NextResponse.json(body, status ? { status } : undefined);
}

function transactionsUrlWithQuery(transactionQuery: {
  pageRequested: string | null;
  params: Record<string, string>;
}) {
  const url = new URL(transactionsUrl);
  url.searchParams.set("venue", process.env.ONLINEPOS_VENUE_ID ?? "");
  url.searchParams.set("extended_view", "1");

  Object.entries(transactionQuery.params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url;
}

function getTransactionQuery(request: Request): {
  pageRequested: string | null;
  params: Record<string, string>;
} | null {
  const url = new URL(request.url);
  const datetimeFrom = url.searchParams.get("datetime_from");
  const datetimeTo = url.searchParams.get("datetime_to");
  const page = url.searchParams.get("page");

  if (!datetimeFrom || !datetimeTo) {
    return null;
  }

  return {
    pageRequested: page,
    params: {
      datetime_from: datetimeFrom,
      datetime_to: datetimeTo,
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

function aggregateConsumption(transactions: Record<string, unknown>[]) {
  const registerMap = new Map<string, ConsumptionGroup & { productMap: Map<string, ConsumptionProduct> }>();

  transactions.forEach((transaction) => {
    const cashRegister = toSafeCashRegister(pickField(transaction, ["cash_register", "cashRegister"]));
    const registerKey = `${cashRegister?.id ?? "unknown"}:${cashRegister?.name ?? ""}`;
    let group = registerMap.get(registerKey);

    if (!group) {
      group = {
        cash_register_id: cashRegister?.id ?? null,
        cash_register_name: cashRegister?.name ?? null,
        products: [],
        productMap: new Map<string, ConsumptionProduct>(),
      };
      registerMap.set(registerKey, group);
    }

    findTransactionLines(transaction).forEach((line) => {
      const product = toConsumptionProduct(line);
      const productKey = `${product.product_id ?? "unknown"}:${product.product_name ?? ""}:${product.product_group_id ?? ""}`;
      const existing = group.productMap.get(productKey);

      if (existing) {
        existing.quantity_sold += product.quantity_sold;
        existing.revenue += product.revenue;
        return;
      }

      group.productMap.set(productKey, product);
      group.products.push(product);
    });
  });

  return Array.from(registerMap.values()).map((group) => ({
    cash_register_id: group.cash_register_id,
    cash_register_name: group.cash_register_name,
    products: group.products.map((product) => ({
      ...product,
      quantity_sold: roundNumber(product.quantity_sold),
      revenue: roundNumber(product.revenue),
    })),
  }));
}

function toConsumptionProduct(line: Record<string, unknown>): ConsumptionProduct {
  const productName = stringifyValue(pickField(line, ["product_name", "productName", "productname", "name"]));
  const productGroupName = stringifyValue(pickField(line, ["product_group_name", "productGroupName", "productgroupname"]));
  const classification = classifyLine(productName, productGroupName);

  return {
    product_id: pickScalarField(line, ["product_id", "productId", "productid"]),
    product_name: productName,
    product_group_id: pickScalarField(line, ["product_group_id", "productGroupId", "productgroupid"]),
    product_group_name: productGroupName,
    quantity_sold: numberValue(pickField(line, ["quantity", "qty", "count", "amount"])) ?? 0,
    revenue: numberValue(pickField(line, ["net_price", "netPrice", "netprice", "price", "gross_price", "grossPrice"])) ?? 0,
    ...classification,
  };
}

function classifyLine(
  productName: string | null,
  productGroupName: string | null,
): Pick<ConsumptionProduct, "lineType" | "inventoryRelevant" | "needsMapping"> {
  const name = (productName ?? "").toLocaleUpperCase("da-DK");
  const group = (productGroupName ?? "").trim();
  const groupUpper = group.toLocaleUpperCase("da-DK");

  if (groupUpper.startsWith("MSG -")) {
    return {
      lineType: "modifier_stock_item",
      inventoryRelevant: true,
      needsMapping: false,
    };
  }

  if (name.includes("GEBYR") && (name.includes("KRUS") || name.includes("KANDE"))) {
    return {
      lineType: "deposit_fee",
      inventoryRelevant: false,
      needsMapping: false,
    };
  }

  if (name.includes("RETUR") && (name.includes("KRUS") || name.includes("KANDE"))) {
    return {
      lineType: "deposit_return",
      inventoryRelevant: false,
      needsMapping: false,
    };
  }

  if (["DRINKS", "SODAVAND"].includes(groupUpper)) {
    return {
      lineType: "container_product",
      inventoryRelevant: false,
      needsMapping: true,
    };
  }

  return {
    lineType: "stock_item",
    inventoryRelevant: true,
    needsMapping: true,
  };
}

function buildSummary(groups: ConsumptionGroup[]): ConsumptionSummary {
  const products = groups.flatMap((group) => group.products);

  return {
    totalProducts: products.length,
    inventoryRelevantProducts: products.filter((product) => product.inventoryRelevant).length,
    modifierProducts: products.filter((product) => product.lineType === "modifier_stock_item").length,
    depositProducts: products.filter((product) => product.lineType === "deposit_fee" || product.lineType === "deposit_return").length,
    unknownProducts: products.filter((product) => product.lineType === "stock_item").length,
  };
}

function emptySummary(): ConsumptionSummary {
  return {
    totalProducts: 0,
    inventoryRelevantProducts: 0,
    modifierProducts: 0,
    depositProducts: 0,
    unknownProducts: 0,
  };
}

function toSafeCashRegister(value: unknown): {
  id: string | number | null;
  name: string | null;
} | null {
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

function roundNumber(value: number) {
  return Math.round(value * 100) / 100;
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
    return "OnlinePOS transactions request afviser venue eller dato";
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
