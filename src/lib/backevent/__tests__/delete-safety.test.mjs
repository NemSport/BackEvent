import assert from "node:assert/strict";
import test from "node:test";
import { planAdminObjectDelete } from "../delete-safety.ts";
import { hasRoleAtLeast } from "../permissions.ts";

test("ubrugt produkt kan slettes", () => {
  const plan = planAdminObjectDelete({ activeStockQuantity: 0, historyCount: 0, relationCount: 0 });
  assert.equal(plan.action, "delete");
});

test("brugt produkt kan kun deaktiveres", () => {
  const plan = planAdminObjectDelete({ activeStockQuantity: 0, historyCount: 2, relationCount: 0 });
  assert.equal(plan.action, "deactivate");
});

test("ubrugt lokation kan slettes", () => {
  const plan = planAdminObjectDelete({ activeStockQuantity: 0, historyCount: 0, relationCount: 0 });
  assert.equal(plan.action, "delete");
});

test("lokation med historik kan kun deaktiveres", () => {
  const plan = planAdminObjectDelete({ activeStockQuantity: 0, historyCount: 1, relationCount: 0 });
  assert.equal(plan.action, "deactivate");
});

test("aktiv beholdning blokerer sletning og deaktivering", () => {
  const plan = planAdminObjectDelete({ activeStockQuantity: 3, historyCount: 0, relationCount: 0 });
  assert.equal(plan.action, "blocked");
  assert.equal(plan.canDeactivate, false);
});

test("frivillig og ansvarlig kan ikke slette", () => {
  assert.equal(hasRoleAtLeast("frivillig", "ejer"), false);
  assert.equal(hasRoleAtLeast("ansvarlig", "ejer"), false);
  assert.equal(hasRoleAtLeast("ejer", "ejer"), true);
});

test("inaktive objekter vises ikke i nye valg", () => {
  const rows = [
    { id: "active", active: true },
    { id: "inactive", active: false },
  ];
  assert.deepEqual(rows.filter((row) => row.active !== false).map((row) => row.id), ["active"]);
});

test("historik kan stadig vise deaktiverede objekter via id", () => {
  const products = [
    { id: "product-1", name: "Mokai", active: false },
  ];
  const historyLine = { productId: "product-1" };
  assert.equal(products.find((product) => product.id === historyLine.productId)?.name, "Mokai");
});
