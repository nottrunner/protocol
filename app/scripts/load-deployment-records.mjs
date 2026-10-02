// Build-time (Node only) reader for deployments/*.json. Used by next.config.mjs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { selectRecords } from "./deployment-records.mjs";

/**
 * Reads `<dir>/*.json` (non-recursive; subdirectories such as logs/ are skipped) and selects records.
 * A missing directory yields no records (the app then relies on env overrides / shows "not deployed").
 * @param {string} dir
 * @param {{ useFork: boolean, warn?: (msg: string) => void }} opts
 */
export function loadRecordsFromDir(dir, { useFork, warn = () => {} }) {
  if (!existsSync(dir)) return { records: {}, ignored: [] };
  /** @type {{ file: string, raw: unknown }[]} */
  const files = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      files.push({ file, raw: JSON.parse(readFileSync(join(dir, file), "utf8")) });
    } catch (e) {
      warn(`deployments: cannot parse ${file}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const result = selectRecords(files, { useFork });
  for (const i of result.ignored) warn(`deployments: ${i.file}: ${i.reason}`);
  return result;
}
