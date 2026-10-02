# Deploy scripts (fresh fork deployment)

`script/DeployCore.s.sol` deploys the persistent + release core of this fork on ONE chain and wires it up,
reading `config/chains/<chain>.json`. It mirrors `tests/utils/core/deployment/DeploymentUtils.sol`
(`deployPersistentCore` + `deployReleaseCore`) with real broadcasts instead of `vm.prank`.

Chains: `ethereum` (1), `base` (8453), `arbitrum` (42161), `robinhood` (4663).

## Open decision (needs the user)

**Reuse Enzyme's live deployments vs. fresh fork deployment.** Default assumption in this PR: **fresh deploy on all four**.
- Reuse (Ethereum/Arbitrum/Base only; Enzyme has nothing on Robinhood Chain): no audit/ops burden, but the
  ValueInterpreter feeds and adapter registry are owned by Enzyme DAO / Technical Committee, so we can't add assets or adapters.
- Fresh: full control (we add feeds/adapters), but we own governance, audits and the Dispatcher owner key.
Robinhood Chain needs a fresh deploy either way. If "reuse" is chosen for the other three, this script is only used for Robinhood.

## What is deployed / configured

Persistent: Dispatcher, AddressListRegistry, ExternalPositionFactory, GlobalConfig (lib + proxy), ProtocolFeeReserve (lib + proxy),
UintListRegistry, FundValueCalculatorRouter. Release: GasRelayPaymaster (lib + factory), FundDeployer, ProtocolFeeTracker, ValueInterpreter,
PolicyManager, ExternalPositionManager, FeeManager, IntegrationManager, ComptrollerLib, VaultLib, FundValueCalculator.
Then: GlobalConfigLib upgrade, position deployer, FundDeployer pseudo-constants, calculator router, ETH/USD aggregator,
config primitives (`chainlink.primitives`), `setReleaseLive`, `Dispatcher.setCurrentFundDeployer`.
A final in-script check prices 1 WETH in the first registered primitive (proves feeds are fresh under the configured stale threshold).

**Not deployed by this PR:** adapters (UniswapV3, ParaSwapV6, OneInchV5, ...), policies, fees, external position libs. Router addresses and
feature flags in the config are for the follow-up adapter script. The existing `UniswapV3Adapter` is intentionally NOT changed here; PR #4 adds a separate `UniswapV3SwapRouter02Adapter` variant (no deadline protection) for chains that only have SwapRouter02.

## Config

`config/chains/*.json` hold chain id, RPC env var *names* (never URLs with keys), tokens, Chainlink feeds (with heartbeat),
stale-rate threshold + reasoning, routers, feature flags and a `todo` list. Every address carries a `verified` note
(on-chain read on 2026-10-01 or cited source). Unknown values are omitted and listed in `todo`; the script reads them as `address(0)`.

Robinhood Chain: phase 1 only (vault creation + deposit/redeem; `swaps=false`), USDG is the denomination asset, only non-equity feeds
(ETH/USD, USDG/USD) are registered, and the token labelled "USDC" (`0x378F…8030`, "Universal Stable Digital Coin", 18 dec) is **not** Circle USDC.
MLN token / burner are `address(0)` there (no MLN on that chain; buyback unusable).

## Usage

```bash
git submodule update --init --recursive
forge build contracts                       # script uses deployCode() on artifacts in ./artifacts
cp .env.example .env                        # fill in RPC URLs (ETHEREUM_NODE_MAINNET/_BASE/_ARBITRUM/_ROBINHOOD); never commit .env
source .env
```

`foundry.toml` `fs_permissions` is narrow: read `./artifacts` and `./config`; read-write only for `./deployments/<chain>.json` and `./deployments/<chain>.pending.json` of the four chains (no wildcard, no `OUTPUT_PATH`; the output path is fixed). `CHAIN` selects the config.

### Dry run against a local anvil fork (no broadcast)

