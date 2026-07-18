import assert from "node:assert/strict";
import test from "node:test";
import { amountIncludingVat } from "../vat.ts";

test("ekskl. moms-beløb omregnes med dansk moms", () => {
  assert.equal(amountIncludingVat(100, false), 125);
  assert.equal(amountIncludingVat(-80, false), -100);
});

test("beløb der allerede inkluderer moms ændres ikke", () => {
  assert.equal(amountIncludingVat(125, true), 125);
});

test("momsbeløb afrundes til to decimaler", () => {
  assert.equal(amountIncludingVat(10.01, false), 12.51);
});
