import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { arbitrumChain, baseChain, ethereumChain, robinhoodChain, supportedChains } from "./chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appName = "Onchain Portfolio";

const transports = {
  [ethereumChain.id]: http(ethereumChain.rpcUrls.default.http[0]),
  [baseChain.id]: http(baseChain.rpcUrls.default.http[0]),
  [arbitrumChain.id]: http(arbitrumChain.rpcUrls.default.http[0]),
  [robinhoodChain.id]: http(robinhoodChain.rpcUrls.default.http[0]),
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
