import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplayWindows,
  isOnlinePosReplayEnabled,
  productionExternalLineId,
  replayExternalLineId,
  validateCleanupConfirmation,
  validateReplayConfirmation,
} from "../historical-replay-core.ts";

const baseInput = {
  date: "2025-07-17",
  startTime: "17:00",
  endTime: "17:50",
  intervalMinutes: 10,
  overlapMinutes: 2,
};

test("replay vinduer genereres korrekt", () => {
  const windows = buildReplayWindows(baseInput);
  assert.equal(windows.length, 5);
  assert.deepEqual(windows.map((window) => window.label), ["17:10", "17:20", "17:30", "17:40", "17:50"]);
});

test("overlap genereres korrekt", () => {
  const windows = buildReplayWindows(baseInput);
  assert.equal(new Date(windows[0].fetchFrom).toISOString(), "2025-07-17T14:58:00.000Z");
  assert.equal(new Date(windows[1].fetchFrom).toISOString(), "2025-07-17T15:08:00.000Z");
  assert.equal(new Date(windows[4].fetchTo).toISOString(), "2025-07-17T15:50:00.000Z");
});

test("replay bruger namespace og kolliderer ikke med produktions-idempotency", () => {
  const line = {
    transactionId: "tx-1",
    receiptNumber: "100",
    lineId: "line-1",
    lineIndex: 0,
    onlineposProductId: "233",
    onlineposProductName: "Kildevand",
  };
  assert.equal(productionExternalLineId(line), "tx-1:line-1:233");
  assert.equal(replayExternalLineId("run-1", line), "historical-replay:run-1:tx-1:line-1:233");
  assert.notEqual(replayExternalLineId("run-1", line), productionExternalLineId(line));
  assert.notEqual(replayExternalLineId("run-2", line), replayExternalLineId("run-1", line));
});

test("dublet på tværs af vinduer kan deduplikeres med produktionslinje-id", () => {
  const line = { transactionId: "tx-1", receiptNumber: null, lineId: "line-1", lineIndex: 0, onlineposProductId: "233", onlineposProductName: "Kildevand" };
  const seen = new Set();
  const first = productionExternalLineId(line);
  const second = productionExternalLineId(line);
  assert.equal(seen.has(first), false);
  seen.add(first);
  assert.equal(seen.has(second), true);
});

test("dry-run og cleanup confirmations er sikre", () => {
  assert.equal(validateReplayConfirmation("dry-run", null), null);
  assert.equal(validateReplayConfirmation("test-run", null), "Test-run kræver bekræftelsen KØR HISTORISK TEST");
  assert.equal(validateReplayConfirmation("test-run", "KØR HISTORISK TEST"), null);
  assert.equal(validateCleanupConfirmation("SLET REPLAYDATA"), true);
  assert.equal(validateCleanupConfirmation("SLET ALT"), false);
});

test("feature flag slukket afviser adgang", () => {
  assert.equal(isOnlinePosReplayEnabled({}), false);
  assert.equal(isOnlinePosReplayEnabled({ BACKEVENT_ENABLE_ONLINEPOS_REPLAY: "false" }), false);
  assert.equal(isOnlinePosReplayEnabled({ BACKEVENT_ENABLE_ONLINEPOS_REPLAY: "true" }), true);
});

test("historisk replay namespace kan ikke kollidere med almindelig sync", () => {
  const lines = [
    { transactionId: "tx-1", receiptNumber: "100", lineId: "line-1", lineIndex: 0, onlineposProductId: "233", onlineposProductName: "Kildevand" },
    { transactionId: "tx-1", receiptNumber: "100", lineId: "line-2", lineIndex: 1, onlineposProductId: "234", onlineposProductName: "Pepsi Max" },
  ];
  const productionIds = lines.map(productionExternalLineId);
  const replayIds = lines.map((line) => replayExternalLineId("historisk-test", line));

  assert.equal(new Set(productionIds).size, 2);
  assert.equal(new Set(replayIds).size, 2);
  assert.equal(replayIds.every((id) => id.startsWith("historical-replay:historisk-test:")), true);
  assert.equal(replayIds.some((id) => productionIds.includes(id)), false);
});

test("dry-run kræver ikke skrivende bekræftelse", () => {
  assert.equal(validateReplayConfirmation("dry-run", ""), null);
  assert.equal(validateReplayConfirmation("dry-run", "SLET REPLAYDATA"), null);
});

test("oprydning kræver præcis dansk bekræftelse", () => {
  assert.equal(validateCleanupConfirmation("SLET REPLAYDATA"), true);
  assert.equal(validateCleanupConfirmation("slet replaydata"), false);
  assert.equal(validateCleanupConfirmation("KØR HISTORISK TEST"), false);
});
