import { NextResponse } from "next/server";
import {
  calculateReturnTestAdjustmentReversal,
  canCleanupReturnTestSource,
  defaultReturnInputUnit,
  getReturnInputUnitOptions,
  isReturnTestHarnessEnabled,
  normalizeReturnTestScenario,
  returnTestScenarios,
  runReturnTestHarnessScenario,
  shouldReverseReturnTestAdjustment,
} from "@/lib/backevent/return-test-harness";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type TestHarnessBody = {
  scenario?: unknown;
  locationId?: unknown;
  receiptNumber?: unknown;
  returnedAt?: unknown;
  runId?: unknown;
  lines?: unknown;
  productId?: unknown;
  quantity?: unknown;
  amount?: unknown;
};

type TestLineType = "main" | "modifier" | "deposit" | "cup" | "fee";

export async function GET(request: Request) {
  const gate = await requireReturnTestHarness(request);
  if (!gate.ok) return gate.response;

  const { data: locations, error: locationsError } = await gate.supabase
    .from("backevent_locations")
    .select("id,name,type,source_location_id,active")
    .eq("active", true)
    .order("sort_order");
  const { data: productRows, error: productsError } = await gate.supabase
    .from("backevent_products")
    .select("id,name,unit,units_per_case,purchase_unit_label,units_per_purchase_unit,stock_unit_label,content_per_stock_unit,consumption_unit_label,return_handling,active")
    .eq("active", true)
    .order("sort_order");
  const { data: recentReturns, error: recentError } = await gate.supabase
    .from("backevent_returns")
    .select("id,receipt_number,test_scenario,created_by_name,created_at,processing_status,control_status,total_amount")
    .eq("source", "test_harness")
    .order("created_at", { ascending: false })
    .limit(10);

  if (locationsError || productsError || recentError) {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente retur-testdata" }, { status: 500 });
  }

  const products = (productRows ?? []).map((product) => ({
    ...product,
    defaultInputUnit: defaultReturnInputUnit(product),
    inputUnits: getReturnInputUnitOptions(product),
  }));

  return NextResponse.json({
    ok: true,
    enabled: true,
    scenarios: returnTestScenarios,
    locations: locations ?? [],
    products,
    recentReturns: recentReturns ?? [],
  });
}

export async function POST(request: Request) {
  const gate = await requireReturnTestHarness(request);
  if (!gate.ok) return gate.response;

  let validation;
  try {
    validation = validateBody((await request.json().catch(() => null)) as TestHarnessBody | null);
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 400 });
  }

  if (!validation.ok) {
    return NextResponse.json({ ok: false, message: validation.message }, { status: 400 });
  }

  try {
    const result = await runReturnTestHarnessScenario(gate.supabase, {
      ...validation.input,
      createdByUserId: gate.auth.userId,
      createdByName: gate.auth.userEmail ?? "Ejer",
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const gate = await requireReturnTestHarness(request);
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { confirmation?: unknown };
  if (body.confirmation !== "SLET TESTDATA") {
    return NextResponse.json({ ok: false, message: "Skriv SLET TESTDATA for at rydde testdata" }, { status: 400 });
  }

  try {
    const result = await cleanupReturnTestData(gate.supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 500 });
  }
}

async function requireReturnTestHarness(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status }),
    };
  }

  if (!isReturnTestHarnessEnabled()) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, message: "Retur-test er ikke aktiveret" }, { status: 403 }),
    };
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, message: "Supabase service role mangler" }, { status: 500 }),
    };
  }

  return { ok: true as const, auth, supabase };
}

function validateBody(body: TestHarnessBody | null):
  | { ok: false; message: string }
  | {
      ok: true;
      input: {
        scenario: ReturnType<typeof normalizeReturnTestScenario>;
        locationId: string;
        receiptNumber: string;
        returnedAt: string;
        runId: string;
        lines: Array<{
          clientLineId: string;
          productId: string;
          quantity: number;
          inputUnit: string;
          amount: number;
          lineType: TestLineType;
          parentClientLineId?: string | null;
        }>;
      };
    } {
  const scenario = normalizeReturnTestScenario(body?.scenario);
  const locationId = typeof body?.locationId === "string" ? body.locationId : "";
  const receiptNumber = typeof body?.receiptNumber === "string" ? body.receiptNumber.trim() : "";
  const returnedAt = typeof body?.returnedAt === "string" ? body.returnedAt : "";
  const runId = typeof body?.runId === "string" && body.runId.trim() ? body.runId.trim() : crypto.randomUUID();
  const legacyLine = body?.productId
    ? [{ clientLineId: "line-1", productId: body.productId, quantity: body.quantity, inputUnit: "stk", amount: body.amount, lineType: "main" }]
    : [];
  const rawLines = Array.isArray(body?.lines) ? body.lines : legacyLine;

  if (!locationId) return { ok: false, message: "Vaelg lokation" };
  if (!receiptNumber) return { ok: false, message: "Udfyld bonnummer" };
  if (!returnedAt || Number.isNaN(new Date(returnedAt).getTime())) return { ok: false, message: "Tidspunkt er ugyldigt" };
  if (rawLines.length === 0) return { ok: false, message: "Tilfoej mindst en returlinje" };

  const lines = rawLines.map((line, index) => {
    const value = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
    const productId = typeof value.productId === "string" ? value.productId : "";
    const quantity = numberValue(value.quantity);
    const amount = numberValue(value.amount);
    const inputUnit = typeof value.inputUnit === "string" ? value.inputUnit.trim() : "";
    const lineType = typeof value.lineType === "string" && isLineType(value.lineType) ? value.lineType : null;

    if (!productId) throw new Error(`Vaelg produkt paa vare ${index + 1}`);
    if (!quantity || quantity <= 0) throw new Error(`Antal skal vaere over 0 paa vare ${index + 1}`);
    if (!inputUnit) throw new Error(`Vaelg enhed paa vare ${index + 1}`);
    if (amount === null) throw new Error(`Beloeb er ugyldigt paa vare ${index + 1}`);
    if (!lineType) throw new Error(`Linjetype er ugyldig paa vare ${index + 1}`);

    return {
      clientLineId: typeof value.clientLineId === "string" && value.clientLineId.trim() ? value.clientLineId.trim() : `line-${index + 1}`,
      productId,
      quantity,
      inputUnit,
      amount,
      lineType,
      parentClientLineId: typeof value.parentClientLineId === "string" && value.parentClientLineId.trim() ? value.parentClientLineId.trim() : null,
    };
  });

  return {
    ok: true,
    input: {
      scenario,
      locationId,
      receiptNumber,
      returnedAt: new Date(returnedAt).toISOString(),
      runId,
      lines,
    },
  };
}

