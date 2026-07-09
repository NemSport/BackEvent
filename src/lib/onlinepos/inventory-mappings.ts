export type OnlinePosLineType =
  | "modifier_stock_item"
  | "deposit_fee"
  | "deposit_return"
  | "container_product"
  | "stock_item"
  | "unknown";

export type OnlinePosMappingAction = "consume_stock" | "ignore" | "deposit_fee" | "deposit_return" | "container_only";
export type OnlinePosMappingStatus = "unmapped" | "approved";

export type OnlinePosInventoryMapping = {
  id: string;
  onlineposProductId: string | null;
  onlineposProductName: string | null;
  onlineposProductGroupName: string | null;
  lineType: OnlinePosLineType;
  backeventInventoryItemId: string | null;
  conversionFactor: number | null;
  mappingAction: OnlinePosMappingAction;
  status: OnlinePosMappingStatus;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type OnlinePosInventoryMappingInput = Omit<OnlinePosInventoryMapping, "id" | "createdAt" | "updatedAt"> & {
  id?: string | null;
};

export const mappingActions: OnlinePosMappingAction[] = ["consume_stock", "ignore", "deposit_fee", "deposit_return", "container_only"];
export const mappingStatuses: OnlinePosMappingStatus[] = ["unmapped", "approved"];

export const mockOnlinePosInventoryMappings: OnlinePosInventoryMapping[] = [];

export function toMappingIdentity(input: {
  onlineposProductId?: string | number | null;
  onlineposProductName?: string | null;
  onlineposProductGroupName?: string | null;
  lineType: OnlinePosLineType;
}) {
  return [
    input.onlineposProductId === null || input.onlineposProductId === undefined ? "" : String(input.onlineposProductId),
    input.onlineposProductName ?? "",
    input.onlineposProductGroupName ?? "",
    input.lineType,
  ].join(":");
}

export function createMockMappingId() {
  return `mapping-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
