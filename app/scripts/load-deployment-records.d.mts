export function loadRecordsFromDir(
  dir: string,
  opts: { useFork: boolean; warn?: (msg: string) => void },
): { records: Record<string, Record<string, unknown>>; ignored: { file: string; reason: string }[] };
