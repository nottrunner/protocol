export const CHAIN_IDS_BY_NAME: { readonly ethereum: 1; readonly base: 8453; readonly arbitrum: 42161; readonly robinhood: 4663 };
export type RecordClass = "mainnet" | "fork" | "unlabelled" | "invalid";
export function classifyRecord(raw: unknown): RecordClass;
export function pickShippedFields(raw: Record<string, unknown>): Record<string, unknown>;
export function selectRecords(
  files: { file: string; raw: unknown }[],
  opts: { useFork: boolean },
): { records: Record<string, Record<string, unknown>>; ignored: { file: string; reason: string }[] };
