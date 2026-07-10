import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getCurrentActorName, getCurrentProfile } from "./auth";
import { isOwnerRole, isResponsibleRole, normalizeRole } from "./permissions";
import {
  locations as mockLocationsSource,
  openingClosingStatuses as mockStatusesSource,
  products as mockProductsSource,
  recentMovements as mockMovementsSource,
  stockBalances as mockBalancesSource,
} from "./mock-data";
import type {
  AdminSetupStatus,
  BackEventMember,
  BackEventMemberGroup,
  BackEventMemberGroupMembership,
  ConsumptionLine,
  ConsumptionReport,
  HistoryEntry,
  LocationConsumption,
  Location,
  MissingOpeningClosing,
  OperationalChecklistItem,
  OpeningClosingStatus,
  OpeningClosingLocationOverview,
  Product,
  ProductAlertSetting,
  MemberRole,
  StockAdjustment,
  StockAdjustmentType,
  StockBalance,
  StockDiscrepancy,
  StockMovement,
  StockStatus,
} from "./types";

type CreateStockMovementInput = {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  unit?: string;
  note?: string | null;
  createdByName?: string | null;
};

const productSelectColumns =
  "id,name,unit,tracking_mode,onlinepos_product_id,onlinepos_name,sales_unit_quantity,liters_per_sale,units_per_case,purchase_unit_label,units_per_purchase_unit,stock_unit_label,content_per_stock_unit,consumption_unit_label,sort_order,active";

type CreateOpeningClosingStatusInput = {
  locationId: string;
  type: "opening" | "closing";
  createdByName?: string | null;
  counts: Array<{
    productId: string;
    quantity: number;
    unit?: string;
  }>;
};

type CreateStockAdjustmentInput = {
  productId: string;
  locationId: string;
  type: StockAdjustmentType;
  quantityDelta?: number;
  newQuantity?: number;
  unit?: string;
  note?: string | null;
  createdByName?: string | null;
};

const mockStore = {
  locations: mockLocationsSource.map((location, index) => withLocationDefaults({ ...location, sortOrder: index + 1 })),
  products: mockProductsSource.map((product, index) => withProductDefaults({ ...product, sortOrder: index + 1 })),
  alertSettings: mockProductsSource.map((product) => ({
    id: `mock-alert-${product.id}`,
    inventoryItemId: product.id,
    locationId: null,
    lowThreshold: product.lowThreshold,
    criticalThreshold: product.criticalThreshold,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })) as ProductAlertSetting[],
  balances: mockBalancesSource.map((balance) => ({ ...balance })),
  movements: mockMovementsSource.map((movement) => ({ ...movement })),
  statuses: mockStatusesSource.map((status) => ({ ...status })),
  adjustments: [] as StockAdjustment[],
  members: [
    {
      id: "mock-user",
      fullName: "Mock mode",
      email: "mock@backevent.local",
      role: "ejer" as MemberRole,
      active: true,
      createdAt: new Date().toISOString(),
      groups: [],
    },
  ],
  memberGroups: [
    {
      id: "mock-group-lagerhold",
      name: "Lagerhold",
      description: "Folk der hjælper med lager og containere",
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ] as BackEventMemberGroup[],
  memberGroupMemberships: [] as BackEventMemberGroupMembership[],
};

export async function getLocations(): Promise<Location[]> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return [...mockStore.locations].sort(sortByOrder);
  }

  const { data, error } = await supabase
    .from("backevent_locations")
    .select("id,name,type,source_location_id,is_main_storage,sort_order,active")
    .eq("active", true)
    .order("sort_order");

  if (error) {
    throw error;
  }

  return data.map((row) => withLocationDefaults({
    id: row.id,
    name: row.name,
    kind: row.type,
    sourceLocationId: row.source_location_id,
    isMainStorage: row.is_main_storage,
    sortOrder: row.sort_order,
    active: row.active,
  }));
}

export async function getProducts(): Promise<Product[]> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return [...mockStore.products].filter((product) => product.active !== false && product.trackingMode === "inventory").sort(sortByOrder);
  }

  const { data, error } = await supabase
    .from("backevent_products")
    .select(productSelectColumns)
    .eq("active", true)
    .eq("tracking_mode", "inventory")
    .order("sort_order");

  if (error) {
    throw error;
  }

  return data.map((row) => withProductDefaults({
    id: row.id,
    name: row.name,
    unit: row.unit ?? "kasser",
    trackingMode: row.tracking_mode,
    onlineposProductId: row.onlinepos_product_id,
    onlineposName: row.onlinepos_name,
    salesUnitQuantity: Number(row.sales_unit_quantity ?? 1),
    litersPerSale: row.liters_per_sale === null ? null : Number(row.liters_per_sale),
    unitsPerCase: row.units_per_case,
    purchaseUnitLabel: row.purchase_unit_label,
    unitsPerPurchaseUnit: row.units_per_purchase_unit === null ? null : Number(row.units_per_purchase_unit),
    stockUnitLabel: row.stock_unit_label,
    contentPerStockUnit: row.content_per_stock_unit === null ? null : Number(row.content_per_stock_unit),
    consumptionUnitLabel: row.consumption_unit_label,
    sortOrder: row.sort_order,
    active: row.active,
  }));
}

export async function getStockBalances(): Promise<StockBalance[]> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return mockStore.balances.map((balance) => ({ ...balance }));
  }

  const { data, error } = await supabase
    .from("backevent_stock_balances")
    .select("product_id,location_id,quantity");

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    productId: row.product_id,
    locationId: row.location_id,
    quantity: Number(row.quantity ?? 0),
  }));
}

export async function getStockByLocation(locationId: string) {
  const products = await getProducts();
  const balances = await getStockBalances();

  return products.map((product) => ({
    product,
    balance:
      balances.find((item) => item.locationId === locationId && item.productId === product.id)?.quantity ?? 0,
  }));
}

export async function getRecentMovements(): Promise<StockMovement[]> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return [...mockStore.movements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const { data, error } = await supabase
    .from("backevent_stock_movements")
    .select(
      "id,product_id,from_location_id,to_location_id,quantity,unit,created_by_name,created_at,reversed_at,reversed_by_name,reversal_reason",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    productId: row.product_id,
    fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id,
    quantity: Number(row.quantity),
    unit: row.unit ?? "kasser",
    createdAt: row.created_at,
    createdBy: row.created_by_name ?? "Frivillig",
    reversedAt: row.reversed_at,
    reversedBy: row.reversed_by_name,
    reversalReason: row.reversal_reason,
  }));
}

