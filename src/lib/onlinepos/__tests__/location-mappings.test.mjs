import assert from "node:assert/strict";
import test from "node:test";
import {
  findSuggestedBackEventLocationId,
  getLocationMappingSuggestion,
  mergeLocationDiscoveries,
  normalizeOnlinePosCashRegisterName,
  resolveOnlinePosLocation,
} from "../location-mappings.ts";
import { hasRoleAtLeast } from "../../backevent/permissions.ts";

const locations = [
  { id: "blaa", name: "Blåbar", type: "bar", source_location_id: "blaa-container", active: true },
  { id: "blaa-container", name: "Blå Container", type: "container", source_location_id: null, active: true },
  { id: "groen", name: "Grønbar", type: "bar", source_location_id: "groen-container", active: true },
  { id: "roed", name: "Rødbar", type: "bar", source_location_id: "roed-container", active: true },
  { id: "pub", name: "Pubben", type: "bar", source_location_id: "pub-container", active: true },
  { id: "street", name: "Street", type: "bar", source_location_id: "street-container", active: true },
  { id: "den-lokale", name: "Den Lokale", type: "bar", source_location_id: "roed-container", active: true },
  { id: "central", name: "Centrallager", type: "container", source_location_id: null, active: true },
];

function mapping(overrides = {}) {
  return {
    id: "mapping-1",
    venueId: "15249",
    cashRegisterId: null,
    cashRegisterName: "Blå bar",
    normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Blå bar"),
    backeventLocationId: "blaa",
    active: true,
    firstSeenAt: null,
    lastSeenAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

test("forslag matcher Blå bar, Grøn Bar, Rød Bar, Pubben og Street", () => {
  assert.equal(findSuggestedBackEventLocationId("Blå bar", locations), "blaa");
  assert.equal(findSuggestedBackEventLocationId("Grøn Bar", locations), "groen");
  assert.equal(findSuggestedBackEventLocationId("Rød Bar", locations), "roed");
  assert.equal(findSuggestedBackEventLocationId("Pubben", locations), "pub");
  assert.equal(findSuggestedBackEventLocationId("Street", locations), "street");
});

test("Beer Bar og Den Lokale får ikke autoforslag", () => {
  assert.equal(getLocationMappingSuggestion("Beer Bar"), null);
  assert.equal(getLocationMappingSuggestion("Den Lokale"), null);
});

test("mappet kasse kan resolve til BackEvent-lokation", () => {
  const result = resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Blå bar" }, [mapping()], locations);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.location.id, "blaa");
  assert.equal(result.ok && result.matchedBy, "name");
});

test("production mappings med null ID resolver på eksakt normaliseret navn", () => {
  const shownMappings = [
    mapping({ id: "mapping-blaa", cashRegisterId: null, cashRegisterName: "Blå bar", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Blå bar"), backeventLocationId: "blaa" }),
    mapping({ id: "mapping-den-lokale", cashRegisterId: null, cashRegisterName: "Den Lokale", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Den Lokale"), backeventLocationId: "den-lokale" }),
    mapping({ id: "mapping-groen", cashRegisterId: null, cashRegisterName: "Grøn Bar", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Grøn Bar"), backeventLocationId: "groen" }),
    mapping({ id: "mapping-pubben", cashRegisterId: null, cashRegisterName: "Pubben", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Pubben"), backeventLocationId: "pub" }),
    mapping({ id: "mapping-roed", cashRegisterId: null, cashRegisterName: "Rød Bar", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Rød Bar"), backeventLocationId: "roed" }),
  ];

  assert.equal(resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Blå bar" }, shownMappings, locations).ok, true);
  assert.equal(resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Den Lokale" }, shownMappings, locations).ok, true);
  assert.equal(resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Grøn Bar" }, shownMappings, locations).ok, true);
  assert.equal(resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Pubben" }, shownMappings, locations).ok, true);
  assert.equal(resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Rød Bar" }, shownMappings, locations).ok, true);
});

test("navnefallback virker når incoming ID mangler selvom gemt mapping har ID", () => {
  const result = resolveOnlinePosLocation(
    { venueId: "15249", cashRegisterId: null, cashRegisterName: "Den Lokale" },
    [mapping({ cashRegisterId: "stored-register", cashRegisterName: "Den Lokale", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Den Lokale"), backeventLocationId: "den-lokale" })],
    locations,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.location.id, "den-lokale");
  assert.equal(result.ok && result.matchedBy, "name");
});

test("navnefallback bruges ikke når begge sider har forskellige ID'er", () => {
  const result = resolveOnlinePosLocation(
    { venueId: "15249", cashRegisterId: "incoming-register", cashRegisterName: "Den Lokale" },
    [mapping({ cashRegisterId: "stored-register", cashRegisterName: "Den Lokale", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Den Lokale"), backeventLocationId: "den-lokale" })],
    locations,
  );
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errorCode, "ONLINEPOS_LOCATION_UNMAPPED");
});

test("Blå bar matcher ikke automatisk Blåbar", () => {
  const result = resolveOnlinePosLocation(
    { venueId: "15249", cashRegisterName: "Blå bar" },
    [mapping({ cashRegisterName: "Blåbar", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Blåbar") })],
    locations,
  );
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errorCode, "ONLINEPOS_LOCATION_UNMAPPED");
});

test("Ejer kan mappe Blå bar eksplicit til BackEvent-lokationen Blåbar", () => {
  const result = resolveOnlinePosLocation(
    { venueId: "15249", cashRegisterName: "Blå bar" },
    [
      mapping({ cashRegisterName: "Blåbar", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Blåbar") }),
      mapping({ id: "mapping-2", cashRegisterName: "Blå bar", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Blå bar") }),
    ],
    locations,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.location.id, "blaa");
  assert.equal(result.ok && result.matchedBy, "name");
});

test("navnefallback kræver ikke venue når gemt mapping mangler venue", () => {
  const result = resolveOnlinePosLocation(
    { venueId: "15249", cashRegisterName: "Blå bar" },
    [mapping({ venueId: null, cashRegisterName: "Blå bar", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Blå bar") })],
    locations,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.location.id, "blaa");
  assert.equal(result.ok && result.matchedBy, "name");
});

test("navnefallback kræver ikke venue når incoming venue er generisk", () => {
  const result = resolveOnlinePosLocation(
    { venueId: "-", cashRegisterName: "Rød Bar" },
    [mapping({ venueId: "15249", cashRegisterName: "Rød Bar", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Rød Bar"), backeventLocationId: "roed" })],
    locations,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.location.id, "roed");
  assert.equal(result.ok && result.matchedBy, "name");
});

test("diagnostics viser incoming name id venue normaliseret navn og kandidater", () => {
  const result = resolveOnlinePosLocation(
    { venueId: "15249", cashRegisterName: "Blå bar" },
    [mapping({ backeventLocationId: null, active: false })],
    locations,
  );
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.diagnostics.incomingName, "Blå bar");
  assert.equal(!result.ok && result.diagnostics.incomingId, null);
  assert.equal(!result.ok && result.diagnostics.venueId, "15249");
  assert.equal(!result.ok && result.diagnostics.normalizedName, normalizeOnlinePosCashRegisterName("Blå bar"));
  assert.equal(!result.ok && result.diagnostics.candidateMappingsLoaded.length, 1);
  assert.equal(!result.ok && result.diagnostics.candidateMappingsLoaded[0].hasBackeventLocation, false);
});

test("historiske discovery-navne gemmes separat når navnet er forskelligt", () => {
  const rows = mergeLocationDiscoveries([
    { venueId: "15249", cashRegisterName: "Blåbar", seenAt: "2025-07-17T15:00:00.000Z" },
    { venueId: "15249", cashRegisterName: "Blå bar", seenAt: "2025-07-17T15:10:00.000Z" },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.normalizedCashRegisterName).sort(), [
    normalizeOnlinePosCashRegisterName("Blå bar"),
    normalizeOnlinePosCashRegisterName("Blåbar"),
  ].sort());
});

test("discovery-rækker uden BackEvent-lokation bruges ikke som godkendt mapping", () => {
  const result = resolveOnlinePosLocation(
    { venueId: "15249", cashRegisterName: "Blå bar" },
    [mapping({ backeventLocationId: null, active: false })],
    locations,
  );
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errorCode, "ONLINEPOS_LOCATION_UNMAPPED");
});

test("Beer Bar uden mapping påvirker ikke lager", () => {
  const result = resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Beer Bar" }, [], locations);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errorCode, "ONLINEPOS_LOCATION_UNMAPPED");
});

test("der er ingen fallback til Centrallager", () => {
  const result = resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Ukendt kasse" }, [], locations);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.location, null);
});

test("ID-match prioriteres over navn og overlever navneændring", () => {
  const result = resolveOnlinePosLocation(
    { venueId: "15249", cashRegisterId: "register-1", cashRegisterName: "Nyt navn" },
    [mapping({ cashRegisterId: "register-1", cashRegisterName: "Gammelt navn", normalizedCashRegisterName: normalizeOnlinePosCashRegisterName("Gammelt navn"), backeventLocationId: "roed" })],
    locations,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.location.id, "roed");
  assert.equal(result.ok && result.matchedBy, "cash_register_id");
});

test("deaktiveret mapping bruges ikke", () => {
  const result = resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Blå bar" }, [mapping({ active: false })], locations);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errorCode, "ONLINEPOS_LOCATION_MAPPING_INACTIVE");
});

test("ukendt BackEvent-lokation giver struktureret fejl", () => {
  const result = resolveOnlinePosLocation({ venueId: "15249", cashRegisterName: "Blå bar" }, [mapping({ backeventLocationId: "missing" })], locations);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errorCode, "BACKEVENT_LOCATION_UNKNOWN");
});

test("kun Ejer har skriveadgang til lokationsmapping", () => {
  assert.equal(hasRoleAtLeast("ejer", "ejer"), true);
  assert.equal(hasRoleAtLeast("ansvarlig", "ejer"), false);
  assert.equal(hasRoleAtLeast("frivillig", "ejer"), false);
});
