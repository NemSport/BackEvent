import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyMemberGroupCreate,
  applyMemberGroupMembers,
  canCreateMemberGroup,
  countFinanceGroups,
  financeGroupName,
  needsFinanceGroupSeed,
} from "../member-groups-core.ts";

test("Ejer kan oprette gruppe", () => {
  assert.equal(canCreateMemberGroup("ejer"), true);
  assert.equal(canCreateMemberGroup("admin"), true);
});

test("gruppen gemmes og vises efter refetch", () => {
  const state = applyMemberGroupCreate([], [], {
    id: "group-1",
    name: "Barchefer",
    description: "Holdet ved barerne",
    active: true,
    memberIds: [],
    now: "2026-07-11T10:00:00Z",
  });
  const refetched = [...state.groups];

  assert.equal(refetched.length, 1);
  assert.equal(refetched[0].name, "Barchefer");
});

test("Ejer kan tilføje medlem til gruppe", () => {
  const memberships = applyMemberGroupMembers([], "group-1", ["member-1", "member-1", "member-2"], "2026-07-11T10:00:00Z");

  assert.equal(memberships.length, 2);
  assert.deepEqual(memberships.map((membership) => membership.profileId).sort(), ["member-1", "member-2"]);
});

test("Økonomiansvarlige findes kun én gang og seed påvirker ikke eksisterende grupper", () => {
  const existing = [
    { id: "group-a", name: "Barchefer", description: null, active: true },
    { id: "group-b", name: financeGroupName, description: null, active: true },
  ];

  assert.equal(needsFinanceGroupSeed(existing), false);
  assert.equal(countFinanceGroups(existing), 1);
  assert.equal(existing[0].name, "Barchefer");
});

test("Økonomiansvarlige seed oprettes kun hvis den mangler", () => {
  assert.equal(needsFinanceGroupSeed([{ name: "Lagerhold" }]), true);
  assert.equal(needsFinanceGroupSeed([{ name: "økonomiansvarlige" }]), false);
});

test("Ansvarlig, Frivillig og Økonomiansvarlig alene kan ikke oprette gruppe", () => {
  assert.equal(canCreateMemberGroup("ansvarlig"), false);
  assert.equal(canCreateMemberGroup("frivillig"), false);
  assert.equal(canCreateMemberGroup("økonomiansvarlig"), false);
});

test("RLS afviser uautoriseret insert og tillader kun Ejer", () => {
  const migration = readFileSync("supabase/migrations/202607110005_backevent_member_group_regression_fix.sql", "utf8");

  assert.match(migration, /for insert to authenticated/);
  assert.match(migration, /with check \(public\.backevent_is_owner\(\)\)/);
  assert.doesNotMatch(migration, /backevent_is_finance_responsible\(\).*insert/s);
});
