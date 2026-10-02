// Classification + selection of deployments/<chain>.json records (written by script/DeployCore.s.sol, PR #3).
// Pure and dependency-free so it is shared by next.config.mjs (build time, Node) and the app's typed loader
// (src/lib/deployments). It decides which records may be embedded in the bundle. No Node imports here (browser-safe);
// directory reading lives in load-deployment-records.mjs.
/** Chains the app knows, by deployments/<name>.json file name. */
export const CHAIN_IDS_BY_NAME = { ethereum: 1, base: 8453, arbitrum: 42161, robinhood: 4663 };

/**
 * Where a record comes from:
 *  - "mainnet": explicitly labelled `mainnet: true` + `kind: "mainnet broadcast"` (real, approved broadcast).
 *  - "fork":    explicitly labelled a fork run (`mainnet: false` / `kind` "fork, not mainnet" / `runKind: "fork"`).
 *  - "unlabelled": no explicit `mainnet: true` (e.g. early QA records with `label: "REAL BROADCAST DEPLOYMENT"` that were
 *    in fact written by a broadcast against a local fork). Fail closed: treated like "fork".
 * Anything contradictory (claims mainnet but also has a forkBlock / fork label) is "fork".
 * @param {unknown} raw
 * @returns {"mainnet" | "fork" | "unlabelled" | "invalid"}
 */
export function classifyRecord(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (typeof r.chainId !== "number" || r.addresses === null || typeof r.addresses !== "object") return "invalid";
  const kind = typeof r.kind === "string" ? r.kind.toLowerCase() : "";
  const label = typeof r.label === "string" ? r.label.toLowerCase() : "";
  const looksFork =
    r.mainnet === false ||
    kind.startsWith("fork") ||
    r.runKind === "fork" ||
    label.includes("fork") ||
    (typeof r.forkBlock === "number" && r.forkBlock > 0);
  if (looksFork) return "fork";
  if (r.mainnet === true && kind.startsWith("mainnet") && r.runKind === "broadcast") return "mainnet";
  return "unlabelled";
}

/** Fields that are safe and useful to ship to the browser (no log paths, hashes of local files, etc.). */
const KEEP = [
  "chain", "chainId", "kind", "mainnet", "label", "runKind", "forkBlock", "deployBlock", "blockNumberAtDeploy",
  "evmBlockNumberAtDeploy", "approvedAdaptersListId", "blockTimestampAtDeploy", "scriptCommit", "chainlinkStaleRateThresholdSeconds", "addresses", "denominationAsset",
  "denominationAssets", "adapters", "externalContracts",
];

/** @param {Record<string, unknown>} raw */
export function pickShippedFields(raw) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of KEEP) if (raw[k] !== undefined) out[k] = raw[k];
  return out;
}

/**
 * @param {{ file: string, raw: unknown }[]} files parsed JSON per file (`file` = base name, e.g. "base.json")
 * @param {{ useFork: boolean }} opts
 * @returns {{ records: Record<string, Record<string, unknown>>, ignored: { file: string, reason: string }[] }}
 *   records keyed by chain id (as string, JSON-friendly)
 */
export function selectRecords(files, { useFork }) {
  /** @type {Record<string, Record<string, unknown>>} */
  const records = {};
  /** @type {{ file: string, reason: string }[]} */
  const ignored = [];
  for (const { file, raw } of files) {
    const cls = classifyRecord(raw);
    if (cls === "invalid") {
      ignored.push({ file, reason: "not a deployment record (missing chainId/addresses)" });
      continue;
    }
    const r = /** @type {Record<string, unknown>} */ (raw);
    const name = file.replace(/\.json$/, "");
    const expected = /** @type {Record<string, number>} */ (CHAIN_IDS_BY_NAME)[name];
    if (expected === undefined) {
      ignored.push({ file, reason: `unknown chain name "${name}"` });
      continue;
    }
    if (r.chainId !== expected || (typeof r.chain === "string" && r.chain !== name)) {
      ignored.push({ file, reason: `chain/chainId (${String(r.chain)}/${String(r.chainId)}) does not match file name` });
      continue;
    }
    if (cls !== "mainnet" && !useFork) {
      ignored.push({ file, reason: `${cls} record ignored (set NEXT_PUBLIC_USE_FORK_DEPLOYMENTS=1 for QA builds)` });
      continue;
    }
    records[String(expected)] = pickShippedFields(r);
  }
  return { records, ignored };
}
