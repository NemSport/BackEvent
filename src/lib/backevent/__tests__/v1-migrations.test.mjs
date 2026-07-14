import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const handling = readFileSync("supabase/migrations/202607140002_backevent_receipt_control_handling.sql", "utf8");
const email = readFileSync("supabase/migrations/202607140003_deprecate_backevent_operational_email.sql", "utf8");
const hardening = readFileSync("supabase/migrations/202607140004_backevent_v1_access_hardening.sql", "utf8");
const emailPrivileges = readFileSync("supabase/migrations/202607140005_harden_deprecated_email_log_privileges.sql", "utf8");
const rpcPrivileges = readFileSync("supabase/migrations/202607140006_harden_v1_rpc_execute_privileges.sql", "utf8");

test("V1 migration filenames preserve dependency order", () => {
  assert.ok("202607140002" < "202607140003");
  assert.ok("202607140003" < "202607140004");
  assert.ok("202607140004" < "202607140005");
  assert.ok("202607140005" < "202607140006");
});

test("receipt-control handling is restricted to Ejer and active Økonomiansvarlige", () => {
  assert.match(handling, /public\.backevent_is_owner\(\) or exists/);
  assert.match(handling, /profiles\.active = true/);
  assert.match(handling, /groups\.active = true/);
  assert.match(handling, /lower\(groups\.name\) = lower\('Økonomiansvarlige'\)/);
  assert.match(handling, /RECEIPT_CONTROL_CONFLICT/);
  assert.match(handling, /backevent_onlinepos_receipt_control_audit/);
});

test("operational e-mail migration preserves history and removes writes", () => {
  assert.match(email, /revoke insert, update, delete/i);
  assert.doesNotMatch(email, /drop table|truncate|delete from/i);
});

test("deprecated operational e-mail history is read-only for client roles", () => {
  assert.match(emailPrivileges, /revoke all privileges on table public\.backevent_email_logs from anon, authenticated/i);
  assert.match(emailPrivileges, /grant select on table public\.backevent_email_logs to authenticated/i);
  assert.doesNotMatch(emailPrivileges, /drop table|truncate table|delete from/i);
});

test("stock-changing RPCs are service-role only", () => {
  assert.match(hardening, /backevent_create_stock_movement_batch[\s\S]*from anon, authenticated/);
  assert.match(hardening, /backevent_apply_onlinepos_inventory_sync[\s\S]*from anon, authenticated/);
  const grants = hardening.match(/grant execute[\s\S]*?to service_role;/gi) ?? [];
  assert.equal(grants.length, 2);
});

test("V1 RPC grants remove PUBLIC and anon execution", () => {
  assert.match(rpcPrivileges, /create or replace function public\.backevent_can_manage_receipt_controls/);
  assert.match(rpcPrivileges, /select public\.backevent_is_owner\(\) or exists/);
  assert.match(rpcPrivileges, /create or replace function public\.backevent_is_finance_responsible[\s\S]*select public\.backevent_can_manage_receipt_controls\(\)/);
  assert.match(rpcPrivileges, /backevent_create_stock_movement_batch[\s\S]*from public, anon, authenticated/i);
  assert.match(rpcPrivileges, /backevent_apply_onlinepos_inventory_sync[\s\S]*from public, anon, authenticated/i);
  assert.match(rpcPrivileges, /backevent_can_manage_receipt_controls[\s\S]*from public, anon/i);
  assert.match(rpcPrivileges, /backevent_handle_receipt_control[\s\S]*from public, anon/i);
  assert.match(rpcPrivileges, /backevent_is_finance_responsible[\s\S]*from public, anon/i);
  const serviceRoleGrants = rpcPrivileges.match(/grant execute[\s\S]*?to service_role;/gi) ?? [];
  assert.equal(serviceRoleGrants.length, 2);
});

test("V1 migrations contain no destructive data operation", () => {
  for (const migration of [handling, email, hardening, emailPrivileges, rpcPrivileges]) {
    assert.doesNotMatch(migration, /drop table|truncate table|delete from/i);
  }
});
