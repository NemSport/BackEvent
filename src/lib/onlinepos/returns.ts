import type { SupabaseClient } from "@supabase/supabase-js";
import webPush from "web-push";
import type { OnlinePosInventoryMapping, OnlinePosMappingAction } from "./inventory-mappings";

export type ReturnHandling = "waste" | "return_to_stock" | "manual_review" | "no_stock_effect";

export type ParsedOnlinePosReturnLine = {
  onlineposLineId: string | null;
  externalReturnLineId: string;
  onlineposProductId: string | null;
  productDescription: string;
  productGroupName: string | null;
  returnedQuantity: number;
  unitPrice: number | null;
  lineAmount: number;
  lineType: string;
  isDeposit: boolean;
  isCup: boolean;
  isFee: boolean;
};

export type ParsedOnlinePosReturn = {
  externalIdempotencyKey: string;
  contentHash: string;
  receiptNumber: string | null;
  onlineposTransactionId: string | null;
  onlineposReturnId: string | null;
  originalTransactionId: string | null;
  onlineposReturnedAt: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string | null;
  totalAmount: number;
  productAmount: number;
  depositAmount: number;
  cupAmount: number;
  controlReasons: string[];
  suspicionFlags: string[];
  rawMetadata: Record<string, unknown>;
  lines: ParsedOnlinePosReturnLine[];
};

type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  return_handling: ReturnHandling | null;
  active: boolean | null;
};

type LocationRow = {
  id: string;
  name: string;
  type: string | null;
  source_location_id: string | null;
  active: boolean | null;
};

type TokenResponse = {
  access_token?: string;
};

type ReturnPagination = {
  total: string | number | null;
  per_page: string | number | null;
  current_page: string | number | null;
  last_page: string | number | null;
};

const restBaseUrl = "https://rest.onlinepos.dk";
const timeoutMs = 15000;
const maxPages = 100;

export async function runOnlinePosReturnSync({
  supabase,
  datetimeFrom,
  datetimeTo,
  source = "manual",
}: {
  supabase: SupabaseClient;
  datetimeFrom: string;
  datetimeTo: string;
  source?: "manual" | "cron";
}) {
  const run = await createReturnSyncRun(supabase, { datetimeFrom, datetimeTo, source });
  try {
    const fetched = await fetchOnlinePosTransactions({ datetimeFrom, datetimeTo });
    const returns = fetched.transactions.map(parseOnlinePosReturn).filter((item): item is ParsedOnlinePosReturn => Boolean(item));
    const context = await loadReturnContext(supabase);
    const registered = [];
    let processedLineCount = 0;
    let reviewCount = 0;
    let duplicateCount = 0;

    for (const parsedReturn of returns) {
      const result = await registerAndProcessReturn(supabase, parsedReturn, context);
      registered.push(result);
      processedLineCount += result.processedLineCount;
      reviewCount += result.reviewCount;
      duplicateCount += result.duplicate ? 1 : 0;
    }

    const status = fetched.pageErrors.length > 0 ? "partial" : "completed";
    await updateReturnSyncRun(supabase, run.id, {
      status,
      pageCount: fetched.pageCount,
      transactionCount: fetched.transactions.length,
      returnCount: returns.length,
      processedLineCount,
      reviewCount,
      duplicateCount,
      errorMessage: fetched.pageErrors.length > 0 ? fetched.pageErrors.join("; ") : null,
    });

    return {
      ok: fetched.pageErrors.length === 0,
      source,
      runId: run.id,
      status,
      datetimeFrom,
      datetimeTo,
      pageCount: fetched.pageCount,
      transactionCount: fetched.transactions.length,
      returnCount: returns.length,
      processedLineCount,
      reviewCount,
      duplicateCount,
      pagination: fetched.pagination,
      pageErrors: fetched.pageErrors,
      returns: registered,
    };
  } catch (error) {
    await updateReturnSyncRun(supabase, run.id, {
      status: "failed",
      pageCount: 0,
      transactionCount: 0,
      returnCount: 0,
      processedLineCount: 0,
      reviewCount: 0,
      duplicateCount: 0,
      errorMessage: safeErrorMessage(error),
    }).catch(() => undefined);

    return {
      ok: false,
      source,
      runId: run.id,
      status: "failed",
      datetimeFrom,
      datetimeTo,
      message: safeErrorMessage(error),
      pageCount: 0,
      transactionCount: 0,
      returnCount: 0,
      processedLineCount: 0,
      reviewCount: 0,
      duplicateCount: 0,
      pageErrors: [safeErrorMessage(error)],
      returns: [],
    };
  }
}

