import { connectorsForWallets, getDefaultConfig, getDefaultWallets, type WalletList } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { arbitrumChain, baseChain, ethereumChain, hyperEvmChain, robinhoodChain, supportedChains } from "./chains";
import { rpcUrls } from "./rpc";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appName = "Onchain Portfolio";

// Endpoints come from NEXT_PUBLIC_RPC_URL_* (see ./rpc.ts), falling back to public defaults.
const transports = {
  [ethereumChain.id]: http(rpcUrls.ethereum),
  [baseChain.id]: http(rpcUrls.base),
  [arbitrumChain.id]: http(rpcUrls.arbitrum),
  [robinhoodChain.id]: http(rpcUrls.robinhood),
  [hyperEvmChain.id]: http(rpcUrls.hyperevm),
} as const;

/**
 * Extra wallet groups for QA builds. The ONLY thing that may enable the E2E mock wallet is the build flag
 * NEXT_PUBLIC_E2E_MOCK_WALLET=1 (or "true"), written inline in the `if` below on purpose: Next.js/webpack replaces
 * `process.env.NEXT_PUBLIC_*` with the literal at build time and then drops the dead branch, including the `require`,
 * so src/e2e/* (and the public Anvil key in it) is not bundled at all when the flag is off. Do not hoist this
 * condition into a helper or a variable, and do not turn the require into a static import: either would keep the
 * connector in every build. `npm run verify:bundle` / CI greps the output to enforce this.
 */
const extraWallets: WalletList = [];
if (process.env.NEXT_PUBLIC_E2E_MOCK_WALLET === "1" || process.env.NEXT_PUBLIC_E2E_MOCK_WALLET === "true") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be a sync, compile-time-removable import
  const { e2eMockWalletGroup } = require("../e2e/mockWallet") as typeof import("../e2e/mockWallet");
  extraWallets.push(e2eMockWalletGroup);
}

/**
 * With a WalletConnect project id: RainbowKit's default wallet list (incl. WalletConnect QR).
 * Without one: injected + Coinbase wallets only, so the app still builds and runs with zero secrets.
 */
export const wagmiConfig = projectId
  ? getDefaultConfig({
      appName,
      projectId,
      chains: supportedChains,
      transports,
      ssr: true,
      ...(extraWallets.length > 0 ? { wallets: [...getDefaultWallets().wallets, ...extraWallets] } : {}),
    })
  : createConfig({
      chains: supportedChains,
      transports,
      ssr: true,
      connectors: connectorsForWallets(
        [{ groupName: "Browser wallets", wallets: [injectedWallet, coinbaseWallet] }, ...extraWallets],
        { appName, projectId: "unset" },
      ),
    });
