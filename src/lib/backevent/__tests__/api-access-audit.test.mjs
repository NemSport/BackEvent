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

test("QR inventory reads and writes require an authenticated BackEvent user", () => {
  for (const path of ["src/app/api/qr/move-flow/route.ts", "src/app/api/qr/stock-movements/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireBackEventRole\(request, "frivillig"\)/, path);
  }
});

test("stock-changing server RPCs cannot be called with anon or arbitrary authenticated JWTs", () => {
  const migration = readFileSync("supabase/migrations/202607140004_backevent_v1_access_hardening.sql", "utf8");
  assert.match(migration, /revoke execute on function public\.backevent_create_stock_movement_batch[\s\S]*from anon, authenticated/);
  assert.match(migration, /revoke execute on function public\.backevent_apply_onlinepos_inventory_sync[\s\S]*from anon, authenticated/);
  assert.match(migration, /to service_role/);
});
