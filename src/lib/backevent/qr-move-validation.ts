export type QrMoveQuantityLine = {
  productId: string;
  quantity: number;
  available?: number;
};

export function clampQrMoveQuantity(nextQuantity: number, available?: number) {
  if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
    return 0;
  }

  return available === undefined ? nextQuantity : Math.min(nextQuantity, Math.max(0, available));
}

export function getSelectedQrMoveLines(lines: QrMoveQuantityLine[]) {
  return lines.filter((line) => line.quantity > 0);
}

export function validateQrMoveLines(lines: QrMoveQuantityLine[]) {
  const selectedLines = getSelectedQrMoveLines(lines);

  if (selectedLines.length === 0) {
    return { ok: false as const, message: "Vælg mindst én vare" };
  }

  const invalidLine = selectedLines.find(
    (line) => line.quantity <= 0 || (line.available !== undefined && line.quantity > line.available),
  );

  if (invalidLine) {
    return { ok: false as const, message: "Antal er højere end beholdningen" };
  }

  return { ok: true as const, lines: selectedLines };
}
