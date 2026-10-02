# Chain feasibility: Enzyme-style vaults on Ethereum, Base, Arbitrum, Robinhood Chain (and HyperEVM, §9)

Date: 2026-10-01 (ET). Author: SWE bot. Scope: research only. Nothing was pushed, no PRs opened.
Legend: **[V-repo]** read in the fork. **[V-chain]** I checked it live over public JSON-RPC today. **[V-web]** a cited page says so. **[UNVERIFIED]** I could not confirm it, so treat it as an open item.

## 0. Verdict

- **Robinhood Chain is not blocked.** Mainnet has been live since 2026-07-01 as chain ID 4663.
  - It has Chainlink Data Feeds, including ETH/USD, USDC/USD, USDG/USD and about 35 stock/ETF feeds.
  - It has Uniswap v3 (Factory and SwapRouter02) and Velora/ParaSwap Augustus v6.2.
  - Enzyme has no deployment there, so the whole persistent and release pipeline has to be deployed fresh.
- **The repo's adapters do not drop in on Robinhood Chain, and one does not drop in on Base either.**
  - `UniswapV3Adapter` calls the original SwapRouter `exactInput` (with `deadline`). Only SwapRouter02 is deployed on Robinhood Chain and Base, and its `exactInput` has no `deadline`. Details in §5.
  - The 0x v4 ExchangeProxy and the 1inch v5 router are not deployed on Robinhood Chain.
  - `ParaSwapV6Adapter` is the one swap adapter that works unchanged, because Augustus v6.2 is live on Robinhood Chain.
- **Recommendation:**
  - Ethereum and Arbitrum: full feature set.
  - Base: full feature set minus Uniswap v3 swaps, unless the adapter is patched.
  - Robinhood Chain: **reduced, staged**. Phase 1 is vault create plus deposit/redeem, with USDG as the denomination asset. Phase 2 adds ParaSwap v6 swaps after fork tests. Phase 3 adds a patched Uniswap v3 adapter.
- **One architecture question needs the user's decision.** Enzyme's ValueInterpreter price feeds and adapter registry are owned by the Enzyme DAO/Technical Committee (§1.4). Reusing Enzyme's live deployments on Ethereum, Arbitrum and Base means we cannot add assets or adapters ourselves. A fresh fork deployment on each chain gives us control, but we then own the audits and governance.

---

## 1. What Enzyme needs per chain (from the fork)

Source: `https://github.com/nottrunner/protocol`, branch `dev`, HEAD `da3b870f4d9619e082cb599b172b8b108a62298d` (2026-05-29). It is a fork of `enzymefinance/protocol`, public, contracts only. I read it from a read-only clone at `/workspace/onchain-etf/repo`, using the already-authenticated gh token. I ran no login flow.

### 1.1 Layout [V-repo]
- `contracts/persistent/`: Dispatcher, VaultProxy, AddressListRegistry, ExternalPositionFactory, GlobalConfig, ProtocolFeeReserve, UintListRegistry, FundValueCalculatorRouter, queues, shares wrappers.
- `contracts/release/`: FundDeployer, ComptrollerLib, VaultLib, ValueInterpreter, FeeManager, PolicyManager, IntegrationManager, ExternalPositionManager, GasRelayPaymaster, price feeds, adapters, policies, fees.
- `foundry.toml` has RPC aliases only for mainnet, polygon, arbitrum and base: `ETHEREUM_NODE_MAINNET`, `_POLYGON`, `_ARBITRUM`, `_BASE`. There is no Robinhood Chain entry (`foundry.toml`, `.env.example`, `tests/utils/Constants.sol`, and a case-insensitive grep for "robinhood" across the repo).
- The Solidity versions are mixed (0.6.12 core, 0.8.19 newer), with `evm_version = cancun`. An `eth_call` on the Robinhood Chain RPC accepted PUSH0, MCOPY, TSTORE/TLOAD and BLOBHASH [V-chain]. The EVM version should therefore be compatible.