export async function getStockAdjustments(): Promise<StockAdjustment[]> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return [...mockStore.adjustments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const { data, error } = await supabase
    .from("backevent_stock_adjustments")
    .select(
      "id,product_id,location_id,adjustment_type,quantity_before,quantity_after,quantity_delta,unit,note,created_by_name,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    productId: row.product_id,
    locationId: row.location_id,
    type: row.adjustment_type,
    quantityBefore: Number(row.quantity_before),
    quantityAfter: Number(row.quantity_after),
    quantityDelta: Number(row.quantity_delta),
    unit: row.unit ?? "kasser",
    note: row.note,
    createdBy: row.created_by_name ?? "Ansvarlig",
    createdAt: row.created_at,
  }));
}

export async function createStockAdjustment(input: CreateStockAdjustmentInput) {
  if (input.type === "waste" && (!input.quantityDelta || input.quantityDelta <= 0)) {
    throw new Error("Svind skal være større end 0");
  }

  if (input.type === "correction" && input.newQuantity === undefined) {
    throw new Error("Nyt antal mangler");
  }

  const supabase = createSupabaseBrowserClient();
  const actorName = await getCurrentActorName();

  if (!supabase) {
    ensureMockBalance(input.productId, input.locationId);
    const balance = mockStore.balances.find(
      (item) => item.productId === input.productId && item.locationId === input.locationId,
    );
    const before = balance?.quantity ?? 0;
    const delta = input.type === "correction" ? (input.newQuantity ?? 0) - before : -(input.quantityDelta ?? 0);
    const after = Number((before + delta).toFixed(1));

    if (balance) {
      balance.quantity = after;
    }

    const adjustment: StockAdjustment = {
      id: createMockId(),
      productId: input.productId,
      locationId: input.locationId,
      type: input.type,
      quantityBefore: before,
      quantityAfter: after,
      quantityDelta: delta,
      unit: input.unit ?? "kasser",
      note: input.note,
      createdBy: input.createdByName ?? actorName,
      createdAt: new Date().toISOString(),
    };

    mockStore.adjustments.unshift(adjustment);
    return adjustment.id;
  }

  const profile = await getCurrentProfile();
  if (!isResponsibleRole(profile?.role)) {
    throw new Error("Kun ansvarlig kan gøre dette");
  }

  const { data, error } = await supabase.rpc("backevent_create_stock_adjustment", {
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_adjustment_type: input.type,
    p_quantity_delta: input.quantityDelta ?? null,
    p_new_quantity: input.newQuantity ?? null,
    p_unit: input.unit ?? "kasser",
    p_note: input.note ?? null,
    p_created_by_name: actorName,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function createStockMovement(input: CreateStockMovementInput) {
  if (input.quantity <= 0) {
    throw new Error("Antal skal være større end 0");
  }

  if (input.fromLocationId === input.toLocationId) {
    throw new Error("Fra og til skal være forskellige steder");
  }

  const supabase = createSupabaseBrowserClient();
  const actorName = await getCurrentActorName();

  if (!supabase) {
    ensureMockBalance(input.productId, input.fromLocationId);
    ensureMockBalance(input.productId, input.toLocationId);

    updateMockBalance(input.productId, input.fromLocationId, -input.quantity);
    updateMockBalance(input.productId, input.toLocationId, input.quantity);

    const movement: StockMovement = {
      id: createMockId(),
      productId: input.productId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      quantity: input.quantity,
      unit: input.unit ?? "kasser",
      createdAt: new Date().toISOString(),
      createdBy: input.createdByName ?? actorName,
    };

    mockStore.movements.unshift(movement);
    return movement.id;
  }

  const { data, error } = await supabase.rpc("backevent_create_stock_movement", {
    p_product_id: input.productId,
    p_from_location_id: input.fromLocationId,
    p_to_location_id: input.toLocationId,
    p_quantity: input.quantity,
    p_unit: input.unit ?? "kasser",
    p_note: input.note ?? null,
    p_created_by_name: actorName,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function reverseStockMovement(
  movementId: string,
  reversedByName: string | null = "Frivillig",
  reversalReason: string | null = "Fortrudt i BackEvent",
) {
  const supabase = createSupabaseBrowserClient();
  const actorName = await getCurrentActorName();

  if (!supabase) {
    const movement = mockStore.movements.find((item) => item.id === movementId);

    if (!movement) {
      throw new Error("Flytning blev ikke fundet");
    }

    if (movement.reversedAt) {
      throw new Error("Flytning er allerede fortrudt");
    }

    ensureMockBalance(movement.productId, movement.fromLocationId);
    ensureMockBalance(movement.productId, movement.toLocationId);
    updateMockBalance(movement.productId, movement.fromLocationId, movement.quantity);
    updateMockBalance(movement.productId, movement.toLocationId, -movement.quantity);

    movement.reversedAt = new Date().toISOString();
    movement.reversedBy = reversedByName ?? actorName;
    movement.reversalReason = reversalReason;
    return;
  }

  const profile = await getCurrentProfile();
  if (!isOwnerRole(profile?.role)) {
    throw new Error("Kun ejer kan gøre dette");
  }

  const { error } = await supabase.rpc("backevent_reverse_stock_movement", {
    p_movement_id: movementId,
    p_reversed_by_name: reversedByName ?? actorName,
    p_reversal_reason: reversalReason,
  });

  if (error) {
    throw error;
  }
}

export async function createOpeningClosingStatus(input: CreateOpeningClosingStatusInput) {
  const supabase = createSupabaseBrowserClient();
  const actorName = await getCurrentActorName();

  if (!supabase) {
    const status: OpeningClosingStatus = {
      id: createMockId(),
      locationId: input.locationId,
      type: input.type,
      statusDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      createdBy: input.createdByName ?? actorName,
      counts: input.counts.map((count) => ({ ...count })),
    };

    mockStore.statuses.unshift(status);
    return status.id;
  }

  const { data: status, error: statusError } = await supabase
    .from("backevent_opening_closing_statuses")
    .insert({
      location_id: input.locationId,
      status_type: input.type,
      created_by_name: actorName,
    })
    .select("id")
    .single();

  if (statusError) {
    throw statusError;
  }

  const { error: linesError } = await supabase.from("backevent_opening_closing_lines").insert(
    input.counts.map((count) => ({
      status_id: status.id,
      product_id: count.productId,
      quantity: count.quantity,
      unit: count.unit ?? "kasser",
    })),
  );

  if (linesError) {
    throw linesError;
  }

  return status.id as string;
}

export async function getOpeningClosingStatuses(): Promise<OpeningClosingStatus[]> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return mockStore.statuses.map((status) => ({ ...status, counts: status.counts.map((count) => ({ ...count })) }));
  }

  const { data, error } = await supabase
    .from("backevent_opening_closing_statuses")
    .select(
      "id,location_id,status_type,status_date,created_by_name,created_at,backevent_opening_closing_lines(product_id,quantity,unit)",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    locationId: row.location_id,
    type: row.status_type,
    statusDate: row.status_date,
    createdAt: row.created_at,
    createdBy: row.created_by_name ?? "Frivillig",
    counts: (row.backevent_opening_closing_lines ?? []).map(
      (line: { product_id: string; quantity: number | string; unit?: string | null }) => ({
        productId: line.product_id,
        quantity: Number(line.quantity),
        unit: line.unit ?? "kasser",
      }),
    ),
  }));
}

export async function getHistoryEntries(): Promise<HistoryEntry[]> {
  const [movements, adjustments, statuses] = await Promise.all([
    getRecentMovements(),
    getStockAdjustments(),
    getOpeningClosingStatuses(),
  ]);

  return [
    ...movements.map<HistoryEntry>((movement) => ({
      id: movement.id,
      kind: "movement",
      createdAt: movement.createdAt,
      productId: movement.productId,
      fromLocationId: movement.fromLocationId,
      toLocationId: movement.toLocationId,
      quantity: movement.quantity,
      unit: movement.unit,
      createdBy: movement.createdBy,
      reversedAt: movement.reversedAt,
    })),
    ...adjustments.map<HistoryEntry>((adjustment) => ({
      id: adjustment.id,
      kind: "adjustment",
      createdAt: adjustment.createdAt,
      productId: adjustment.productId,
      locationId: adjustment.locationId,
      adjustmentType: adjustment.type,
      quantityBefore: adjustment.quantityBefore,
      quantityAfter: adjustment.quantityAfter,
      quantityDelta: adjustment.quantityDelta,
      unit: adjustment.unit,
      note: adjustment.note,
      createdBy: adjustment.createdBy,
    })),
    ...statuses.map<HistoryEntry>((status) => ({
      id: status.id,
      kind: "status",
      createdAt: status.createdAt,
      locationId: status.locationId,
      statusType: status.type,
      createdBy: status.createdBy,
      lineCount: status.counts.length,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getOpeningClosingOverview(date?: string): Promise<OpeningClosingLocationOverview[]> {
  const [locations, statuses] = await Promise.all([getLocations(), getOpeningClosingStatuses()]);

  return locations.filter(isPhysicalStockLocation).map((location) => {
    const locationStatuses = statuses
      .filter((status) => status.locationId === location.id && matchesDate(status.createdAt, status.statusDate, date))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latestOpening = locationStatuses.find((status) => status.type === "opening");
    const latestClosing = locationStatuses.find((status) => status.type === "closing");
    let status: OpeningClosingLocationOverview["status"] = "not_started";

    if (latestOpening && latestClosing) {
      status = "closed";
    } else if (latestOpening) {
      status = "missing_closing";
    } else if (latestClosing) {
      status = "closed";
    }

    return {
      locationId: location.id,
      status,
      latestOpening,
      latestClosing,
    };
  });
}

export async function getLocationConsumption(locationId: string, date?: string): Promise<LocationConsumption> {
  const report = await getConsumptionReport(date);
  return (
    report.locations.find((location) => location.locationId === locationId) ?? {
      locationId,
      date,
      totalConsumption: 0,
      lines: [],
      warnings: ["Ingen data endnu"],
    }
  );
}

export async function getConsumptionReport(date?: string): Promise<ConsumptionReport> {
  const [locations, products, statuses, movements, adjustments] = await Promise.all([
    getLocations(),
    getProducts(),
    getOpeningClosingStatuses(),
    getRecentMovements(),
    getStockAdjustments(),
  ]);

  const reportLocations = locations.filter(isPhysicalStockLocation).map<LocationConsumption>((location) => {
    const locationStatuses = statuses.filter(
      (status) => status.locationId === location.id && matchesDate(status.createdAt, status.statusDate, date),
    );
    const opening = latestStatus(locationStatuses, "opening");
    const closing = latestStatus(locationStatuses, "closing");
    const lines = products.map<ConsumptionLine>((product) => {
      const openingQuantity = getStatusProductQuantity(opening, product.id);
      const closingQuantity = getStatusProductQuantity(closing, product.id);
      const movedIn = movements
        .filter(
          (movement) =>
            movement.toLocationId === location.id &&
            movement.productId === product.id &&
            !movement.reversedAt &&
            matchesDate(movement.createdAt, undefined, date),
        )
        .reduce((sum, movement) => sum + movement.quantity, 0);
      const movedOut = movements
        .filter(
          (movement) =>
            movement.fromLocationId === location.id &&
            movement.productId === product.id &&
            !movement.reversedAt &&
            matchesDate(movement.createdAt, undefined, date),
        )
        .reduce((sum, movement) => sum + movement.quantity, 0);
      const productAdjustments = adjustments.filter(
        (adjustment) =>
          adjustment.locationId === location.id &&
          adjustment.productId === product.id &&
          matchesDate(adjustment.createdAt, undefined, date),
      );
      const adjustmentDelta = productAdjustments.reduce((sum, adjustment) => sum + adjustment.quantityDelta, 0);
      const wasteQuantity = productAdjustments
        .filter((adjustment) => adjustment.type === "waste")
        .reduce((sum, adjustment) => sum + Math.abs(adjustment.quantityDelta), 0);
      const calculatedConsumption =
        openingQuantity === null || closingQuantity === null
          ? null
          : Number((openingQuantity + movedIn - movedOut - closingQuantity).toFixed(1));
      const expectedClosing =
        openingQuantity === null ? null : Number((openingQuantity + movedIn - movedOut).toFixed(1));
      const warnings: string[] = [];

      if (openingQuantity === null) {
        warnings.push("Mangler åbning");
      }

      if (closingQuantity === null) {
        warnings.push("Mangler lukning");
      }

      if (calculatedConsumption !== null && calculatedConsumption < 0) {
        warnings.push("Afvigelse fundet");
      }

      if (expectedClosing !== null && closingQuantity !== null && closingQuantity > expectedClosing) {
        warnings.push("Afvigelse fundet");
      }

      return {
        locationId: location.id,
        productId: product.id,
        openingQuantity,
        movedIn,
        movedOut,
        closingQuantity,
        calculatedConsumption,
        adjustmentDelta,
        wasteQuantity,
        warnings: Array.from(new Set(warnings)),
      };
    });
    const warnings = Array.from(new Set(lines.flatMap((line) => line.warnings)));
    const totalConsumption = lines.reduce((sum, line) => sum + Math.max(0, line.calculatedConsumption ?? 0), 0);

    return {
      locationId: location.id,
      date,
      totalConsumption,
      lines,
      warnings: warnings.length > 0 ? warnings : ["Ingen data endnu"],
    };
  });

  return {
    date,
    locations: reportLocations,
  };
}

export async function getMissingOpeningClosing(date?: string): Promise<MissingOpeningClosing[]> {
  const overview = await getOpeningClosingOverview(date);

  return overview.map((item) => ({
    locationId: item.locationId,
    missingOpening: !item.latestOpening,
    missingClosing: !item.latestClosing,
  }));
}

export async function getStockDiscrepancies(date?: string): Promise<StockDiscrepancy[]> {
  const report = await getConsumptionReport(date);
  const discrepancies: StockDiscrepancy[] = [];

  for (const location of report.locations) {
    for (const line of location.lines) {
      if (line.warnings.includes("Mangler åbning")) {
        discrepancies.push({
          locationId: line.locationId,
          productId: line.productId,
          message: "Mangler åbning",
          severity: "warning",
        });
      }

      if (line.warnings.includes("Mangler lukning")) {
        discrepancies.push({
          locationId: line.locationId,
          productId: line.productId,
          message: "Mangler lukning",
          severity: "warning",
        });
      }

      if (line.warnings.includes("Afvigelse fundet")) {
        discrepancies.push({
          locationId: line.locationId,
          productId: line.productId,
          message: "Afvigelse fundet",
          severity: "critical",
        });
      }
    }
  }

  return discrepancies;
}

export function getLocationTotal(locationId: string, balances: StockBalance[]) {
  return balances
    .filter((balance) => balance.locationId === locationId)
    .reduce((sum, balance) => sum + balance.quantity, 0);
}

export function isPhysicalStockLocation(location: Pick<Location, "kind">) {
  return location.kind === "container";
}

export function getLocationStatus(locationId: string, products: Product[], balances: StockBalance[]): StockStatus {
  const stock = products.map((product) => ({
    product,
    balance: balances.find((item) => item.locationId === locationId && item.productId === product.id)?.quantity ?? 0,
  }));

  const hasCritical = stock.some((item) => item.balance <= item.product.criticalThreshold || item.balance < 0);
  const hasLow = stock.some((item) => item.balance <= item.product.lowThreshold);

  if (hasCritical) {
    return "critical";
  }

  if (hasLow) {
    return "low";
  }

  return "good";
}

export function getFillPercentageFromTotal(total: number) {
  return Math.max(0, Math.min(100, Math.round((total / 260) * 100)));
}

export async function getMembers(): Promise<BackEventMember[]> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return mockStore.members.map((member) => ({
      ...member,
      groups: groupsForMember(member.id),
    }));
  }

  const [{ data, error }, memberships] = await Promise.all([
    supabase
    .from("backevent_profiles")
    .select("id,full_name,email,role,active,created_at")
      .order("created_at", { ascending: true }),
    getMemberGroupMemberships(),
  ]);

  if (error) throw error;

  return data.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: normalizeRole(row.role),
    active: row.active ?? true,
    createdAt: row.created_at,
    groups: memberships.groups.filter((group) =>
      memberships.memberships.some((membership) => membership.profileId === row.id && membership.groupId === group.id),
    ),
  }));
}

export async function updateMemberRole(memberId: string, role: MemberRole) {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    const member = mockStore.members.find((item) => item.id === memberId);
    if (member) {
      member.role = role;
    }
    return;
  }

  const profile = await getCurrentProfile();
  if (!isOwnerRole(profile?.role)) {
    throw new Error("Kun ejer kan gøre dette");
  }

  const { error } = await supabase.from("backevent_profiles").update({ role }).eq("id", memberId);

  if (error) throw error;
}

export async function getMemberGroups(): Promise<BackEventMemberGroup[]> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return [...mockStore.memberGroups].sort(sortByName);
  }

  const { data, error } = await supabase
    .from("backevent_member_groups")
    .select("id,name,description,active,created_at,updated_at")
    .order("name", { ascending: true });

  if (error) throw error;

  return data.map(toMemberGroup);
}

