import assert from "node:assert/strict";
import test from "node:test";
import { getOnlinePosGrossAmount, getOnlinePosGrossTotal, hasOnlinePosGrossAmount } from "../pricing.ts";

test("bruttopris inkl. moms prioriteres over nettopris", () => {
  assert.equal(getOnlinePosGrossAmount({ gross_price: 125, net_price: 100 }), 125);
  assert.equal(getOnlinePosGrossAmount({ price: "62,50", netPrice: 50 }), 62.5);
});

test("nettopris bruges kun som fallback når bruttopris mangler", () => {
  assert.equal(getOnlinePosGrossAmount({ net_price: 100 }), 100);
  assert.equal(getOnlinePosGrossAmount({}), 0);
});

test("kun eksplicitte bruttoprisfelter markerer beløbet som inkl. moms", () => {
  assert.equal(hasOnlinePosGrossAmount({ gross_price: 125 }), true);
  assert.equal(hasOnlinePosGrossAmount({ grossPrice: 125 }), true);
  assert.equal(hasOnlinePosGrossAmount({ price: 100 }), false);
  assert.equal(hasOnlinePosGrossAmount({ net_price: 100 }), false);
});

test("bontotal beregnes fra inkl. moms-linjer når header-totalen er ekskl. moms", () => {
  assert.equal(
    getOnlinePosGrossTotal(
      { total: 120 },
      [
        { gross_price: 100, net_price: 80 },
        { price: 50, net_price: 40 },
      ],
    ),
    150,
  );
});
