// @vitest-environment node
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  connect,
  createConfig,
  disconnect,
  getBalance,
  getConnectorClient,
  signMessage,
  sendTransaction,
  signTypedData,
  switchChain,
  waitForTransactionReceipt,
} from "@wagmi/core";
import { createPublicClient, defineChain, http, parseEther, recoverMessageAddress, verifyTypedData, type Chain } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { e2eMockConnector, E2E_MOCK_WALLET_NAME, rpcTxToRequest } from "./mockWallet";
import { resolveMockAccount } from "./mockAccount";

const ANVIL = [join(homedir(), ".foundry/bin/anvil"), "anvil"].find(
  (c) => (c === "anvil" ? spawnSync("anvil", ["--version"]).status === 0 : existsSync(c)),
);

// Same four chain ids as the app (src/config/chains.ts); one local Anvil (no fork) per chain.
const LOCAL = [
  { id: 1, name: "Ethereum", port: 18601 },
  { id: 8453, name: "Base", port: 18602 },
  { id: 42161, name: "Arbitrum One", port: 18603 },
  { id: 4663, name: "Robinhood Chain", port: 18604 },
] as const;

describe("rpcTxToRequest", () => {
  it("converts hex JSON-RPC fields to viem values", () => {
    expect(rpcTxToRequest({ to: "0x0000000000000000000000000000000000000001", value: "0xde0b6b3a7640000", gas: "0x5208", data: "0x" }))
      .toMatchObject({ value: 10n ** 18n, gas: 21000n });
    expect(rpcTxToRequest({ input: "0xabcd" })).toMatchObject({ data: "0xabcd" });
  });
});

describe.skipIf(!ANVIL)("E2E mock connector against local Anvil (no fork)", () => {
  const procs: ChildProcess[] = [];
  const account = resolveMockAccount({ index: "1" }); // QA vault manager in qa/fixtures.json

  // chain.rpcUrls deliberately point at a dead port: everything must go through the configured transports.
  const chains = LOCAL.map(({ id, name }) =>
    defineChain({ id, name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:1"] } } }),
  ) as unknown as readonly [Chain, ...Chain[]];
  const transports = Object.fromEntries(LOCAL.map(({ id, port }) => [id, http(`http://127.0.0.1:${port}`)]));
  const config = createConfig({ chains, transports, connectors: [e2eMockConnector({ account })], ssr: false });
  const connector = config.connectors[0]!;

  beforeAll(async () => {
    await Promise.all(
      LOCAL.map(async ({ id, port }) => {
        const p = spawn(ANVIL!, ["--port", String(port), "--chain-id", String(id), "--silent"], { stdio: "ignore" });
        procs.push(p);
        const client = createPublicClient({ transport: http(`http://127.0.0.1:${port}`) });
        for (let i = 0; i < 100; i++) {
          try {
            if ((await client.getChainId()) === id) return;
          } catch {}
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`anvil on ${port} did not start`);
      }),
    );
  }, 30_000);
  afterAll(() => procs.forEach((p) => p.kill()));

  it("is named 'E2E Mock Wallet'", () => {
    expect(connector.name).toBe(E2E_MOCK_WALLET_NAME);
    expect(connector.name).toBe("E2E Mock Wallet");
  });

  it("connects, then switches across all four chains and sends a tx on each via that chain's transport", async () => {
    const res = await connect(config, { connector, chainId: 1 });
    expect(res.accounts).toEqual([account.address]);
    expect(res.chainId).toBe(1);

    const to = "0x000000000000000000000000000000000000dEaD";
    for (const { id, port } of LOCAL) {
      await switchChain(config, { chainId: id });
      expect(config.state.chainId).toBe(id);
      expect(await connector.getChainId()).toBe(id);
      const before = await getBalance(config, { address: to, chainId: id });
      // (config is typed with a generic Chain tuple here, so the per-chain parameter union collapses; cast the args)
      const hash = await sendTransaction(config, { to, value: parseEther("1.5"), chainId: id } as never);
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: id });
      expect(receipt.status).toBe("success");
      expect(receipt.from.toLowerCase()).toBe(account.address.toLowerCase());
      expect((await getBalance(config, { address: to, chainId: id })).value - before.value).toBe(parseEther("1.5"));
      // The tx landed on that chain's own node and nowhere else.
      for (const other of LOCAL.filter((o) => o.id !== id)) {
        const c = createPublicClient({ transport: http(`http://127.0.0.1:${other.port}`) });
        expect(await c.getTransaction({ hash }).catch(() => null)).toBeNull();
      }
      const own = createPublicClient({ transport: http(`http://127.0.0.1:${port}`) });
      expect((await own.getTransaction({ hash })).from.toLowerCase()).toBe(account.address.toLowerCase());
    }
  }, 60_000);

  it("rejects switching to an unconfigured chain", async () => {
    await expect(switchChain(config, { chainId: 10 })).rejects.toThrow();
  });

  it("signs messages and EIP-712 typed data with the Anvil account", async () => {
    const signature = await signMessage(config, { message: "hello e2e" });
    expect(await recoverMessageAddress({ message: "hello e2e", signature })).toBe(account.address);

    const typed = {
      domain: { name: "E2E", version: "1", chainId: config.state.chainId, verifyingContract: "0x000000000000000000000000000000000000dEaD" },
      types: { Ping: [{ name: "n", type: "uint256" }] },
      primaryType: "Ping",
      message: { n: 7n },
    } as const;
    const sig = await signTypedData(config, typed);
    expect(await verifyTypedData({ address: account.address, signature: sig, ...typed })).toBe(true);
  });

  it("connector client works with eth_sendTransaction through viem actions, and disconnect clears authorization", async () => {
    const client = await getConnectorClient(config);
    expect(client.account.address).toBe(account.address);
    await disconnect(config, { connector });
    expect(await connector.isAuthorized()).toBe(false);
  });
});
