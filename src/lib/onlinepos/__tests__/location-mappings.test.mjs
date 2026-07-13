import assert from "node:assert/strict";
import test from "node:test";
import {
  findSuggestedBackEventLocationId,
  getLocationMappingSuggestion,
  normalizeOnlinePosCashRegisterName,
  resolveOnlinePosLocation,
} from "../location-mappings.ts";
import { hasRoleAtLeast } from "../../backevent/permissions.ts";

const locations = [
  { id: "blaa", name: "Blå Container", type: "container", source_location_id: null, active: true },
  { id: "groen", name: "Grøn Container", type: "container", source_location_id: null, active: true },
  { id: "roed", name: "Rød Container", type: "container", source_location_id: null, active: true },
  { id: "pub", name: "Pub Container", type: "container", source_location_id: null, active: true },
  { id: "street", name: "Street Container", type: "container", source_location_id: null, active: true },
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