### 1.2 Deployment config and scripts [V-repo]
- **There are no deployment scripts.** The repo has no `script/` directory and no `*.s.sol` files.
- The only deployment code is the test helper `tests/utils/core/deployment/DeploymentUtils.sol` (plus `PersistentContracts.sol` and `V4ReleaseContracts.sol`).
- The per-chain config is the `ReleaseConfig` struct, with defaults in `tests/bases/IntegrationTest.sol` (`getDefaultMainnetConfig`, `getDefaultArbitrumConfig`, `getDefaultBaseChainConfig`, around lines 530-620).

| `ReleaseConfig` field | Meaning | Robinhood Chain value |
|---|---|---|
| `chainlinkEthUsdAggregatorAddress` | Chainlink ETH/USD proxy | `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` [V-chain] |
| `chainlinkStaleRateThreshold` | one global staleness limit | open decision (see §5.3) |
| `mlnTokenAddress` | MLN, used for the protocol-fee buyback (constructor arg of ComptrollerLib/VaultLib) | no MLN known [UNVERIFIED] |
| `wethTokenAddress`, `wrappedNativeTokenAddress` | WETH | aeWETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` [V-chain, V-web] |
| `gasRelayHubAddress`, `gasRelayTrustedForwarderAddress` | GSN | `address(0)` / `// TODO: lookup real value` in all three existing chain configs; no GSN on Robinhood Chain known [UNVERIFIED] |
| `vaultMlnBurner`, `vaultPositionsLimit` | vault settings | choose |

### 1.3 Price feeds [V-repo]
- `ValueInterpreter` takes `(fundDeployer, wethToken, chainlinkStaleRateThreshold)`. It is built on `ChainlinkPriceFeedMixin` plus `AggregatedDerivativePriceFeedMixin`.
- **Primitives** are assets with a Chainlink-style aggregator quoted in ETH or USD (`addPrimitives`, rate asset `ETH` or `USD`).
- `setEthUsdAggregator` is required as soon as ETH-quoted and USD-quoted assets mix. `__validateAggregator` requires `answer > 0` and a fresh `updatedAt` at registration.
- WETH is special-cased as the rate base (`__getLatestRateData`).
- **Derivatives** are in `price-feeds/derivatives/feeds/`: ERC4626PriceFeed, EnzymeVaultPriceFeed, EtherFiEthPriceFeed, PeggedDerivativesPriceFeed, StaderSDPriceFeed, RevertingPriceFeed.
- Helper aggregators in `primitives/` include ConvertedQuoteAggregator, UsdEthSimulatedAggregator, ERC4626RateAggregator, ChainlinkLikeWstethPriceFeed, PeggedRateDeviationAggregator and NonStandardPrecisionSimulatedAggregator.
- **Staleness is one global threshold** for all primitives. The repo's test configs use `3650 days`, so the production value is [UNVERIFIED]. Staleness reverts, so a stale feed blocks valuation.
- **The contracts do not read an L2 sequencer uptime feed.** A grep for "sequencer" in `contracts/` returned nothing.

