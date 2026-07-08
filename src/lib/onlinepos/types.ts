export type OnlinePosProbeAction =
  | "connection"
  | "latest-sales"
  | "sales-by-date"
  | "export-sales-fallback"
  | "reports-test"
  | "reports-sales-per-product";

export type OnlinePosReportsParamMode = "none" | "from_to_iso" | "startDate_endDate_iso" | "dateFrom_dateTo_iso";

export type OnlinePosEnvStatus = {
  configured: boolean;
  hasBaseUrl: boolean;
  hasToken: boolean;
  hasFirmaId: boolean;
  baseUrl: string;
};

export type OnlinePosReportsEnvStatus = {
  configured: boolean;
  hasBaseUrl: boolean;
  hasToken: boolean;
  baseUrl: string;
};

export type OnlinePosSaleLine = {
  datetime?: string | null;
  productid?: string | number | null;
  productname?: string | null;
  department?: string | null;
  count?: string | number | null;
  price?: string | number | null;
  firmaid?: string | number | null;
  orderid?: string | number | null;
  orderlineid?: string | number | null;
};

export type OnlinePosProbeResult = {
  ok: boolean;
  endpoint: string;
  status: number;
  statusText: string;
  contentType: string | null;
  unixRange?: {
    from: number;
    to: number;
  };
  summary: {
    responseType: "json" | "text" | "empty";
    topLevelType: string;
    lineCount: number;
    firstKeys: string[];
    hasDepartmentFields: boolean;
    hasPaginationInfo: boolean;
    paginationInfo: Record<string, unknown> | null;
    rawPreview: string;
  };
  lines: OnlinePosSaleLine[];
  distinctDepartments: string[];
  distinctProducts: string[];
  error?: string;
};
