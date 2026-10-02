# Onchain Portfolio app

Next.js (App Router, TypeScript) + wagmi + viem + RainbowKit front end for creating and managing portfolio
vaults (Enzyme-fork contracts in this repo) on:

| Chain | ID | Create | Deposit / redeem | Swap |
|---|---|---|---|---|
| Ethereum | 1 | yes | yes | yes |
| Base | 8453 | yes | yes | yes (not via the Uniswap v3 adapter, see below) |
| Arbitrum One | 42161 | yes | yes | yes |
| Robinhood Chain | 4663 | yes | yes | **hidden / disabled** (phase 1) |
| HyperEVM | 999 | yes | yes | **hidden / disabled** (phase 1; USDC denomination, swaps are phase 2) |

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
- `NEXT_PUBLIC_RPC_URL_{ETHEREUM,BASE,ROBINHOOD,ARBITRUM,HYPEREVM}`: optional per-chain RPC overrides. Defaults are public
  endpoints (`ethereum-rpc.publicnode.com`, `mainnet.base.org`, `rpc.mainnet.chain.robinhood.com`,
  `arb1.arbitrum.io/rpc`, `rpc.hyperliquid.xyz/evm`) that are rate-limited; use a dedicated provider in production. Unset or empty means
  "use the default". Resolution lives in `src/config/rpc.ts` and feeds both the chain definitions and the wagmi
  transports. See `.env.example`.
- Deployment addresses: see [Deployment addresses](#deployment-addresses) below (`deployments/<chain>.json` records +
  `NEXT_PUBLIC_FUND_DEPLOYER_<CHAIN>` and related overrides, `NEXT_PUBLIC_USE_FORK_DEPLOYMENTS`).

Everything `NEXT_PUBLIC_*` is shipped to the browser. Never put secrets in them.

Robinhood Chain is defined with `defineChain` in `src/config/chains.ts`: id 4663, ETH gas token, RPC
`https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com` (per
docs.robinhood.com; `eth_chainId` on the RPC returns 0x1237).

HyperEVM is defined the same way: id 999, native token **HYPE** (18 decimals), RPC `https://rpc.hyperliquid.xyz/evm` (read-only public
endpoint; `eth_chainId` returns 0x3e7), explorer `https://hyperevmscan.io`. Known tokens: Circle-native USDC
`0xb88339CB7199b77E23DB6E890353E22632Ba630f` (denomination asset) and Wrapped HYPE. Fork it with `--chain-id 999 --gas-limit 30000000`
(see `qa/fixtures.json`).

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

- Use the matching var per chain (`..._BASE`, `..._ROBINHOOD`, `..._ARBITRUM`, `..._HYPEREVM`); chains left unset keep their public
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
connect and switch across all five chains (Ethereum, Base, Arbitrum One, Robinhood Chain, HyperEVM).

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

## Deployment addresses

No contract address is hardcoded in the app. Per chain, `src/lib/deployments` resolves a typed `ChainDeployment` from:

