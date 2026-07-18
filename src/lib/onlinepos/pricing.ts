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
