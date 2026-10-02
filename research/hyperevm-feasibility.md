# Chain feasibility: Enzyme-style vaults on HyperEVM (the fifth chain)

Date: 2026-10-01 (ET). Author: SWE bot. Scope: research only. Nothing was broadcast to any real network.
Legend: **[V-repo]** read in the fork. **[V-chain]** I checked it live over public JSON-RPC today (read-only `eth_call` / `eth_getCode` / `eth_getBlock*`). **[V-fork]** I ran it on a throwaway local Anvil fork of HyperEVM (nothing leaves the box). **[V-web]** a cited page says so. **[UNVERIFIED]** I could not confirm it, so treat it as an open item.
Method and format follow `research/chain-feasibility.md`. Config format follows `config/chains/*.json`. Scope is the same portfolio flows (create vault, deposit, redeem, swap later). Hyperliquid trading venues (perps, spot order books, HyperCore write/read precompiles) are out of scope. Provisional assumption is the Robinhood-style Phase 1 (create, deposit, redeem; swap deferred).
Supporting scripts, raw feed data and draft config are in `research/hl/` (only `hl-feeds-onchain.json` and `gaps.json` are kept in the repo; see §9).

## 0. Verdict

- **HyperEVM is feasible for Phase 1. Nothing found blocks create / deposit / redeem.** I ran the real flow on a local fork: the core deploy, `createNewFund`, `buyShares` and `redeemSharesInKind` all succeeded with the real Circle USDC as denomination asset [V-fork] (§6.2).
- **The real USDC-like token is Circle-native USDC `0xb88339CB7199b77E23DB6E890353E22632Ba630f`** (name "USDC", 6 decimals, FiatToken v2). It is on Circle's official list and matches on-chain reads [V-web, V-chain] (§2.3). This is the recommended denomination asset. USDT0 (`0xB8CE59FC…5ebb`, 6 dec) and USDH (`0x111111a1…1111`, 6 dec) are real but not recommended.
- **Three Enzyme-specific problems, none fatal:**
  1. **Big-block deploy.** `ComptrollerLib` (5.17M gas), `VaultLib` (4.26M) and `FundDeployer` (3.96M) cost more gas than the 3M small-block limit. The core deploy must run with the deployer switched to HyperEVM **big blocks** (30M gas, 1-minute cadence). Anvil does not model this. On a fork left at 3M the deploy fails with OutOfGas at `FundDeployer` [V-fork]. Bytecode itself fits: biggest runtime 23,521 bytes against the 24,576 EIP-170 limit, which the live chain enforces [V-chain] (§1.3).
  2. **No WETH.** Enzyme's `WETH_TOKEN` is an immutable of `ValueInterpreter`, `ComptrollerLib` and `VaultLib`, and the gas token is HYPE. Decision **D1** (§5.1). I recommend using Wrapped HYPE (`0x5555…5555`) plus the HYPE/USD feed as the "ETH" anchor. That needs **zero script change** and was run end to end on a fork. The alternative follows the Polygon precedent and needs a 3-line script patch.
  3. **Adapters.** `ParaSwapV6Adapter` (Augustus), `OneInchV5Adapter` and `ZeroExV4Adapter` do not work: their routers are not deployed on HyperEVM. `UniswapV3Adapter` can work **unchanged** against the original-interface Uniswap v3 forks (HyperSwap `SwapRouter01`, Project X router). I executed the router call on a fork. The official Uniswap v3 deployment on HyperEVM has no pools. SwapRouter02-style routers (including HyperSwap `SwapRouter02`) have the same mismatch as Base (§4).
- **Oracles are fine.** Chainlink Data Feeds are live on HyperEVM (36 feeds, ETH/USD, USDC/USD, USDT/USD, HYPE/USD, BTC/USD and more). They speak the same `latestRoundData()` interface that Enzyme calls, and `setEthUsdAggregator` / `addPrimitives` accepted them on the fork. All heartbeats are 86,400 s. Pitfall: HyperEVM lists both 8-decimal and 18-decimal variants (§2.2). Enzyme's math needs one consistent decimals family, so use the 8-decimal ones.
- **Recommendation:**
  - HyperEVM: **reduced, staged**, same as Robinhood. Phase 1 is create + deposit/redeem, USDC denomination, no swaps, no external positions, no GSN, no MLN buyback. Stale-rate threshold **172,800 s (48 h)**. Phase 2 is swaps through `UniswapV3Adapter` pointed at one chosen original-interface router. Phase 3 is 0x v2 / 1inch / Algebra adapters, only if needed.
  - Proposed AC scope: **AC-1, 2, 3, 5, 6 binding; AC-4 deferred** (§7).
- **Two decisions need the user/PM:** D1 (WETH anchor, a one-way door per release) and D3 (who holds the deployer key and how big-block mode is operated, §5.2). The existing open question (reuse vs fresh Enzyme deployment) is settled by facts here: Enzyme has no HyperEVM deployment, so it must be a fresh deploy (§2.5).

---

## 1. HyperEVM chain facts

### 1.1 Basics

