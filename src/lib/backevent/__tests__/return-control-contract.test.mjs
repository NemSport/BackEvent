import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildOpenReturnControlSummary,
  buildReturnControlDetailHref,
  canTreatReceiptControl,
  explainReceiptControlRule,
  formatReceiptClassification,
  formatReceiptControlRule,
  formatReceiptControlStatus,
  isActiveReceiptControlStatus,
  receiptControlStatusForAction,
} from "../return-control-contract.ts";

test("summary includes the same open receipt-control population used by the control list", () => {
  assert.deepEqual(buildOpenReturnControlSummary(3, 39), { openReturns: 3, openReceiptControls: 39, openTotal: 42 });
});

test("receipt-control status and classifications use operational Danish labels", () => {
  assert.equal(formatReceiptControlStatus("open"), "Afventer kontrol");
  assert.equal(formatReceiptControlStatus("resolved"), "Godkendt");
  assert.equal(formatReceiptControlStatus("follow_up"), "Kræver opfølgning");
  assert.equal(formatReceiptClassification("sale_with_deposit_return"), "Salg med pantretur");
});

test("treatment actions map to active and closed statuses", () => {
  assert.equal(receiptControlStatusForAction("approve", "open"), "approved");
  assert.equal(receiptControlStatusForAction("follow_up", "open"), "follow_up");
  assert.equal(receiptControlStatusForAction("confirm_error", "open"), "confirmed_error");
  assert.equal(receiptControlStatusForAction("save_note", "follow_up"), "follow_up");
  assert.equal(isActiveReceiptControlStatus("follow_up"), true);
  assert.equal(isActiveReceiptControlStatus("approved"), false);
});

test("only Ejer and Økonomiansvarlige can treat receipt controls", () => {
  assert.equal(canTreatReceiptControl(true, false), true);
  assert.equal(canTreatReceiptControl(false, true), true);
  assert.equal(canTreatReceiptControl(true, true), true);
  assert.equal(canTreatReceiptControl(false, false), false);
});

test("migration enforces finance access, audit, optimistic concurrency and notification resolution", () => {
  const migration = readFileSync("supabase/migrations/202607140002_backevent_receipt_control_handling.sql", "utf8");
  assert.match(migration, /backevent_can_manage_receipt_controls\(\)/);
  assert.match(migration, /lower\('Økonomiansvarlige'\)/);
  assert.match(migration, /RECEIPT_CONTROL_CONFLICT/);
  assert.match(migration, /backevent_onlinepos_receipt_control_audit/);
  assert.match(migration, /set handled_at = completed_at/);
  assert.match(migration, /set resolved_at = completed_at/);
});

test("receipt-control rules have readable labels and explanations", () => {
  assert.equal(formatReceiptControlRule("HIGH_DEPOSIT_RETURN"), "Mange pantgenstande");
  assert.equal(explainReceiptControlRule("HIGH_DEPOSIT_RETURN", 17), "Der er registreret 17 pantgenstande på samme bon. Grænsen er 10.");
  assert.equal(formatReceiptControlRule("SOMETHING_NEW"), "Anden kontrolregel");
});

test("typed control links keep classic returns and receipt controls distinct", () => {
  assert.equal(buildReturnControlDetailHref("return", "return-1"), "/retur/return-1");
  assert.equal(buildReturnControlDetailHref("receipt-control", "control-1"), "/retur/kontrol/control-1");
});
