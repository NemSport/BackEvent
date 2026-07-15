import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ownerRoutes = [
  "src/app/api/onlinepos/health/route.ts",
  "src/app/api/onlinepos/venues/route.ts",
  "src/app/api/onlinepos/transactions-basic/route.ts",
  "src/app/api/onlinepos/transactions-extended/route.ts",
  "src/app/api/onlinepos/inventory-consumption-preview/route.ts",
];

test("OnlinePOS diagnostic endpoints require Ejer", () => {
  for (const path of ownerRoutes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireBackEventRole\(request, "ejer"\)/, path);
  }
});

test("only the QR flow endpoints allow a guest fallback", () => {
  const readRoute = readFileSync("src/app/api/qr/move-flow/route.ts", "utf8");
  const writeRoute = readFileSync("src/app/api/qr/stock-movements/route.ts", "utf8");
  assert.match(readRoute, /Authentication is optional on this one narrowly scoped endpoint/);
  assert.match(writeRoute, /narrowly[\s\S]*allowed guest operation/);
  assert.doesNotMatch(readRoute, /return NextResponse\.json\(\{ ok: false, message: auth\.message/);
  assert.doesNotMatch(writeRoute, /return NextResponse\.json\(\{ ok: false, message: auth\.message/);
});

test("stock-changing server RPCs cannot be called with anon or arbitrary authenticated JWTs", () => {
  const migration = readFileSync("supabase/migrations/202607140004_backevent_v1_access_hardening.sql", "utf8");
  assert.match(migration, /revoke execute on function public\.backevent_create_stock_movement_batch[\s\S]*from anon, authenticated/);
  assert.match(migration, /revoke execute on function public\.backevent_apply_onlinepos_inventory_sync[\s\S]*from anon, authenticated/);
  assert.match(migration, /to service_role/);
});
