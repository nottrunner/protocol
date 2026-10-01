// Scans the Next.js build output for the E2E mock wallet markers.
//   node scripts/verify-e2e-mock-bundle.mjs absent   -> exit 1 if any marker is found (production-style build)
//   node scripts/verify-e2e-mock-bundle.mjs present  -> exit 1 if markers are missing (flag build; proves the scan works)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// All values below are PUBLIC test fixtures (Anvil's account #0 key) or the connector's identifiers.
const MARKERS = {
  "wallet display name": "E2E Mock Wallet",
  "wallet id": "e2eMockWallet",
  "Anvil test mnemonic": "test test test test test test test test test test test junk",
  "Anvil account #0 private key": "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
};

const mode = process.argv[2];
if (mode !== "absent" && mode !== "present") {
  console.error("usage: verify-e2e-mock-bundle.mjs <absent|present> [buildDir=.next]");
  process.exit(2);
}
const root = process.argv[3] ?? ".next";

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    // Skip caches (webpack pack cache keeps stale modules from previous builds) and dev-only data.
    if (name === "cache" || name === "trace") continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (s.isFile() && s.size < 50_000_000) out.push(p);
  }
  return out;
}

const files = walk(root);
if (files.length === 0) {
  console.error(`no files under ${root}; did the build run?`);
  process.exit(2);
}
/** @type {Record<string, string[]>} */
const hits = {};
for (const f of files) {
  const text = readFileSync(f, "utf8").toLowerCase();
  for (const [label, needle] of Object.entries(MARKERS)) {
    if (text.includes(needle.toLowerCase())) (hits[label] ??= []).push(f);
  }
}
console.log(`scanned ${files.length} files under ${root}`);
for (const label of Object.keys(MARKERS)) {
  const where = hits[label];
  console.log(`  ${where ? "FOUND  " : "absent "} ${label}${where ? ` (${where.length} files, e.g. ${where[0]})` : ""}`);
}
const foundAny = Object.keys(hits).length > 0;
if (mode === "absent" && foundAny) {
  console.error("FAIL: E2E mock wallet markers leaked into the build output.");
  process.exit(1);
}
if (mode === "present" && !(hits["wallet id"] && hits["wallet display name"])) {
  console.error("FAIL: expected the mock wallet in a flag build but its markers are missing.");
  process.exit(1);
}
console.log(`OK (${mode})`);
