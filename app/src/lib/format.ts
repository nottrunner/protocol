import { formatUnits, parseUnits } from "viem";

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Returns undefined when the input is empty/invalid or has too many decimals. */
export function safeParseUnits(value: string, decimals: number): bigint | undefined {
  const v = value.trim();
  if (!/^\d*\.?\d+$|^\d+\.?$/.test(v)) return undefined;
  const [, frac = ""] = v.split(".");
  if (frac.length > decimals) return undefined;
  try {
    return parseUnits(v, decimals);
  } catch {
    return undefined;
  }
}

export function formatAmount(value: bigint | undefined, decimals: number, maxFrac = 6): string {
  if (value === undefined) return "-";
  const s = formatUnits(value, decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : (i ?? "0");
}
