import { NextResponse } from "next/server";
import { products as mockProductsSource } from "@/lib/backevent/mock-data";
import type { Product } from "@/lib/backevent/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LineType = "modifier_stock_item" | "deposit_fee" | "deposit_return" | "container_product" | "stock_item" | "unknown";
type MappingAction = "consume_stock" | "ignore" | "deposit_fee" | "deposit_return" | "container_only";
type MappingStatus = "unmapped" | "approved";
type ErrorStep =
  | "missing_datetime"
  | "missing_env"
  | "token_request"
  | "token_parse"
  | "transactions_request"
  | "parse_products_empty"
  | "unexpected_error"
  | null;

type InventoryMappingPreviewResponse = {
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
  productCountBeforeMapping: number;
  mappingCount: number;
  errorStep: ErrorStep;
  summary: {
    totalProducts: number;
    approvedMappings: number;
    missingMappings: number;
    inventoryRelevantMissingMappings: number;
    ignoredProducts: number;
    depositProducts: number;
    containerProducts: number;
  };
  products: MappingPreviewProduct[];
};

type MappingPreviewProduct = {
  onlinepos_product_id: string | number | null;
  onlinepos_product_name: string | null;
  onlinepos_product_group_name: string | null;
  lineType: LineType;
  inventoryRelevant: boolean;
  needsMapping: boolean;
  mappingStatus: MappingStatus;
  mappingAction: MappingAction;
  backeventInventoryItemId: string | null;
  conversionFactor: number | null;
  canAffectInventory: boolean;
};

type ClassifiedLine = {
  onlineposProductId: string | number | null;
  onlineposProductName: string | null;
  onlineposProductGroupId: string | number | null;
  onlineposProductGroupName: string | null;
  lineType: LineType;
  inventoryRelevant: boolean;
  needsMapping: boolean;
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
  const transactionQuery = getTransactionQuery(request);

  if (!transactionQuery) {
    return jsonPreview(
      {
        ok: false,
        status: 400,
        message: "Missing datetime_from or datetime_to",
        tokenRequestStatus: null,
        transactionsRequestStatus: null,
        datetimeMode: "query",
        pageRequested: new URL(request.url).searchParams.get("page"),
        transactionCount: 0,
        lineCount: 0,
        pagination: emptyPagination(),
        hasMorePages: false,
        productCountBeforeMapping: 0,
        mappingCount: 0,
        errorStep: "missing_datetime",
        summary: emptySummary(),
        products: [],
      },
      400,
    );
  }

  const hasClientId = Boolean(process.env.ONLINEPOS_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.ONLINEPOS_CLIENT_SECRET);
  const hasVenueId = Boolean(process.env.ONLINEPOS_VENUE_ID);

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
      productCountBeforeMapping: 0,
      mappingCount: 0,
      errorStep: "missing_env",
      summary: emptySummary(),
      products: [],
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
        productCountBeforeMapping: 0,
        mappingCount: 0,
        errorStep: "token_request",
        summary: emptySummary(),
        products: [],
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
        productCountBeforeMapping: 0,
        mappingCount: 0,
        errorStep: "token_parse",
        summary: emptySummary(),
        products: [],
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
        productCountBeforeMapping: 0,
        mappingCount: 0,
        errorStep: "transactions_request",
        summary: emptySummary(),
        products: [],
      });
    }

    const parsed = parseTransactions(transactionsText);
    const allLines = parsed.transactions.flatMap(findTransactionLines);
    const productCountBeforeMapping = countDistinctClassifiedProducts(allLines);
    const backeventProducts = await getBackeventProducts();
    const products = buildMappingProducts(parsed.transactions, backeventProducts);
    const mappingCount = products.filter((product) => product.mappingStatus === "approved").length;

    if (products.length === 0) {
      return jsonPreview({
        ok: false,
        status: transactionsResponse.status,
        message: "Transactions fetched, but no products could be parsed",
        tokenRequestStatus: tokenResponse.status,
        transactionsRequestStatus: transactionsResponse.status,
        datetimeMode: "query",
        pageRequested: transactionQuery.pageRequested,
        transactionCount: parsed.transactions.length,
        lineCount: allLines.length,
        pagination: parsed.pagination,
        hasMorePages: hasMorePages(parsed.pagination),
        productCountBeforeMapping,
        mappingCount,
        errorStep: "parse_products_empty",
        summary: emptySummary(),
        products: [],
      });
    }

    return jsonPreview({
      ok: true,
      status: transactionsResponse.status,
      message: "Inventory mapping preview fetched",
      tokenRequestStatus: tokenResponse.status,
      transactionsRequestStatus: transactionsResponse.status,
      datetimeMode: "query",
      pageRequested: transactionQuery.pageRequested,
      transactionCount: parsed.transactions.length,
      lineCount: allLines.length,
      pagination: parsed.pagination,
      hasMorePages: hasMorePages(parsed.pagination),
      productCountBeforeMapping,
      mappingCount,
      errorStep: null,
      summary: buildSummary(products),
      products,
    });
  } catch {
    clearTimeout(timeout);
    return jsonPreview({
      ok: false,
      status: null,
      message: "OnlinePOS kan ikke nås",
      tokenRequestStatus: null,
      transactionsRequestStatus: null,
      datetimeMode: "query",
      pageRequested: transactionQuery.pageRequested,
      transactionCount: 0,
      lineCount: 0,
      pagination: emptyPagination(),
      hasMorePages: false,
      productCountBeforeMapping: 0,
      mappingCount: 0,
      errorStep: "unexpected_error",
      summary: emptySummary(),
      products: [],
    });
  }
}