export function parseOnlinePosReturn(transaction: Record<string, unknown>, transactionIndex = 0): ParsedOnlinePosReturn | null {
  const lines = findTransactionLines(transaction);
  const returnSignal = hasReturnSignal(transaction, lines);

  if (!returnSignal.isReturn) {
    return null;
  }

  const transactionId = stringOrNull(pickField(transaction, ["transaction_id", "transactionId", "id"]));
  const receiptNumber = stringOrNull(pickField(transaction, ["receipt_number", "receiptNumber"]));
  const returnId = stringOrNull(pickField(transaction, ["return_id", "refund_id", "returnId", "refundId"]));
  const originalTransactionId = stringOrNull(pickField(transaction, ["original_transaction_id", "originalTransactionId", "parent_transaction_id"]));
  const onlineposReturnedAt = stringOrNull(pickField(transaction, ["datetime", "created_at", "createdAt", "returned_at", "returnedAt"]));
  const cashRegister = toSafeCashRegister(pickField(transaction, ["cash_register", "cashRegister"]));
  const parsedLines = lines
    .map((line, lineIndex) => toReturnLine(line, transactionId, receiptNumber, transactionIndex * 10000 + lineIndex))
    .filter((line) => line.returnedQuantity > 0 || line.lineAmount < 0);

  if (parsedLines.length === 0) {
    return null;
  }

  const totalAmount = numberValue(pickField(transaction, ["total", "amount", "net_price", "netPrice", "price"])) ?? parsedLines.reduce((sum, line) => sum + line.lineAmount, 0);
  const depositAmount = parsedLines.filter((line) => line.isDeposit || line.isCup || line.isFee).reduce((sum, line) => sum + line.lineAmount, 0);
  const productAmount = parsedLines.reduce((sum, line) => sum + line.lineAmount, 0) - depositAmount;
  const cupAmount = parsedLines.filter((line) => line.isCup).reduce((sum, line) => sum + line.lineAmount, 0);
  const externalIdempotencyKey = [
    "return",
    returnId ?? transactionId ?? receiptNumber ?? `tx-${transactionIndex}`,
    receiptNumber ?? "receipt",
    Math.abs(roundNumber(totalAmount)),
    onlineposReturnedAt ?? "time",
  ].join(":");
  const contentHash = stableHash({
    transactionId,
    receiptNumber,
    totalAmount: roundNumber(totalAmount),
    lines: parsedLines.map((line) => ({
      id: line.onlineposLineId,
      product: line.onlineposProductId ?? line.productDescription,
      qty: line.returnedQuantity,
      amount: line.lineAmount,
    })),
  });
  const controlReasons = [...returnSignal.reasons];
  const suspicionFlags = [];

  if (parsedLines.some((line) => line.returnedQuantity > 10 && !line.isDeposit)) {
    suspicionFlags.push("STOR_RETUR");
    controlReasons.push("Stor retur over 10 enheder");
  }

  if (parsedLines.some((line) => line.isCup || line.isDeposit || line.isFee)) {
    suspicionFlags.push("PANT_KRUS");
  }

  return {
    externalIdempotencyKey,
    contentHash,
    receiptNumber,
    onlineposTransactionId: transactionId,
    onlineposReturnId: returnId,
    originalTransactionId,
    onlineposReturnedAt,
    cashRegisterId: cashRegister?.id ?? null,
    cashRegisterName: cashRegister?.name ?? null,
    totalAmount: roundNumber(totalAmount),
    productAmount: roundNumber(productAmount),
    depositAmount: roundNumber(depositAmount),
    cupAmount: roundNumber(cupAmount),
    controlReasons: [...new Set(controlReasons)],
    suspicionFlags: [...new Set(suspicionFlags)],
    rawMetadata: {
      source: "onlinepos",
      cashRegister,
      weakSignal: returnSignal.weak,
    },
    lines: parsedLines,
  };
}

