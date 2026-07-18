import ExcelJS from "exceljs";
import { formatReceiptControlRule, formatReceiptControlStatus } from "./return-control-contract.ts";

type ExportControl = {
  receiptNumber: string | null;
  transactionId: string | null;
  transactionDatetime: string | null;
  createdAt: string;
  source: string;
  cashRegisterId: string | null;
  cashRegisterName: string | null;
  locationName: string | null;
  locationMappingStatus: string;
  purchaseValue: number;
  depositReturnValue: number;
  finalTotal: number;
  purchaseValueIncludingVat: number;
  depositReturnValueIncludingVat: number;
  finalTotalIncludingVat: number;
  depositReturnQuantity: number;
  controlTypes: string[];
  status: string;
  internalNote: string | null;
  handledByName: string | null;
  handledAt: string | null;
};

export async function buildReceiptControlWorkbook(items: ExportControl[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BackEvent";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Boner", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Bonnummer", key: "receiptNumber", width: 16 },
    { header: "OnlinePOS receipt ID", key: "transactionId", width: 22 },
    { header: "Dato", key: "date", width: 13 },
    { header: "Tid", key: "time", width: 10 },
    { header: "Sync-type", key: "source", width: 18 },
    { header: "OnlinePOS bar ID", key: "cashRegisterId", width: 18 },
    { header: "OnlinePOS bar-navn", key: "cashRegisterName", width: 22 },
    { header: "BackEvent lokation", key: "locationName", width: 22 },
    { header: "Mappingstatus", key: "mappingStatus", width: 16 },
    { header: "Køb inkl. moms", key: "purchaseValue", width: 18, style: { numFmt: '#,##0.00 "kr."' } },
    { header: "Pant retur inkl. moms", key: "depositReturnValue", width: 22, style: { numFmt: '#,##0.00 "kr."' } },
    { header: "Bon i alt inkl. moms", key: "finalTotal", width: 20, style: { numFmt: '#,##0.00 "kr."' } },
    { header: "Antal pant", key: "depositQuantity", width: 14 },
    { header: "Kontrolårsag", key: "reasons", width: 38 },
    { header: "Status", key: "status", width: 20 },
    { header: "Intern bemærkning", key: "note", width: 40 },
    { header: "Seneste behandler", key: "handler", width: 24 },
    { header: "Senest behandlet tidspunkt", key: "handledAt", width: 24 },
    { header: "Oprettet tidspunkt", key: "createdAt", width: 24 },
  ];

  for (const item of items) {
    const receiptTime = new Date(item.transactionDatetime ?? item.createdAt);
    sheet.addRow({
      receiptNumber: item.receiptNumber ?? "",
      transactionId: item.transactionId ?? "",
      date: receiptTime,
      time: receiptTime,
      source: sourceLabel(item.source),
      cashRegisterId: item.cashRegisterId ?? "",
      cashRegisterName: item.cashRegisterName ?? "",
      locationName: item.locationName ?? "",
      mappingStatus: item.locationMappingStatus === "mapped" ? "Mappet" : item.cashRegisterId || item.cashRegisterName ? "Ikke mappet" : "Ukendt",
      purchaseValue: item.purchaseValueIncludingVat,
      depositReturnValue: item.depositReturnValueIncludingVat,
      finalTotal: item.finalTotalIncludingVat,
      depositQuantity: item.depositReturnQuantity,
      reasons: item.controlTypes.map(formatReceiptControlRule).join(" · "),
      status: formatReceiptControlStatus(item.status),
      note: item.internalNote ?? "",
      handler: item.handledByName ?? "",
      handledAt: dateOrBlank(item.handledAt),
      createdAt: new Date(item.createdAt),
    });
  }
  sheet.getColumn("date").numFmt = "dd-mm-yyyy";
  sheet.getColumn("time").numFmt = "hh:mm";
  sheet.getColumn("handledAt").numFmt = "dd-mm-yyyy hh:mm";
  sheet.getColumn("createdAt").numFmt = "dd-mm-yyyy hh:mm";
  sheet.autoFilter = { from: "A1", to: "S1" };
  styleHeader(sheet.getRow(1));

  const summary = workbook.addWorksheet("Opsummering", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.columns = [{ header: "Nøgletal", key: "label", width: 34 }, { header: "Værdi", key: "value", width: 24 }];
  const statusCounts = countBy(items, (item) => formatReceiptControlStatus(item.status));
  const locationCounts = countBy(items, (item) => item.locationName ?? (item.cashRegisterName ? `${item.cashRegisterName} (ikke mappet)` : "Ukendt"));
  summary.addRow({ label: "Antal boner", value: items.length });
  summary.addRow({ label: "Samlet negativ total", value: items.filter((item) => item.finalTotal < 0).reduce((sum, item) => sum + Math.abs(item.finalTotalIncludingVat), 0) });
  summary.addRow({ label: "Samlet pant retur", value: items.reduce((sum, item) => sum + item.depositReturnValueIncludingVat, 0) });
  summary.addRow({ label: "Antal ikke mappede barer", value: items.filter((item) => item.locationMappingStatus !== "mapped").length });
  for (const [status, count] of statusCounts) summary.addRow({ label: `Status: ${status}`, value: count });
  for (const [location, count] of locationCounts) summary.addRow({ label: `Lokation: ${location}`, value: count });
  summary.getCell("B3").numFmt = '#,##0.00 "kr."';
  summary.getCell("B4").numFmt = '#,##0.00 "kr."';
  summary.autoFilter = { from: "A1", to: "B1" };
  styleHeader(summary.getRow(1));

  return workbook.xlsx.writeBuffer();
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B3A00" } };
}

function dateOrBlank(value: string | null) {
  return value ? new Date(value) : "";
}

function sourceLabel(source: string) {
  if (source === "historical_replay") return "Replay";
  if (source === "test") return "Test-run";
  return source === "live" ? "Live sync" : source;
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, "da"));
}