export async function getMemberGroupMemberships(): Promise<{
  groups: BackEventMemberGroup[];
  memberships: BackEventMemberGroupMembership[];
}> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return {
      groups: [...mockStore.memberGroups].sort(sortByName),
      memberships: mockStore.memberGroupMemberships.map((membership) => ({ ...membership })),
    };
  }

  const [groupsResponse, membershipsResponse] = await Promise.all([
    supabase.from("backevent_member_groups").select("id,name,description,active,created_at,updated_at").order("name", { ascending: true }),
    supabase.from("backevent_member_group_members").select("id,group_id,profile_id,created_at"),
  ]);

  if (groupsResponse.error) throw groupsResponse.error;
  if (membershipsResponse.error) throw membershipsResponse.error;

  return {
    groups: (groupsResponse.data ?? []).map(toMemberGroup),
    memberships: (membershipsResponse.data ?? []).map((row) => ({
      id: row.id,
      groupId: row.group_id,
      profileId: row.profile_id,
      createdAt: row.created_at,
    })),
  };
}

export async function createMemberGroup(input: { name: string; description?: string | null; active?: boolean }) {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Gruppenavn mangler");
  }

  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    const group: BackEventMemberGroup = {
      id: createMockId(),
      name,
      description: input.description?.trim() || null,
      active: input.active ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockStore.memberGroups.push(group);
    return group.id;
  }

  await ensureOwner();

  const { data, error } = await supabase
    .from("backevent_member_groups")
    .insert({
      name,
      description: input.description?.trim() || null,
      active: input.active ?? true,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function updateMemberGroup(
  groupId: string,
  input: { name: string; description?: string | null; active: boolean },
) {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Gruppenavn mangler");
  }

  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    const group = mockStore.memberGroups.find((item) => item.id === groupId);
    if (group) {
      group.name = name;
      group.description = input.description?.trim() || null;
      group.active = input.active;
      group.updatedAt = new Date().toISOString();
    }
    return;
  }

  await ensureOwner();

  const { error } = await supabase
    .from("backevent_member_groups")
    .update({
      name,
      description: input.description?.trim() || null,
      active: input.active,
    })
    .eq("id", groupId);

  if (error) throw error;
}