function jsonPreview(body: InventoryMappingPreviewResponse, status?: number) {
  return NextResponse.json(body, status ? { status } : undefined);
}

function transactionsUrlWithQuery(transactionQuery: {
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

async function getBackeventProducts(): Promise<Product[]> {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return mockProductsSource;
  }

  const { data, error } = await supabase
    .from("backevent_products")
    .select("id,name,unit,tracking_mode,onlinepos_product_id,onlinepos_name,sales_unit_quantity,liters_per_sale,units_per_case,sort_order,active")
    .eq("active", true);

  if (error) {
    return mockProductsSource;
  }

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    unit: row.unit ?? "kasser",
    trackingMode: row.tracking_mode ?? "inventory",
    onlineposProductId: row.onlinepos_product_id,
    onlineposName: row.onlinepos_name,
    salesUnitQuantity: Number(row.sales_unit_quantity ?? 1),
    litersPerSale: row.liters_per_sale === null ? null : Number(row.liters_per_sale),
    unitsPerCase: row.units_per_case,
    sortOrder: row.sort_order,
    active: row.active,
    lowThreshold: 10,
    criticalThreshold: 5,
  }));
}

function buildMappingProducts(transactions: Record<string, unknown>[], backeventProducts: Product[]) {
  const lineMap = new Map<string, ClassifiedLine>();

  transactions.flatMap(findTransactionLines).forEach((line) => {
    const classified = toClassifiedLine(line);
    const key = [
      classified.onlineposProductId ?? "unknown",
      classified.onlineposProductName ?? "",
      classified.onlineposProductGroupName ?? "",
      classified.lineType,
    ].join(":");

    if (!lineMap.has(key)) {
      lineMap.set(key, classified);
    }
  });

  return Array.from(lineMap.values()).map((line) => toMappingProduct(line, backeventProducts));
}

function countDistinctClassifiedProducts(lines: Record<string, unknown>[]) {
  const keys = new Set<string>();

  lines.forEach((line) => {
    const classified = toClassifiedLine(line);
    keys.add(
      [
        classified.onlineposProductId ?? "unknown",
        classified.onlineposProductName ?? "",
        classified.onlineposProductGroupName ?? "",
        classified.lineType,
      ].join(":"),
    );
  });

  return keys.size;
}

function toMappingProduct(line: ClassifiedLine, backeventProducts: Product[]): MappingPreviewProduct {
  const mappedProduct = findMappedProduct(line, backeventProducts);
  const mappingStatus: MappingStatus = mappedProduct ? "approved" : isAutoApprovedLine(line.lineType) ? "approved" : "unmapped";
  const mappingAction = getMappingAction(line, mappedProduct);
  const canAffectInventory = mappingStatus === "approved" && mappingAction === "consume_stock";

  return {
    onlinepos_product_id: line.onlineposProductId,
    onlinepos_product_name: line.onlineposProductName,
    onlinepos_product_group_name: line.onlineposProductGroupName,
    lineType: line.lineType,
    inventoryRelevant: line.inventoryRelevant,
    needsMapping: line.needsMapping,
    mappingStatus,
    mappingAction,
    backeventInventoryItemId: mappedProduct?.id ?? null,
    conversionFactor: mappedProduct && mappingAction === "consume_stock" ? mappedProduct.salesUnitQuantity ?? 1 : null,
    canAffectInventory,
  };
}

