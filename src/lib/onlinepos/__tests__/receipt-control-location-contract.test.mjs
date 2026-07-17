import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
    assert.match(source, /Bar:/, path);
    assert.match(source, /Ikke mappet/, path);
  }
});
