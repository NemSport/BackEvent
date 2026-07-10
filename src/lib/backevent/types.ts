export type StockStatus = "good" | "low" | "critical";
export type ProductTrackingMode = "inventory" | "flow" | "ignore";

export type Product = {
  id: string;
  name: string;
  unit: string;
  trackingMode?: ProductTrackingMode;
  onlineposProductId?: string | null;
  onlineposName?: string | null;
  salesUnitQuantity?: number;
  litersPerSale?: number | null;
  lowThreshold: number;
  criticalThreshold: number;
  unitsPerCase?: number | null;
  purchaseUnitLabel?: string | null;
  unitsPerPurchaseUnit?: number | null;
  stockUnitLabel?: string | null;
  contentPerStockUnit?: number | null;
  consumptionUnitLabel?: string | null;
  sortOrder?: number;
  active?: boolean;
};

export type ProductAlertSetting = {
  id?: string;
  inventoryItemId: string;
  locationId?: string | null;
  lowThreshold: number | null;
  criticalThreshold: number | null;
  active: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type LocationProductThreshold = {
  id?: string;
  locationId: string;
  productId: string;
  lowThreshold: number | null;
  criticalThreshold: number | null;
  alertsEnabled: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type Location = {
  id: string;
  name: string;
  kind: "container" | "bar" | "sales_point";
  sourceLocationId?: string | null;
  isMainStorage?: boolean;
  sortOrder?: number;
  active?: boolean;
};

export type StockBalance = {
  locationId: string;
  productId: string;
  quantity: number;
};

export type StockMovement = {
  id: string;
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  unit: string;
  createdAt: string;
  createdBy: string;
  source?: string | null;
  batchId?: string | null;
  reversedAt?: string | null;
  reversedBy?: string | null;
  reversalReason?: string | null;
};

export type OpeningClosingStatus = {
  id: string;
  locationId: string;
  type: "opening" | "closing";
  statusDate?: string;
  createdAt: string;
  createdBy: string;
  counts: Array<{
    productId: string;
    quantity: number;
    unit?: string;
  }>;
};

export type StockAdjustmentType = "correction" | "waste";

export type StockAdjustment = {
  id: string;
  productId: string;
  locationId: string;
  type: StockAdjustmentType;
  quantityBefore: number;
  quantityAfter: number;
  quantityDelta: number;
  unit: string;
  note?: string | null;
  createdBy: string;
  createdAt: string;
};

export type HistoryEntry =
  | {
      id: string;
      kind: "movement";
      createdAt: string;
      productId: string;
      fromLocationId: string;
      toLocationId: string;
      quantity: number;
      unit: string;
      createdBy: string;
      reversedAt?: string | null;
    }
  | {
      id: string;
      kind: "adjustment";
      createdAt: string;
      productId: string;
      locationId: string;
      adjustmentType: StockAdjustmentType;
      quantityBefore: number;
      quantityAfter: number;
      quantityDelta: number;
      unit: string;
      note?: string | null;
      createdBy: string;
    }
  | {
      id: string;
      kind: "status";
      createdAt: string;
      locationId: string;
      statusType: "opening" | "closing";
      createdBy: string;
      lineCount: number;
    };

export type OpeningClosingLocationOverview = {
  locationId: string;
  status: "not_started" | "opened" | "closed" | "missing_closing";
  latestOpening?: OpeningClosingStatus;
  latestClosing?: OpeningClosingStatus;
};

export type ConsumptionLine = {
  locationId: string;
  productId: string;
  openingQuantity: number | null;
  movedIn: number;
  movedOut: number;
  closingQuantity: number | null;
  calculatedConsumption: number | null;
  adjustmentDelta: number;
  wasteQuantity: number;
  warnings: string[];
};

export type LocationConsumption = {
  locationId: string;
  date?: string;
  totalConsumption: number;
  lines: ConsumptionLine[];
  warnings: string[];
};

export type ConsumptionReport = {
  date?: string;
  locations: LocationConsumption[];
};

export type MissingOpeningClosing = {
  locationId: string;
  missingOpening: boolean;
  missingClosing: boolean;
};

export type StockDiscrepancy = {
  locationId: string;
  productId: string;
  message: "Mangler åbning" | "Mangler lukning" | "Afvigelse fundet";
  severity: "warning" | "critical";
};

export type AdminSetupStatus = {
  productCount: number;
  locationCount: number;
  stockBalanceCount: number;
  movementCount: number;
  openingClosingCount: number;
  supabaseConnected: boolean;
  authStatus: "mock" | "logged_in" | "not_logged_in";
  rlsStatus: "unknown" | "configured";
};

export type OperationalChecklistItem = {
  label: string;
  status: "Klar" | "Tjek kræves" | "Fejl";
  detail: string;
};

export type MemberRole = "frivillig" | "ansvarlig" | "ejer";

export type BackEventMember = {
  id: string;
  fullName: string | null;
  email: string | null;
  phone?: string | null;
  role: MemberRole;
  active: boolean;
  invitationStatus?: "not_sent" | "pending" | "accepted";
  invitationSentAt?: string | null;
  invitationAcceptedAt?: string | null;
  lastLoginAt?: string | null;
  pushSubscriptionCount?: number;
  createdAt?: string | null;
  groups?: BackEventMemberGroup[];
};

export type BackEventMemberGroup = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type BackEventMemberGroupMembership = {
  id: string;
  groupId: string;
  profileId: string;
  createdAt?: string | null;
};
