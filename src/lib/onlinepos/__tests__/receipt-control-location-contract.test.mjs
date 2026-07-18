import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatReceiptControlLocation } from "../receipt-control-location.ts";

const root = new URL("../../../../", import.meta.url);

test("migration gemmer både BackEvent-lokation og oprindelig OnlinePOS-bar", async () => {
  const sql = await readFile(new URL("supabase/migrations/202607160001_receipt_control_location_context.sql", root), "utf8");
  assert.match(sql, /location_id uuid references public\.backevent_locations/);
  assert.match(sql, /location_name text/);
  assert.match(sql, /cash_register_id text/);
  assert.match(sql, /cash_register_name text/);
  assert.match(sql, /location_mapping_status in \('mapped', 'unmapped'\)/);
});

test("oversigt, detalje og historik viser bar og umappet status", async () => {
  const paths = [
    "src/app/retur/kontrol/page.tsx",
    "src/app/retur/kontrol/[controlId]/page.tsx",
    "src/app/retur/historik/page.tsx",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.match(source, /formatReceiptControlLocation/, path);
  }
  const formatter = await readFile(new URL("src/lib/onlinepos/receipt-control-location.ts", root), "utf8");
  assert.match(formatter, /Bar:/);
  assert.match(formatter, /Ikke mappet/);
});

test("mappet bar viser kun BackEvent-lokationens navn", () => {
  assert.equal(formatReceiptControlLocation({
    locationName: "Pubben",
    cashRegisterName: "OnlinePOS Pub",
    cashRegisterId: "29305",
  }), "Bar: Pubben");
});

test("kun OnlinePOS-navn og manglende mapping vises tydeligt", () => {
  assert.equal(formatReceiptControlLocation({
    locationName: null,
    cashRegisterName: "Beer Bar",
    cashRegisterId: null,
  }), "Bar: Beer Bar · Ikke mappet");
});

test("OnlinePOS-id bruges når navnet mangler", () => {
  assert.equal(formatReceiptControlLocation({
    locationName: null,
    cashRegisterName: null,
    cashRegisterId: "29315",
  }), "Bar: 29315 · Ikke mappet");
});

test("ukendt bruges kun når OnlinePOS ikke leverede id eller navn", () => {
  assert.equal(formatReceiptControlLocation({
    locationName: null,
    cashRegisterName: null,
    cashRegisterId: null,
  }), "Bar: Ukendt · Ikke mappet");
});

test("backfill matcher eksisterende bon på transaktions-id og aldrig bonnummer", async () => {
  const sql = await readFile(new URL("supabase/migrations/202607170001_backfill_receipt_control_locations.sql", root), "utf8");
  assert.match(sql, /sync_line\.transaction_id = control\.onlinepos_transaction_id/);
  assert.doesNotMatch(sql, /sync_line\.receipt_number = control\.receipt_number/);
  assert.match(sql, /cash_register_id = coalesce/);
  assert.match(sql, /location_id = coalesce/);
});
