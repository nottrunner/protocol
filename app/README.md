# Onchain Portfolio app

Next.js (App Router, TypeScript) + wagmi + viem + RainbowKit front end for creating and managing portfolio
vaults (Enzyme-fork contracts in this repo) on:

| Chain | ID | Create | Deposit / redeem | Swap |
|---|---|---|---|---|
| Ethereum | 1 | yes | yes | yes |
| Base | 8453 | yes | yes | yes (not via the Uniswap v3 adapter, see below) |
| Arbitrum One | 42161 | yes | yes | yes |
| Robinhood Chain | 4663 | yes | yes | **hidden / disabled** (phase 1) |

Flags live in `src/config/features.ts`. Rationale: Robinhood Chain has no Enzyme deployment yet, and the repo's
`UniswapV3Adapter` targets the original SwapRouter, not SwapRouter02 (used on Base and Robinhood Chain).

> **Status: scaffold.** The UI is complete, but **no deployed contract addresses are configured** (none were invented).
> Until they are set, Create shows "protocol not deployed" and write actions are disabled. The read-only portfolio
> view works for any vault address.

## Setup

```bash
cd app
cp .env.example .env.local   # optional; no secrets are required to run
npm ci
npm run dev                  # http://localhost:3000
```

Scripts: `npm run lint`, `npm run typecheck`, `npm test` (vitest), `npm run build`. Requires Node >= 20.

## Configuration

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: optional. Without it only injected + Coinbase wallets are offered.
- `NEXT_PUBLIC_RPC_URL_{ETHEREUM,BASE,ROBINHOOD,ARBITRUM}`: optional per-chain RPC overrides. Defaults are public
  endpoints (`ethereum-rpc.publicnode.com`, `mainnet.base.org`, `rpc.mainnet.chain.robinhood.com`,
  `arb1.arbitrum.io/rpc`) that are rate-limited; use a dedicated provider in production. Unset or empty means
  "use the default". Resolution lives in `src/config/rpc.ts` and feeds both the chain definitions and the wagmi
  transports. See `.env.example`.
- `NEXT_PUBLIC_FUND_DEPLOYER_{ETHEREUM,BASE,ARBITRUM,ROBINHOOD}`: FundDeployer address per chain.

Everything `NEXT_PUBLIC_*` is shipped to the browser. Never put secrets in them.

Robinhood Chain is defined with `defineChain` in `src/config/chains.ts`: id 4663, ETH gas token, RPC
`https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com` (per
docs.robinhood.com; `eth_chainId` on the RPC returns 0x1237).

### Pointing a build at a local fork

To run the app against a local [Anvil](https://book.getfoundry.sh/anvil/) fork (e.g. for QA), set the RPC var for
the chain you are forking; no code changes are needed. Chain IDs are unchanged, so fork with the real chain's ID
(Anvil's `--fork-url` keeps it).

```bash
anvil --fork-url "$MAINNET_RPC" --port 8545        # in another terminal

cd app
NEXT_PUBLIC_RPC_URL_ETHEREUM=http://127.0.0.1:8545 npm run dev
# or put it in .env.local; for a production build:
NEXT_PUBLIC_RPC_URL_ETHEREUM=http://127.0.0.1:8545 npm run build && npm start
```

Notes:

- Use the matching var per chain (`..._BASE`, `..._ROBINHOOD`, `..._ARBITRUM`); chains left unset keep their public
  defaults. Fork several chains on different ports (8545, 8546, ...) and set each var.
- `NEXT_PUBLIC_*` values are inlined at **build** time: restart `npm run dev` / rebuild after changing them.
- Values must be `http(s)` URLs; an invalid value throws on startup. Blank is treated as unset.
- The URL is requested from the **browser**, so `127.0.0.1` means the machine running the browser. Your wallet must
  also use the fork as its RPC for that chain (the app reads through its own transport, but wallet sends go through
  the wallet's network RPC).

## Layout

```
src/app/                 routes: /, /create, /portfolio
src/components/          UI (may only import from '@/lib/contracts'; enforced by ESLint)
src/config/              chains, feature flags, wagmi config, known tokens
src/lib/contracts/       isolated contracts layer: abis.ts, addresses.ts, hooks.ts, index.ts
```

### Contracts layer

All chain interaction goes through `src/lib/contracts/` (`useCreatePortfolio`, `useVault`, `useDeposit`, `useRedeem`, ...).
Addresses are in `addresses.ts`: `null` until known, with `TODO(addresses)` markers. Other open TODOs: fee/policy
config encoding on create, NAV / share price display, slippage (`minShares`), portfolio listing (needs an indexer or a
`NewFundCreated` log scan), swap UI. ABIs are minimal and derived from `contracts/release/core/**` and
`contracts/persistent/vault/**`; re-check them against the release you deploy.

## Deploying on Vercel

1. Import `nottrunner/protocol` in Vercel and set **Root Directory = `app`**. The Next.js preset is auto-detected and
   `app/vercel.json` pins `npm ci` / `npm run build`.
2. Add the env vars above (all optional).

## CI

`.github/workflows/app-ci.yaml` runs lint, typecheck, test and build on changes under `app/`.
