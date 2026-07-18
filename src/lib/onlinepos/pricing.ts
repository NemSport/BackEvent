import { amountIncludingVat } from "../backevent/vat.ts";

export type OnlinePosSourcedAmount = {
  value: number;
  valueIncludingVat: number;
  includesVat: boolean;
  sourceField: string;
};

export function getOnlinePosSourcedLineAmount(record: Record<string, unknown>): OnlinePosSourcedAmount {
  return sourcedAmount(record, [
    ["gross_price", true],
    ["grossPrice", true],
    ["price", true],
    ["net_price", false],
    ["netPrice", false],
    ["netprice", false],
  ]) ?? emptySourcedAmount("missing");
}

export function getOnlinePosSourcedTotal(
  transaction: Record<string, unknown>,
  lines: Record<string, unknown>[],
): OnlinePosSourcedAmount {
  const headerAmount = sourcedAmount(transaction, [
    ["gross_total", true],
    ["grossTotal", true],
    ["total_including_vat", true],
    ["totalIncludingVat", true],
    ["total", true],
    ["amount", true],
    ["price", true],
    ["net_total", false],
    ["netTotal", false],
    ["net_price", false],
    ["netPrice", false],
  ]);
  if (headerAmount) return headerAmount;

  const lineAmounts = lines.map(getOnlinePosSourcedLineAmount);
  return {
    value: roundMoney(lineAmounts.reduce((sum, item) => sum + item.value, 0)),
    valueIncludingVat: roundMoney(lineAmounts.reduce((sum, item) => sum + item.valueIncludingVat, 0)),
    includesVat: lineAmounts.every((item) => item.includesVat),
    sourceField: "calculated_from_lines",
  };
}

export function getOnlinePosGrossAmount(record: Record<string, unknown>) {
  return numberValue(pickField(record, ["gross_price", "grossPrice", "price"]))
    ?? numberValue(pickField(record, ["net_price", "netPrice", "netprice"]))
    ?? 0;
}

export function getOnlinePosGrossTotal(
  transaction: Record<string, unknown>,
  lines: Record<string, unknown>[],
) {
  const explicitGrossTotal = numberValue(pickField(transaction, [
    "gross_total",
    "grossTotal",
    "total_including_vat",
    "totalIncludingVat",
  ]));
  if (explicitGrossTotal !== null) return explicitGrossTotal;

  if (lines.some(hasOnlinePosGrossAmount)) {
    return lines.reduce((sum, line) => sum + getOnlinePosGrossAmount(line), 0);
  }

  return numberValue(pickField(transaction, ["total", "amount", "price", "net_price", "netPrice"]));
}

export function hasOnlinePosGrossAmount(record: Record<string, unknown>) {
  return numberValue(pickField(record, ["gross_price", "grossPrice"])) !== null;
}

function pickField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sourcedAmount(
  record: Record<string, unknown>,
  fields: ReadonlyArray<readonly [string, boolean]>,
): OnlinePosSourcedAmount | null {
  for (const [sourceField, includesVat] of fields) {
    const value = numberValue(record[sourceField]);
    if (value === null) continue;
    return {
      value,
      valueIncludingVat: amountIncludingVat(value, includesVat),
      includesVat,
      sourceField,
    };
  }
  return null;
}

function emptySourcedAmount(sourceField: string): OnlinePosSourcedAmount {
  return { value: 0, valueIncludingVat: 0, includesVat: true, sourceField };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
