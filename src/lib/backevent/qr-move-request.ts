export type QrMoveRequest = {
  fromLocationId?: unknown;
  toLocationId?: unknown;
  actorName?: unknown;
  lines?: unknown;
};

export type QrMoveLine = {
  productId: string;
  quantity: number;
};

export function validateQrMoveRequest(body: QrMoveRequest | null, requireGuestName: boolean, requireUuids = false):
  | { ok: false; message: string }
  | { ok: true; fromLocationId: string; toLocationId: string; actorName: string; lines: QrMoveLine[] } {
  if (!body) return { ok: false, message: "Ugyldig forespørgsel" };

  const fromLocationId = typeof body.fromLocationId === "string" ? body.fromLocationId.trim() : "";
  const toLocationId = typeof body.toLocationId === "string" ? body.toLocationId.trim() : "";

  if (!fromLocationId || fromLocationId.length > 100 || (requireUuids && !isUuid(fromLocationId))) {
    return { ok: false, message: "Vælg startlokation" };
  }
  if (!toLocationId || toLocationId.length > 100 || (requireUuids && !isUuid(toLocationId))) {
    return { ok: false, message: "Vælg destination" };
  }
  if (fromLocationId === toLocationId) {
    return { ok: false, message: "Start og destination skal være forskellige" };
  }

  const actorName = typeof body.actorName === "string"
    ? body.actorName.normalize("NFC").trim().replace(/\s+/gu, " ")
    : "";
  if (requireGuestName) {
    if (actorName.length < 2) return { ok: false, message: "Skriv dit navn" };
    if (actorName.length > 120) return { ok: false, message: "Navnet er for langt" };
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,119}$/u.test(actorName)) {
      return { ok: false, message: "Navnet indeholder ugyldige tegn" };
    }
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 100) {
    return { ok: false, message: "Vælg mindst én vare" };
  }

  const lines = body.lines.map((line) => parseLine(line, requireUuids));
  if (lines.some((line) => line === null)) {
    return { ok: false, message: "Alle antal skal være positive" };
  }

  const validLines = lines as QrMoveLine[];
  if (new Set(validLines.map((line) => line.productId)).size !== validLines.length) {
    return { ok: false, message: "Den samme vare må kun vælges én gang" };
  }

  return {
    ok: true,
    fromLocationId,
    toLocationId,
    actorName,
    lines: validLines,
  };
}

function parseLine(line: unknown, requireUuid: boolean): QrMoveLine | null {
  if (!line || typeof line !== "object") return null;
  const productId = "productId" in line && typeof line.productId === "string" ? line.productId.trim() : "";
  const quantity = "quantity" in line && typeof line.quantity === "number" ? line.quantity : 0;
  if (!productId || productId.length > 100 || (requireUuid && !isUuid(productId)) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return null;
  return { productId, quantity };
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