function findMappedProduct(line: ClassifiedLine, backeventProducts: Product[]) {
  const onlineposId = stringifyValue(line.onlineposProductId);
  const onlineposName = line.onlineposProductName?.trim().toLocaleLowerCase("da-DK");

  return backeventProducts.find((product) => {
    if (onlineposId && product.onlineposProductId && product.onlineposProductId === onlineposId) {
      return true;
    }

    return Boolean(onlineposName && product.onlineposName?.trim().toLocaleLowerCase("da-DK") === onlineposName);
  });
}

function getMappingAction(line: ClassifiedLine, mappedProduct: Product | undefined): MappingAction {
  if (line.lineType === "deposit_fee") {
    return "deposit_fee";
  }

  if (line.lineType === "deposit_return") {
    return "deposit_return";
  }

  if (line.lineType === "container_product") {
    return "container_only";
  }

  if (line.lineType === "unknown") {
    return "ignore";
  }

  if (!mappedProduct) {
    return line.inventoryRelevant ? "consume_stock" : "ignore";
  }

  if (mappedProduct.trackingMode === "ignore") {
    return "ignore";
  }

  if (mappedProduct.trackingMode === "flow") {
    return "container_only";
  }

  return "consume_stock";
}

function isAutoApprovedLine(lineType: LineType) {
  return lineType === "deposit_fee" || lineType === "deposit_return" || lineType === "unknown";
}

function toClassifiedLine(line: Record<string, unknown>): ClassifiedLine {
  const productId = pickScalarField(line, ["product_id", "productId", "productid"]);
  const productName = stringifyValue(pickField(line, ["product_name", "productName", "productname", "name"]));
  const productGroupId = pickScalarField(line, ["product_group_id", "productGroupId", "productgroupid"]);
  const productGroupName = stringifyValue(pickField(line, ["product_group_name", "productGroupName", "productgroupname"]));
  const classification = classifyLine(productName, productGroupName);

  return {
    onlineposProductId: productId,
    onlineposProductName: productName,
    onlineposProductGroupId: productGroupId,
    onlineposProductGroupName: productGroupName,
    ...classification,
  };
}

function classifyLine(
  productName: string | null,
  productGroupName: string | null,
): Pick<ClassifiedLine, "lineType" | "inventoryRelevant" | "needsMapping"> {
  const name = (productName ?? "").toLocaleUpperCase("da-DK");
  const group = (productGroupName ?? "").trim();
  const groupUpper = group.toLocaleUpperCase("da-DK");

  if (!productName && !productGroupName) {
    return {
      lineType: "unknown",
      inventoryRelevant: false,
      needsMapping: false,
    };
  }

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

function buildSummary(products: MappingPreviewProduct[]): InventoryMappingPreviewResponse["summary"] {
  return {
    totalProducts: products.length,
    approvedMappings: products.filter((product) => product.mappingStatus === "approved").length,
    missingMappings: products.filter((product) => product.mappingStatus === "unmapped").length,
    inventoryRelevantMissingMappings: products.filter((product) => product.inventoryRelevant && product.mappingStatus === "unmapped").length,
    ignoredProducts: products.filter((product) => product.mappingAction === "ignore").length,
    depositProducts: products.filter((product) => product.mappingAction === "deposit_fee" || product.mappingAction === "deposit_return").length,
    containerProducts: products.filter((product) => product.mappingAction === "container_only").length,
  };
}

function emptySummary(): InventoryMappingPreviewResponse["summary"] {
  return {
    totalProducts: 0,
    approvedMappings: 0,
    missingMappings: 0,
    inventoryRelevantMissingMappings: 0,
    ignoredProducts: 0,
    depositProducts: 0,
    containerProducts: 0,
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
