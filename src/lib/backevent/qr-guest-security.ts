import { createHmac } from "node:crypto";

export const QR_GUEST_REQUEST_MAX_BYTES = 64_000;

export async function readQrJsonBody(request: Request): Promise<
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; message: string; event: "invalid_json" | "request_too_large" }
> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > QR_GUEST_REQUEST_MAX_BYTES) {
    return { ok: false, status: 413, message: "Forespørgslen er for stor", event: "request_too_large" };
  }

  const text = await request.text().catch(() => null);
  if (text === null) {
    return { ok: false, status: 400, message: "Ugyldig forespørgsel", event: "invalid_json" };
  }

  if (new TextEncoder().encode(text).byteLength > QR_GUEST_REQUEST_MAX_BYTES) {
    return { ok: false, status: 413, message: "Forespørgslen er for stor", event: "request_too_large" };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, message: "Ugyldig forespørgsel", event: "invalid_json" };
  }
}

export function createQrGuestFingerprint(request: Request, fromLocationId: string) {
  const secret = process.env.QR_RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;

  const forwardedAddresses = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const forwardedFor = forwardedAddresses.at(-1);
  const clientAddress = (request.headers.get("x-real-ip")?.trim() || forwardedFor || "unknown").slice(0, 128);

  return createHmac("sha256", secret)
    .update(`qr-guest-move\n${fromLocationId}\n${clientAddress}`)
    .digest("hex");
}

export function logQrGuestSecurityEvent(event: string) {
  // Deliberately excludes names, request bodies, authorization headers and raw IP addresses.
  console.warn(JSON.stringify({ scope: "qr_guest_move", event, occurredAt: new Date().toISOString() }));
}
