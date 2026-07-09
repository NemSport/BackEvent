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