| Fact | Value | Source |
|---|---|---|
| Chain ID | **999** mainnet, **998** testnet | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm.md ; [V-chain] `eth_chainId` = 0x3e7 (mainnet) and 0x3e6 (testnet) |
| Public RPC | mainnet `https://rpc.hyperliquid.xyz/evm`, testnet `https://rpc.hyperliquid-testnet.xyz/evm`. No websocket on the official RPC. `web3_clientVersion` = "hyperliquid evm Mainnet" | same docs page ; [V-chain] |
| RPC behaviour | Docs: `eth_call`, `eth_getCode`, `eth_getStorageAt`, `eth_getBalance` "only the latest block is supported"; `eth_getLogs` max 50 blocks and 4 topics; `eth_maxPriorityFeePerGas` always 0; `eth_gasPrice` returns the next small block's base fee. **Observed differently:** historical `eth_call` / `eth_getCode` / `eth_getBalance` worked back at least 100,000 blocks, and `eth_getLogs` over a 200-block span worked. Do not rely on this (see §6.4). Sequential bursts of ~300 calls intermittently got error responses (probably rate limiting; I did not capture the code). | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc.md ; [V-chain] |
| Explorers | Etherscan-family `https://hyperevmscan.io` (HTTP 200 to curl); Blockscout `https://www.hyperscan.com` (resolves to the "HyperEVM Explorer" at hl.eco); also hypurrscan and owlscan. Hyperliquid's docs list several and designate none. 1inch's help page uses hyperevmscan.io. | https://hyperliquid.gitbook.io/hyperliquid-docs/builder-tools/hyperevm-tools.md ; [V-chain] curl. I could not use an explorer search API (the Blockscout host redirects). |
| Native gas token | **HYPE**, 18 decimals on mainnet and testnet. Base fees are burned. **Priority fees are burned too** (sent to the zero address's balance). | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm.md |
| Wrapped native | **WHYPE `0x5555555555555555555555555555555555555555`**, immutable, same source as WETH9. Read on-chain: name "Wrapped HYPE", symbol WHYPE, 18 dec. `deposit()` works on a fork. | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/wrapped-hype.md ; [V-chain] ; [V-fork] |
| Stage | Official overview still calls HyperEVM "in the alpha stage". | https://hyperliquid.gitbook.io/hyperliquid-docs/hyperevm |
| Consensus | Same HyperBFT consensus as HyperCore; EVM blocks are produced by the L1. Not an L2, so no L1-block-number estimate quirk like Orbit chains. | https://hyperliquid.gitbook.io/hyperliquid-docs/hyperevm |
| Fee level | Base fee 100,000,000 wei = **0.1 gwei** on both `eth_gasPrice` and `eth_bigBlockGasPrice`; priority fee 0. | [V-chain] |
| Enzyme on HyperEVM | **None found.** No "hyper" match in the Onyx README or the Onyx contract-addresses page, and the Enzyme Blue docs lists only Ethereum / Arbitrum / Base (see `chain-feasibility.md` §2). | https://raw.githubusercontent.com/enzymefinance/protocol-onyx/main/README.md ; https://docs.enzyme.finance/onyx-protocol/contract-addresses.md (negative result) |

### 1.2 Block time and gas: small vs big blocks

Official description (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/dual-block-architecture.md): two interleaved block types with one increasing EVM block number. **Fast ("small") blocks: 1 s, 3M gas. Slow ("big") blocks: 1 min, 30M gas.** Two independent mempools. The mempool accepts only the next 8 nonces per address, and transactions older than 1 day are pruned. A deployer opts into big blocks with an L1 action `{"type":"evmUserModify","usingBigBlocks":true}`. The flag is per HyperCore user, must be unset again to target small blocks, and requires the address to exist as a Core user (for example after receiving a Core asset such as USDC).

My reads [V-chain], 81 consecutive blocks ending at block 47,408,716:
- 79 blocks had gas limit 3,000,000 and 2 had 30,000,000. Timestamp gaps were 1 s (78 times) and 0 s (2 times, the big blocks sharing a timestamp with a small one). Block gas used was 0.5–0.9M.
- Base fee 100,000,000 wei.
- `bigBlockGasPrice` (the name in the docs) returns "Method not found". **`eth_bigBlockGasPrice` works** and returned 0x5f5e100 (0.1 gwei).
- `eth_call` runs with `GASLIMIT` = 30,000,000, so `eth_estimateGas` happily returns numbers above 3M. Wallets and forge simulations will therefore not warn about small-block inclusion. What the node does with a >3M transaction sent to the small-block mempool is [UNVERIFIED].

### 1.3 Contract size and our biggest contracts

The chain enforces the standard Ethereum limits [V-chain via `eth_estimateGas` on synthetic creations]: runtime code of 24,576 bytes is accepted, 24,577 fails with `CreateContractSizeLimit`; initcode of 49,152 is accepted, 49,153 fails with "max initcode size exceeded" (`research/hl/eip170.py`). The docs say the EVM is Cancun without blobs.

Sizes from the fork's `artifacts/` build (`evm_version = cancun`, optimizer 200 runs) [V-repo]:

| Contract | Initcode (bytes) | Runtime (bytes) | Gas actually used to deploy [V-fork] |
|---|---|---|---|
| ComptrollerLib | 24,217 | 23,521 | **5,167,724** |
| VaultLib | 19,716 | 19,433 | **4,255,812** |
| FundDeployer | 18,505 | 17,887 | **3,956,426** |
| ValueInterpreter | 11,186 | 10,867 | 2,404,943 |
| Dispatcher | 10,836 | 10,571 | 2,404,375 |
| IntegrationManager | 9,978 | 9,822 | 2,177,154 |
| ExternalPositionManager | 9,516 | 9,355 | 2,075,738 |
| ParaSwapV6Adapter / UniswapV3Adapter (Phase 2) | 5,731 / 5,363 | 5,429 / 5,098 | not deployed |

- The largest contract anywhere in the repo is `GatedRedemptionQueueSharesWrapperLib` (runtime 24,566 bytes, 10 bytes under the limit). It is not part of `DeployCore`.
- Whole `DeployCore` run on a 30M-gas fork: 32 transactions, **37,387,013 gas total**, largest single transaction 5.17M [V-fork]. At 0.1 gwei that is about 0.0037 HYPE, roughly $0.33 at the HYPE/USD feed price of $87.46 read today. Forge's pre-flight estimate was higher (48.7M gas, "0.01 HYPE required"). Treat gas cost as negligible.
- **Result on a fork left at the default 3M block gas limit:** `forge script … --broadcast` fails with `OutOfGas` at the `FundDeployer` creation, after 9 smaller contracts succeeded [V-fork] (`research/hl/logs/small-block-run.tail.log`). The first transaction over 3M is `FundDeployer`, then `VaultLib` and `ComptrollerLib`.
- Everything a user does later fits in a small block: `createNewFund` 608k gas, `buyShares` 217k, `redeemSharesInKind` 110k [V-fork].

**What the deploy needs (docs-based plan; the actual L1 action was not run, [UNVERIFIED] on mainnet):**
1. The deployer address must exist as a HyperCore user (receive a Core asset) and hold a little HYPE on the EVM side for gas.
2. Send the signed L1 action `evmUserModify {usingBigBlocks: true}` from the deployer key. Hyperliquid's docs point to the Python SDK example `basic_evm_use_big_blocks.py` and to a community toggle site (https://hyperevmblocktoggle.xyz/). Hardware wallets or multisigs may not be able to sign this action; that needs checking before D3.
3. Run `DeployCore` with `--slow` so forge sends one transaction at a time. Reason: the mempool only accepts the next 8 nonces per address (inference from the docs), and 32 transactions would otherwise be rejected.
4. Expect it to be slow: big blocks come about once a minute, so up to ~30 minutes for 32 sequential transactions (estimate).
5. Send `usingBigBlocks: false` afterwards. Deploy cost is the same at 0.1 gwei.

### 1.4 EVM compatibility

| Item | Result | Evidence |
|---|---|---|
| PUSH0 (Shanghai) | works | `eth_call` of `PUSH0` initcode returned [V-chain] (`research/hl/ops.py`) |
| MCOPY, TSTORE/TLOAD (Cancun) | work | same |
| BLOBHASH / BLOBBASEFEE | execute (return 0 / 1) although docs say "Cancun without blobs" | same |
| CHAINID | 0x3e7 = 999 | same |
| Standard precompiles | ecrecover (known vector recovers `0x7156…8c8a`), sha256, identity, modexp, bn256Add all work. blake2f and KZG point evaluation errored on empty input (expected). | `eth_call` [V-chain] |
| Create2 deployer | `0x4e59…956C` (69 bytes), CreateX `0xba5E…a5Ed` (11,838 bytes), Multicall3 `0xcA11…CA11` (3,808 bytes), Permit2 `0x0000…8BA3` (9,152 bytes), Safe singleton 1.3 present | `eth_getCode` [V-chain] |
| SELFDESTRUCT (EIP-6780) | not tested [UNVERIFIED] | |
| Solidity | the fork builds with solc 0.6.12 and 0.8.19, which emit no PUSH0. Forge prints a cosmetic warning "EIP-3855 not supported … Unsupported Chain IDs: 999"; it only matters for solc ≥ 0.8.20 and the chain does support PUSH0. | [V-fork] |
| Enzyme block-based logic | A search of `contracts/release/core`, `contracts/persistent/dispatcher`, fee-manager and policy-manager found no `block.number`, `blockhash` or `tx.origin`. | [V-repo] |
| **HyperCore system addresses** | `0x2222…2222` (122 bytes: HYPE bridge, `receive()` emits an event that credits HyperCore), `0x3333…3333` CoreWriter (544 bytes: emits actions for HyperCore), Core-spot system addresses `0x20…` + token index. Read-precompiles at `0x800+` have no code but respond: `0x807` (oracle price) and `0x809` (L1 block number) returned values on the live chain. Enzyme never calls any of these [V-repo grep: none]. **Stock Anvil does not implement the precompiles**: the same calls on a fork return empty `0x`. CoreWriter on a fork is just a contract that emits logs. | docs https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore.md and `.../hypercore-less-than-greater-than-hyperevm-transfers.md` ; [V-chain] ; [V-fork] |

### 1.5 Enzyme-specific consequence of the gas token

`DeployCore` currently sets `wrappedNative = weth` and the comment says "all four chains use ETH as the gas token" [V-repo]. HyperEVM breaks that assumption (§5.1).

---

## 2. Oracles, USDC-like tokens and denomination

### 2.1 Which oracles are live

| Provider | Status on HyperEVM | Enzyme-compatible? |
|---|---|---|
| **Chainlink Data Feeds** | **Live.** The Chainlink reference-data directory lists 36 HyperEVM mainnet feeds (`research/hl/hl-feeds.json`). Feed pages exist at `https://data.chain.link/feeds/hyperliquid/hyperliquid/{eth-usd,btc-usd,usdc-usd,usdt-usd,hype-usd}` ("Network HyperEVM Mainnet", "Low market risk", deviation 0.5%). All 36 entries have `heartbeat: 86400`; price feeds have threshold 0.5%, exchange-rate feeds 0.05%. I read the proxies on chain: all have 9,571 bytes of code, `version()` = 6, `description()`, `decimals()` and `latestRoundData()`. | **Yes.** Same interface as the other four chains (§2.2). `setEthUsdAggregator` and `addPrimitives` accepted them on a fork [V-fork]. |
| Pyth | The Pyth contract at `0xe9d69CdD6Fe41e7B621B4A688C5D1a68cB5c8ADc` has code on HyperEVM (708 bytes) [V-chain]; it is listed in a Pyth docs repo revision. The current docs page I fetched does not list HyperEVM at all, and a search snippet lists different "current / upgraded" addresses, so the address is [UNVERIFIED]. | **No.** Pyth is pull-based (`getPriceNoOlderThan`), not `latestRoundData`. It would need a wrapper aggregator. Not worth it. |
| RedStone, DIA, Blocksense, Seda, Stork | Listed on Hyperliquid's tools page (https://hyperliquid.gitbook.io/hyperliquid-docs/builder-tools/hyperevm-tools.md). I did not find or read any feed addresses. | [UNVERIFIED] |
| API3 | I found no HyperEVM evidence. | [UNVERIFIED] |
| HyperCore oracle precompile | Exists (`0x807`) but is a trading-venue read. Out of scope. | Not used. |

### 2.2 Feeds Enzyme can use (read live [V-chain], `research/hl/hl-feeds-onchain.json`, `gaps.json`)

Use only the **8-decimal** proxies. The directory path name is `eth-usd`, `usdc-usd`, `usdt-usd`, `hype-usd`.

| Feed | Proxy (8 decimals) | Latest answer | Age at read | Heartbeat | Max observed update gap |
|---|---|---|---|---|---|
| ETH / USD | `0x017151e74fB3a393673B5B5149F53578c0Fa55B0` | 2,702.18 | 12,487 s | 86,400 s | 31,006 s (61 rounds, ~87 h) |
| USDC / USD | `0xA0Adc43ce7AfE3EE7d7eac3C994E178D0620223B` | 0.99996476 | 15,029 s | 86,400 s | 86,483–86,484 s (≈ heartbeat + 83 s; median 86,416 s) |
| USDT / USD | `0x9114446540B4f8E0E310041981f7c1Be6181Ed07` | 0.99954474 | 15,105 s | 86,400 s | 86,469–86,480 s (median 86,405 s) |
| HYPE / USD | `0xa5a72eF19F82A579431186402425593a559ed352` | 87.45684 | 5,447 s | 86,400 s | 6,213 s (61 rounds, ~25 h) |
| BTC / USD | `0x71A2017296De30F4597B36FBD90b7e8Ec6E97A82` | 84,682.93 | 7,505 s | 86,400 s | 86,405 s |
| UETH / USD (Unit Ethereum) | `0x54EdE484Bb0E589F5eE13e04c84f46eb787c9C6a` | 2,705.03 | 12,421 s | 86,400 s | not sampled |

The USDC and USDT sample includes one spurious 1.79-billion-second gap from walking back across a Chainlink phase boundary (timestamp 0). I excluded it and reported the real gaps.

Pitfalls specific to this chain [V-chain, directory JSON]:
- **Both 8-decimal and 18-decimal copies exist** for ETH, BTC, USDC, USDT, HYPE and SOL; the 18-decimal ones are the "shared SVR" family (a secondary "SVR proxy" address is listed next to each). Enzyme's `ChainlinkPriceFeedMixin` does no decimal normalisation: it assumes ETH-rate feeds have 18 decimals and every USD-rate feed (including the ETH/USD aggregator) has the same decimals as each other [V-repo, `__calcConversionAmount*`]. Mixing 8- and 18-decimal feeds would misprice by 10^10. Pick the 8-decimal family everywhere. I tested only that family.
- **Lookalike feed:** `USDC / USD TEST CAPPED` at `0x25B5A1c25E3421E053D13F4645AF3298c96138eF` (18 decimals, `docs.hidden: true`, value 0.99997). It is a hidden test feed. Never register it.
- Exchange-rate feeds for HYPE liquid-staking tokens exist (kHYPE/HYPE, beHYPE/HYPE, wstHYPE/stHYPE, LHYPE/…, 18 decimals, 0.05% deviation). They would fit Enzyme's ETH-rate-asset slot if D1 option A is chosen, but are out of scope now.
- Equity-style 24/5 feeds do not exist here (no stock tokens), so no weekend-staleness problem.
- I did not find an L2 sequencer-uptime feed concept for HyperEVM; it is not an L2. Enzyme never reads one anyway [V-repo grep]. Absence of one on the Chainlink page is [UNVERIFIED].

### 2.3 The real USDC-like token (read on chain, 2026-10-01)

| Token | Address | On-chain name / symbol / decimals | Notes |
|---|---|---|---|
| **USDC (Circle native)** | **`0xb88339CB7199b77E23DB6E890353E22632Ba630f`** | "USDC" / USDC / **6** ; `version()` = "2", `currency()` = "USD", `paused()` = false, `blacklister()` `0x33Aa4E95…874beb`, `masterMinter()` `0xf21ce1A1…464a73`. Upgradeable proxy (admin slot non-zero `0x178d71a6…5080`). Total supply read as 6,930,584,899.76 USDC; I did not work out why it is that large (probably includes Core-bridge balances), [UNVERIFIED]. | Listed for HyperEVM on Circle's official page https://developers.circle.com/stablecoins/usdc-contract-addresses and on https://www.circle.com/multi-chain-usdc/hyperevm ("USDC is native to HyperEVM"). CCTP V2 contracts have code on chain: MessageTransmitter `0x81D40F21…B64`, CctpForwarder `0xb21D281D…5757`, CoreDepositWallet `0x6B9E7731…0A24` (https://developers.circle.com/cctp/references/hypercore-contract-addresses). |
| USDT0 (Tether omnichain) | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` | "**USD₮0**" (symbol uses the `₮` U+20AE character) / 6 | https://docs.usdt0.to/technical-documentation/deployments ; OFT `0x904861a2…7e98`. Supply 66.7M. Real, but the unusual symbol is a lookalike risk in UIs. |
| USDH (Native Markets) | `0x111111a1a0667d36bD57c0A9f569b98057111111` | "USDH" / 6 | Hyperliquid-native stablecoin linked to HyperCore; 61 bytes of code (proxy-like). Supply 8.09M. https://docs.usdh.com/usdh/hyperevm . Small, not recommended. |
| WHYPE | `0x5555…5555` | "Wrapped HYPE" / 18 | official system contract |
| UETH (HyperUnit bridged ETH) | `0xBe6727B535545C67d5cAa73dEa54865B92CF7907` | "Unit Ethereum" / UETH / 18 | **Not WETH.** Bridged by HyperUnit https://docs.hyperunit.xyz/developers/key-addresses/mainnet/token-metadata |

**Recommendation: denomination asset = Circle USDC `0xb883…630f`.**
- Reasons: issuer-published address, matches on-chain reads, deepest stablecoin liquidity against WHYPE (§4.3), has a Chainlink feed, same asset as the Base and Arbitrum vaults. It can be bridged by CCTP V2.
- Risks: issuer freeze/blacklist risk (the contract has a blacklister), the same as on Base and Arbitrum. HyperCore linkage: USDC sent to a Core system address is credited on HyperCore, not lost, but not recoverable by the vault (§5.3).

**Lookalike warning.** I could not enumerate other tokens labelled "USDC" on this chain (explorer search was not usable), so absence of lookalikes is [UNVERIFIED]. On Robinhood Chain a token labelled USDC was not Circle's, so match addresses only. Specifically: do not use USDT0 / USDH / UETH or any token found by symbol; do not use the hidden `USDC / USD TEST CAPPED` feed; and the 18-decimal USDC/USD proxy `0x091fCd3832aF70b3816f3a29262145919E182B82` is the wrong decimals family.

### 2.4 Enzyme's price-feed interface against these feeds

`IChainlinkAggregator.latestRoundData()` is what `ChainlinkPriceFeedMixin` calls, and it requires `answer > 0` and `updatedAt >= block.timestamp - STALE_RATE_THRESHOLD` at registration and at every valuation [V-repo]. On a fork of HyperEVM, `ValueInterpreter.setEthUsdAggregator(HYPE/USD)` and `addPrimitives([USDC],[USDC/USD],[USD])` succeeded, and the in-script check `calcCanonicalAssetValue(WHYPE, 1e18, USDC)` returned 87,459,922 raw units (= 87.46 USDC) [V-fork].

### 2.5 Enzyme deployments
None on HyperEVM (§1.1). Fresh deploy is the only path.

---

## 3. Stale-rate threshold

`ValueInterpreter` takes one global, **immutable** threshold [V-repo]. Registered feeds for Phase 1: USDC/USD (heartbeat 86,400 s), HYPE/USD or ETH/USD (86,400 s each).
- Worst real update gap seen: **86,484 s** (USDC/USD), i.e. heartbeat + 84 s. A threshold equal to the heartbeat would revert valuation whenever an update is a little late, exactly as measured on Robinhood.
- **Proposal: 172,800 s (48 h) = 2 × heartbeat.** It tolerates one fully missed heartbeat. It matches the Robinhood config, which also has only 86,400 s feeds. The 0.5% deviation trigger bounds normal drift.
- Trade-off: a halted or depegged feed can be accepted for up to 48 h; a lower value (129,600 s = 1.5×) is tighter but leaves only ~43,000 s of slack over the worst observed gap. Because the value is immutable, changing it later means redeploying `ValueInterpreter` and the release.
- Phase 1 impact is small: with a USDC-only vault, valuation does not read any feed. On a fork I advanced time by 3 days (all feeds stale) and an `eth_call` of `buyShares` still returned shares [V-fork]. The threshold bites once vaults hold non-denomination assets (Phase 2).
- If an 18-decimal exchange-rate feed or a feed with a longer heartbeat is added, re-derive this number before the deploy.

---

## 4. DEXes, routers and Enzyme adapters

### 4.1 What is deployed [V-chain unless marked; code length in bytes, `research/hl/codes.sh`]

| Venue | Address | Code | Interface check |
|---|---|---|---|
| **Uniswap v3 (official)**, per https://developers.uniswap.org/docs/protocols/v3/deployments/v3-hyperevm-deployments | Factory `0xf0db7b58379503491d857dB50AC9ece64c653918` (24,535); SwapRouter `0xfF8137B0E0B9EF7021850B5124987C51E5424A9E` (12,070); SwapRouter02 `0x7AdF4701AbCDBc5Dcf5Cb58B526f897e048F0D11` (24,497); NonfungiblePositionManager `0x39654A85…1377`; UniversalRouter `0x9aFe3C49…5DBa` | present | SwapRouter has `exactInput` selector `c04b8d59` (with deadline) and not `b858183f`; SwapRouter02 the opposite. Both report factory = the Factory and `WETH9()` = WHYPE. **But no pool exists** at any fee tier (100/500/3000/10000) for USDC/USDT0, USDC/WHYPE or USDT0/WHYPE: 12 `getPool` calls all returned zero. A ghost deployment. |
| **HyperSwap v3** (https://docs.hyperswap.exchange/docs/amm/contracts/hyper-evm/v3/) | Factory `0xB1c0fa0B789320044A6F623cFe5eBda9562602E3`; **SwapRouter01 `0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D`** (12,070); SwapRouter02 `0x6D99e7f6747AF2cDbB5164b6DD50e40D4fDe1e77` (21,792); NPM `0x6eDA2062…fBC8` | present | Router01: `c04b8d59` yes (original interface). Router02: `b858183f` only. Pools: USDC/USDT0 0.01% (about 27.8k USDC + 31.2k USDT0), USDT0/WHYPE 0.05% (284k USDT0 + 3,105 WHYPE), thin USDC/WHYPE. |
| **Project X (v3 fork)** | Factory `0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072` (24,123); **SwapRouter `0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B`** (12,070) | present | Router: `c04b8d59` yes, `factory()` = Project X factory, `WETH9()` = WHYPE. The router address comes from the hyperevmscan page for the factory and the `wp-evm-prjx` crate, not from Project X's own docs (§6). Pools: **USDC/WHYPE 0.05% about 6.70M USDC + 86,973 WHYPE**, USDC/WHYPE 0.3% 2.94M USDC + 39,322 WHYPE, USDC/USDT0 0.01% about 127k USDC + 154k USDT0. The deepest venue I found. |
| **Kittenswap** (https://kittenswap.gitbook.io/kittenswap/deployed-contracts) | SwapRouter `0x4E73E421480A7E0C24FB3C11019254EDE194F736` (12,561); v2 Router `0xD6EeFfbD…0802` and PairFactory `0xDA12F450…B31B` are 163-byte proxies | present | Algebra-style: `poolDeployer()` is set, `WETH9()` reverts, `factory()` = `0x5f95E92c…61A7`. Selector `c04b8d59` is present, but Algebra paths carry no fee tier, so the adapter's path encoding would not match (inferred, **not executed**). |
| Velora / ParaSwap Augustus v6.2 `0x6a000f20…1068` | **no code** | | Velora's supported-chain list (https://www.velora.xyz/docs/resources/chains-and-contracts) does not include 999. |
| 0x v4 ExchangeProxy `0xDef1C0de…5EfF` | **no code** | | The 0x Swap API does support chain 999 (https://0x.org/post/hyperevm-support, 2026-03-05) via the v2 stack: AllowanceHolder `0x0000000000001fF3684f28c67538d4D072C22734` has code (1,009 bytes). Enzyme has no adapter for that. |
| 1inch v5 `0x11111112…0582` and v6 `0x11111112 5421…2A65` | **no code** at the standard addresses | | 1inch says HyperEVM is supported (https://help.1inch.com/en/articles/16919287-how-to-use-1inch-on-hyperevm), so its router lives at a non-standard address, [UNVERIFIED], not looked up. |
| Aave v3 / Pendle / Bebop | not checked | | [UNVERIFIED] |

### 4.2 Which Enzyme adapters work unchanged

| Adapter | Verdict | Why |
|---|---|---|
| `UniswapV3Adapter` | **Works unchanged against an original-interface router.** Use HyperSwap SwapRouter01 or Project X's router; the official Uniswap SwapRouter works but has no liquidity. **Not** SwapRouter02 (HyperSwap Router02, Uniswap Router02). | On a fork I called `exactInput((bytes,address,uint256,uint256,uint256))` with the adapter's exact struct (path, recipient, deadline, amountIn, amountOutMinimum) on both routers: 100 USDC → USDT0 succeeded, 150,554 gas on HyperSwap and 133,539 gas on Project X, and returned about 100.03 USDT0 each [V-fork]. **This tests the router call, not the adapter contract itself**; the adapter run and the vault trade need a fork test (Phase 2). One adapter instance is deployed per router. |
| `ParaSwapV6Adapter` | No | Augustus not deployed. |
| `OneInchV5Adapter` | No | v5 router has no code. |
| `ZeroExV4Adapter` | No | Legacy exchange proxy has no code. |
| Kitten / Algebra | No (needs a path-encoding variant) | See above. |

Thin liquidity note: the USDC/USDT0 stable pools hold only tens to low hundreds of thousands of dollars; USDC/WHYPE is multi-million. Slippage policy matters in Phase 2.

### 4.3 Local fork funding facts [V-fork]
- `script/fund-anvil.sh` works unchanged: Circle USDC balances slot **9** (same slot as Ethereum USDC), WHYPE slot **3**. Native HYPE via `anvil_setBalance`. `WHYPE.deposit()` also works on the fork.

---

## 5. Gap detail and decisions

### 5.1 D1: the "WETH" anchor (needs a decision before any deploy; one-way door per release)

> **Decision (Engineering Lead, 2026-10-02): Option A**, Wrapped HYPE as `WETH_TOKEN` with the HYPE/USD feed as the ETH-equivalent anchor. Implemented in `config/chains/hyperliquid.json`.
Enzyme's `WETH_TOKEN` is an **immutable** in `ValueInterpreter`, `ComptrollerLib` and `VaultLib`. `VaultLib.receive()` wraps any native coin sent to a vault into `WETH_TOKEN` via `deposit()`, `ComptrollerLib` pulls `WETH_TOKEN` for the gas relayer, and `ValueInterpreter` treats `WETH_TOKEN` as having a rate of exactly 1e18 in the "ETH" rate asset [V-repo]. On HyperEVM the native coin is HYPE and there is no canonical WETH9.

| | **Option A (recommended for Phase 1)** | Option B |
|---|---|---|
| `tokens.weth` | WHYPE `0x5555…5555` (it is the WETH9-style wrapper of the gas token) | UETH `0xBe67…7907` (bridged ETH, no `deposit()`) |
| wrapped native (VaultLib/ComptrollerLib) | same WHYPE | WHYPE (separate, as on Polygon, where `weth` = bridged WETH and `wrappedNative` = WMATIC; `getDefaultPolygonConfig`) |
| `ethUsdAggregator` | **HYPE/USD** 8-dec proxy `0xa5a7…d352`. The "ETH" rate asset then means "HYPE". | ETH/USD `0x0171…55B0` |
| `DeployCore.s.sol` change | **none** (the script maps `weth` to both) | 3-line patch to read an optional `tokens.wrappedNative.address` (`research/hl/draft-optionB-DeployCore.diff`) |
| Fork evidence | Full core deploy, `createNewFund`, `buyShares`, `calcGav`, `redeemSharesInKind` OK; sanity check priced 1 WHYPE = 87.46 USDC [V-fork] | Full core deploy OK; sanity check priced 1 UETH = 2,702.28 USDC. **Vault flow not run** [V-fork] |
| Upside | No script change; WHYPE is trust-minimised 1:1 with native HYPE; HYPE-quoted exchange-rate feeds (kHYPE/HYPE, beHYPE/HYPE) fit the "ETH" slot later | Follows Enzyme's existing Polygon pattern; "ETH" stays ETH |
| Downside | Config key `ethUsdAggregator` holds HYPE/USD (confusing; document it). Departs from every other chain's meaning of "ETH" | UETH is a bridged token valued at exactly 1 ETH with no feed, so a depeg is invisible. Needs a script change and a patched deploy to be re-reviewed. |

Phase 1 vaults hold only USDC, so neither option prices anything in Phase 1. The choice becomes real in Phase 2, but it is locked by the Phase 1 deploy because the immutables are baked in. Revisit only if there is a concrete need for ETH-quoted assets.

### 5.2 D3: deployer key and big-block operation
Deployment needs a deployer that (i) exists as a HyperCore user, (ii) can sign the `evmUserModify` L1 action, (iii) holds HYPE. Today's repo guidance is a keystore or hardware wallet via `--account`. Whether a hardware wallet or Safe can sign the L1 action is [UNVERIFIED]. The Dispatcher ownership handover (`DISPATCHER_OWNER`) is unchanged.

### 5.3 HyperCore interaction risks (read this before enabling external positions or arbitrary calls)
- Sending **HYPE** to `0x2222…2222`, or a Core-linked **ERC-20** to its `0x20…` system address, moves it onto HyperCore under the sender's address. A vault is a contract with no Core key; funds sent there would be unrecoverable unless the contract can use CoreWriter. Enzyme has no code that does this [V-repo grep], but a user can set `_recipient` of a redemption to such an address, and any future "call arbitrary contract" adapter could be pointed at them. The UI should block `0x2222…`, `0x3333…` and `0x20…` recipients.
- Docs warn: "Do not blindly assume accurate fungibility between Core and EVM spot" and non-round amounts are burned when extra decimals are involved (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/hypercore-less-than-greater-than-hyperevm-transfers.md).
- Core → EVM transfers of USDC are the normal on-ramp for users; they need a little HYPE on the EVM side for gas (about 0.0001 HYPE per vault creation at current prices), which is an onboarding step on AC-1.

### 5.4 Other items
- **MLN:** no MLN on HyperEVM; same treatment as Robinhood (`features.protocolFeeBuyback=false`, MLN `address(0)`) [V-repo: script only stores it]. Confirmed again by the successful fork deploy.
- **GSN / gas relayer:** none known; disabled. Config keeps the `gasRelay` block with `features.gasRelay=false`.
- **Gas for users:** priority fee is burned and always 0; base fee 0.1 gwei. Vault creation 608k gas ≈ 0.00006 HYPE.
- **Reorg/finality:** HyperBFT; I did not read finality docs [UNVERIFIED]. No Enzyme logic depends on it.
- **Licensing:** unchanged from `chain-feasibility.md` §8.

---

## 6. Local Anvil fork: what works, and what adding the chain needs

### 6.1 Can Anvil fork the RPC?
Yes. `anvil --fork-url https://rpc.hyperliquid.xyz/evm --chain-id 999` (Foundry 1.8.1) starts, reports chain ID 999 and base fee 0.1 gwei, serves reads, and runs the deploy and vault flow [V-fork]. Notes:
- The fork inherits the fork block's gas limit. If the fork block is a small block the limit is **3,000,000**, and the core deploy fails (§1.3). Start with `--gas-limit 30000000`.
- Call `evm_mine` once after start, as for the other chains.
- Use the throttle flags from `fork-dry-run.sh` (`--compute-units-per-second 25 --retries 20 --fork-retry-backoff 1000`). The public RPC throttles bursts.
- Pinning with `--fork-block-number <head-50>` worked on this RPC (although the docs say historical reads are unsupported). Pinned reproducibility on other providers is [UNVERIFIED].
- Anvil does not implement dual blocks or HyperCore precompiles. Fork tests prove contract logic, not big-block deployment or Core interactions.

### 6.2 Fork run results (Option A, Circle USDC, local anvil only, `research/hl/fork-sample-hyperliquid-optionA.json`)
- `DeployCore` (with `--broadcast` against the **local** fork only): script succeeded, 32 transactions, 37,387,013 gas, post-deploy check priced 1 WHYPE = 87.459922 USDC.
- `createNewFund(owner, "HL A", "HLA", USDC, 0, 0x, 0x)`: success, 608,353 gas.
- Funded depositor with 1,000 USDC (`fund-anvil.sh`, slot 9); `buyShares(100e6, 1)`: success, 217,464 gas, received 100e18 shares; `calcGav()` = 100,000,000 (100 USDC).
- `redeemSharesInKind` of all shares: success, 110,439 gas; depositor back to 1,000 USDC.
- After advancing fork time by 3 days (all feeds stale), an `eth_call` of `buyShares` still returned shares (USDC-only vault does not read feeds); I did not send it as a transaction.
- Option B: the core deploy succeeded on the fork; vault flow not run.
- All of this was on a throwaway local fork; nothing was sent to any real network. Account #0 is Anvil's public test key, used only locally. The scripts were run in a scratch copy of the repo.

### 6.3 What to add to the repo (done in this PR: `feat/hyperevm`)
1. **`config/chains/hyperliquid.json`**: draft in `research/hl/draft-hyperliquid-config-optionA.json` (tokens: weth = WHYPE, usdc; `denominationAsset: usdc`; `ethUsdAggregator` = HYPE/USD; primitives: USDC/USD and UETH/USD [USD rate]; stale threshold 172,800; features Phase 1: `swaps=false`, adapters false, `protocolFeeBuyback=false`, `gasRelay=false`; `rpc.envVar` = `ETHEREUM_NODE_HYPERLIQUID`; `excludedTokens` listing USDT0, USDH, the TEST CAPPED feed). The draft's `verified` notes still need the final wording pass; the heartbeat and observation fields should be copied from §2.2.
2. **`foundry.toml`**: add `hyperliquid = "${ETHEREUM_NODE_HYPERLIQUID}"` under `[rpc_endpoints]`; add the variable to `.env.example`.
3. **`script/DeployCore.s.sol`**: no change for Option A (only update the comment "all four chains use ETH as the gas token"). Option B needs the draft 3-line patch.
4. **`script/fork-dry-run.sh`**: add the `hyperliquid)` case (ID 999, port 8646, default URL `https://rpc.hyperliquid.xyz/evm`) and pass `--gas-limit 30000000` to the anvil line. **Without it the fork dry run will OutOfGas** (§1.3). `script/README.md`: add the chain, and a "Big blocks" section for real deploys (§1.3).
5. **`qa/fixtures.json`**: add the entry in `research/hl/draft-fixtures-entry-hyperliquid.json` (port 8646; steps: anvil with `--gas-limit 30000000`, `evm_mine`, `anvil_setBalance`, `fund-anvil.sh` USDC and WHYPE, all verified here).
6. **`deployments/hyperliquid.json`**: written only by a real `RUN_KIND=broadcast` run (the script refuses to write the default path otherwise). Until a real deploy exists, add `deployments/fork-samples/hyperliquid.json` (+ `.log`) via `fork-dry-run.sh`. A sample from my run is in `research/hl/fork-sample-hyperliquid-optionA.json` (labelled as a fork; its provenance fields are "unknown" because I ran outside the repo).
7. **`qa/CANONICAL-AC-PACK.md`**: add the HyperEVM row (§7) once the PM confirms.
8. Fork tests for Phase 2 only: Uniswap v3 adapter against HyperSwap Router01 / Project X; not Phase 1.

### 6.4 Things that might differ in CI
The public RPC rate-limits and serves history contrary to its docs. For CI use a paid provider (Alchemy, QuickNode, Chainstack, dRPC and others are listed on Hyperliquid's tools page) or pin the fork and cache.

---

## 7. Per-chain table and proposed scope

| | Ethereum (1) | Base (8453) | Arbitrum (42161) | Robinhood (4663) | **HyperEVM (999)** |
|---|---|---|---|---|---|
| Gas token | ETH | ETH | ETH | ETH | **HYPE** (no WETH9; WHYPE) |
| Oracle | Chainlink | Chainlink | Chainlink | Chainlink, 24 h heartbeat | **Chainlink, 24 h heartbeat, 8- and 18-dec families, 36 feeds** |
| Denomination asset | USDC | USDC | USDC | USDG (Paxos) | **Circle USDC `0xb883…630f`** |
| Stale threshold | n/a | 172,800 | 3,600 | 172,800 | **172,800** |
| Deploy constraint | none | none | none | none | **big blocks needed for 3 contracts** |
| Swap adapters unchanged | Uni v3, ParaSwap v6, 1inch v5, 0x v4 | ParaSwap v6, 1inch v5 | Uni v3, ParaSwap v6, 1inch v5 | none (SwapRouter02 only; ParaSwap v6 live) | **Uni v3 against HyperSwap R01 / Project X (router call tested); none of the others** |
| Recommended | Full | Full minus Uni v3 until patched | Full | Reduced, staged | **Reduced, staged** |

**Proposed phases**
- **Phase 0 (gate):** D1 and D3 decisions.
- **Phase 1:** config + fresh core deploy (big blocks) + create / deposit / redeem with USDC.
- **Phase 2:** `UniswapV3Adapter` against one chosen original-interface router (suggest Project X for depth, subject to a review of that router, which is a third-party fork and not audited by us), behind `AllowedAdapters`, with fork tests and a slippage policy.
- **Phase 3:** 0x v2 / 1inch / Algebra variants, USDT0 as a second asset, HYPE-LST feeds.
- **Out of scope:** HyperCore precompiles, CoreWriter, perps, spot books, staking.

**Proposed AC scope for HyperEVM Phase 1** (canonical IDs from `qa/CANONICAL-AC-PACK.md`):
- AC-1 Connect wallet and switch to chain 999 (HYPE as gas).
- AC-2 Create a portfolio (USDC denomination).
- AC-3 Deposit (Circle USDC).
- AC-5 Redeem.
- AC-6 Reload and view the portfolio.
- AC-4 Swap: **deferred**, as for Robinhood, until a PM cut for Phase 2.
- Suggested additions for PM to accept or reject: AC-H1 UI shows the real USDC address and rejects other tokens named USDC; AC-H2 UI blocks Core system addresses as recipients.

---

## 8. Not verified (explicit list)
1. The actual `evmUserModify` big-block switch and a real big-block deploy on mainnet (only emulated with Anvil's `--gas-limit`). Whether hardware wallets or multisigs can sign it. Real latency of 32 transactions.
2. What the node does with a transaction above 3M gas sent to the small-block mempool.
3. Total supply interpretation of USDC (6.93B) and whether other tokens labelled "USDC" exist on HyperEVM. Explorer search was unusable.
4. Pyth's current HyperEVM address, any RedStone / API3 / DIA feed addresses on HyperEVM.
5. 1inch's HyperEVM router address, 0x v2 Settler details, Aave v3 / Pendle / Bebop on HyperEVM.
6. Project X's router address from its own docs (taken from an explorer page and a crate); Kittenswap Algebra path-encoding incompatibility (inferred only).
7. `UniswapV3Adapter` itself on a fork (only the router call was run), and a vault-level trade.
8. Option B vault flow; SELFDESTRUCT semantics; finality docs.
9. Whether the stale-rate threshold needs revisiting when Chainlink changes heartbeats (it did on Arbitrum in April 2026).
10. Public RPC rate limits and their exact error codes; reproducibility of pinned forks across providers.
11. Testnet token addresses (Circle lists USDC `0x2B3370eE501B4a559b57D449569354196457D8Ab` on HyperEVM testnet; not read). Testnet chain ID 998 and RPC are confirmed.
12. Legal/ops review of Circle's blacklist power over the denomination asset.

## 9. Files in `research/hl/` (supporting artifacts)
- `hl-feeds.json`: Chainlink directory JSON for HyperEVM mainnet (36 feeds). `hl-feeds-onchain.json`: my on-chain reads of every proxy. `gaps.json` / `gaps.py`: update-gap sampling.
- `codes.sh`: code-presence checks (run against a local fork). `ops.py`: opcode / precompile probes. `eip170.py`: size-limit probes. `t1.py`, `rpc.py`: helpers.
- `draft-hyperliquid-config-optionA.json`, `draft-optionB-hyperliquid-config.json`, `draft-optionB-DeployCore.diff`, `draft-fixtures-entry-hyperliquid.json`: drafts only (superseded by `config/chains/hyperliquid.json` and the `hyperliquid` entry in `qa/fixtures.json`; not included in the repo).
- `fork-sample-hyperliquid-optionA.json`: addresses from a throwaway fork run (not a deployment). `logs/`: anvil and forge logs, including the small-block OutOfGas failure tail.

## 10. Sources (consolidated)
- Hyperliquid docs: https://hyperliquid.gitbook.io/hyperliquid-docs/hyperevm ; /for-developers/hyperevm.md ; /for-developers/hyperevm/dual-block-architecture.md ; /interacting-with-hypercore.md ; /hypercore-less-than-greater-than-hyperevm-transfers.md ; /wrapped-hype.md ; /json-rpc.md ; /builder-tools/hyperevm-tools.md ; sitemap https://hyperliquid.gitbook.io/hyperliquid-docs/sitemap.md
- Chainlink: https://reference-data-directory.vercel.app/feeds-hyperliquid-mainnet.json ; https://data.chain.link/feeds/hyperliquid/hyperliquid/{eth-usd,btc-usd,usdc-usd,usdt-usd,hype-usd}
- Circle: https://developers.circle.com/stablecoins/usdc-contract-addresses ; https://www.circle.com/multi-chain-usdc/hyperevm ; https://developers.circle.com/cctp/references/hypercore-contract-addresses
- Other tokens: https://docs.usdt0.to/technical-documentation/deployments ; https://docs.usdh.com/usdh/hyperevm ; https://docs.hyperunit.xyz/developers/key-addresses/mainnet/token-metadata
- DEXes and aggregators: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-hyperevm-deployments ; https://docs.hyperswap.exchange/docs/amm/contracts/hyper-evm/v3/ ; https://kittenswap.gitbook.io/kittenswap/deployed-contracts ; https://hyperevmscan.io/address/0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072 ; https://www.velora.xyz/docs/resources/chains-and-contracts ; https://0x.org/post/hyperevm-support ; https://help.1inch.com/en/articles/16919287-how-to-use-1inch-on-hyperevm
- Oracles (other): https://docs.pyth.network/price-feeds/core/contract-addresses/evm
- Enzyme: https://github.com/nottrunner/protocol (branch `feat/deploy-scripts` for scripts/config) ; https://docs.enzyme.finance/onyx-protocol/contract-addresses.md ; https://raw.githubusercontent.com/enzymefinance/protocol-onyx/main/README.md
- Live reads and fork runs: `https://rpc.hyperliquid.xyz/evm`, `https://rpc.hyperliquid-testnet.xyz/evm`, local Anvil 1.8.1 forks, 2026-10-01 ET.
