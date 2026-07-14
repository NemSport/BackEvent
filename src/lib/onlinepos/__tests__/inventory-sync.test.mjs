import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOnlinePosSyncDecisions,
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

test("live sync resolver samme canonical kasse ens på 100 linjer", () => {
  const lines = Array.from({ length: 100 }, (_, index) => line({
    transactionId: `tx-${index}`,
    lineId: `line-${index}`,
    lineIndex: index,
  }));
  const decisions = buildSyncDecisions(lines, [approvedMapping], [product], locations, locationMappings);

  assert.equal(decisions.length, 100);
  assert.equal(decisions.every((item) => item.status === "processed" && item.locationId === "roedbar"), true);
  assert.equal(new Set(decisions.map((item) => item.locationDiagnostics?.canonicalKey)).size, 1);
  assert.equal(decisions[0].locationDiagnostics?.incomingNames.length, 1);
});

test("lokationskonflikt stopper live sync eksplicit", () => {
  const duplicateMappings = [
    locationMappings[0],
    { ...locationMappings[0], id: "loc-map-roedbar-duplicate", venueId: "15249", backeventLocationId: "central" },
  ];
  const [decision] = buildSyncDecisions([line()], [approvedMapping], [product], locations, duplicateMappings);

  assert.equal(decision.status, "failed");
  assert.equal(decision.errorReason, "OnlinePOS-lokationsmapping har konflikt");
  assert.equal(decision.locationDiagnostics?.conflictingCandidates.length, 2);
});

test("live sync bruger mappingens forbrugsenhed for Shaker Sport", () => {
  const shaker = {
    id: "shaker",
    name: "Shaker Sport",
    unit: "kasser",
    active: true,
    unitsPerPurchaseUnit: 24,
    stockUnitLabel: "dåse",
    contentPerStockUnit: 1,
    consumptionUnitLabel: "dåser",
  };
  const mapping = {
    ...approvedMapping,
    id: "mapping-shaker",
    onlineposProductId: "shaker-sale",
    onlineposProductName: "Shaker Sport",
    components: [{ backeventInventoryItemId: "shaker", conversionFactor: 1, sortOrder: 0 }],
  };
  const [decision] = buildSyncDecisions([
    line({ onlineposProductId: "shaker-sale", onlineposProductName: "Shaker Sport", quantitySold: 5 }),
  ], [mapping], [shaker], locations, locationMappings);

  assert.equal(decision.components[0].quantity, 5 / 24);
  assert.equal(decision.components[0].consumptionDiagnostics.totalConsumptionQuantity, 5);
  assert.equal(decision.components[0].consumptionDiagnostics.humanReadableDelta, "-5 dåser");
});

test("live sync og replay-beslutning bruger samme Postmix-konvertering", () => {
  const postmix = {
    id: "postmix",
    name: "Postmix",
    unit: "kasser",
    active: true,
    unitsPerPurchaseUnit: 1,
    stockUnitLabel: "sirupskasse",
    contentPerStockUnit: 500,
    consumptionUnitLabel: "cl",
  };
  const mapping = {
    ...approvedMapping,
    id: "mapping-postmix",
    onlineposProductId: "postmix-sale",
    onlineposProductName: "Postmix",
    components: [{ backeventInventoryItemId: "postmix", conversionFactor: 10.5, sortOrder: 0 }],
  };
  const input = [line({ onlineposProductId: "postmix-sale", onlineposProductName: "Postmix", quantitySold: 5 })];
  const liveDecision = buildSyncDecisions(input, [mapping], [postmix], locations, locationMappings)[0];
  const replayDecision = buildSyncDecisions(input, [mapping], [postmix], locations, locationMappings)[0];

  assert.equal(liveDecision.components[0].quantity, 0.105);
  assert.deepEqual(replayDecision.components[0], liveDecision.components[0]);
  assert.equal(liveDecision.components[0].consumptionDiagnostics.humanReadableDelta, "-52,5 cl");
});

test("databasefejl stopper apply sikkert uden at rapportere behandlede linjer", async () => {
  const supabase = {
    from() {
      return {
        insert() {
          return { select: () => ({ single: async () => ({ data: { id: "run-1" }, error: null }) }) };
        },
        update() {
          return { eq: async () => ({ error: null }) };
        },
      };
    },
    async rpc() {
      return { data: null, error: { message: "Simuleret databasefejl" } };
    },
  };
  const safeDecision = buildSyncDecisions([line()], [approvedMapping], [product], locations, locationMappings)[0];
  const result = await applyOnlinePosSyncDecisions({
    supabase,
    datetimeFrom: "2025-07-17T15:00:00Z",
    datetimeTo: "2025-07-17T15:10:00Z",
    actorUserId: "owner",
    actorEmail: "owner@example.com",
    decisions: [safeDecision],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.processedCount, 0);
  assert.equal(result.failedCount, 1);
});
