import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExternalLineId,
  buildSyncDecisions,
  classifyOnlinePosLine,
} from "../inventory-sync.ts";

const product = { id: "water", name: "Kildevand", unit: "stk.", active: true };
const locations = [
  { id: "roedbar", name: "Rødbar", type: "bar", source_location_id: "roed-container", active: true },
  { id: "roed-container", name: "Rød Container", type: "container", source_location_id: null, active: true },
  { id: "central", name: "Centrallager", type: "container", source_location_id: null, active: true },
];

const locationMappings = [
  {
    id: "loc-map-roedbar",
    venueId: null,
    cashRegisterId: null,
    cashRegisterName: "Rødbar",
    normalizedCashRegisterName: "rødbar",
    backeventLocationId: "roedbar",
    active: true,
    firstSeenAt: null,
    lastSeenAt: null,
    createdAt: null,
    updatedAt: null,
  },
];

const approvedMapping = {
  id: "mapping-water",
  onlineposProductId: "23300358",
  onlineposProductName: "Kildevand",
  onlineposProductGroupName: "Sodavand",
  lineType: "stock_item",
  backeventInventoryItemId: null,
  conversionFactor: null,
  mappingAction: "consume_stock",
  status: "approved",
  components: [{ backeventInventoryItemId: "water", conversionFactor: 1, sortOrder: 0 }],
};

function line(overrides = {}) {
  return {
    transactionId: "tx-1",
    receiptNumber: "100",
    lineId: "line-1",
    lineIndex: 0,
    onlineposProductId: "23300358",
    onlineposProductName: "Kildevand",
    onlineposProductGroupId: "10",
    onlineposProductGroupName: "Sodavand",
    cashRegisterId: null,
    cashRegisterName: "Rødbar",
    quantitySold: 2,
    revenue: 40,
    lineType: "stock_item",
    inventoryRelevant: true,
    needsMapping: true,
    ...overrides,
  };
}

test("almindeligt salg bliver behandlet med godkendt produkt- og lokationsmapping", () => {
  const [decision] = buildSyncDecisions([line()], [approvedMapping], [product], locations, locationMappings);
  assert.equal(decision.status, "processed");
  assert.equal(decision.sourceLocationId, "roed-container");
  assert.equal(decision.components[0].productId, "water");
  assert.equal(decision.components[0].quantity, 2);
});

test("modifierlinje er lagerrelevant og kræver mapping", () => {
  const classification = classifyOnlinePosLine("Vodka", "MSG - Spiritus");
  assert.equal(classification.lineType, "modifier_stock_item");
  assert.equal(classification.inventoryRelevant, true);
  assert.equal(classification.needsMapping, true);
});

test("0-prislinje kan stadig behandles når mapping er godkendt", () => {
  const [decision] = buildSyncDecisions([line({ revenue: 0 })], [approvedMapping], [product], locations, locationMappings);
  assert.equal(decision.status, "processed");
  assert.equal(decision.revenue, 0);
  assert.equal(decision.components[0].quantity, 2);
});

test("stabil ekstern linje-ID er ens ved dobbelt sync", () => {
  assert.equal(buildExternalLineId(line()), buildExternalLineId(line()));
});

test("manglende produktmapping ignoreres uden lagertræk", () => {
  const [decision] = buildSyncDecisions([line()], [], [product], locations, locationMappings);
  assert.equal(decision.status, "ignored");
  assert.equal(decision.errorReason, "Mangler godkendt mapping");
  assert.equal(decision.components.length, 0);
});

test("pant og retur behandles ikke som normalt vareforbrug", () => {
  const classification = classifyOnlinePosLine("RETUR Krus", "Pant");
  assert.equal(classification.lineType, "deposit_return");
  const [decision] = buildSyncDecisions([line({ ...classification, onlineposProductName: "RETUR Krus", onlineposProductGroupName: "Pant" })], [approvedMapping], [product], locations, locationMappings);
  assert.equal(decision.status, "ignored");
});

test("umappet kasse påvirker ikke lager og bruger ikke Centrallager fallback", () => {
  const [decision] = buildSyncDecisions([line({ cashRegisterName: "Beer Bar" })], [approvedMapping], [product], locations, []);
  assert.equal(decision.status, "failed");
  assert.equal(decision.errorReason, "OnlinePOS-kasse mangler lokationsmapping");
  assert.equal(decision.sourceLocationId, null);
  assert.equal(decision.components.length, 0);
});
