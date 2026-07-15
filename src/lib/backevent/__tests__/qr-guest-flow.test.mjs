import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createQrGuestFingerprint, QR_GUEST_REQUEST_MAX_BYTES, readQrJsonBody } from "../qr-guest-security.ts";
import { validateQrMoveRequest } from "../qr-move-request.ts";

const validMove = {
  fromLocationId: "11111111-1111-4111-8111-111111111111",
  toLocationId: "22222222-2222-4222-8222-222222222222",
  actorName: "Mads Nielsen",
  lines: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 2 }],
};

test("guest can submit a complete QR move", () => {
  const result = validateQrMoveRequest(validMove, true);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.actorName, "Mads Nielsen");
});

test("guest without a name is rejected", () => {
  assert.equal(validateQrMoveRequest({ ...validMove, actorName: " " }, true).ok, false);
  assert.equal(validateQrMoveRequest({ ...validMove, actorName: "M" }, true).ok, false);
});

test("guest names reject excessive length and HTML or script syntax", () => {
  assert.equal(validateQrMoveRequest({ ...validMove, actorName: "A".repeat(121) }, true).ok, false);
  assert.equal(validateQrMoveRequest({ ...validMove, actorName: "<script>alert(1)</script>" }, true).ok, false);
  assert.equal(validateQrMoveRequest({ ...validMove, actorName: "Mads & Co" }, true).ok, false);
  const normalized = validateQrMoveRequest({ ...validMove, actorName: "  Mads   Nielsen  " }, true);
  assert.equal(normalized.ok && normalized.actorName, "Mads Nielsen");
});

test("authenticated user's client-supplied name is not required", () => {
  assert.equal(validateQrMoveRequest({ ...validMove, actorName: undefined }, false).ok, true);
});

test("same start and destination is rejected", () => {
  assert.equal(validateQrMoveRequest({ ...validMove, toLocationId: validMove.fromLocationId }, true).ok, false);
});

test("non-positive, duplicate and excessive lines are rejected", () => {
  assert.equal(validateQrMoveRequest({ ...validMove, lines: [{ productId: "p", quantity: 0 }] }, true).ok, false);
  assert.equal(validateQrMoveRequest({ ...validMove, lines: [validMove.lines[0], validMove.lines[0]] }, true).ok, false);
  assert.equal(validateQrMoveRequest({ ...validMove, lines: Array.from({ length: 101 }, (_, index) => ({ productId: `p-${index}`, quantity: 1 })) }, true).ok, false);
  assert.equal(validateQrMoveRequest({ ...validMove, lines: [{ ...validMove.lines[0], quantity: "2" }] }, true).ok, false);
});

test("production validation rejects malformed location and product UUIDs", () => {
  assert.equal(validateQrMoveRequest({ ...validMove, fromLocationId: "not-a-uuid" }, true, true).ok, false);
  assert.equal(validateQrMoveRequest({ ...validMove, lines: [{ productId: "not-a-uuid", quantity: 1 }] }, true, true).ok, false);
  assert.equal(validateQrMoveRequest(validMove, true, true).ok, true);
});

test("request reader enforces actual UTF-8 body size even without Content-Length", async () => {
  const oversized = new Request("https://example.test/api/qr/stock-movements", {
    method: "POST",
    body: JSON.stringify({ padding: "ø".repeat(QR_GUEST_REQUEST_MAX_BYTES) }),
  });
  oversized.headers.delete("content-length");
  const result = await readQrJsonBody(oversized);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 413);
});

test("guest fingerprint is stable, scoped and does not contain the raw address", () => {
  const previousSecret = process.env.QR_RATE_LIMIT_SECRET;
  process.env.QR_RATE_LIMIT_SECRET = "test-only-secret";
  try {
    const request = new Request("https://example.test", { headers: { "x-real-ip": "192.0.2.10" } });
    const first = createQrGuestFingerprint(request, validMove.fromLocationId);
    const second = createQrGuestFingerprint(request, validMove.fromLocationId);
    const otherLocation = createQrGuestFingerprint(request, validMove.toLocationId);
    assert.equal(first, second);
    assert.notEqual(first, otherLocation);
    assert.match(first ?? "", /^[0-9a-f]{64}$/);
    assert.doesNotMatch(first ?? "", /192\.0\.2\.10/);
  } finally {
    if (previousSecret === undefined) delete process.env.QR_RATE_LIMIT_SECRET;
    else process.env.QR_RATE_LIMIT_SECRET = previousSecret;
  }
});

test("public QR catalogue omits stock balances for guests", () => {
  const source = readFileSync("src/app/api/qr/move-flow/route.ts", "utf8");
  assert.match(source, /\.\.\.\(isAuthenticated[\s\S]*balances:/);
  assert.match(source, /QR-lokationen findes ikke eller er deaktiveret/);
  assert.match(source, /if \(isSupabaseConfigured\(\)\)[\s\S]*status: 500/);
});

test("guest audit and atomic database validation are enforced in the service-only RPC", () => {
  const migration = readFileSync("supabase/migrations/202607150001_qr_guest_stock_moves.sql", "utf8");
  assert.match(migration, /performed_by_user_id/);
  assert.match(migration, /performed_by_type[\s\S]*'user', 'guest'/);
  assert.match(migration, /p_performed_by_type = 'guest' and p_performed_by_user_id is not null/);
  assert.match(migration, /active = true and tracking_mode = 'inventory'/);
  assert.match(migration, /for update/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /backevent_qr_guest_rate_limits enable row level security/);
  assert.match(migration, /backevent_allow_qr_guest_move/);
  assert.match(migration, /return v_request_count <= 10/);
});

test("history renders the guest name and manual marker", () => {
  const source = readFileSync("src/app/historik/page.tsx", "utf8");
  assert.match(source, /entry\.createdBy/);
  assert.match(source, /Gæst \/ manuel registrering/);
});

test("other protected pages and APIs keep their guards", () => {
  const history = readFileSync("src/app/historik/page.tsx", "utf8");
  const adminApi = readFileSync("src/app/api/admin/reports/flowvarer/route.ts", "utf8");
  const guard = readFileSync("src/components/backevent/auth-guard.tsx", "utf8");
  assert.match(history, /requiredRole="ansvarlig"/);
  assert.match(adminApi, /requireBackEventRole\(request, "ansvarlig"\)/);
  assert.match(guard, /router\.replace\("\/login"\)/);
});