export async function deleteMemberGroup(groupId: string) {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    mockStore.memberGroups = mockStore.memberGroups.filter((group) => group.id !== groupId);
    mockStore.memberGroupMemberships = mockStore.memberGroupMemberships.filter((membership) => membership.groupId !== groupId);
    return;
  }

  await ensureOwner();

  const { error } = await supabase.from("backevent_member_groups").delete().eq("id", groupId);

  if (error) throw error;
}

export async function setMemberGroups(memberId: string, groupIds: string[]) {
  const uniqueGroupIds = Array.from(new Set(groupIds));
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    mockStore.memberGroupMemberships = mockStore.memberGroupMemberships.filter((membership) => membership.profileId !== memberId);
    mockStore.memberGroupMemberships.push(
      ...uniqueGroupIds.map((groupId) => ({
        id: createMockId(),
        groupId,
        profileId: memberId,
        createdAt: new Date().toISOString(),
      })),
    );
    return;
  }

  await ensureOwner();

  const { error: deleteError } = await supabase.from("backevent_member_group_members").delete().eq("profile_id", memberId);
  if (deleteError) throw deleteError;

  if (uniqueGroupIds.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from("backevent_member_group_members").insert(
    uniqueGroupIds.map((groupId) => ({
      group_id: groupId,
      profile_id: memberId,
    })),
  );

  if (insertError) throw insertError;
}

