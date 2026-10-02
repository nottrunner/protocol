// Scans the Next.js build output for fork-deployment markers (the FundDeployer / ValueInterpreter addresses of the fork
// records in the given directory).
//   node scripts/verify-fork-deployments-bundle.mjs absent  <dir-with-fork-records> [buildDir=.next]  -> exit 1 if found
//   node scripts/verify-fork-deployments-bundle.mjs present <dir-with-fork-records> [buildDir=.next]  -> exit 1 if missing
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const mode = process.argv[2];
const recordsDir = process.argv[3];
const root = process.argv[4] ?? ".next";
if ((mode !== "absent" && mode !== "present") || !recordsDir) {
  console.error("usage: verify-fork-deployments-bundle.mjs <absent|present> <records-dir> [buildDir=.next]");
  process.exit(2);
}

/** Markers: every address in each record's `addresses` (lowercased). */
const markers = new Map();
for (const f of readdirSync(recordsDir).filter((n) => n.endsWith(".json"))) {
  const rec = JSON.parse(readFileSync(join(recordsDir, f), "utf8"));
  for (const [k, v] of Object.entries(rec.addresses ?? {})) {
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) markers.set(v.toLowerCase(), `${f}:${k}`);
  }
}
if (markers.size === 0) {
  console.error(`no addresses found in ${recordsDir}`);
  process.exit(2);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "cache" || name === "trace") continue; // webpack pack cache keeps stale modules from earlier builds
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
const hits = new Map();
// The flag's own name must not appear as a string literal in a default bundle either (the flag read itself is inlined
// by Next via next.config `env`, so only a stray literal, e.g. in a diagnostic message, could leak it). Checked in the
// client output (.next/static, served to browsers) only: server-side files such as required-server-files.json legitimately
// echo next.config's `env` keys and are never sent to the client.
const FLAG_NAME = "use_fork_deployments";
let flagLiteralFiles = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8").toLowerCase();
  if (f.split(sep).includes("static") && text.includes(FLAG_NAME)) flagLiteralFiles++;
  for (const [addr, label] of markers) if (text.includes(addr)) hits.set(label, (hits.get(label) ?? 0) + 1);
}
console.log(`scanned ${files.length} files under ${root}; ${markers.size} fork-record addresses checked`);
console.log(`  ${hits.size} of ${markers.size} markers found`);
if (mode === "absent") console.log(`  flag name literal (USE_FORK_DEPLOYMENTS) found in ${flagLiteralFiles} client files (.next/static)`);
if (mode === "absent" && flagLiteralFiles > 0) {
  console.error("FAIL: the string USE_FORK_DEPLOYMENTS is present in the client bundle (.next/static) of a default build.");
  process.exit(1);
}
if (mode === "absent" && hits.size > 0) {
  console.error(`FAIL: fork deployment data leaked into the build: ${[...hits.keys()].slice(0, 5).join(", ")} ...`);
  process.exit(1);
}
if (mode === "present" && hits.size === 0) {
  console.error("FAIL: expected fork records in a flag build but no marker was found.");
  process.exit(1);
}
console.log(`OK (${mode})`);