export async function registerAndProcessReturn(
  supabase: SupabaseClient,
  parsedReturn: ParsedOnlinePosReturn,
  context: Awaited<ReturnType<typeof loadReturnContext>>,
) {
  const location = findLocationForCashRegister(parsedReturn, context.locations);
  const sourceLocationId = location?.source_location_id ?? null;
  const controlReasons = [...parsedReturn.controlReasons];

  if (!location) controlReasons.push("Ukendt lokation");
  if (location && !sourceLocationId) controlReasons.push("Mangler lagerkilde");
  if (!parsedReturn.receiptNumber) controlReasons.push("Mangler bonnummer");

  const existing = await findExistingReturn(supabase, parsedReturn.externalIdempotencyKey);
  if (existing) {
    if (existing.content_hash && existing.content_hash !== parsedReturn.contentHash) {
      const reasons = uniqueJson([...(asStringArray(existing.control_reasons) ?? []), "Dublet med ændret indhold"]);
      await supabase
        .from("backevent_returns")
        .update({
          processing_status: "duplicate",
          control_status: "open",
          control_reasons: reasons,
        })
        .eq("id", existing.id);
      await notifyOwnersAboutReturnControl(supabase, String(existing.id), parsedReturn, reasons);
    }
    return {
      id: String(existing.id),
      duplicate: true,
      processedLineCount: 0,
      reviewCount: 0,
      processingStatus: existing.processing_status,
    };
  }

  const { data: insertedReturn, error: insertError } = await supabase
    .from("backevent_returns")
    .insert({
      location_id: location?.id ?? null,
      source_location_id: sourceLocationId,
      onlinepos_venue_id: process.env.ONLINEPOS_VENUE_ID ?? null,
      onlinepos_location_ref: parsedReturn.cashRegisterName ?? parsedReturn.cashRegisterId,
      onlinepos_returned_at: parsedReturn.onlineposReturnedAt,
      receipt_number: parsedReturn.receiptNumber,
      onlinepos_transaction_id: parsedReturn.onlineposTransactionId,
      onlinepos_return_id: parsedReturn.onlineposReturnId,
      original_transaction_id: parsedReturn.originalTransactionId,
      external_idempotency_key: parsedReturn.externalIdempotencyKey,
      content_hash: parsedReturn.contentHash,
      total_amount: parsedReturn.totalAmount,
      product_amount: parsedReturn.productAmount,
      deposit_amount: parsedReturn.depositAmount,
      cup_amount: parsedReturn.cupAmount,
      processing_status: "processing",
      control_status: controlReasons.length > 0 ? "open" : "not_required",
      control_reasons: uniqueJson(controlReasons),
      suspicion_flags: uniqueJson(parsedReturn.suspicionFlags),
      raw_metadata: parsedReturn.rawMetadata,
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error("Retur kunne ikke registreres");
  }

  const returnId = String(insertedReturn.id);
  await supabase.from("backevent_return_history").insert({
    return_id: returnId,
    action: "registered",
    actor_name: "BackEvent",
    metadata: { lineCount: parsedReturn.lines.length },
  });

  const preparedLines = parsedReturn.lines.map((line) => prepareReturnLine(line, returnId, context));
  const allControlReasons = uniqueJson([...controlReasons, ...preparedLines.flatMap((line) => line.reasons)]);
  if (allControlReasons.length > controlReasons.length) {
    await supabase
      .from("backevent_returns")
      .update({ control_status: "open", control_reasons: allControlReasons })
      .eq("id", returnId);
  }

  const { data: insertedLines, error: lineError } = await supabase
    .from("backevent_return_lines")
    .insert(preparedLines.map((line) => line.row))
    .select("id,processing_status");

  if (lineError) {
    await supabase.from("backevent_returns").update({ processing_status: "processing_failed", control_status: "open" }).eq("id", returnId);
    await notifyOwnersAboutReturnControl(supabase, returnId, parsedReturn, ["Returlinjer kunne ikke registreres"]);
    throw new Error("Returlinjer kunne ikke registreres");
  }

  let processedLineCount = 0;
  let reviewCount = 0;

  for (const row of insertedLines ?? []) {
    const { data, error } = await supabase.rpc("backevent_process_return_line", { p_return_line_id: row.id });
    const result = data as { ok?: boolean; status?: string } | null;
    if (result?.ok) processedLineCount += 1;
    if (error || result?.status === "requires_review") reviewCount += 1;
  }

  await notifyFinanceAboutReturn(supabase, returnId, parsedReturn, location?.name ?? null);
  if (allControlReasons.length > 0 || reviewCount > 0) {
    await notifyOwnersAboutReturnControl(supabase, returnId, parsedReturn, allControlReasons.length > 0 ? allControlReasons : ["Retur kræver kontrol"]);
  }

  return { id: returnId, duplicate: false, processedLineCount, reviewCount, processingStatus: reviewCount > 0 ? "requires_review" : "processed" };
}

export async function fetchOnlinePosTransactions({ datetimeFrom, datetimeTo, page }: { datetimeFrom: string; datetimeTo: string; page?: string | null }) {
  if (!process.env.ONLINEPOS_CLIENT_ID || !process.env.ONLINEPOS_CLIENT_SECRET || !process.env.ONLINEPOS_VENUE_ID) {
    throw new Error("OnlinePOS env mangler");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const tokenResponse = await fetch(`${restBaseUrl}/auth/token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.ONLINEPOS_CLIENT_ID,
        client_secret: process.env.ONLINEPOS_CLIENT_SECRET,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const tokenText = await tokenResponse.text();

    if (!tokenResponse.ok) throw new Error("OnlinePOS token request fejlede");
    const accessToken = parseAccessToken(tokenText);
    if (!accessToken) throw new Error("OnlinePOS token response manglede access_token");

    const collected: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const pageErrors: string[] = [];
    let pagination: ReturnPagination = emptyPagination();
    let currentPage = page ? Number(page) : 1;
    let pageCount = 0;

    while (pageCount < maxPages) {
      const pageResult = await fetchOnlinePosTransactionPage({
        accessToken,
        datetimeFrom,
        datetimeTo,
        page: String(currentPage),
        signal: controller.signal,
      });
      pageCount += 1;
      pagination = pageResult.pagination;

      for (const transaction of pageResult.transactions) {
        const key = transactionKey(transaction);
        if (!seen.has(key)) {
          seen.add(key);
          collected.push(transaction);
        }
      }

      if (page || !hasMorePages(pagination)) {
        break;
      }

      const nextPage = nextPageNumber(pagination, currentPage);
      if (!nextPage || nextPage <= currentPage) {
        pageErrors.push("Pagination stoppede uden gyldig næste side");
        break;
      }
      currentPage = nextPage;
    }

    if (pageCount >= maxPages && hasMorePages(pagination)) {
      pageErrors.push("Pagination stoppet af sikkerhedsgrænse");
    }

    return {
      transactions: collected,
      pagination,
      pageCount,
      pageErrors,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("OnlinePOS kald timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOnlinePosTransactionPage({
  accessToken,
  datetimeFrom,
  datetimeTo,
  page,
  signal,
}: {
  accessToken: string;
  datetimeFrom: string;
  datetimeTo: string;
  page: string;
  signal: AbortSignal;
}) {
  const url = new URL(`${restBaseUrl}/transactions`);
  url.searchParams.set("venue", process.env.ONLINEPOS_VENUE_ID!);
  url.searchParams.set("extended_view", "1");
  url.searchParams.set("datetime_from", datetimeFrom);
  url.searchParams.set("datetime_to", datetimeTo);
  url.searchParams.set("page", page);

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403 ? "OnlinePOS afviser adgang" : `OnlinePOS transactions fejlede på side ${page}`);
  }

  return parseTransactions(text);
}

async function createReturnSyncRun(supabase: SupabaseClient, input: { datetimeFrom: string; datetimeTo: string; source: "manual" | "cron" }) {
  const { data, error } = await supabase
    .from("backevent_return_sync_runs")
    .insert({
      source: input.source,
      datetime_from: input.datetimeFrom,
      datetime_to: input.datetimeTo,
    })
    .select("id")
    .single();

  if (error) {
    return { id: crypto.randomUUID() };
  }

  return { id: String(data.id) };
}

async function updateReturnSyncRun(
  supabase: SupabaseClient,
  runId: string,
  input: {
    status: "completed" | "partial" | "failed";
    pageCount: number;
    transactionCount: number;
    returnCount: number;
    processedLineCount: number;
    reviewCount: number;
    duplicateCount: number;
    errorMessage: string | null;
  },
) {
  await supabase
    .from("backevent_return_sync_runs")
    .update({
      status: input.status,
      page_count: input.pageCount,
      transaction_count: input.transactionCount,
      return_count: input.returnCount,
      processed_line_count: input.processedLineCount,
      review_count: input.reviewCount,
      duplicate_count: input.duplicateCount,
      error_message: input.errorMessage,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

async function loadReturnContext(supabase: SupabaseClient) {
  const [mappingsResult, componentsResult, productsResult, locationsResult] = await Promise.all([
    supabase.from("onlinepos_inventory_mappings").select("id,onlinepos_product_id,onlinepos_product_name,line_type,mapping_action,status,backevent_inventory_item_id,conversion_factor"),
    supabase.from("onlinepos_inventory_mapping_components").select("mapping_id,backevent_inventory_item_id,conversion_factor,sort_order").order("sort_order"),
    supabase.from("backevent_products").select("id,name,unit,return_handling,active").eq("active", true),
    supabase.from("backevent_locations").select("id,name,type,source_location_id,active").eq("active", true),
  ]);

  if (mappingsResult.error || componentsResult.error || productsResult.error || locationsResult.error) {
    throw new Error("Returdata kunne ikke hentes");
  }

  const componentsByMapping = new Map<string, Array<{ backeventInventoryItemId: string | null; conversionFactor: number | null; sortOrder: number }>>();
  for (const component of componentsResult.data ?? []) {
    const key = String(component.mapping_id);
    const list = componentsByMapping.get(key) ?? [];
    list.push({
      backeventInventoryItemId: stringOrNull(component.backevent_inventory_item_id),
      conversionFactor: component.conversion_factor === null ? null : Number(component.conversion_factor),
      sortOrder: Number(component.sort_order ?? 0),
    });
    componentsByMapping.set(key, list);
  }

  const mappings = (mappingsResult.data ?? []).map((mapping) => ({
    id: String(mapping.id),
    onlineposProductId: stringOrNull(mapping.onlinepos_product_id),
    onlineposProductName: stringOrNull(mapping.onlinepos_product_name),
    onlineposProductGroupName: null,
    lineType: mapping.line_type,
    backeventInventoryItemId: stringOrNull(mapping.backevent_inventory_item_id),
    conversionFactor: mapping.conversion_factor === null ? null : Number(mapping.conversion_factor),
    mappingAction: mapping.mapping_action as OnlinePosMappingAction,
    status: mapping.status as "unmapped" | "approved",
    components: componentsByMapping.get(String(mapping.id)) ?? [],
    createdAt: null,
    updatedAt: null,
  }));

  return {
    mappings,
    products: (productsResult.data ?? []) as ProductRow[],
    locations: (locationsResult.data ?? []) as LocationRow[],
  };
}

function prepareReturnLine(
  line: ParsedOnlinePosReturnLine,
  returnId: string,
  context: Awaited<ReturnType<typeof loadReturnContext>>,
) {
  const mapping = findMapping(line, context.mappings);
  const components = normalizeReturnComponents(mapping);
  const firstComponent = components.length === 1 ? components[0] : null;
  const product = firstComponent?.backeventInventoryItemId
    ? context.products.find((item) => item.id === firstComponent.backeventInventoryItemId) ?? null
    : null;
  const handling = line.isDeposit || line.isCup || line.isFee
    ? "no_stock_effect"
    : product?.return_handling ?? (components.length > 1 ? "manual_review" : "manual_review");
  const conversionFactor = firstComponent?.conversionFactor ?? 0;
  const calculatedStockQuantity = roundNumber(Math.abs(line.returnedQuantity) * Number(conversionFactor));
  const reasons = [];

  if (!mapping || mapping.status !== "approved") reasons.push("Mangler godkendt mapping");
  if (components.length > 1) reasons.push("Flere lagerkomponenter kræver manuel returkontrol");
  if (!product && handling !== "no_stock_effect") reasons.push("Produkt findes ikke i BackEvent");
  if (handling === "manual_review") reasons.push("Produkt kræver manuel returkontrol");

  return {
    reasons,
    row: {
      return_id: returnId,
      onlinepos_line_id: line.onlineposLineId,
      external_return_line_id: line.externalReturnLineId,
      onlinepos_product_id: line.onlineposProductId,
      backevent_product_id: product?.id ?? null,
      product_description: line.productDescription,
      returned_quantity: line.returnedQuantity,
      unit: product?.unit ?? null,
      unit_price: line.unitPrice,
      line_amount: line.lineAmount,
      line_type: line.lineType,
      return_handling: handling,
      is_deposit: line.isDeposit,
      is_cup: line.isCup,
      is_fee: line.isFee,
      affects_stock: handling === "return_to_stock",
      calculated_stock_quantity: calculatedStockQuantity,
      processing_status: reasons.length > 0 ? "requires_review" : "registered",
      error_message: reasons.length > 0 ? reasons.join(", ") : null,
      idempotency_key: line.externalReturnLineId,
    },
  };
}

async function notifyFinanceAboutReturn(supabase: SupabaseClient, returnId: string, parsedReturn: ParsedOnlinePosReturn, locationName: string | null) {
  const members = await getFinanceMembers(supabase);
  if (members.length === 0) return;

  const title = "Retur – " + (locationName ?? parsedReturn.cashRegisterName ?? "Ukendt sted");
  const body = buildReturnNotificationText(parsedReturn);
  const targetUrl = "/retur/" + returnId;
  const configured = isWebPushConfigured();
  if (configured) {
    webPush.setVapidDetails(process.env.WEB_PUSH_SUBJECT!, getPublicVapidKey()!, process.env.WEB_PUSH_PRIVATE_KEY!);
  }

  for (const member of members) {
    const dedupeKey = "return-created:" + returnId + ":finance:" + member.id;
    const { data: existing } = await supabase.from("backevent_return_notifications").select("id").eq("dedupe_key", dedupeKey).maybeSingle();
    if (existing) continue;

    const message = await createPushMessage(supabase, {
      recipientUserId: member.id,
      recipientEmail: member.email,
      senderName: "BackEvent",
      title,
      body,
      targetUrl,
      category: "group",
    });

    await supabase.from("backevent_return_notifications").insert({
      return_id: returnId,
      recipient_user_id: member.id,
      dedupe_key: dedupeKey,
      notification_type: "return_created_finance",
      push_message_id: message.id,
      status: configured ? "pending" : "skipped",
      error_message: configured ? null : "Push er ikke konfigureret",
    });

    if (!configured) continue;

    const { data: subscriptions } = await supabase
      .from("backevent_push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", member.id)
      .eq("active", true);

    for (const subscription of subscriptions ?? []) {
      try {
        await webPush.sendNotification(
          {
            endpoint: String(subscription.endpoint),
            keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth) },
          },
          JSON.stringify(pushPayload({ title, body, messageId: message.id, url: buildMessageUrl(message.id) })),
        );
      } catch (error) {
        if (isExpiredSubscription(error)) {
          await supabase.from("backevent_push_subscriptions").update({ active: false }).eq("id", subscription.id);
        }
      }
    }
  }
}

async function notifyOwnersAboutReturnControl(supabase: SupabaseClient, returnId: string, parsedReturn: ParsedOnlinePosReturn, reasons: string[]) {
  const owners = await getOwnerMembers(supabase);
  if (owners.length === 0) return;

  const title = "Retur kræver ejerkontrol";
  const bonText = parsedReturn.receiptNumber ? "Bon " + parsedReturn.receiptNumber : "Bon mangler";
  const body = bonText + " · " + reasons.slice(0, 3).join(" · ");
  const configured = isWebPushConfigured();
  if (configured) {
    webPush.setVapidDetails(process.env.WEB_PUSH_SUBJECT!, getPublicVapidKey()!, process.env.WEB_PUSH_PRIVATE_KEY!);
  }

  for (const owner of owners) {
    const dedupeKey = "return-control:" + returnId + ":owner:" + owner.id;
    const { data: existing } = await supabase.from("backevent_return_notifications").select("id").eq("dedupe_key", dedupeKey).maybeSingle();
    if (existing) continue;

    const message = await createPushMessage(supabase, {
      recipientUserId: owner.id,
      recipientEmail: owner.email,
      senderName: "BackEvent",
      title,
      body,
      targetUrl: "/retur/" + returnId,
      category: "group",
    });

    await supabase.from("backevent_return_notifications").insert({
      return_id: returnId,
      recipient_user_id: owner.id,
      dedupe_key: dedupeKey,
      notification_type: "return_control_owner",
      push_message_id: message.id,
      status: configured ? "pending" : "skipped",
      error_message: configured ? null : "Push er ikke konfigureret",
    });

    if (!configured) continue;

    const { data: subscriptions } = await supabase
      .from("backevent_push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", owner.id)
      .eq("active", true);

    for (const subscription of subscriptions ?? []) {
      try {
        await webPush.sendNotification(
          { endpoint: String(subscription.endpoint), keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth) } },
          JSON.stringify(pushPayload({ title, body, messageId: message.id, url: buildMessageUrl(message.id) })),
        );
      } catch (error) {
        if (isExpiredSubscription(error)) {
          await supabase.from("backevent_push_subscriptions").update({ active: false }).eq("id", subscription.id);
        }
      }
    }
  }
}

async function getFinanceMembers(supabase: SupabaseClient): Promise<Array<{ id: string; email: string | null }>> {
  const { data } = await supabase
    .from("backevent_member_group_members")
    .select("profile_id, backevent_member_groups!inner(name,active), backevent_profiles!inner(id,email,active)")
    .eq("backevent_member_groups.active", true)
    .eq("backevent_profiles.active", true)
    .ilike("backevent_member_groups.name", "Økonomiansvarlige");

  return (data ?? []).map((row) => {
    const profile = row.backevent_profiles as { id?: string; email?: string | null } | null;
    return { id: String(profile?.id ?? row.profile_id), email: profile?.email ?? null };
  }).filter((member, index, all) => member.id && all.findIndex((item) => item.id === member.id) === index);
}

async function getOwnerMembers(supabase: SupabaseClient): Promise<Array<{ id: string; email: string | null }>> {
  const { data } = await supabase
    .from("backevent_profiles")
    .select("id,email,active,role")
    .eq("active", true)
    .eq("role", "ejer");

  return (data ?? []).map((row) => ({ id: String(row.id), email: row.email ?? null }));
}

function buildReturnNotificationText(parsedReturn: ParsedOnlinePosReturn) {
  return [
    `Tid: ${formatNotificationTime(parsedReturn.onlineposReturnedAt)}`,
    `Bon: ${parsedReturn.receiptNumber ?? "Mangler"}`,
  ].join("\n");
}

function formatNotificationTime(value: string | null) {
  if (!value) return "Mangler";
  return new Date(value).toLocaleString("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function findExistingReturn(supabase: SupabaseClient, externalIdempotencyKey: string) {
  const { data, error } = await supabase
    .from("backevent_returns")
    .select("id,content_hash,processing_status,control_reasons")
    .eq("external_idempotency_key", externalIdempotencyKey)
    .maybeSingle();
  if (error) throw new Error("Retur kunne ikke kontrolleres for dublet");
  return data as { id: string; content_hash: string | null; processing_status: string; control_reasons: unknown } | null;
}

function findMapping(line: ParsedOnlinePosReturnLine, mappings: OnlinePosInventoryMapping[]) {
  const productId = normalizeOnlinePosId(line.onlineposProductId);
  if (productId) {
    return mappings.find((mapping) => normalizeOnlinePosId(mapping.onlineposProductId) === productId) ?? null;
  }
  const productName = normalizeName(line.productDescription);
  return mappings.find((mapping) => !normalizeOnlinePosId(mapping.onlineposProductId) && normalizeName(mapping.onlineposProductName) === productName) ?? null;
}

async function createPushMessage(supabase: SupabaseClient, input: {
  recipientUserId: string;
  recipientEmail?: string | null;
  senderName?: string | null;
  title: string;
  body: string;
  targetUrl: string;
  category: "group" | "inventory_alert" | "general" | "test";
}) {
  const id = crypto.randomUUID();
  const { error } = await supabase.from("backevent_push_messages").insert({
    id,
    recipient_user_id: input.recipientUserId,
    recipient_email: input.recipientEmail ?? null,
    sender_name: input.senderName ?? null,
    title: input.title,
    body: input.body,
    target_url: input.targetUrl,
    category: input.category,
  });

  if (error) throw error;
  return { id, targetUrl: input.targetUrl };
}

function buildMessageUrl(messageId: string | null | undefined) {
  return messageId ? `/notifikationer/${messageId}` : "/notifikationer";
}

function pushPayload(input: { title: string; body: string; messageId?: string | null; url?: string | null }) {
  return {
    title: input.title,
    body: input.body,
    messageId: input.messageId ?? null,
    url: input.url ?? buildMessageUrl(input.messageId),
  };
}

function classifyOnlinePosLine(productName: string | null, productGroupName: string | null) {
  const name = (productName ?? "").toLocaleUpperCase("da-DK");
  const groupUpper = (productGroupName ?? "").trim().toLocaleUpperCase("da-DK");

  if (!productName && !productGroupName) {
    return { lineType: "unknown", inventoryRelevant: false, needsMapping: false };
  }

  if (groupUpper.startsWith("MSG -")) {
    return { lineType: "modifier_stock_item", inventoryRelevant: true, needsMapping: true };
  }

  if (name.includes("GEBYR") && (name.includes("KRUS") || name.includes("KANDE"))) {
    return { lineType: "deposit_fee", inventoryRelevant: false, needsMapping: false };
  }

  if (name.includes("RETUR") && (name.includes("KRUS") || name.includes("KANDE"))) {
    return { lineType: "deposit_return", inventoryRelevant: false, needsMapping: false };
  }

  if (["DRINKS", "SODAVAND"].includes(groupUpper)) {
    return { lineType: "container_product", inventoryRelevant: false, needsMapping: true };
  }

  return { lineType: "stock_item", inventoryRelevant: true, needsMapping: true };
}

function normalizeReturnComponents(mapping: OnlinePosInventoryMapping | null) {
  if (!mapping) return [];
  if (mapping.components.length > 0) return mapping.components;
  if (mapping.backeventInventoryItemId && mapping.conversionFactor !== null) {
    return [{ backeventInventoryItemId: mapping.backeventInventoryItemId, conversionFactor: mapping.conversionFactor }];
  }
  return [];
}

function findLocationForCashRegister(parsedReturn: ParsedOnlinePosReturn, locations: LocationRow[]) {
  const id = normalizeOnlinePosId(parsedReturn.cashRegisterId);
  if (id) {
    const byId = locations.find((location) => normalizeOnlinePosId(location.id) === id);
    if (byId) return byId;
  }
  const name = normalizeName(parsedReturn.cashRegisterName);
  return name ? locations.find((location) => normalizeName(location.name) === name) ?? null : null;
}

function toReturnLine(line: Record<string, unknown>, transactionId: string | null, receiptNumber: string | null, lineIndex: number): ParsedOnlinePosReturnLine {
  const productDescription = stringOrNull(pickField(line, ["product_name", "productName", "productname", "name", "receipt_text", "receiptText"])) ?? "Ukendt vare";
  const productGroupName = stringOrNull(pickField(line, ["product_group_name", "productGroupName", "productgroupname"]));
  const quantity = Math.abs(numberValue(pickField(line, ["quantity", "qty", "count", "amount"])) ?? 0);
  const lineAmount = numberValue(pickField(line, ["net_price", "netPrice", "netprice", "price", "gross_price", "grossPrice"])) ?? 0;
  const classification = classifyOnlinePosLine(productDescription, productGroupName);
  const normalizedName = productDescription.toLocaleUpperCase("da-DK");
  const isCup = normalizedName.includes("KRUS") || normalizedName.includes("KANDE");
  const isFee = normalizedName.includes("GEBYR");
  const isDeposit = classification.lineType === "deposit_fee" || classification.lineType === "deposit_return" || isCup || isFee;
  const lineId = stringOrNull(pickField(line, ["line_id", "lineId", "orderlineid", "id"]));
  const onlineposProductId = stringOrNull(pickField(line, ["product_id", "productId", "productid"]));
  const externalReturnLineId = [
    "return-line",
    transactionId ?? receiptNumber ?? "transaction",
    lineId ?? `line-${lineIndex}`,
    onlineposProductId ?? normalizeName(productDescription),
    quantity,
    Math.abs(roundNumber(lineAmount)),
  ].join(":");

  return {
    onlineposLineId: lineId,
    externalReturnLineId,
    onlineposProductId,
    productDescription,
    productGroupName,
    returnedQuantity: roundNumber(quantity),
    unitPrice: quantity > 0 ? roundNumber(lineAmount / quantity) : null,
    lineAmount: roundNumber(lineAmount),
    lineType: classification.lineType,
    isDeposit,
    isCup,
    isFee,
  };
}

function hasReturnSignal(transaction: Record<string, unknown>, lines: Record<string, unknown>[]) {
  const typeText = [
    stringOrNull(pickField(transaction, ["type", "kind", "status", "transaction_type", "transactionType"])),
    stringOrNull(pickField(transaction, ["return_id", "refund_id", "returnId", "refundId"])),
  ].filter(Boolean).join(" ").toLocaleLowerCase("da-DK");
  const explicit = /return|refund|retur|credit/.test(typeText);
  const voidOrCancel = /void|cancel|cancelled|canceled|annuller/.test(typeText);
  const negativeLine = lines.some((line) => (numberValue(pickField(line, ["quantity", "qty", "count", "amount"])) ?? 0) < 0 || (numberValue(pickField(line, ["net_price", "price", "gross_price"])) ?? 0) < 0);
  const negativeTotal = (numberValue(pickField(transaction, ["total", "amount", "net_price", "price"])) ?? 0) < 0;
  const isReturn = explicit || (!voidOrCancel && negativeLine && negativeTotal);
  const reasons = [];
  if (!explicit && isReturn) reasons.push("Retur fundet ud fra negative linjer");
  return { isReturn, weak: !explicit && isReturn, reasons };
}

function parseTransactions(text: string): { transactions: Record<string, unknown>[]; pagination: ReturnPagination } {
  try {
    const json = JSON.parse(text) as unknown;
    return { transactions: findTransactions(json), pagination: findPagination(json) };
  } catch {
    return { transactions: [], pagination: emptyPagination() };
  }
}

function findTransactions(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    const data = value.data;
    if (Array.isArray(data)) return data.filter(isRecord);
  }
  return [];
}

function findTransactionLines(transaction: Record<string, unknown>): Record<string, unknown>[] {
  const lines = pickField(transaction, ["lines", "transaction_lines", "transactionLines", "orderlines"]);
  return Array.isArray(lines) ? lines.filter(isRecord) : [];
}

function findPagination(value: unknown) {
  if (!isRecord(value) || !isRecord(value.pagination)) return emptyPagination();
  return {
    total: stringOrNumber(value.pagination.total),
    per_page: stringOrNumber(value.pagination.per_page),
    current_page: stringOrNumber(value.pagination.current_page),
    last_page: stringOrNumber(value.pagination.last_page),
  };
}

function emptyPagination(): ReturnPagination {
  return { total: null, per_page: null, current_page: null, last_page: null };
}

function hasMorePages(pagination: ReturnPagination) {
  const current = numberValue(pagination.current_page);
  const last = numberValue(pagination.last_page);
  if (current !== null && last !== null) return current < last;

  const total = numberValue(pagination.total);
  const perPage = numberValue(pagination.per_page);
  if (total !== null && perPage !== null && perPage > 0 && current !== null) {
    return current < Math.ceil(total / perPage);
  }

  return false;
}

function nextPageNumber(pagination: ReturnPagination, fallbackCurrentPage: number) {
  const current = numberValue(pagination.current_page) ?? fallbackCurrentPage;
  return current + 1;
}

function transactionKey(transaction: Record<string, unknown>) {
  const transactionId = stringOrNull(pickField(transaction, ["transaction_id", "transactionId", "id"]));
  const receiptNumber = stringOrNull(pickField(transaction, ["receipt_number", "receiptNumber"]));
  const datetime = stringOrNull(pickField(transaction, ["datetime", "created_at", "createdAt"]));
  return [transactionId ?? "tx", receiptNumber ?? "receipt", datetime ?? stableHash(transaction)].join(":");
}

function toSafeCashRegister(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    id: stringOrNull(value.id),
    name: stringOrNull(value.name),
  };
}

function parseAccessToken(text: string) {
  try {
    const json = JSON.parse(text) as TokenResponse;
    return typeof json.access_token === "string" ? json.access_token : null;
  } catch {
    return null;
  }
}

function pickField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return null;
}

function stringOrNull(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNumber(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function normalizeOnlinePosId(value: string | null | undefined) {
  return value ? String(value).trim() : "";
}

function normalizeName(value: string | null | undefined) {
  return value ? value.trim().toLocaleLowerCase("da-DK") : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueJson(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stableHash(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16);
}

function roundNumber(value: number) {
  return Math.round(value * 10000) / 10000;
}

function isWebPushConfigured() {
  return Boolean(getPublicVapidKey() && process.env.WEB_PUSH_PRIVATE_KEY && process.env.WEB_PUSH_SUBJECT);
}

function getPublicVapidKey() {
  return process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? process.env.WEB_PUSH_PUBLIC_KEY ?? null;
}

function isExpiredSubscription(error: unknown) {
  return isRecord(error) && (error.statusCode === 404 || error.statusCode === 410);
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ukendt fejl";
}