export async function getAdminSetupStatus(): Promise<AdminSetupStatus> {
  const [products, locations, balances, movements, statuses] = await Promise.all([
    getProductsAdmin(),
    getLocationsAdmin(),
    getStockBalances(),
    getRecentMovements(),
    getOpeningClosingStatuses(),
  ]);
  const profile = await getCurrentProfile();

  return {
    productCount: products.length,
    locationCount: locations.length,
    stockBalanceCount: balances.length,
    movementCount: movements.length,
    openingClosingCount: statuses.length,
    supabaseConnected: Boolean(createSupabaseBrowserClient()),
    authStatus: profile?.isMock ? "mock" : profile ? "logged_in" : "not_logged_in",
    rlsStatus: createSupabaseBrowserClient() ? "configured" : "unknown",
  };
}

export async function getProductsAdmin() {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return [...mockStore.products].sort(sortByOrder);
  }

  const { data, error } = await supabase
    .from("backevent_products")
    .select(productSelectColumns)
    .order("sort_order");

  if (error) throw error;

  return data.map((row) => withProductDefaults({
    id: row.id,
    name: row.name,
    unit: row.unit ?? "kasser",
    trackingMode: row.tracking_mode,
    onlineposProductId: row.onlinepos_product_id,
    onlineposName: row.onlinepos_name,
    salesUnitQuantity: Number(row.sales_unit_quantity ?? 1),
    litersPerSale: row.liters_per_sale === null ? null : Number(row.liters_per_sale),
    unitsPerCase: row.units_per_case,
    purchaseUnitLabel: row.purchase_unit_label,
    unitsPerPurchaseUnit: row.units_per_purchase_unit === null ? null : Number(row.units_per_purchase_unit),
    stockUnitLabel: row.stock_unit_label,
    contentPerStockUnit: row.content_per_stock_unit === null ? null : Number(row.content_per_stock_unit),
    consumptionUnitLabel: row.consumption_unit_label,
    sortOrder: row.sort_order,
    active: row.active,
  }));
}

