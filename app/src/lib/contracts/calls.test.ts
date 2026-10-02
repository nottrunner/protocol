import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, keccak256, toBytes, toFunctionSelector, zeroAddress, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { fundDeployerAbi } from "./abis";
import { createNewFundArgs, encodeCreateNewFund, parseNewFund } from "./calls";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const FD = "0xd1D84F3bb531f12ab5B348fD8DFCFf1B07FB3446" as const;
const VAULT = "0x1111111111111111111111111111111111111111" as const;
const COMP = "0x2222222222222222222222222222222222222222" as const;

describe("createNewFund encoding", () => {
  it("has the selector of FundDeployer.createNewFund(address,string,string,address,uint256,bytes,bytes)", () => {
    expect(toFunctionSelector("createNewFund(address,string,string,address,uint256,bytes,bytes)")).toBe(
      keccak256(toBytes("createNewFund(address,string,string,address,uint256,bytes,bytes)")).slice(0, 10),
    );
    const data = encodeCreateNewFund({ owner: OWNER, name: "My Fund", symbol: "MYF", denominationAsset: USDC });
    expect(data.slice(0, 10)).toBe(toFunctionSelector("createNewFund(address,string,string,address,uint256,bytes,bytes)"));
  });
  it("round-trips: owner, name, symbol, denomination, timelock 0, empty fee + policy config", () => {
    const data = encodeCreateNewFund({ owner: OWNER, name: "My Fund", symbol: "MYF", denominationAsset: USDC });
    const dec = decodeFunctionData({ abi: fundDeployerAbi, data });
    expect(dec.functionName).toBe("createNewFund");
    expect(dec.args).toEqual([OWNER, "My Fund", "MYF", USDC, BigInt(0), "0x", "0x"]);
  });
  it("passes an explicit timelock", () => {
    expect(createNewFundArgs({ owner: OWNER, name: "n", symbol: "s", denominationAsset: USDC, sharesActionTimelock: BigInt(3600) })[4]).toBe(BigInt(3600));
  });
});

describe("parseNewFund", () => {
  const topics = encodeEventTopics({ abi: fundDeployerAbi, eventName: "NewFundCreated", args: { creator: OWNER } });
  const data = encodeAbiParameters([{ type: "address" }, { type: "address" }], [VAULT, COMP]);
  const log = (address: `0x${string}`) => ({
    address, topics, data, blockHash: null, blockNumber: null, logIndex: null, transactionHash: null, transactionIndex: null, removed: false,
  }) as unknown as Log;
  it("decodes creator, vault and comptroller from the FundDeployer's log", () => {
    expect(parseNewFund([log(FD)], FD)).toEqual({ creator: getAddress(OWNER), vaultProxy: getAddress(VAULT), comptrollerProxy: getAddress(COMP) });
  });
  it("ignores the same event emitted by another contract when a FundDeployer is given", () => {
    expect(parseNewFund([log("0x3333333333333333333333333333333333333333")], FD)).toBeUndefined();
    expect(parseNewFund([log(zeroAddress)])).toBeDefined();
  });
  it("returns undefined without the event", () => {
    expect(parseNewFund([], FD)).toBeUndefined();
  });
});