async function cleanupReturnTestData(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>) {
  const { data: returns, error: returnsError } = await supabase
    .from("backevent_returns")
    .select("id,source")
    .eq("source", "test_harness");

  if (returnsError) throw new Error("Testreturer kunne ikke hentes");

  const returnIds = (returns ?? []).filter((row) => canCleanupReturnTestSource(row.source)).map((row) => String(row.id));
  if (returnIds.length === 0) {
    return { deletedReturns: 0, deletedNotifications: 0, deletedAdjustments: 0, reversedStockAdjustments: 0 };
  }

  const { data: adjustments, error: adjustmentError } = await supabase
    .from("backevent_stock_adjustments")
    .select("id,product_id,location_id,adjustment_type,quantity_delta,unit")
    .in("return_id", returnIds);
  if (adjustmentError) throw new Error("Testjusteringer kunne ikke hentes");

  let reversedStockAdjustments = 0;
  for (const adjustment of adjustments ?? []) {
    if (!shouldReverseReturnTestAdjustment({ source: "test_harness", quantityDelta: adjustment.quantity_delta })) continue;
    const productId = String(adjustment.product_id ?? "");
    const locationId = String(adjustment.location_id ?? "");
    const delta = Number(adjustment.quantity_delta ?? 0);
    if (!productId || !locationId || !Number.isFinite(delta) || delta === 0) continue;

    const { data: balance, error: balanceError } = await supabase
      .from("backevent_stock_balances")
      .select("id,quantity")
      .eq("product_id", productId)
      .eq("location_id", locationId)
      .maybeSingle();
    if (balanceError) throw new Error("Testlager kunne ikke reverseres");
    if (!balance) continue;

    const beforeQuantity = Number(balance.quantity ?? 0);
    const nextQuantity = calculateReturnTestAdjustmentReversal({ currentQuantity: beforeQuantity, quantityDelta: delta });
    const { error: updateError } = await supabase
      .from("backevent_stock_balances")
      .update({ quantity: nextQuantity, updated_at: new Date().toISOString() })
      .eq("id", balance.id);
    if (updateError) throw new Error("Testlager kunne ikke opdateres");

    const { error: reversalError } = await supabase.from("backevent_stock_adjustments").insert({
      product_id: productId,
      location_id: locationId,
      adjustment_type: "correction",
      quantity_before: beforeQuantity,
      quantity_after: nextQuantity,
      quantity_delta: -delta,
      unit: adjustment.unit ?? "kasser",
      note: `Modpost for testretur-oprydning: ${adjustment.id}`,
      created_by_name: "BackEvent",
      external_reference: `test_harness_cleanup_reversal:${adjustment.id}`,
    });
    if (reversalError) throw new Error("Testmodpost kunne ikke oprettes");
    reversedStockAdjustments += 1;
  }

  const { data: notifications } = await supabase
    .from("backevent_return_notifications")
    .select("id,push_message_id")
    .in("return_id", returnIds);
  const pushMessageIds = (notifications ?? []).map((row) => row.push_message_id).filter((id): id is string => typeof id === "string" && id.length > 0);

  if (pushMessageIds.length > 0) {
    await supabase.from("backevent_push_messages").delete().in("id", pushMessageIds);
  }

  await supabase.from("backevent_return_notifications").delete().in("return_id", returnIds);
  await supabase.from("backevent_return_history").delete().in("return_id", returnIds);
  const { error: deleteAdjustmentsError } = await supabase.from("backevent_stock_adjustments").delete().in("return_id", returnIds);
  if (deleteAdjustmentsError) throw new Error("Testjusteringer kunne ikke slettes");

  const { error: deleteReturnsError } = await supabase
    .from("backevent_returns")
    .delete()
    .eq("source", "test_harness")
    .in("id", returnIds);
  if (deleteReturnsError) throw new Error("Testreturer kunne ikke slettes");

  return {
    deletedReturns: returnIds.length,
    deletedNotifications: notifications?.length ?? 0,
    deletedAdjustments: adjustments?.length ?? 0,
    reversedStockAdjustments,
  };
}

function isLineType(value: string): value is TestLineType {
  return ["main", "modifier", "deposit", "cup", "fee"].includes(value);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ukendt fejl";
}
