export type FlowReportSyncLine = {
  externalLineId: string;
  transactionId: string | null;
  receiptNumber: string | null;
  transactionDatetime: string;
  onlineposProductName: string | null;
  quantitySold: number;
  status: "processed" | "ignored" | "failed";
  errorReason: string | null;
  mappingAction: string | null;
  locationId: string | null;
  source: string;
  components: Array<{
    productId: string;
    quantity: number;
    consumptionDiagnostics?: {
      consumptionPerSale?: number;
      consumptionUnit?: string;
      totalConsumptionQuantity?: number;
      finalStoredDelta?: number;
      humanReadableDelta?: string;
    };
  }>;
};

export type FlowReportReturnLine = {
  id: string;
  productId: string | null;
  locationId: string | null;
  datetime: string;
  handling: string;
  processingStatus: string;
  stockQuantity: number;
  wasteQuantity: number;
};

export type FlowReportDetail = {
  datetime: string;
  locationId: string | null;
  receiptNumber: string | null;
  onlineposProductName: string | null;
  soldQuantity: number;
  consumptionPerSale: number | null;
  totalConsumption: number;
  storedDelta: number;
  source: string;
  status: "behandlet";
};

type FlowReportRow = {
  productId: string;
  gross: number;
  returned: number;
  waste: number;
  lineCount: number;
  latestAt: string;
  consumptionUnit: string;
  byLocation: Record<string, number>;
  details: FlowReportDetail[];
};

export function buildFlowReport(input: {
  syncLines: FlowReportSyncLine[];
  returnLines: FlowReportReturnLine[];
  duplicateCount: number;
  locationIds?: string[];
  productIds?: string[];
  from?: string;
  to?: string;
}) {
  const locations = new Set(input.locationIds ?? []);
  const products = new Set(input.productIds ?? []);
  const deduped = Array.from(new Map(input.syncLines.map((line) => [line.externalLineId, line])).values());
  const selected = deduped.filter((line) =>
    (!locations.size || (line.locationId && locations.has(line.locationId)))
    && (!input.from || line.transactionDatetime >= input.from)
    && (!input.to || line.transactionDatetime <= input.to));
  const processed = selected.filter((line) => line.status === "processed");
  const rows = new Map<string, FlowReportRow>();

  for (const line of processed) {
    for (const component of line.components.filter((item) => !products.size || products.has(item.productId))) {
      const diagnostic = component.consumptionDiagnostics;
      const gross = Math.abs(diagnostic?.totalConsumptionQuantity ?? component.quantity);
      const row = rows.get(component.productId) ?? emptyRow(component.productId, line.transactionDatetime, diagnostic?.consumptionUnit ?? "enheder");
      row.gross += gross;
      row.lineCount += 1;
      row.latestAt = row.latestAt > line.transactionDatetime ? row.latestAt : line.transactionDatetime;
      if (line.locationId) row.byLocation[line.locationId] = (row.byLocation[line.locationId] ?? 0) + gross;
      row.details.push({
        datetime: line.transactionDatetime,
        locationId: line.locationId,
        receiptNumber: line.receiptNumber,
        onlineposProductName: line.onlineposProductName,
        soldQuantity: line.quantitySold,
        consumptionPerSale: diagnostic?.consumptionPerSale ?? null,
        totalConsumption: gross,
        storedDelta: diagnostic?.finalStoredDelta ?? -component.quantity,
        source: line.source,
        status: "behandlet",
      });
      rows.set(component.productId, row);
    }
  }

  for (const line of input.returnLines.filter((item) => item.productId
    && (!locations.size || (item.locationId && locations.has(item.locationId)))
    && (!products.size || products.has(item.productId!))
    && (!input.from || item.datetime >= input.from)
    && (!input.to || item.datetime <= input.to))) {
    const row = rows.get(line.productId!) ?? emptyRow(line.productId!, line.datetime, "enheder");
    if (line.handling === "return_to_stock" && line.processingStatus === "returned_to_stock") row.returned += Math.abs(line.stockQuantity);
    if (line.handling === "waste" && line.processingStatus === "waste_registered") row.waste += Math.abs(line.wasteQuantity);
    rows.set(line.productId!, row);
  }

  const reportRows = Array.from(rows.values()).map((row) => ({ ...row, net: row.gross - row.returned }))
    .sort((a, b) => b.net - a.net || a.productId.localeCompare(b.productId));
  return {
    summary: {
      receiptCount: new Set(processed.map((line) => line.transactionId ?? line.receiptNumber).filter(Boolean)).size,
      processedLineCount: processed.length,
      totalConsumptionUnits: reportRows.reduce((sum, row) => sum + row.net, 0),
      duplicateCount: input.duplicateCount,
      ignoredLineCount: selected.filter((line) => line.status === "ignored").length,
      controlOrMappingLineCount: selected.filter((line) => line.status === "failed" || line.errorReason?.includes("mapping") || line.errorReason?.includes("kontrol")).length,
    },
    rows: reportRows,
  };
}

function emptyRow(productId: string, datetime: string, consumptionUnit: string): FlowReportRow {
  return { productId, gross: 0, returned: 0, waste: 0, lineCount: 0, latestAt: datetime, consumptionUnit, byLocation: {}, details: [] };
}