### 1.4 Who controls the registries [V-web]
Enzyme docs: "The `ValueInterpreter` is the single point of aggregation of various 'price feeds' (an additional type of 'plugin' that is only managed by the Enzyme Technical Committee)" (https://docs.enzyme.finance/enzyme-blue-protocol/architecture/release).
In the code, `addPrimitives`, `setEthUsdAggregator` and `addDerivatives` are `onlyFundDeployerOwner` [V-repo, `ValueInterpreter.sol`].

### 1.5 Swap and DEX adapters [V-repo, `contracts/release/extensions/integration-manager/integrations/adapters/`]

| Adapter | Needs on-chain | Constructor arg |
|---|---|---|
| UniswapV3Adapter | Uniswap v3 router, original SwapRouter interface (`IUniswapV3SwapRouter.exactInput` with `deadline`) | `_router` |
| ParaSwapV6Adapter | Augustus v6 | `_augustusSwapper` (the tests also use the fee vault `0x00700052…10CC`) |
| ZeroExV4Adapter | 0x v4 Exchange (`0xDef1C0de…5EfF`, legacy OTC/RFQ) | exchange |
| OneInchV5Adapter | 1inch v5 AggregationRouter | router |
| BebopBlendAdapter | Bebop Blend | not examined [UNVERIFIED] |
| Others | Aave v3, ERC4626, Pendle v2, Diva, Stader, TransferAssets, EnzymeV4Vault | not swaps, not needed for Phase 1 |

Which chains the repo tests each adapter on:
- UniswapV3Adapter: Ethereum, Polygon and Arbitrum only (`tests/tests/protocols/uniswap/UniswapV3Utils.sol`; the Arbitrum constants equal the Ethereum ones).
- OneInchV5: Ethereum, Arbitrum and Base.
- ParaSwapV6: Ethereum.
- ZeroExV4: Ethereum.
- AaveV3Debt: Ethereum, Arbitrum and Base.
- GMX v2: Arbitrum.

Other relevant pieces:
- External positions: Uniswap v3 LP (needs NonfungiblePositionManager), Aave v3 debt, GMX v2, Lido and Stader withdrawals, Convex, MYSO, Alice, arbitrary loan.
- Policies: AllowedAdapters, AllowedAdapterIncomingAssets, CumulativeSlippageTolerance, MinMaxInvestment, AllowedDepositRecipients, and others.
- Peripheral: DepositWrapper, UnpermissionedActionsWrapper.
- Persistent extras: single-asset deposit and redemption queues, gated redemption wrapper, shares splitter.

### 1.6 Where per-chain addresses live
- **Not in this repo.** The README points to https://docs.enzyme.finance/developers/contracts. That URL now returns 404 [V-web].
- Enzyme Blue v4 address tables are in the docs repo: `https://github.com/enzymefinance/docs/tree/main/general-info/codebase/contracts/{mainnet,arbitrum,base}.md`. I could not establish how current they are [UNVERIFIED]. The checked-in test constants (`tests/utils/Constants.sol`) hold only Chainlink aggregators and token addresses for the fork tests.
- Enzyme's newer "Onyx" product keeps its addresses in https://github.com/enzymefinance/onyx-sdk/tree/main/packages/environment/src/deployments (page: https://docs.enzyme.finance/onyx-protocol/contract-addresses.md).

---

## 2. Robinhood Chain facts

| Fact | Value | Source |
|---|---|---|
| Status | Mainnet live since 2026-07-01; testnet also exists | https://www.prnewswire.com/news-releases/robinhood-chain-launches-and-adopts-chainlink-to-unlock-access-to-the-onchain-economy-for-millions-of-users-302816242.html ; https://www.alchemy.com/blog/robinhood-chain-mainnet-is-live-on-alchemy |
| Stack | Arbitrum Orbit / Arbitrum Dedicated Blockchains L2, settles to Ethereum | https://docs.robinhood.com/chain/ |
| Chain ID | **4663** (testnet 46630) | https://docs.robinhood.com/chain/add-network-to-wallet/ ; [V-chain] `eth_chainId` = 0x1237 = 4663 |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` (testnet `https://rpc.testnet.chain.robinhood.com`); Alchemy is the recommended provider. The public RPC rate-limits (HTTP 429) under load. | https://docs.robinhood.com/chain/connecting/ ; [V-chain] |
| Explorer | `robinhoodchain.blockscout.com` (testnet `explorer.testnet.chain.robinhood.com`). My direct curl hit a Cloudflare challenge, so I could not independently load the explorer. | https://docs.robinhood.com/chain/add-network-to-wallet/ |
| Gas token | ETH | https://docs.robinhood.com/chain/ |
| Sequencing | first-come-first-served | https://docs.robinhood.com/chain/ |
| `block.number` caveat | on Orbit chains it returns an L1 estimate. The Enzyme contracts have no `block.number` or `chainid` logic (grep of `contracts/`). | https://docs.investorscenter.finance/docs/reference/chain-facts (third-party, 🟡) |
| Oracles | Chainlink Data Feeds, Data Streams and CCIP live from day one; Chainlink is the official oracle | PR Newswire link above ; https://docs.robinhood.com/chain/oracles-and-price-feeds/ |
| Chainlink feed list | 58 feeds in the Chainlink directory JSON (I downloaded it to `research/rh-feeds.json`), all with heartbeat 86400s. Examples: ETH/USD `0x78F3556b…d3A9`, USDC/USD `0x9e6f4605…2546`, USDG/USD `0x61B7e565…9aD2`, USDT/USD, BTC/USD, WBTC/USD, cbBTC/USD, wstETH/USD, weETH/USD, LINK/USD, and about 35 Robinhood stock/ETF feeds (AAPL, NVDA, TSLA, SPY, QQQ and others), all 8 decimals; 18-decimal exchange-rate feeds for wstETH/stETH, weETH/eETH and syrup tokens. | https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json ; also listed in https://docs.investorscenter.finance/docs/reference/chain-facts |
| Feed live check | ETH/USD returned $2,691.74, updated about 31 min before my read. USDC/USD returned 0.99997, updated about 4.4 h before. | [V-chain] `latestRoundData()` |
| Equity feed semantics | "Total Return Value" (price × `uiMultiplier`), 24/5 market hours, may pause during corporate actions | https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood |
| L2 Sequencer Uptime Feed | **None listed for Robinhood Chain.** Chainlink says it is no longer expanding these feeds. | https://docs.chain.link/data-feeds/l2-sequencer-feeds |
| Uniswap v3 | Factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`, SwapRouter02 `0xcaf681a66d020601342297493863e78c959e5cb2`, NonfungiblePositionManager `0x73991a25…8de0d3`, QuoterV2, Permit2, UniversalRouter `0x88767899…c0904`. Code present at Factory and SwapRouter02 [V-chain]. | https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments |
| Uniswap v4 | PoolManager `0x8366a39C…0951`. The UniversalRouter is a modified fork (extra `minHopPriceX36` field). | https://github.com/Uniswap/UniswapX/blob/main/playbook/chains/robinhood.md ; investorscenter page above |
| V3 pools [V-chain] | WETH/USDG pools exist at fee tiers 100, 500, 3000 and 10000. WETH/"USDC" (see below) exists at fee tier 100. | `UniswapV3Factory.getPool` |
| Other DEX / routing | Rialto (propAMM), 0x RFQ, 1inch Fusion, LiFi; Lighter (orderbook) | https://docs.robinhood.com/chain/building-with-stock-tokens/ |
| Velora/ParaSwap | Robinhood Chain (4663) listed with Delta and Market (Augustus v6.2 at `0x6a000f20005980200259b80c5102003040001068`) | https://www.velora.xyz/docs/resources/chains-and-contracts ; [V-chain] 24,562 bytes of code at that address on Robinhood Chain |
| 1inch | Robinhood Chain supported (Swap API v6, Fusion). Liquidity is thin and Uniswap v4 hooked pools are not routed. | https://help.1inch.com/en/articles/16799830-robinhood-chain-on-1inch-what-s-supported-today |
| 0x | Search summary says 0x supports Robinhood Chain (RFQ/Gasless). I did not verify the contract type; see §5. | https://blog.kyberswap.com/best-dex-aggregator-api-for-swapping-on-robinhood-chain/ (via search summary only, [UNVERIFIED]) |
| Canonical tokens | WETH (aeWETH) `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` and USDG (Paxos) `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals | https://docs.robinhood.com/chain/contracts/ ; [V-chain] |
| **USDC: do not assume** | The token labelled `USDC` at `0x378F906eAD242F0C3aa9ed45AA07612A2C088030` reads on-chain as name "Universal Stable Digital Coin", **18 decimals**, total supply exactly 1,000,000,000. A search summary calls it "Circle-issued native USDC", but Circle's official mainnet list has no Robinhood Chain entry. Treat it as **unverified and probably not Circle USDC**. The canonical Arbitrum-bridged USDC is `0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8` (6 decimals, name "USD Coin") [V-chain] and is dust per the third-party page. | https://developers.circle.com/stablecoins/usdc-contract-addresses ; [V-chain] ; https://docs.investorscenter.finance/docs/reference/chain-facts |
| Stock tokens | Standard ERC-20 (18 decimals, ERC-8056 `uiMultiplier`), tokenised debt securities issued by Robinhood Assets (Jersey) Ltd. Impersonator tokens exist, so match addresses only. | https://docs.robinhood.com/chain/stock-tokens/ ; investorscenter page above |
| Transfer restrictions | Docs say they are plain ERC-20s that can be held and transferred in any wallet and composed in contracts. Legal/eligibility limits are front-end/jurisdictional. I found no contract-level allowlist, but did not test a vault transfer. | https://docs.robinhood.com/chain/building-with-stock-tokens/ ; https://docs.robinhood.com/chain/stock-tokens/ [UNVERIFIED for a vault] |
| Enzyme on Robinhood Chain | **None found.** Onyx supported networks are mainnet, arbitrum, avalanche, base, bnb_smart_chain, ethereum_sepolia, mega_eth, plume and rayls. The Enzyme Blue address list has Ethereum, Arbitrum and Base only. | https://raw.githubusercontent.com/enzymefinance/protocol-onyx/main/README.md ; https://docs.enzyme.finance/onyx-protocol/contract-addresses.md ; docs repo files above |

---

## 3. Base and Arbitrum (and Ethereum) checks

| Item | Ethereum | Base | Arbitrum |
|---|---|---|---|
| Chainlink ETH/USD (repo constant) | `0x5f4eC3Df…8419`, live $2,693 [V-chain] | `0x71041ddd…Bb70`, live $2,702 [V-chain] | `0x639Fe6ab…a612`, live $2,702 [V-chain] |
| Chainlink USDC/USD | n/a in repo constants (USDC feed not listed there) | `0x7e860098…2bc6B`, live 0.99995, updated 7 h ago [V-chain] | `0x50834F31…4aD3`, live 0.99996 [V-chain] |
| L2 sequencer feed | n/a | `0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`, status 0 = up [V-chain]; https://docs.chain.link/data-feeds/l2-sequencer-feeds | `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`, status 0 = up [V-chain]; same Chainlink page |
| Uniswap v3 router | original SwapRouter `0xE592427A…1564` | **SwapRouter02** `0x2626664c2603336E57B271c5C0b26F421741e481`, https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments | original SwapRouter `0xE592427A…1564` (12,070 bytes, original `exactInput` selector present [V-chain]) and SwapRouter02 `0x68b34658…Fc45`, https://docs.uniswap.org/contracts/v3/reference/deployments/arbitrum-deployments |
| Enzyme Blue v4 deployed? | Yes: FundDeployer `0x4f1c53f0…6360`, ValueInterpreter `0xd7b0610d…a327`, UniswapV3Adapter `0xed6a08e0…2793`, ZeroExV4Adapter `0x49affbe9…b2f4`, ParaSwapV6Adapter, OneInchV5Adapter [V-web docs repo; code present at all four I checked, V-chain] | Yes: FundDeployer `0xbb274df6…aeb`, ValueInterpreter `0xa76bc052…e8e1`, adapters: Aave v3, ERC4626, OneInchV5, ParaSwapV5, ParaSwapV6, TransferAssets, EnzymeV4Vault. **No UniswapV3Adapter and no ZeroEx adapter listed.** | Yes: FundDeployer `0xa2b4c827…ec3`, ValueInterpreter `0xdd5f18a5…a06c`, adapters: Aave v3, BalancerV2Liquidity, OneInchV5, ParaSwapV5, ParaSwapV6, ThreeOneThird, UniswapV3, TransferAssets, EnzymeV4Vault. No ZeroEx adapter listed. |
| Aggregator contracts present | 0x v4 proxy, 1inch v5 and v6, Augustus 6.2 [V-chain] | 1inch v5 and v6, Augustus 6.2; 0x v4 proxy present (1,195 bytes) [V-chain] | 1inch v5 and v6, Augustus 6.2; 0x v4 proxy present (1,195 bytes) [V-chain] |

Sources for the Enzyme address rows: `https://raw.githubusercontent.com/enzymefinance/docs/main/general-info/codebase/contracts/{mainnet,arbitrum,base}.md`.

---

## 4. Per-chain table

| | **Ethereum (1)** | **Base (8453)** | **Arbitrum One (42161)** | **Robinhood Chain (4663)** |
|---|---|---|---|---|
| **Oracle availability** | Chainlink, deepest. The repo has full config and fork tests. | Chainlink ETH/USD and USDC/USD live, and the sequencer feed exists. The repo has `BASE_MLN_ETH_AGGREGATOR = 0x0 // TODO`, so there is no MLN feed. | Chainlink ETH/USD, USDC/USD and others live. Sequencer feed exists. | Chainlink Data Feeds live. ETH/USD, USDC/USD, USDG/USD, BTC/WBTC/cbBTC, LINK and about 35 stock/ETF feeds, all with a 24h heartbeat. **No sequencer uptime feed.** Equity feeds are 24/5, so stale on weekends, and may pause around corporate actions. |
| **DEX adapters available** | UniswapV3, ParaSwapV6, OneInchV5, ZeroExV4 (repo adapters plus live Enzyme deployments) | ParaSwapV6, OneInchV5, ERC4626 live. UniswapV3Adapter would need a SwapRouter02 patch. | UniswapV3 (original router), ParaSwapV6, OneInchV5, plus Balancer, 3-1-Third and others in the live deployment. | Uniswap v3 SwapRouter02 and Factory live. Velora/ParaSwap Augustus v6.2 live. 1inch v6 router has code, but the repo only has a v5 adapter. 0x v4 ExchangeProxy and 1inch v5 router: no code. |
| **Gap vs Enzyme needs** | None found. | `UniswapV3Adapter` interface mismatch (§5.1). No MLN/ETH aggregator. GSN hub unset in repo config. | None found for core. ZeroExV4 not deployed (not needed). | (1) No Enzyme deployment, so full persistent + release deploy. (2) Adapter mismatch (§5). (3) MLN token, GSN hub, sequencer feed absent. (4) USDC identity unclear. (5) Thin stock-token liquidity, so swaps will be price-impact-heavy. (6) One global staleness threshold must fit 24/5 equity feeds. |
| **Recommended feature set** | **Full.** | **Full minus Uniswap v3 swaps** (or full once the adapter is patched). | **Full.** | **Reduced, staged.** Phase 1: core vault, fees, policies, USDG-denominated vaults, deposit/redeem, no external positions, no GSN gas relay, no MLN buyback. Phase 2: ParaSwap v6 swaps behind AllowedAdapters. Phase 3: patched UniswapV3Adapter, and 1inch v6 if wanted. |

---

## 5. Robinhood Chain gap detail

### 5.1 Uniswap v3 interface mismatch (also affects Base)
- The repo's `UniswapV3ActionsMixin` calls `IUniswapV3SwapRouter.exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum))`. That selector is `c04b8d59`, from the original SwapRouter.
- SwapRouter02's `exactInput((bytes,address,uint256,uint256))` (no `deadline`, selector `b858183f`) is what Uniswap lists for Robinhood Chain and Base. I confirmed in deployed bytecode that Robinhood Chain SwapRouter02 and Base SwapRouter02 contain `b858183f` and not `c04b8d59`. The Arbitrum original router contains `c04b8d59`. [V-chain]
- The address `0xE592427A…1564` on Robinhood Chain and Base has a tiny (2,109-byte) contract that is not SwapRouter, so do not assume it.
- Fix: add a SwapRouter02-style variant of the mixin and adapter. The change is small, but it needs fork tests and probably a re-audit of the diff. Note that the Uniswap v3 LP external position uses the NonfungiblePositionManager, which is a separate matter.

### 5.2 0x and 1inch
- The repo's `ZeroExV4Adapter` targets the legacy 0x v4 exchange at `0xDef1C0de…5EfF`. That address has **no code on Robinhood Chain** [V-chain]. 0x's Robinhood Chain support is a different contract family, so the existing adapter cannot be reused.
- `OneInchV5Adapter` targets the 1inch v5 router `0x11111112…0582`. That address has **no code on Robinhood Chain**. The v6 router `0x111111125421cA6dc452d289314280a0f8842A65` has code there [V-chain], but the repo has no v6 adapter.

### 5.3 Oracle behaviour to design around
- Staleness: `ValueInterpreter` has one global threshold. Robinhood equity feeds have a 86,400 s heartbeat and a 0.5% deviation threshold [V-web, directory JSON], and they follow 24/5 market hours. A threshold shorter than about 3 days would make equity-holding vaults un-priceable over weekends. A threshold of 3650 days (the test value) removes staleness protection, so the production policy needs a decision.
- Corporate actions: the stock-token feed already includes `uiMultiplier`, so do **not** re-apply it. While a feed is paused (`oraclePaused()`), valuation will fail or go stale, which blocks deposits and redemptions that need pricing. Whether in-kind redemption still works during a pause is [UNVERIFIED].
- No sequencer uptime gating exists on Robinhood Chain, and the Enzyme contracts never use one. Risk is accepted by omission.
- Decimals: USDG has 6, stock tokens 18, feeds 8 (18 for the exchange-rate feeds). Enzyme reads token decimals on registration, so this is handled, but add tests for each.

### 5.4 Other items to settle before deploying
- **MLN:** it is a required constructor param for ComptrollerLib/VaultLib. I did not verify whether `address(0)` is accepted, so plan for a dummy burnable token if not. The protocol-fee buyback would then be unusable.
- **GSN gas relayer:** all three existing configs leave the hub as `address(0)` (`TODO`). Disable it on Robinhood Chain.
- **Denomination asset:** USDG (Paxos) is the natural choice (native, has a Chainlink feed, deepest stablecoin liquidity per a third-party source). It is an issuer-controlled stablecoin, so freeze risk applies [UNVERIFIED legal/ops review].
- **Liquidity:** a third-party sweep says stock-token liquidity is concentrated in USDG pools and many names have no sanely priced pool (https://docs.investorscenter.finance/docs/reference/chain-facts, 🟡, dated July/Aug 2026). Docs say tokenised stocks trade mainly by RFQ at launch (https://docs.robinhood.com/chain/building-with-stock-tokens/).
- **Aave v3:** not checked on Robinhood Chain. Morpho is listed as the lending partner (https://docs.robinhood.com/chain/). The Aave v3 adapter and debt position are therefore out of scope for Phase 1.

---

## 6. Not verified (explicit list)
1. Whether the docs-repo address tables for Ethereum/Arbitrum/Base match the current live Enzyme Blue release. I only confirmed that code exists at the addresses I probed.
2. Which Enzyme-side parameters are in production use (stale threshold, GSN hub).
3. Whether `address(0)` is accepted as the MLN token in the constructors.
4. The identity and issuer of the token at `0x378F906e…8030` ("USDC", 18 decimals). Whether Circle native USDC is deployed on Robinhood Chain at all.
5. 0x's contract addresses and API on Robinhood Chain (only a search summary).
6. Bebop Blend, Aave v3 and Pendle on Robinhood Chain.
7. The Robinhood Chain Blockscout explorer. Direct fetch was blocked by Cloudflare, so I relied on the docs.
8. Whether stock tokens transfer into and out of an Enzyme VaultProxy without contract-level restrictions. No on-chain test was run.
9. Whether the sequencer/compliance screening mentioned in a search summary affects vault addresses.
10. Current testnet status beyond the documented chain ID 46630 and RPC.
11. Robinhood Chain Uniswap v3 pool depth for any given stock-token pair (I checked only that the WETH/USDG and WETH/"USDC" pools exist).

## 7. Sources (consolidated)
- Fork: https://github.com/nottrunner/protocol (branch `dev`)
- Robinhood Chain docs: https://docs.robinhood.com/chain/ ; /connecting/ ; /add-network-to-wallet/ ; /contracts/ ; /oracles-and-price-feeds/ ; /stock-tokens/ ; /building-with-stock-tokens/ ; /data-streams/
- Launch: https://www.prnewswire.com/news-releases/robinhood-chain-launches-and-adopts-chainlink-to-unlock-access-to-the-onchain-economy-for-millions-of-users-302816242.html ; https://www.alchemy.com/blog/robinhood-chain-mainnet-is-live-on-alchemy ; https://dev.chain.link/changelog/data-feeds-expands-to-robinhood-chain-mainnet
- Chainlink: https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json ; https://docs.chain.link/data-feeds/l2-sequencer-feeds ; https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
- Uniswap: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments ; https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments ; https://docs.uniswap.org/contracts/v3/reference/deployments/arbitrum-deployments ; https://github.com/Uniswap/UniswapX/blob/main/playbook/chains/robinhood.md
- Aggregators: https://www.velora.xyz/docs/resources/chains-and-contracts ; https://help.1inch.com/en/articles/16799830-robinhood-chain-on-1inch-what-s-supported-today ; https://blog.kyberswap.com/best-dex-aggregator-api-for-swapping-on-robinhood-chain/
- Tokens: https://developers.circle.com/stablecoins/usdc-contract-addresses ; https://docs.investorscenter.finance/docs/reference/chain-facts (third-party)
- Enzyme: https://docs.enzyme.finance/enzyme-blue-protocol/architecture/release ; https://docs.enzyme.finance/onyx-protocol/contract-addresses.md ; https://github.com/enzymefinance/docs (general-info/codebase/contracts/*.md) ; https://raw.githubusercontent.com/enzymefinance/protocol-onyx/main/README.md ; https://github.com/enzymefinance/onyx-sdk
- Live reads: public JSON-RPC, 2026-10-01 — `https://rpc.mainnet.chain.robinhood.com`, `https://mainnet.base.org`, `https://base-rpc.publicnode.com`, `https://arb1.arbitrum.io/rpc`, `https://ethereum-rpc.publicnode.com`.

## 8. Licensing note [V-repo]
`LICENSE`: GPL-3.0 for the public. Enzyme Foundation may license under other terms (e.g. BUSL-1.1) for affiliated products, and public users get GPL-3.0 only. A hosted app on top of a GPL-3.0 fork is fine, but modified contract source we deploy must be publishable under GPL-3.0. Have counsel confirm.

---

## 9. HyperEVM (chain id 999), the fifth chain [added with PR `feat/hyperevm`]

Full study: `research/hyperevm-feasibility.md` (read-only RPC checks on 2026-10-01/02; local Anvil fork runs). Summary:

- **Feasible for Phase 1** (create vault, deposit, redeem; AC-1, 2, 3, 5, 6). Swaps are Phase 2 (via the existing `UniswapV3Adapter` pointed at one original-interface Uniswap v3 fork router). Enzyme has no HyperEVM deployment, so this is a fresh deploy.
- **Denomination asset:** Circle-native USDC `0xb88339CB7199b77E23DB6E890353E22632Ba630f` (6 dec). Two independent sources: an on-chain read via `https://rpc.hyperliquid.xyz/evm` and Circle's published list (https://developers.circle.com/stablecoins/usdc-contract-addresses, row "HyperEVM").
- **"WETH" anchor:** HYPE is the gas token, so Wrapped HYPE `0x5555555555555555555555555555555555555555` (immutable WETH9 clone, https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/wrapped-hype) is Enzyme's `WETH_TOKEN` and the HYPE/USD feed `0xa5a72eF19F82A579431186402425593a559ed352` is the "ETH/USD" aggregator. No script change needed.
- **Oracles:** Chainlink feeds are live; only the **8-decimal** family is used (USDC/USD `0xA0Adc43ce7AfE3EE7d7eac3C994E178D0620223B`, HYPE/USD). All heartbeats are 86400 s; USDC/USD was observed at heartbeat + 84 s, so the stale-rate threshold is **172800 s**.
- **Big blocks (the main operational finding).** HyperEVM interleaves 1-second "small" blocks (3M gas) with 1-minute "big" blocks (30M gas). `ComptrollerLib` (~5.17M gas), `VaultLib` (~4.26M) and `FundDeployer` (~3.96M) cost more than the 3M small-block limit, so the core deployment **must run in big-block mode**: the deployer address has to enable it with the L1 action `{"type":"evmUserModify","usingBigBlocks":true}` (the address must exist as a HyperCore user) and then send the deploy transactions to the big-block mempool. Bytecode itself fits EIP-170 (largest runtime 23,521 of 24,576 bytes). A local Anvil fork inherits the fork block's gas limit and cannot enforce the cap: on a fork left at 3M the core deploy fails with `OutOfGas` (re-checked 2026-10-02), so fork runs use `--gas-limit 30000000` (`script/fork-dry-run.sh hyperliquid` does this) and the deployment record carries the additive fields `bigBlocksEmulated` (fork records), `blockGasLimit` and `bigBlocksNote`. What the node does with a >3M transaction sent to the small-block mempool is unverified.
- **Adapters:** ParaSwap/1inch/0x routers are not deployed on HyperEVM; `UniswapV3Adapter` can work unchanged against original-interface routers; SwapRouter02-style routers need the SwapRouter02 variant. None are deployed in Phase 1.
- **Repo support:** `config/chains/hyperliquid.json`, `999` in `config/mainnet-chain-ids.json`, `qa/fixtures.json` entry, `script/fork-dry-run.sh hyperliquid`, `deployments/hyperliquid.json` (local-fork broadcast record).