1. **`deployments/<chain>.json`** in the repo root (`ethereum|base|arbitrum|robinhood`, and `hyperliquid` for HyperEVM, chain id 999; written by `script/DeployCore.s.sol`
   on branch `feat/deploy-scripts`, PR #3). They are read by `next.config.mjs` **at build time** and inlined; the directory can be
   changed with the build-time-only `DEPLOYMENTS_DIR`. Missing directory = no records. (On Vercel, Root Directory = `app`
   must allow source files outside the root, which is Vercel's default.)
2. **Env overrides** (always win, no flag needed): `NEXT_PUBLIC_FUND_DEPLOYER_<CHAIN>` plus optional
   `NEXT_PUBLIC_VALUE_INTERPRETER_<CHAIN>`, `..._FUND_VALUE_CALCULATOR_ROUTER_<CHAIN>`, `..._DEPLOY_BLOCK_<CHAIN>`,
   `..._DENOMINATION_ASSETS_<CHAIN>` (`USDC:0x..,USDG:0x..`), `..._UNISWAP_V3_ADAPTER_<CHAIN>`,
   `..._UNISWAP_V3_SWAPROUTER02_ADAPTER_<CHAIN>`, `..._PARASWAP_V6_ADAPTER_<CHAIN>` (`<CHAIN>` also accepts `HYPEREVM`), `..._UNISWAP_V3_QUOTER_<CHAIN>`. If the FundDeployer override differs from the
   record's `fundDeployer`, the record is **superseded** for that chain (its other addresses are not mixed in); the app
   then discovers the rest on-chain (ValueInterpreter and IntegrationManager from the vault's ComptrollerLib).

**Fork records are not used by default.** A record is "mainnet" only if it says `"mainnet": true`, `"kind": "mainnet broadcast"`,
`"runKind": "broadcast"` and carries no fork marker (`forkBlock > 0`, a "fork" label...). Records with `"mainnet": false` /
`"kind": "fork, not mainnet"`, and **unlabelled** ones (e.g. early QA records that say `REAL BROADCAST DEPLOYMENT` but were
broadcast to a local fork) are dropped at build time unless `NEXT_PUBLIC_USE_FORK_DEPLOYMENTS=1` (or `true`). Without the flag the
fork addresses are not in the bundle at all (CI proves it with `npm run verify:fork-bundle`), and the chain shows
**"Protocol not deployed on <chain>"**. With the flag, a "FORK DEPLOYMENT RECORDS" banner is shown on every page.

Like the mock wallet, the flag is guarded: `npm run build` **fails** if it is `1`/`true` while `VERCEL_ENV=production` or
`VERCEL_TARGET_ENV=production`, or if it has any value other than `1|true|0|false|unset` (`scripts/fork-deployments-guard.mjs`,
run by `prebuild` and again from `next.config.mjs`; tested in `scripts/fork-deployments-guard.test.ts`). Setting
`NEXT_PUBLIC_FUND_DEPLOYER_<CHAIN>` is a separate explicit opt-in and is not blocked.

Record fields used (shape of `script/DeployCore.s.sol` on `feat/deploy-scripts` / `feat/register-adapters`, PR #8):

```jsonc
{
  "chain": "base", "chainId": 8453,
  "kind": "fork, not mainnet", "mainnet": false, "runKind": "fork", "forkBlock": 52072367,
  "blockNumberAtDeploy": 52072400,                  // Solidity block.number (L1 number on Arbitrum / Robinhood!)
  "evmBlockNumberAtDeploy": 52072400,               // optional, chain-native
  "denominationAsset": { "symbol": "USDC", "address": "0x..." },
  "approvedAdaptersListId": 1,                      // AddressListRegistry list of the registered swap adapters
  "addresses": {
    "fundDeployer": "0x...", "valueInterpreter": "0x...", "fundValueCalculatorRouter": "0x...",
    "uniswapV3Adapter": "0x...",                    // Ethereum, Arbitrum (original SwapRouter)
    "uniswapV3SwapRouter02Adapter": "0x...",        // Base only (PR #4 adapter)
    "paraSwapV6Adapter": "0x..."                    // Ethereum, Base, Arbitrum
  }
}
```

Optional extras handled when present: `deployBlock` (chain-native block of the FundDeployer deployment, needed for real records on
Arbitrum/Robinhood), `denominationAssets` (list), `externalContracts.uniswapV3QuoterV2`. `blockNumberAtDeploy` is never used as a
log-scan start on Orbit chains; fork records use `forkBlock`; otherwise scans use a bounded look-back.

## Portfolio flows (what the app does)

| Route | Flow | AC |
| --- | --- | --- |
| header network switcher + RainbowKit | connect / switch network (wallet follows the URL chain via a "Switch wallet to X" button) | AC-1 |
| `/create` | create a portfolio (`FundDeployer.createNewFund`): name, symbol, denomination asset from the chain's allowed list (checked against `ValueInterpreter.isSupportedPrimitiveAsset`), owner = connected wallet, no fees/policies; shows vault + comptroller | AC-2 |
| `/portfolio/<chain>/<vault>` | view (name, symbol, owner, denomination, shares, share price, NAV/GAV, holdings with value), **deposit** (approve + `buyShares` with a `minSharesQuantity` slippage bound), **redeem** (in kind, or into the denomination asset only), **swap** (owner / asset manager) | AC-3, AC-5, AC-4, AC-6 |
| `/portfolio` | "My portfolios": `NewFundCreated` log scan (adaptive chunking, starts at the record's block) for vaults **created by** the connected account + vaults remembered in this browser + paste-an-address fallback | AC-6 |

Everything is addressed by URL (`/portfolio/ethereum|base|arbitrum|robinhood/0xVault`), so reload / deep links work (AC-6).

**Swap routes (AC-4).** The swap card exists only where the chain's record lists at least one eligible adapter, and always shows
the route (adapter) selector: Ethereum / Arbitrum offer `UniswapV3Adapter` (default) and `ParaSwapV6Adapter`; Base offers
`UniswapV3SwapRouter02Adapter` (default) and `ParaSwapV6Adapter` (the original-router adapter is never offered on Base); Robinhood
has none, so it shows "Swaps not enabled on this chain" (`data-testid="swap-disabled"`). Uniswap quotes come from QuoterV2
(direct fee tiers + WETH 2-hop); ParaSwap quotes/calldata come from the public Velora API (`api.paraswap.io`, `swapExactAmountIn`
only, needs internet) and are re-encoded for the adapter. The swap runs through
`Comptroller.callOnExtension(IntegrationManager, 0, abi.encode(adapter, selector, data))` after a pre-send simulation. The result
states which adapter executed (read from the `CallOnIntegrationExecutedForFund` event), for QA:
`data-testid` `swap-route` (selector), `swap-route-adapter`, `swap-result`, `swap-result-route` (+`data-route-kind` =
`uniswapV3 | uniswapV3SwapRouter02 | paraSwapV6`), `swap-result-adapter` (address), `swap-result-spent`, `swap-result-received`.
Swap needs a displayed quote (press "Get quote" first); on Swap the app re-quotes, and if the new quote is worse than the displayed one by more than the slippage setting it sends nothing and shows the new quote. ParaSwap `minOut` is checked client-side to be at least `expectedOut * (1 - slippage)`.
If a ParaSwap route reverts in simulation (e.g. a market maker whose quote is stale on a local fork) the app re-quotes without that
liquidity source (twice at most) and says so (`swap-reroute-note`).

## QA: run the exact SHA against local Anvil forks (mock wallet, fork records)

```bash
# Exact SHA of the app:
git clone https://github.com/nottrunner/protocol && cd protocol && git checkout <SHA> && cd app && npm ci
# 1. Forks + deployment. PROTOCOL_DIR = a checkout that has script/DeployCore.s.sol (feat/register-adapters or later; it can be this
#    repo once those scripts are on dev). fork-up.sh starts a long-lived Anvil fork at the LATEST block (public RPCs are not archive)
#    and BROADCASTS DeployCore to it (script/fork-dry-run.sh BROADCAST_LOCAL=1 does the same but kills its Anvil on exit).
export PROTOCOL_DIR=/path/to/protocol-checkout
for c in ethereum base arbitrum robinhood; do scripts/qa/fork-up.sh $c; done     # ports 8601 8602 8603 8645; records in $PROTOCOL_DIR/deployments/
# 2. Fund the QA accounts (account 1 = vault manager, 2/3 = depositors) with the denomination asset: $PROTOCOL_DIR/script/fund-anvil.sh
#    http://127.0.0.1:8601 0x7099...79C8 <USDC> 10000000000   (Robinhood USDG: impersonate a holder and transfer; storage-slot funding does not work)
# 3. Build the app against those records and forks:
export NEXT_PUBLIC_E2E_MOCK_WALLET=1 NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX=1 NEXT_PUBLIC_USE_FORK_DEPLOYMENTS=1 \
       DEPLOYMENTS_DIR=$PROTOCOL_DIR/deployments \
       NEXT_PUBLIC_RPC_URL_ETHEREUM=http://127.0.0.1:8601 NEXT_PUBLIC_RPC_URL_BASE=http://127.0.0.1:8602 \
       NEXT_PUBLIC_RPC_URL_ARBITRUM=http://127.0.0.1:8603 NEXT_PUBLIC_RPC_URL_ROBINHOOD=http://127.0.0.1:8645
npm run build && npx next start -p 3100
# 4. Open http://localhost:3100/create -> Connect wallet -> "E2E Mock Wallet".   When done: scripts/qa/fork-down.sh
```

**Vault verification (security).** The app reads a vault's comptroller from the vault itself, and a deposit approves the denomination
token to it, so *every* vault (created here, pasted, or deep-linked) is checked against `Dispatcher.getFundDeployerForVaultProxy(vault)`
and must equal the chain's configured FundDeployer (the Dispatcher comes from the record's `addresses.dispatcher`, else from the
configured FundDeployer's `getDispatcher()`). It **fails closed**: no configured FundDeployer or Dispatcher, a reverting / failing /
timing-out call, the zero address, a different FundDeployer, a non-address answer, or a vault/comptroller that do not point at each
other all give the red `vault-unverified` block (`data-reason` = why) and no Deposit / Redeem / Swap cards. The flows also re-check
immediately before sending (`assertVerifiedVault`), so no approval or transaction is reachable from an unverified vault even if the
UI were bypassed. Without a configured FundDeployer, the home page shows "Not deployed" for create / deposit-redeem / swap and
`/portfolio` disables opening a vault by address. Unverified vaults are never saved to "My portfolios". Negative test:
`scripts/qa/qa-fork-unverified.mjs` with `scripts/qa/FakeVault.sol` (a hostile vault+comptroller look-alike deployed on the fork).

`scripts/qa-fork-flow.mjs <chainId> <swapAmount>` (needs `PLAYWRIGHT_MODULE`) drives create -> deposit -> reload -> my portfolios -> swap (each route) -> redeem
with Playwright (`npm i playwright` somewhere and run with `NODE_PATH`/`PLAYWRIGHT_MODULE`, see the file header) and prints the
route/adapter shown for each swap.
Tips: an Anvil fork serves state lazily from the upstream RPC, so the first quote / swap on a fresh fork can take tens of seconds on
public RPCs. After a hard reload the mock wallet is on the default chain: use the "Switch wallet to X" button on the portfolio page.
Nothing in this mode is shipped to production: the build fails if either flag is set with `VERCEL_ENV=production`.

## Layout

```
src/app/                 routes: /, /create, /portfolio, /portfolio/[chain]/[vault]
src/components/          UI (may only import from '@/lib/contracts'; enforced by ESLint)
src/config/              chains, feature flags, wagmi config, known tokens, swap (QuoterV2) addresses
src/e2e/                 test-only E2E mock wallet (compiled out unless NEXT_PUBLIC_E2E_MOCK_WALLET=1)
scripts/                 build guards + bundle verification (mock wallet, fork records), QA fork flow driver
scripts/qa/              fork-up/down helpers, FakeVault.sol + unverified-vault negative test
src/lib/deployments/     typed deployment-record loader (+ fixtures, tests)
src/lib/contracts/       isolated contracts layer
```

### Contracts layer

All chain interaction goes through `src/lib/contracts/` (`index.ts` is the public API; components may not import `abis`/`addresses`):
`calls.ts` (encoders + share maths), `flows.ts` (React-free create/deposit/redeem), `portfolio.ts` (reads, NAV via `eth_call` of the
non-view calculators), `listing.ts` (log scan + saved vaults), `swap.ts` (Uniswap quoting, ParaSwap/Velora, `callOnExtension`
encoding, swap flow), `hooks.ts` (React hooks). ABIs are hand-minimal, derived from `contracts/release/core/**`; re-check them
against the release you deploy. Known limits: no fee / policy configuration on create; "My portfolios" finds vaults where the
connected account is the **creator** (the event's indexed `creator`, which is not necessarily the owner); a vault someone else
created for you needs the paste-address fallback; Robinhood Chain (no Multicall3 assumption is made) is deposit/redeem only.

## Deploying on Vercel

1. Import `nottrunner/protocol` in Vercel and set **Root Directory = `app`**. The Next.js preset is auto-detected and
   `app/vercel.json` pins `npm ci` / `npm run build`.
2. Add the env vars above (all optional).

## CI

`.github/workflows/app-ci.yaml` runs lint, typecheck, test and build on changes under `app/`, plus the mock-wallet
guard and bundle checks described above.