```bash
# 1. fork (pick one; ports match qa/fixtures.json)
anvil --fork-url $ETHEREUM_NODE_MAINNET   --port 8601 --chain-id 1     &
anvil --fork-url $ETHEREUM_NODE_BASE      --port 8602 --chain-id 8453  &
anvil --fork-url $ETHEREUM_NODE_ARBITRUM  --port 8603 --chain-id 42161 &
anvil --fork-url $ETHEREUM_NODE_ROBINHOOD --port 8645 --chain-id 4663  &
cast rpc --rpc-url http://127.0.0.1:8645 evm_mine      # once per fork, avoids "Excess blob gas not set"

# 2. dry run: no --broadcast => simulation only. --sender is an address, not a key.
CHAIN=robinhood forge script script/DeployCore.s.sol:DeployCore \
  --rpc-url http://127.0.0.1:8645 --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 -vv
```
The run logs all deployed addresses. Addresses are CREATE addresses of the sender, so they depend on the sender's nonce **on the fork**
(Anvil account #0 has a non-zero nonce on some real chains). For QA to reproduce the same addresses, use the same fork block or read them from the log
of your own run; do not hardcode them. `broadcast/` is gitignored.

Dry run also works without anvil: `--fork-url $ETHEREUM_NODE_BASE` (remote simulation).

Fund QA accounts on a fork: see `qa/fixtures.json` and `script/fund-anvil.sh` (localhost-only helper).

### Real deployment (NOT done by this PR; needs explicit go-ahead)

Add `--broadcast` plus a keystore or hardware wallet. Never put a private key on the command line or in the repo. A real node
additionally needs `RUN_KIND=broadcast` (otherwise the script reverts in a preflight, before anything is sent):
```bash
cast wallet import deployer --interactive           # stores an encrypted keystore locally
CHAIN=base RUN_KIND=broadcast DISPATCHER_OWNER=<multisig> forge script script/DeployCore.s.sol:DeployCore \
  --rpc-url $ETHEREUM_NODE_BASE --account deployer --broadcast
# after the transactions are mined:
script/finalize-broadcast.sh base --rpc-url $ETHEREUM_NODE_BASE     # or FINALIZE_RPC_URL=...; the URL is never printed or stored
```
`DISPATCHER_OWNER` (optional) only *nominates* the new Dispatcher owner at the end; that address must call `claimOwnership()`.
`MLN_BURNER` (optional env) sets VaultLib's MLN burner (default `address(0)`).

## Deployment records (`deployments/<chain>.json`)

`forge script` runs the script as a **simulation first** and sends the transactions only after `run()` returns, so the script cannot know
that a broadcast succeeded. The record model therefore has three states:

| Situation | File written | `kind` | `mainnet` | Other flags |
|---|---|---|---|---|
| `RUN_KIND=fork` on Anvil, no `--broadcast` | `deployments/<chain>.json` | `"fork, not mainnet"` | `false` | `simulated: true` |
| `RUN_KIND=fork` on Anvil with `--broadcast` (QA fork kept alive) | `deployments/<chain>.json` | `"fork, not mainnet"` | `false` | `simulated: false` |
| `RUN_KIND=broadcast` on a real node, no `--broadcast` | nothing (logs "Simulation on a live node...") | n/a | n/a | n/a |
| `RUN_KIND=broadcast` on a real node, `--broadcast` | `deployments/<chain>.pending.json` (gitignored) | `"mainnet broadcast (PENDING receipt confirmation)"` or `"testnet or unknown network (PENDING receipt confirmation)"` | **always `false`** | `simulated: true`, `pendingBroadcast: true` |
| after `script/finalize-broadcast.sh <chain>` succeeds | `deployments/<chain>.json` (pending file deleted) | `"mainnet broadcast"` if the chain id is in the allowlist, else `"testnet or unknown network"` | `true` only for allowlisted chain ids | `confirmation` block (broadcast log path, tx count, first/last block, receipts and code checked) |

The deploy script never writes `mainnet: true`. Only `script/finalize_broadcast.py` (wrapper `finalize-broadcast.sh`) can, and it refuses unless
the RPC rejects `anvil_nodeInfo`, `eth_chainId` equals the pending record's chain id, `broadcast/DeployCore.s.sol/<chainId>/run-latest.json`
has a receipt with status `0x1` for every transaction (in the file and from the RPC), and every pending address was created by those
transactions and has code on-chain. It also refuses to overwrite an existing `mainnet: true` record unless `OVERWRITE_MAINNET_RECORD=true`.

Preflight reverts (before `vm.startBroadcast`): `--broadcast` on a non-Anvil node without `RUN_KIND=broadcast`; `RUN_KIND=fork` on a non-Anvil
node; `RUN_KIND=broadcast` on Anvil; an unknown `RUN_KIND`; an existing `mainnet: true` record (also for a pending broadcast, unless
`OVERWRITE_MAINNET_RECORD=true`). `script/fork-dry-run.sh` also refuses to overwrite a `mainnet: true` record. `OUTPUT_PATH` no longer exists.

**Chain id allowlist:** `config/mainnet-chain-ids.json` (`mainnetChainIds`: 1, 8453, 42161, 4663) is the single source of truth for both the
script and the finalizer. HyperEVM (chain id 999) is not listed yet (todo in that file); until it is added, a HyperEVM broadcast is finalized
as `"testnet or unknown network"` with `mainnet: false`.

Fields: `kind`, `mainnet`, `simulated`, `label`, `runKind`, `chain`, `chainId`, `forkBlock` (0 for a broadcast), `blockNumberAtDeploy`, `evmBlockNumberAtDeploy`, `blockNumberNote`, `blockTimestampAtDeploy`,
`deployer`, `chainlinkStaleRateThresholdSeconds`, `denominationAsset` (`symbol`, `address`), `scriptCommit` (git SHA of the script at run time),
`scriptTreeDirty`, `configSha256`, `addresses`; fork records also carry `log` (path + SHA-256 of `deployments/logs/<chain>.fork-run.txt`)
and `reproduce`; pending records add `pendingBroadcast`; finalized records add `confirmation`. `simulated` is additive (older records
without it were plain simulations); no existing field changed. The addresses of a fork record exist only on a throwaway local fork; nothing
was broadcast. No keys are involved (Anvil account #0 *address* only; `forge script` runs without `--broadcast`).

Tests: `forge test --match-contract DeployCoreRecordsTest` (decision table, preflight reverts, simulation writes nothing, pending is never
mainnet, allowlist, record schema, no-overwrite guard, narrowed fs permissions) and `python3 script/test/test_finalize_broadcast.py`
(finalizer against a fake JSON-RPC node: refuses on Anvil, chain-id mismatch, missing/failed receipts, foreign addresses, no code, mainnet overwrite).
The finalizer has not been run against a real network.

Block numbers: `forkBlock` and `blockNumberAtDeploy` are **chain-native** (`eth_blockNumber`), i.e. L2 blocks on Arbitrum and Robinhood.
`evmBlockNumberAtDeploy` is `block.number` as seen inside the EVM, which is the *L1* block number on those two chains (Arbitrum semantics).

To keep a QA deployment alive on a local fork (so fixtures/apps can use it) run the script against the running Anvil with the fork kind and
Anvil's unlocked account: `RUN_KIND=fork ... forge script ... --rpc-url http://127.0.0.1:<port> --sender 0xf39F... --unlocked --broadcast`.
`RUN_KIND=broadcast` is refused on Anvil, and a fork run is always labelled as a fork, so it can never be labelled a real deployment.

Reproduce a fork record (needs `forge`/`anvil`, `python3`, `jq`, a clean checkout of `scriptCommit`):
```bash
git checkout <scriptCommit> && git submodule update --init --recursive
script/fork-dry-run.sh <ethereum|base|arbitrum|robinhood> <forkBlock>    # forkBlock from the record
diff <(jq -S .addresses deployments/<chain>.json) <(git show <commit>:deployments/<chain>.json | jq -S .addresses)
```
The addresses are CREATE addresses of the sender (Anvil #0), so the same commit + same fork block + same sender gives the same addresses
(an archive-capable RPC is needed for old blocks; public RPCs prune old state, and Robinhood's public RPC rate-limits, which is why the
wrapper throttles anvil). Omit `<forkBlock>` to fork at the chain head. The wrapper uses `ETHEREUM_NODE_*` if set, otherwise public endpoints.
`scriptCommit` is the commit at run time and may be older than the commit that adds the record (records are committed after the run).

## Stale-rate thresholds (per chain)

`ValueInterpreter` has ONE immutable stale threshold per deployment, so it is sized for the slowest registered feed. Too low: valid rates
revert (valuation, deposits, redeems freeze, fails closed). Too high: stale prices are accepted. Details and evidence per feed are in each
`config/chains/*.json` (`chainlinkStaleRateThresholdNote`, per-feed `heartbeatSeconds` / `observedMaxGapSeconds`).

| Chain | Registered feeds (heartbeat; max observed gap) | Threshold |
|---|---|---|
| Ethereum | ETH/USD (3600s; 15996s), USDC/ETH (86400s; 97800s) | 172800 s |
| Base | ETH/USD (**heartbeat UNVERIFIED**; 1232s), USDC/USD (86400s; 86490s) | 172800 s |
| Arbitrum | ETH/USD (1755s; 630s), USDC/USD (255s; 330s) | 3600 s |
| Robinhood | ETH/USD (86400s; 32560s), USDG/USD (86400s; 86430s) | 172800 s |

## Verified in this PR
`forge build contracts` OK; dry run executed successfully against local anvil forks of all four chains (including the post-deploy pricing check).
Nothing was broadcast.
