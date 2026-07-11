import assert from "node:assert/strict";
import test from "node:test";
import { fetchOnlinePosTransactions, parseOnlinePosReturn } from "../returns.ts";

test("almindeligt salg bliver ikke behandlet som retur", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-1",
    receipt_number: "100",
    total: 120,
    cash_register: { name: "Rødbar" },
    lines: [{ line_id: "1", product_id: "233", product_name: "Kildevand", quantity: 2, net_price: 40 }],
  });

  assert.equal(parsed, null);
});

test("negativ transaktion bliver registreret som retur", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-2",
    receipt_number: "101",
    total: -40,
    cash_register: { name: "Rødbar" },
    lines: [{ line_id: "1", product_id: "233", product_name: "Kildevand", quantity: -2, net_price: -40 }],
  });

  assert.equal(parsed?.receiptNumber, "101");
  assert.equal(parsed?.lines[0].returnedQuantity, 2);
  assert.equal(parsed?.controlReasons.includes("Retur fundet ud fra negative linjer"), true);
});

test("pant og krus markeres uden normal lagerpåvirkning", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-3",
    receipt_number: "102",
    total: -20,
    lines: [
      { line_id: "1", product_name: "RETUR Krus", product_group_name: "Pant", quantity: -1, net_price: -20 },
      { line_id: "2", product_name: "GEBYR Kande", product_group_name: "Pant", quantity: -1, net_price: 0 },
    ],
  });

  assert.equal(parsed?.lines[0].isCup, true);
  assert.equal(parsed?.lines[0].isDeposit, true);
  assert.equal(parsed?.suspicionFlags.includes("PANT_KRUS"), true);
});

test("stabil return idempotency key er ens ved genkørsel", () => {
  const tx = {
    refund_id: "refund-1",
    transaction_id: "tx-4",
    receipt_number: "103",
    total: -30,
    datetime: "2026-07-11T10:00:00Z",
    lines: [{ line_id: "1", product_id: "233", product_name: "Kildevand", quantity: -1, net_price: -30 }],
  };

  assert.equal(parseOnlinePosReturn(tx)?.externalIdempotencyKey, parseOnlinePosReturn(tx)?.externalIdempotencyKey);
});

test("void/cancel behandles ikke ukritisk som refund", () => {
  const parsed = parseOnlinePosReturn({
    transaction_id: "tx-void",
    receipt_number: "104",
    status: "cancelled",
    total: -30,
    lines: [{ line_id: "1", product_id: "233", product_name: "Kildevand", quantity: -1, net_price: -30 }],
  });

  assert.equal(parsed, null);
});

test("pagination henter flere sider og deduplikerer transaktioner", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ONLINEPOS_CLIENT_ID = "client";
  process.env.ONLINEPOS_CLIENT_SECRET = "secret";
  process.env.ONLINEPOS_VENUE_ID = "venue";

  const calls = [];
  globalThis.fetch = async (url, init) => {
    const urlText = String(url);
    calls.push(urlText);
    if (urlText.includes("/auth/token")) {
      return jsonResponse({ access_token: "token" });
    }

    assert.equal(init.headers.Authorization, "Bearer token");
    const page = new URL(urlText).searchParams.get("page");
    if (page === "1") {
      return jsonResponse({
        data: [
          { transaction_id: "tx-a", receipt_number: "200", datetime: "2026-07-11T10:00:00Z", lines: [] },
          { transaction_id: "tx-dup", receipt_number: "201", datetime: "2026-07-11T10:01:00Z", lines: [] },
        ],
        pagination: { current_page: 1, last_page: 2, per_page: 2, total: 4 },
      });
    }

    return jsonResponse({
      data: [
        { transaction_id: "tx-dup", receipt_number: "201", datetime: "2026-07-11T10:01:00Z", lines: [] },
        { transaction_id: "tx-b", receipt_number: "202", datetime: "2026-07-11T10:02:00Z", lines: [] },
      ],
      pagination: { current_page: 2, last_page: 2, per_page: 2, total: 4 },
    });
  };

  try {
    const result = await fetchOnlinePosTransactions({
      datetimeFrom: "2026-07-11T00:00:00Z",
      datetimeTo: "2026-07-11T23:59:59Z",
    });
    assert.equal(result.pageCount, 2);
    assert.equal(result.transactions.length, 3);
    assert.equal(calls.filter((call) => call.includes("/transactions")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}