export async function getProductAlertSettings(): Promise<ProductAlertSetting[]> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return mockStore.alertSettings.map((setting) => ({ ...setting }));
  }

  const { data, error } = await supabase
    .from("backevent_inventory_alert_settings")
    .select("id,inventory_item_id,location_id,low_threshold,critical_threshold,active,created_at,updated_at")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    locationId: row.location_id,
    lowThreshold: row.low_threshold === null ? null : Number(row.low_threshold),
    criticalThreshold: row.critical_threshold === null ? null : Number(row.critical_threshold),
    active: row.active ?? true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function upsertProductAlertSetting(
  productId: string,
  input: {
    lowThreshold: number | null;
    criticalThreshold: number | null;
    active: boolean;
  },
) {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    const existing = mockStore.alertSettings.find((setting) => setting.inventoryItemId === productId && !setting.locationId);
    if (existing) {
      existing.lowThreshold = input.lowThreshold;
      existing.criticalThreshold = input.criticalThreshold;
      existing.active = input.active;
      existing.updatedAt = new Date().toISOString();
    } else {
      mockStore.alertSettings.push({
        id: createMockId(),
        inventoryItemId: productId,
        locationId: null,
        lowThreshold: input.lowThreshold,
        criticalThreshold: input.criticalThreshold,
        active: input.active,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    return;
  }

  await ensureOwner();

  const { data: existing, error: readError } = await supabase
    .from("backevent_inventory_alert_settings")
    .select("id")
    .eq("inventory_item_id", productId)
    .is("location_id", null)
    .maybeSingle();

  if (readError) throw readError;

  const payload = {
    inventory_item_id: productId,
    location_id: null,
    low_threshold: input.lowThreshold,
    critical_threshold: input.criticalThreshold,
    active: input.active,
    updated_at: new Date().toISOString(),
  };

  const response = existing?.id
    ? await supabase.from("backevent_inventory_alert_settings").update(payload).eq("id", existing.id)
    : await supabase.from("backevent_inventory_alert_settings").insert(payload);

  if (response.error) throw response.error;
}

export async function createProduct(input: {
  name: string;
  unit: string;
  trackingMode?: Product["trackingMode"];
  onlineposProductId?: string | null;
  onlineposName?: string | null;
  salesUnitQuantity?: number;
  litersPerSale?: number | null;
  unitsPerCase?: number | null;
  purchaseUnitLabel?: string | null;
  unitsPerPurchaseUnit?: number | null;
  stockUnitLabel?: string | null;
  contentPerStockUnit?: number | null;
  consumptionUnitLabel?: string | null;
  active?: boolean;
  sortOrder?: number;
}) {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    const product: Product = {
      id: createMockId(),
      name: input.name,
      unit: input.unit || "kasser",
      trackingMode: input.trackingMode ?? "inventory",
      onlineposProductId: input.onlineposProductId ?? null,
      onlineposName: input.onlineposName ?? null,
      salesUnitQuantity: input.salesUnitQuantity ?? 1,
      litersPerSale: input.litersPerSale ?? null,
      unitsPerCase: input.unitsPerCase ?? null,
      purchaseUnitLabel: input.purchaseUnitLabel ?? input.unit ?? "kasser",
      unitsPerPurchaseUnit: input.unitsPerPurchaseUnit ?? input.unitsPerCase ?? 1,
      stockUnitLabel: input.stockUnitLabel ?? input.unit ?? "kasser",
      contentPerStockUnit: input.contentPerStockUnit ?? 1,
      consumptionUnitLabel: input.consumptionUnitLabel ?? input.unit ?? "kasser",
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? mockStore.products.length + 1,
      ...thresholdsForProduct(input.name),
    };
    mockStore.products.push({ ...product, sortOrder: product.sortOrder ?? mockStore.products.length + 1 });
    return product.id;
  }

  const { data, error } = await supabase
    .from("backevent_products")
    .insert({
      name: input.name,
      unit: input.unit || "kasser",
      tracking_mode: input.trackingMode ?? "inventory",
      onlinepos_product_id: input.onlineposProductId ?? null,
      onlinepos_name: input.onlineposName ?? null,
      sales_unit_quantity: input.salesUnitQuantity ?? 1,
      liters_per_sale: input.litersPerSale ?? null,
      units_per_case: input.unitsPerCase ?? null,
      purchase_unit_label: input.purchaseUnitLabel ?? input.unit ?? "kasser",
      units_per_purchase_unit: input.unitsPerPurchaseUnit ?? input.unitsPerCase ?? 1,
      stock_unit_label: input.stockUnitLabel ?? input.unit ?? "kasser",
      content_per_stock_unit: input.contentPerStockUnit ?? 1,
      consumption_unit_label: input.consumptionUnitLabel ?? input.unit ?? "kasser",
      active: input.active ?? true,
      sort_order: input.sortOrder ?? 999,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function updateProduct(
  id: string,
  input: {
    name: string;
    unit: string;
    trackingMode: Product["trackingMode"];
    onlineposProductId?: string | null;
    onlineposName?: string | null;
    salesUnitQuantity: number;
    litersPerSale?: number | null;
    unitsPerCase?: number | null;
    purchaseUnitLabel?: string | null;
    unitsPerPurchaseUnit?: number | null;
    stockUnitLabel?: string | null;
    contentPerStockUnit?: number | null;
    consumptionUnitLabel?: string | null;
    active: boolean;
    sortOrder: number;
  },
) {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    const product = mockStore.products.find((item) => item.id === id);
    if (product) {
      product.name = input.name;
      product.unit = input.unit || "kasser";
      product.trackingMode = input.trackingMode;
      product.onlineposProductId = input.onlineposProductId ?? null;
      product.onlineposName = input.onlineposName ?? null;
      product.salesUnitQuantity = input.salesUnitQuantity;
      product.litersPerSale = input.litersPerSale ?? null;
      product.unitsPerCase = input.unitsPerCase ?? null;
      product.purchaseUnitLabel = input.purchaseUnitLabel ?? input.unit ?? "kasser";
      product.unitsPerPurchaseUnit = input.unitsPerPurchaseUnit ?? input.unitsPerCase ?? 1;
      product.stockUnitLabel = input.stockUnitLabel ?? input.unit ?? "kasser";
      product.contentPerStockUnit = input.contentPerStockUnit ?? 1;
      product.consumptionUnitLabel = input.consumptionUnitLabel ?? input.unit ?? "kasser";
      product.active = input.active;
      product.sortOrder = input.sortOrder;
    }
    return;
  }

  const { error } = await supabase
    .from("backevent_products")
    .update({
      name: input.name,
      unit: input.unit || "kasser",
      tracking_mode: input.trackingMode,
      onlinepos_product_id: input.onlineposProductId ?? null,
      onlinepos_name: input.onlineposName ?? null,
      sales_unit_quantity: input.salesUnitQuantity,
      liters_per_sale: input.litersPerSale ?? null,
      units_per_case: input.unitsPerCase ?? null,
      purchase_unit_label: input.purchaseUnitLabel ?? input.unit ?? "kasser",
      units_per_purchase_unit: input.unitsPerPurchaseUnit ?? input.unitsPerCase ?? 1,
      stock_unit_label: input.stockUnitLabel ?? input.unit ?? "kasser",
      content_per_stock_unit: input.contentPerStockUnit ?? 1,
      consumption_unit_label: input.consumptionUnitLabel ?? input.unit ?? "kasser",
      active: input.active,
      sort_order: input.sortOrder,
    })
    .eq("id", id);

  if (error) throw error;
}

export async function getLocationsAdmin() {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return [...mockStore.locations].sort(sortByOrder);
  }

  const { data, error } = await supabase
    .from("backevent_locations")
    .select("id,name,type,source_location_id,is_main_storage,sort_order,active")
    .order("sort_order");

  if (error) throw error;

  return data.map((row) => withLocationDefaults({
    id: row.id,
    name: row.name,
    kind: row.type,
    sourceLocationId: row.source_location_id,
    isMainStorage: row.is_main_storage,
    sortOrder: row.sort_order,
    active: row.active,
  }));
}

export async function createLocation(input: {
  name: string;
  kind: Location["kind"];
  sourceLocationId?: string | null;
  isMainStorage?: boolean;
  active?: boolean;
  sortOrder?: number;
}) {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    const location: Location = {
      id: createMockId(),
      name: input.name,
      kind: input.kind,
      sourceLocationId: input.sourceLocationId ?? null,
      isMainStorage: input.isMainStorage ?? false,
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? mockStore.locations.length + 1,
    };
    mockStore.locations.push({ ...location, sortOrder: location.sortOrder ?? mockStore.locations.length + 1 });
    return location.id;
  }

  const { data, error } = await supabase
    .from("backevent_locations")
    .insert({
      name: input.name,
      type: input.kind,
      source_location_id: input.sourceLocationId ?? null,
      is_main_storage: input.isMainStorage ?? false,
      active: input.active ?? true,
      sort_order: input.sortOrder ?? 999,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function updateLocation(
  id: string,
  input: {
    name: string;
    kind: Location["kind"];
    sourceLocationId?: string | null;
    isMainStorage: boolean;
    active: boolean;
    sortOrder: number;
  },
) {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    const location = mockStore.locations.find((item) => item.id === id);
    if (location) {
      location.name = input.name;
      location.kind = input.kind;
      location.sourceLocationId = input.sourceLocationId ?? null;
      location.isMainStorage = input.isMainStorage;
      location.active = input.active;
      location.sortOrder = input.sortOrder;
    }
    return;
  }

  const { error } = await supabase
    .from("backevent_locations")
    .update({
      name: input.name,
      type: input.kind,
      source_location_id: input.sourceLocationId ?? null,
      is_main_storage: input.isMainStorage,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .eq("id", id);

  if (error) throw error;
}

export async function exportStockCsv() {
  const [locations, products, balances] = await Promise.all([getLocationsAdmin(), getProductsAdmin(), getStockBalances()]);
  return toCsv(
    ["sted", "vare", "antal", "enhed"],
    balances.map((balance) => [
      locations.find((location) => location.id === balance.locationId)?.name ?? balance.locationId,
      products.find((product) => product.id === balance.productId)?.name ?? balance.productId,
      balance.quantity,
      products.find((product) => product.id === balance.productId)?.unit ?? "kasser",
    ]),
  );
}

export async function exportMovementsCsv() {
  const [locations, products, movements, adjustments] = await Promise.all([
    getLocationsAdmin(),
    getProductsAdmin(),
    getRecentMovements(),
    getStockAdjustments(),
  ]);
  return toCsv(
    ["type", "tid", "sted/fra", "til", "vare", "antal", "enhed", "navn", "note"],
    [
      ...movements.map((movement) => [
        movement.reversedAt ? "flytning fortrudt" : "flytning",
        movement.createdAt,
        locations.find((location) => location.id === movement.fromLocationId)?.name ?? movement.fromLocationId,
        locations.find((location) => location.id === movement.toLocationId)?.name ?? movement.toLocationId,
        products.find((product) => product.id === movement.productId)?.name ?? movement.productId,
        movement.quantity,
        movement.unit,
        movement.createdBy,
        movement.reversalReason ?? "",
      ]),
      ...adjustments.map((adjustment) => [
        adjustment.type === "waste" ? "svind" : "rettelse",
        adjustment.createdAt,
        locations.find((location) => location.id === adjustment.locationId)?.name ?? adjustment.locationId,
        "",
        products.find((product) => product.id === adjustment.productId)?.name ?? adjustment.productId,
        adjustment.quantityDelta,
        adjustment.unit,
        adjustment.createdBy,
        adjustment.note ?? "",
      ]),
    ],
  );
}

export async function exportOpeningClosingCsv() {
  const [locations, products, statuses] = await Promise.all([getLocationsAdmin(), getProductsAdmin(), getOpeningClosingStatuses()]);
  return toCsv(
    ["type", "tid", "dato", "sted", "vare", "antal", "enhed", "navn"],
    statuses.flatMap((status) =>
      status.counts.map((line) => [
        status.type === "opening" ? "åbning" : "lukning",
        status.createdAt,
        status.statusDate ?? status.createdAt.slice(0, 10),
        locations.find((location) => location.id === status.locationId)?.name ?? status.locationId,
        products.find((product) => product.id === line.productId)?.name ?? line.productId,
        line.quantity,
        line.unit ?? products.find((product) => product.id === line.productId)?.unit ?? "kasser",
        status.createdBy,
      ]),
    ),
  );
}

export async function exportFullBackupCsv() {
  const [stock, history, openingClosing, report] = await Promise.all([
    exportStockCsv(),
    exportMovementsCsv(),
    exportOpeningClosingCsv(),
    exportFullReportCsv(),
  ]);
  return ["# lagerstatus", stock, "", "# historik", history, "", "# aabning-lukning", openingClosing, "", "# rapport", report].join("\n");
}

async function exportFullReportCsv() {
  const [locations, products, report] = await Promise.all([getLocationsAdmin(), getProductsAdmin(), getConsumptionReport()]);
  return toCsv(
    ["sted", "vare", "åbning", "flyttet_ind", "flyttet_ud", "lukning", "beregnet_forbrug", "svind", "advarsler"],
    report.locations.flatMap((locationReport) =>
      locationReport.lines.map((line) => [
        locations.find((location) => location.id === line.locationId)?.name ?? line.locationId,
        products.find((product) => product.id === line.productId)?.name ?? line.productId,
        line.openingQuantity ?? "",
        line.movedIn,
        line.movedOut,
        line.closingQuantity ?? "",
        line.calculatedConsumption ?? "",
        line.wasteQuantity,
        line.warnings.join(" | "),
      ]),
    ),
  );
}

export async function getOperationalChecklist(): Promise<OperationalChecklistItem[]> {
  const [setup, balances] = await Promise.all([getAdminSetupStatus(), getStockBalances()]);
  const negativeCount = balances.filter((balance) => balance.quantity < 0).length;
  const criticalProblems = [
    setup.productCount === 0,
    setup.locationCount === 0,
    setup.stockBalanceCount === 0,
    negativeCount > 0,
  ].filter(Boolean).length;

  return [
    {
      label: "Supabase forbundet",
      status: setup.supabaseConnected ? "Klar" : "Tjek kræves",
      detail: setup.supabaseConnected ? "Supabase env er sat" : "Mock mode bruges",
    },
    {
      label: "Produkter findes",
      status: setup.productCount > 0 ? "Klar" : "Fejl",
      detail: `${setup.productCount} produkter`,
    },
    {
      label: "Containere findes",
      status: setup.locationCount > 0 ? "Klar" : "Fejl",
      detail: `${setup.locationCount} containere/barer`,
    },
    {
      label: "Lagerbalancer findes",
      status: setup.stockBalanceCount > 0 ? "Klar" : "Fejl",
      detail: `${setup.stockBalanceCount} lagerlinjer`,
    },
    {
      label: "Admin-bruger findes",
      status: setup.authStatus === "mock" || setup.authStatus === "logged_in" ? "Klar" : "Tjek kræves",
      detail: setup.authStatus === "mock" ? "Mock admin aktiv" : setup.authStatus === "logged_in" ? "Bruger logget ind" : "Log ind mangler",
    },
    {
      label: "Ingen negative beholdninger",
      status: negativeCount === 0 ? "Klar" : "Tjek kræves",
      detail: negativeCount === 0 ? "Alt ser normalt ud" : `${negativeCount} negative linjer`,
    },
    {
      label: "Ingen kritiske fejl",
      status: criticalProblems === 0 ? "Klar" : "Fejl",
      detail: criticalProblems === 0 ? "Klar til drift" : `${criticalProblems} punkter kræver handling`,
    },
    {
      label: "Seneste migration ok",
      status: "Tjek kræves",
      detail: "Tjek Supabase migration manuelt før markedet",
    },
  ];
}

function withProductDefaults(product: Partial<Product> & { id: string; name: string; unit?: string | null }): Product {
  return {
    id: product.id,
    name: product.name,
    unit: product.unit ?? "kasser",
    trackingMode: product.trackingMode ?? "inventory",
    onlineposProductId: product.onlineposProductId ?? null,
    onlineposName: product.onlineposName ?? null,
    salesUnitQuantity: product.salesUnitQuantity ?? 1,
    litersPerSale: product.litersPerSale ?? null,
    unitsPerCase: product.unitsPerCase ?? null,
    purchaseUnitLabel: product.purchaseUnitLabel ?? product.unit ?? "kasser",
    unitsPerPurchaseUnit: product.unitsPerPurchaseUnit ?? product.unitsPerCase ?? 1,
    stockUnitLabel: product.stockUnitLabel ?? product.unit ?? "kasser",
    contentPerStockUnit: product.contentPerStockUnit ?? 1,
    consumptionUnitLabel: product.consumptionUnitLabel ?? product.unit ?? "kasser",
    sortOrder: product.sortOrder,
    active: product.active ?? true,
    ...thresholdsForProduct(product.name),
  };
}

function withLocationDefaults(location: Partial<Location> & { id: string; name: string; kind?: string | null }): Location {
  const kind = location.kind === "bar" || location.kind === "sales_point" ? location.kind : "container";

  return {
    id: location.id,
    name: location.name,
    kind,
    sourceLocationId: location.sourceLocationId ?? null,
    isMainStorage: location.isMainStorage ?? false,
    sortOrder: location.sortOrder,
    active: location.active ?? true,
  };
}

function sortByOrder<T extends { sortOrder?: number }>(a: T, b: T) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

function sortByName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name, "da");
}

function toMemberGroup(row: {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}): BackEventMemberGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    active: row.active ?? true,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function groupsForMember(memberId: string) {
  return mockStore.memberGroups
    .filter((group) => mockStore.memberGroupMemberships.some((membership) => membership.profileId === memberId && membership.groupId === group.id))
    .sort(sortByName);
}

async function ensureOwner() {
  const profile = await getCurrentProfile();
  if (!isOwnerRole(profile?.role)) {
    throw new Error("Kun ejer kan gøre dette");
  }
}

function matchesDate(createdAt: string, statusDate?: string, date?: string) {
  if (!date) {
    return true;
  }

  return (statusDate ?? createdAt.slice(0, 10)) === date;
}

function latestStatus(statuses: OpeningClosingStatus[], type: "opening" | "closing") {
  return statuses
    .filter((status) => status.type === type)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function getStatusProductQuantity(status: OpeningClosingStatus | undefined, productId: string) {
  if (!status) {
    return null;
  }

  const line = status.counts.find((count) => count.productId === productId);
  return line ? line.quantity : null;
}

function thresholdsForProduct(name: string) {
  switch (name) {
    case "Tuborg 33 cl":
      return { lowThreshold: 16, criticalThreshold: 8 };
    case "Tuborg Classic":
      return { lowThreshold: 12, criticalThreshold: 6 };
    case "Pepsi Max":
    case "Faxe Kondi":
      return { lowThreshold: 10, criticalThreshold: 5 };
    case "Vand":
      return { lowThreshold: 14, criticalThreshold: 7 };
    case "Somersby":
      return { lowThreshold: 8, criticalThreshold: 4 };
    case "Fadøl 25L":
      return { lowThreshold: 5, criticalThreshold: 2 };
    default:
      return { lowThreshold: 10, criticalThreshold: 5 };
  }
}

function ensureMockBalance(productId: string, locationId: string) {
  const balance = mockStore.balances.find((item) => item.productId === productId && item.locationId === locationId);

  if (!balance) {
    mockStore.balances.push({ productId, locationId, quantity: 0 });
  }
}

function updateMockBalance(productId: string, locationId: string, change: number) {
  const balance = mockStore.balances.find((item) => item.productId === productId && item.locationId === locationId);

  if (balance) {
    balance.quantity = Number((balance.quantity + change).toFixed(1));
  }
}

function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function createMockId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `mock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
