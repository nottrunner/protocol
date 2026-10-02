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
feature flags in the config are for the follow-up adapter script. `UniswapV3Adapter` is intentionally NOT patched here.

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

`foundry.toml` allows reads of `./config` for `vm.readFile`. `CHAIN` selects the config.

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

Add `--broadcast` plus a keystore or hardware wallet. Never put a private key on the command line or in the repo:
```bash
cast wallet import deployer --interactive           # stores an encrypted keystore locally
CHAIN=base DISPATCHER_OWNER=<multisig> forge script script/DeployCore.s.sol:DeployCore \
  --rpc-url $ETHEREUM_NODE_BASE --account deployer --broadcast
```
`DISPATCHER_OWNER` (optional) only *nominates* the new Dispatcher owner at the end; that address must call `claimOwnership()`.
`MLN_BURNER` (optional env) sets VaultLib's MLN burner (default `address(0)`).

## Deployment records (`deployments/<chain>.json`)

`DeployCore` writes a JSON record only when `RUN_KIND` is set. Exactly two kinds exist, and every record states which one it is in
top-level fields, so a fork record cannot be mistaken for a mainnet deployment:

| `RUN_KIND` | `kind` | `mainnet` | Allowed on | Written by |
|---|---|---|---|---|
| `fork` | `"fork, not mainnet"` | `false` | Anvil nodes only (checked with `anvil_nodeInfo`; anything else reverts) | `script/fork-dry-run.sh` |
| `broadcast` | `"mainnet broadcast"` | `true` | real nodes only (reverts on an Anvil node) | a real, approved `--broadcast` run (see above) |

Both write to `deployments/<chain>.json`, so a later real broadcast **overwrites** the fork record at the same path (`kind` flips to
`"mainnet broadcast"`, `mainnet` to `true`, `label` to `REAL BROADCAST DEPLOYMENT`). `script/fork-dry-run.sh` refuses to overwrite a record
with `"mainnet": true`. Review the `kind`/`mainnet` fields (and `git diff`) before committing a record.

Fields: `kind`, `mainnet`, `label`, `runKind`, `chain`, `chainId`, `forkBlock` (0 for a broadcast), `blockNumberAtDeploy`, `blockTimestampAtDeploy`,
`deployer`, `chainlinkStaleRateThresholdSeconds`, `denominationAsset` (`symbol`, `address`), `scriptCommit` (git SHA of the script at run time),
`scriptTreeDirty`, `configSha256`, `addresses`; fork records also carry `log` (path + SHA-256 of `deployments/logs/<chain>.fork-run.txt`)
and `reproduce`. The addresses of a fork record exist only on a throwaway local fork; nothing was broadcast. No keys are involved (Anvil
account #0 *address* only; `forge script` runs without `--broadcast`).

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
