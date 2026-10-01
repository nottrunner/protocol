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

## E2E mock wallet (test-only)

For QA / E2E runs against a local Anvil (fork) with **no wallet extension**. When the build flag is on, RainbowKit's
connect modal gets an **E2E Mock Wallet** option (group "Test only"). It is a wagmi connector backed by a viem local
account: it signs messages, typed data and transactions in the page and broadcasts the raw transaction through the
chain's configured wagmi transport, i.e. the `NEXT_PUBLIC_RPC_URL_*` endpoints from `src/config/rpc.ts`. It can
connect and switch across all four chains (Ethereum, Base, Arbitrum One, Robinhood Chain).

**It never ships to production.** The signing key is Anvil's public account #0 key (and mnemonic), so anything sent to
those addresses on a real chain is stolen immediately. Three layers keep it out of production:

1. **Compiled out by default.** `src/config/wagmi.ts` loads `src/e2e/*` only inside an
   `if (process.env.NEXT_PUBLIC_E2E_MOCK_WALLET === "1" | "true")` block. `next.config.mjs` always defines the variable
   (empty when unset), so webpack folds the condition to `false` and drops the code: no connector, no key in `.next`.
2. **Build guard.** `npm run build` runs `scripts/check-e2e-mock-guard.mjs` (`prebuild`), and `next.config.mjs` runs
   the same check, so the build **fails** if the flag is `1`/`true` while `VERCEL_ENV=production` (or
   `VERCEL_TARGET_ENV=production`), or if the flag has any value other than `1`, `true`, `0`, `false`, or unset.
   Do not set the variable on Vercel's Production environment (Preview is fine for QA).
3. **CI.** `.github/workflows/app-ci.yaml` checks the guard fails for `VERCEL_ENV=production`, builds without the
   flag and greps `.next` to assert the connector name, id, and test key/mnemonic are absent
   (`npm run verify:bundle -- absent`), then builds with the flag and asserts they are present (proves the grep works).

### How QA enables it

```bash
anvil --port 8545 --chain-id 1 [--fork-url "$MAINNET_RPC"]   # one per chain you test; see "Pointing a build at a local fork"

cd app
NEXT_PUBLIC_E2E_MOCK_WALLET=1 \
NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX=1 \
NEXT_PUBLIC_RPC_URL_ETHEREUM=http://127.0.0.1:8545 \
  npm run build && npm start        # or `npm run dev` with the same vars in .env.local
```

- `NEXT_PUBLIC_E2E_MOCK_WALLET=1` (or `true`): turns it on. Rebuild after changing it; it is inlined at build time.
- `NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX` (0-9, default 0): the Anvil default account that signs. Index N is account N in
  `qa/fixtures.json` (`anvilAccounts.accounts[N]`, on branch `feat/deploy-scripts`; addresses only, no keys), derived from
  Anvil's public mnemonic at `m/44'/60'/0'/0/N`: 0 deployer, 1 QA vault manager, 2 depositor A, 3 depositor B.
  `src/e2e/mockAccount.test.ts` pins the index-to-address mapping (and cross-checks `qa/fixtures.json` when present).
- `NEXT_PUBLIC_E2E_MOCK_PRIVATE_KEY` (optional): explicit `0x` key, overrides the index. Test keys only.
- Fund the account on the fork (`anvil_setBalance`, see `qa/fixtures.json` funding steps), click **Connect Wallet**, pick
  **E2E Mock Wallet**. The local node must run with the real chain's id (`--chain-id`, or a fork), because the app's chain
  ids are fixed.
- `eth_sendTransaction` fills nonce/gas/fees from the chain's RPC, signs locally and sends `eth_sendRawTransaction`.
  `wallet_sendCalls` (EIP-5792), `eth_sign`, and `wallet_addEthereumChain` are intentionally unsupported.

Tests: `npm test` runs `src/e2e/mockWallet.test.ts`, which starts four local Anvils (no fork; chain ids 1, 8453, 42161,
4663), connects the connector, switches across all four chains and sends a transaction on each. It is skipped if `anvil` is
not installed (install [Foundry](https://book.getfoundry.sh/); CI does). Other checks: `npm run check:e2e-guard` (the
build guard) and `npm run verify:bundle -- absent|present` (scan `.next`).

## Layout

```
src/app/                 routes: /, /create, /portfolio
src/components/          UI (may only import from '@/lib/contracts'; enforced by ESLint)
src/config/              chains, feature flags, wagmi config, known tokens
src/e2e/                 test-only E2E mock wallet (compiled out unless NEXT_PUBLIC_E2E_MOCK_WALLET=1)
scripts/                 build guard + bundle verification for the mock wallet
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

`.github/workflows/app-ci.yaml` runs lint, typecheck, test and build on changes under `app/`, plus the mock-wallet
guard and bundle checks described above.
