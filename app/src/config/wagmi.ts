import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { arbitrumChain, baseChain, ethereumChain, robinhoodChain, supportedChains } from "./chains";
import { rpcUrls } from "./rpc";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appName = "Onchain Portfolio";

// Endpoints come from NEXT_PUBLIC_RPC_URL_* (see ./rpc.ts), falling back to public defaults.
const transports = {
  [ethereumChain.id]: http(rpcUrls.ethereum),
  [baseChain.id]: http(rpcUrls.base),
  [arbitrumChain.id]: http(rpcUrls.arbitrum),
  [robinhoodChain.id]: http(rpcUrls.robinhood),
} as const;

/**
 * With a WalletConnect project id: RainbowKit's default wallet list (incl. WalletConnect QR).
 * Without one: injected + Coinbase wallets only, so the app still builds and runs with zero secrets.
 */
export const wagmiConfig = projectId
  ? getDefaultConfig({ appName, projectId, chains: supportedChains, transports, ssr: true })
  : createConfig({
      chains: supportedChains,
      transports,
      ssr: true,
      connectors: connectorsForWallets(
        [{ groupName: "Browser wallets", wallets: [injectedWallet, coinbaseWallet] }],
        { appName, projectId: "unset" },
      ),
    });
