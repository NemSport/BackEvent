import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const removedRuntimePaths = [
  "src/app/admin/emails/page.tsx",
  "src/app/api/admin/emails/send/route.ts",
  "src/app/api/admin/emails/inventory-alert-preview/route.ts",
  "src/lib/backevent/email.ts",
];

test("operational e-mail pages, APIs and provider are removed", () => {
  for (const path of removedRuntimePaths) assert.equal(existsSync(path), false, path);
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.dependencies?.resend, undefined);
});

test("legacy e-mail log is preserved read-only without deleting history", () => {
  const migration = readFileSync("supabase/migrations/202607140003_deprecate_backevent_operational_email.sql", "utf8");
  assert.match(migration, /DEPRECATED/);
  assert.match(migration, /revoke insert, update, delete/i);
  assert.doesNotMatch(migration, /drop table|truncate|delete from/i);
});

test("Supabase Auth e-mail flows remain available", () => {
  const auth = readFileSync("src/lib/backevent/auth.ts", "utf8");
  const members = readFileSync("src/lib/backevent/member-admin.ts", "utf8");
  assert.match(auth, /signInWithPassword/);
  assert.match(auth, /signUpWithPassword/);
  assert.match(members, /inviteUserByEmail/);
});
