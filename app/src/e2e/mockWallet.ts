/**
 * E2E MOCK WALLET (TEST-ONLY). Never import this file statically: it is pulled in solely through the guarded
 * `require` in src/config/wagmi.ts, which webpack drops when NEXT_PUBLIC_E2E_MOCK_WALLET is not "1", so the
 * connector and the public Anvil key never reach a normal build (CI asserts this by grepping the output).
 *
 * A wagmi connector backed by a viem local account (an Anvil default account). It needs no browser extension:
 * signing happens in-page, and every JSON-RPC call (reads and the raw-tx broadcast) goes through the chain's
 * configured wagmi transport, i.e. the NEXT_PUBLIC_RPC_URL_* resolution in src/config/rpc.ts. It supports all
 * chains passed to the wagmi config (all four of the app's chains).
 */
import type { Wallet } from "@rainbow-me/rainbowkit";
import {
  createClient,
  createWalletClient,
  getAddress,
  http,
  hexToBigInt,
  hexToNumber,
  numberToHex,
  SwitchChainError,
  UnsupportedProviderMethodError,
  UserRejectedRequestError,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type SendTransactionParameters,
  type Transport,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { createConnector } from "wagmi";
import { readMockAccountEnv, resolveMockAccount } from "./mockAccount";

export const E2E_MOCK_WALLET_ID = "e2eMockWallet";
export const E2E_MOCK_WALLET_NAME = "E2E Mock Wallet";
const STORAGE_KEY = "e2eMockWallet.connected";

type RpcTx = {
  from?: Hex;
  to?: Hex | null;
  data?: Hex;
  input?: Hex;
  value?: Hex;
  gas?: Hex;
  nonce?: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
};

/** Convert a JSON-RPC (hex-string) transaction request to viem's sendTransaction parameters. */
export function rpcTxToRequest(tx: RpcTx): Omit<SendTransactionParameters, "account" | "chain"> {
  const req: Record<string, unknown> = {};
  if (tx.to) req.to = tx.to;
  const data = tx.data ?? tx.input;
  if (data) req.data = data;
  if (tx.value) req.value = hexToBigInt(tx.value);
  if (tx.gas) req.gas = hexToBigInt(tx.gas);
  if (tx.nonce) req.nonce = hexToNumber(tx.nonce);
  if (tx.gasPrice) req.gasPrice = hexToBigInt(tx.gasPrice);
  if (tx.maxFeePerGas) req.maxFeePerGas = hexToBigInt(tx.maxFeePerGas);
  if (tx.maxPriorityFeePerGas) req.maxPriorityFeePerGas = hexToBigInt(tx.maxPriorityFeePerGas);
  return req as Omit<SendTransactionParameters, "account" | "chain">;
}

export type MockConnectorOptions = {
  /** Signing account. Defaults to the one resolved from NEXT_PUBLIC_E2E_MOCK_* (Anvil #0). */
  account?: PrivateKeyAccount;
};

export function e2eMockConnector(options: MockConnectorOptions = {}) {
  const account = options.account ?? resolveMockAccount(readMockAccountEnv());
  return createConnector((config) => {
    let currentChainId = config.chains[0].id;

    const chainFor = (id: number): Chain => {
      const chain = config.chains.find((c) => c.id === id);
      if (!chain) throw new SwitchChainError(new Error(`Chain ${id} is not configured`));
      return chain;
    };
    // The chain's configured wagmi transport (http(rpcUrls.<chain>) from src/config/wagmi.ts); falls back to the
    // chain definition's own (already NEXT_PUBLIC_RPC_URL_*-resolved) endpoint.
    const transportFor = (chain: Chain): Transport => config.transports?.[chain.id] ?? http(chain.rpcUrls.default.http[0]);

    const makeProvider = (): EIP1193Provider => {
      const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
        const p = (params ?? []) as unknown[];
        const chain = chainFor(currentChainId);
        switch (method) {
          case "eth_chainId":
            return numberToHex(currentChainId);
          case "eth_accounts":
          case "eth_requestAccounts":
            return [account.address];
          case "wallet_switchEthereumChain": {
            const next = hexToNumber((p[0] as { chainId: Hex }).chainId);
            chainFor(next);
            currentChainId = next;
            config.emitter.emit("change", { chainId: next });
            return null;
          }
          case "personal_sign": {
            // params: [message(hex), address]
            const [message, from] = p as [Hex, Hex];
            if (from && getAddress(from) !== account.address) throw new UserRejectedRequestError(new Error("wrong signer"));
            return account.signMessage({ message: { raw: message } });
          }
          case "eth_signTypedData_v4": {
            // params: [address, typedDataJson]
            const [from, json] = p as [Hex, string | object];
            if (from && getAddress(from) !== account.address) throw new UserRejectedRequestError(new Error("wrong signer"));
            const typed = typeof json === "string" ? JSON.parse(json) : json;
            return account.signTypedData(typed);
          }
          case "eth_sendTransaction": {
            const tx = p[0] as RpcTx;
            if (tx.from && getAddress(tx.from) !== account.address) {
              throw new UserRejectedRequestError(new Error("wrong signer"));
            }
            // Fills nonce / gas / fees via the chain transport, signs locally, broadcasts with eth_sendRawTransaction.
            const wallet = createWalletClient({ account, chain, transport: transportFor(chain) });
            return wallet.sendTransaction({ ...rpcTxToRequest(tx), account, chain } as SendTransactionParameters);
          }
          case "wallet_getCapabilities":
          case "wallet_sendCalls":
          case "wallet_getCallsStatus":
          case "wallet_showCallsStatus":
          case "wallet_addEthereumChain":
          case "wallet_watchAsset":
          case "eth_sign":
          case "eth_signTransaction":
            throw new UnsupportedProviderMethodError(new Error(`${method} is not supported by the E2E mock wallet`));
          default: {
            // Everything else (eth_call, eth_getBalance, receipts, ...) is a plain read through the chain transport.
            const client = createClient({ chain, transport: transportFor(chain) });
            return client.request({ method, params } as never);
          }
        }
      };
      return { request, on: () => {}, removeListener: () => {} } as unknown as EIP1193Provider;
    };
    const provider = makeProvider();

    return {
      id: E2E_MOCK_WALLET_ID,
      name: E2E_MOCK_WALLET_NAME,
      type: "e2eMock",
      async setup() {},
      async connect(parameters) {
        const { chainId, withCapabilities } = (parameters ?? {}) as { chainId?: number; withCapabilities?: boolean };
        if (chainId !== undefined && chainId !== currentChainId) await this.switchChain!({ chainId });
        await config.storage?.setItem(STORAGE_KEY, true);
        const accounts = [account.address] as const;
        return {
          accounts: (withCapabilities ? accounts.map((address) => ({ address, capabilities: {} })) : accounts),
          chainId: currentChainId,
        } as never;
      },
      async disconnect() {
        await config.storage?.removeItem(STORAGE_KEY);
      },
      async getAccounts() {
        return [account.address];
      },
      async getChainId() {
        return currentChainId;
      },
      async getProvider() {
        return provider;
      },
      async isAuthorized() {
        return Boolean(await config.storage?.getItem(STORAGE_KEY));
      },
      async switchChain({ chainId }) {
        const chain = chainFor(chainId);
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(chainId) }] });
        return chain;
      },
      onAccountsChanged() {},
      onChainChanged(chain) {
        config.emitter.emit("change", { chainId: Number(chain) });
      },
      onDisconnect() {
        config.emitter.emit("disconnect");
      },
    };
  });
}

const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="#7c3aed"/>' +
      '<text x="32" y="42" font-size="30" font-family="monospace" text-anchor="middle" fill="#fff">E2E</text></svg>',
  );

/** RainbowKit wallet entry: shows up as "E2E Mock Wallet" in the connect modal. */
export const e2eMockWallet = (): Wallet => ({
  id: E2E_MOCK_WALLET_ID,
  name: E2E_MOCK_WALLET_NAME,
  shortName: "E2E Mock",
  iconUrl: ICON,
  iconBackground: "#7c3aed",
  installed: true,
  createConnector: (walletDetails) =>
    createConnector((config) => ({
      ...e2eMockConnector()(config),
      ...walletDetails,
    })),
});

/** Wallet-list group appended to the RainbowKit wallets when the flag is on. */
export const e2eMockWalletGroup = { groupName: "Test only", wallets: [e2eMockWallet] };
