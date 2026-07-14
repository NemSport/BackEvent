import assert from "node:assert/strict";
import test from "node:test";
import { financeGroupName, getVisibleMenu, isMenuItemActive, menuSections } from "../navigation.ts";

const hrefs = (identity) => getVisibleMenu(identity).flatMap((section) => section.items.map((item) => item.href));

test("menu items are filtered for volunteer, responsible, owner and finance group", () => {
  assert.deepEqual(hrefs({ role: "frivillig" }), ["/", "/flyt", "/aabning", "/lukning", "/notifikationer"]);
  assert.ok(hrefs({ role: "ansvarlig" }).includes("/admin/rapport"));
  assert.ok(!hrefs({ role: "ansvarlig" }).includes("/admin/medlemmer"));
  assert.ok(hrefs({ role: "ejer" }).includes("/admin/onlinepos-replay"));
  const finance = hrefs({ role: "frivillig", groupNames: [financeGroupName] });
  assert.ok(finance.includes("/retur/kontrol"));
  assert.ok(!finance.includes("/admin"));
});

test("active matching includes dynamic routes without activating parents incorrectly", () => {
  const items = menuSections.flatMap((section) => section.items);
  const control = items.find((item) => item.href === "/retur/kontrol");
  const overview = items.find((item) => item.href === "/retur");
  assert.equal(isMenuItemActive(control, "/retur/kontrol/control-1"), true);
  assert.equal(isMenuItemActive(overview, "/retur/kontrol/control-1"), false);
});

test("central menu contains no duplicate hrefs or labels within a section", () => {
  const all = menuSections.flatMap((section) => section.items);
  assert.equal(new Set(all.map((item) => item.href)).size, all.length);
  for (const section of menuSections) assert.equal(new Set(section.items.map((item) => item.label)).size, section.items.length);
});

test("menu output is deterministic and badge keys do not alter structure", () => {
  const identity = { role: "ejer", groupNames: [financeGroupName] };
  assert.deepEqual(getVisibleMenu(identity), getVisibleMenu(identity));
  for (const item of menuSections.flatMap((section) => section.items)) assert.ok(!("badgeCount" in item));
});
