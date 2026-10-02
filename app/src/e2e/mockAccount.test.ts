import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mnemonicToAccount } from "viem/accounts";
import { ANVIL_ACCOUNT_0_PRIVATE_KEY, ANVIL_TEST_MNEMONIC, resolveMockAccount } from "./mockAccount";

// Anvil default accounts 0-9 (public). Same list as qa/fixtures.json -> anvilAccounts.accounts on feat/deploy-scripts.
const ANVIL_ADDRESSES = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
] as const;

describe("resolveMockAccount", () => {
  it("the hard-coded account #0 key is the one derived from Anvil's public mnemonic", () => {
    const hd = mnemonicToAccount(ANVIL_TEST_MNEMONIC).getHdKey().privateKey!;
    expect(ANVIL_ACCOUNT_0_PRIVATE_KEY).toBe(`0x${Buffer.from(hd).toString("hex")}`);
  });
  it("defaults to Anvil account #0", () => {
    expect(resolveMockAccount().address).toBe(ANVIL_ADDRESSES[0]);
    expect(resolveMockAccount({ index: "", privateKey: "  " }).address).toBe(ANVIL_ADDRESSES[0]);
  });
  it("maps NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX N to Anvil account N (qa/fixtures.json index N)", () => {
    ANVIL_ADDRESSES.forEach((addr, i) => expect(resolveMockAccount({ index: String(i) }).address).toBe(addr));
  });
  it("an explicit private key wins over the index", () => {
    expect(resolveMockAccount({ index: "3", privateKey: ANVIL_ACCOUNT_0_PRIVATE_KEY }).address).toBe(ANVIL_ADDRESSES[0]);
  });
  it("rejects malformed values, naming the env var", () => {
    expect(() => resolveMockAccount({ index: "10" })).toThrow("NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX");
    expect(() => resolveMockAccount({ index: "-1" })).toThrow("NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX");
    expect(() => resolveMockAccount({ index: "abc" })).toThrow("NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX");
    expect(() => resolveMockAccount({ privateKey: "0x1234" })).toThrow("NEXT_PUBLIC_E2E_MOCK_PRIVATE_KEY");
    expect(() => resolveMockAccount({ privateKey: "ac09" + "0".repeat(60) })).toThrow("NEXT_PUBLIC_E2E_MOCK_PRIVATE_KEY");
  });
  it("matches qa/fixtures.json when that file is present (it lives on feat/deploy-scripts)", () => {
    let fixtures: { anvilAccounts: { accounts: { index: number; address: string }[] } };
    try {
      fixtures = JSON.parse(readFileSync(new URL("../../../qa/fixtures.json", import.meta.url), "utf8"));
    } catch {
      return; // not on this branch yet; the hard-coded list above is the same data
    }
    for (const { index, address } of fixtures.anvilAccounts.accounts) {
      expect(resolveMockAccount({ index: String(index) }).address).toBe(address);
    }
  });
});
