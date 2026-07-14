import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const productionLike = process.argv.includes("--production") || process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
const fileEnv = loadEnvFiles([".env.local", ".env"]);
const env = { ...fileEnv, ...process.env };

const variables = [
  entry("NEXT_PUBLIC_SUPABASE_URL", "required", "client"),
  entry("NEXT_PUBLIC_SUPABASE_ANON_KEY", "required", "client"),
  entry("SUPABASE_SERVICE_ROLE_KEY", "required", "server"),
  entry("CRON_SECRET", "production", "server"),
  entry("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "production", "client"),
  entry("WEB_PUSH_PRIVATE_KEY", "production", "server"),
  entry("WEB_PUSH_SUBJECT", "production", "server"),
  entry("ONLINEPOS_CLIENT_ID", "production", "server"),
  entry("ONLINEPOS_CLIENT_SECRET", "production", "server"),
  entry("ONLINEPOS_VENUE_ID", "production", "server"),
  entry("ONLINEPOS_CONCERN", "production", "server"),
  entry("ONLINEPOS_BASE_URL", "optional", "server"),
  entry("ONLINEPOS_TOKEN", "optional", "server"),
  entry("ONLINEPOS_FIRMAID", "optional", "server"),
  entry("ONLINEPOS_REPORTS_BASE_URL", "optional", "server"),
  entry("ONLINEPOS_REPORTS_TOKEN", "optional", "server"),
];

const deprecatedAliases = ["ONLINEPOS_CONCERN_ID", "WEB_PUSH_PUBLIC_KEY", "NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY"];
const forbiddenPublicSecrets = ["NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_WEB_PUSH_PRIVATE_KEY", "NEXT_PUBLIC_CRON_SECRET", "NEXT_PUBLIC_ONLINEPOS_CLIENT_SECRET", "NEXT_PUBLIC_ONLINEPOS_TOKEN", "NEXT_PUBLIC_ONLINEPOS_REPORTS_TOKEN"];
let failed = false;

console.log(`BackEvent preflight (${productionLike ? "production" : "local"})`);
for (const variable of variables) {
  const found = hasValue(env[variable.name]);
  const requiredNow = variable.requirement === "required" || (variable.requirement === "production" && productionLike);
  const status = found ? "fundet" : requiredNow ? "mangler" : "valgfri";
  console.log(`${variable.name}: ${status} (${variable.scope})`);
  if (!found && requiredNow) failed = true;
}

for (const name of deprecatedAliases) {
  if (hasValue(env[name])) {
    console.warn(`${name}: deprecated alias; brug canonical navn`);
    failed = true;
  }
}

for (const name of forbiddenPublicSecrets) {
  if (hasValue(env[name])) {
    console.error(`${name}: ugyldig public secret`);
    failed = true;
  }
}

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
if (typeof packageJson.scripts?.build !== "string" || !packageJson.scripts.build.trim()) {
  console.error("npm build: mangler");
  failed = true;
} else {
  console.log("npm build: fundet");
}

const runtimeFiles = collectSourceFiles(resolve("src"));
for (const path of runtimeFiles) {
  const source = readFileSync(path, "utf8");
  for (const alias of deprecatedAliases) {
    if (source.includes(alias)) {
      console.error(`${alias}: deprecated alias bruges i runtime`);
      failed = true;
    }
  }
  if (/^\s*["']use client["'];/m.test(source) && /WEB_PUSH_PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET|ONLINEPOS_CLIENT_SECRET/.test(source)) {
    console.error(`${path.replace(resolve(".") + "\\", "")}: server-secret refereres fra klientmodul`);
    failed = true;
  }
}

const subject = env.WEB_PUSH_SUBJECT;
if (hasValue(subject) && !/^mailto:|^https:/i.test(subject)) {
  console.error("WEB_PUSH_SUBJECT: skal starte med mailto: eller https:");
  failed = true;
}

if (failed) {
  console.error("Preflight fejlede. Ingen secretværdier er udskrevet.");
  process.exitCode = 1;
} else {
  console.log("Preflight bestået. Ingen secretværdier er udskrevet.");
}

function entry(name, requirement, scope) { return { name, requirement, scope }; }
function hasValue(value) { return typeof value === "string" && value.trim().length > 0; }
function loadEnvFiles(files) {
  const result = {};
  for (const file of files) {
    const path = resolve(file);
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const name = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      result[name] = value;
    }
  }
  return result;
}
function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}
