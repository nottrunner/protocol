// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {DeployCoreHarness} from "tests/tests/deployment/DeployCoreRecords.t.sol";

interface VmKeyExistsTest {
    function keyExistsJson(string calldata, string calldata) external view returns (bool);
}

/// @dev Adds the HyperEVM big-block record fields to the hook harness.
contract DeployCoreBigBlocksHarness is DeployCoreHarness {
    uint256 public gasLimit;
    bool public required;

    function setGasLimit(uint256 _v) external {
        gasLimit = _v;
    }

    function setRequired(bool _v) external {
        required = _v;
    }

    function _blockGasLimit() internal view override returns (uint256) {
        return gasLimit;
    }

    function write_() external {
        writeBigBlocksChain("hyperliquid");
    }

    function writeBigBlocksChain(string memory _chain) public {
        Cfg memory c;
        c.chain = _chain;
        c.denominationSymbol = "USDC";
        c.denominationAsset = address(0xdead);
        c.staleRateThreshold = 172800;
        c.bigBlocksRequired = required;
        Persistent memory p;
        Release memory r;
        Adapters memory a; // HyperEVM has no adapters in Phase 1
        writeDeployment(c, p, r, a);
    }
}

/// @dev HyperEVM (chain id 999): config validation and the additive big-block fields of the deployment record.
contract DeployCoreHyperliquidTest is Test {
    using stdJson for string;

    address internal constant WHYPE = 0x5555555555555555555555555555555555555555;
    address internal constant CIRCLE_USDC = 0xb88339CB7199b77E23DB6E890353E22632Ba630f;
    address internal constant HYPE_USD_FEED = 0xa5a72eF19F82A579431186402425593a559ed352;
    address internal constant USDC_USD_FEED = 0xA0Adc43ce7AfE3EE7d7eac3C994E178D0620223B;

    DeployCoreBigBlocksHarness internal h;

    function setUp() public {
        h = new DeployCoreBigBlocksHarness();
        h.setRunKind("fork");
        h.setAnvil(true);
        vm.chainId(999);
    }

    function __has(string memory _json, string memory _key) internal view returns (bool) {
        return VmKeyExistsTest(address(vm)).keyExistsJson(_json, _key);
    }

    function __config(string memory _chain) internal view returns (string memory) {
        return vm.readFile(string.concat("config/chains/", _chain, ".json"));
    }

    // Config

    function test_config_hyperliquid_identity() public {
        string memory json = __config("hyperliquid");
        assertEq(json.readUint(".chainId"), 999);
        assertEq(json.readString(".name"), "hyperliquid");
        assertEq(json.readString(".rpc.envVar"), "ETHEREUM_NODE_HYPERLIQUID");
        assertEq(json.readString(".rpc.foundryAlias"), "hyperliquid");
    }

    function test_config_hyperliquid_tokensAndFeeds() public {
        string memory json = __config("hyperliquid");
        // Wrapped HYPE is the ETH-equivalent anchor, HYPE/USD its feed
        assertEq(json.readAddress(".tokens.weth.address"), WHYPE);
        assertEq(json.readAddress(".chainlink.ethUsdAggregator.address"), HYPE_USD_FEED);
        // Circle-native USDC is the denomination asset
        assertEq(json.readString(".denominationAsset"), "usdc");
        assertEq(json.readAddress(".tokens.usdc.address"), CIRCLE_USDC);
        assertEq(json.readAddress(".chainlink.primitives[0].token"), CIRCLE_USDC);
        assertEq(json.readAddress(".chainlink.primitives[0].aggregator"), USDC_USD_FEED);
        assertEq(json.readString(".chainlink.primitives[0].rateAsset"), "USD");
        assertFalse(__has(json, ".chainlink.primitives[1]"), "Phase 1 registers only USDC");
        assertEq(json.readUint(".release.chainlinkStaleRateThresholdSeconds"), 172800);
    }

    function test_config_hyperliquid_phase1_noSwapsNoAdapters() public {
        string memory json = __config("hyperliquid");
        assertEq(json.readUint(".features.phase"), 1);
        assertTrue(json.readBool(".features.vaultCreation"));
        assertTrue(json.readBool(".features.depositRedeem"));
        assertFalse(json.readBool(".features.swaps"));
        assertFalse(json.readBool(".features.uniswapV3Adapter"));
        assertFalse(json.readBool(".features.uniswapV3SwapRouter02Adapter"));
        assertFalse(json.readBool(".features.paraSwapV6Adapter"));
        assertFalse(json.readBool(".features.oneInchV5Adapter"));
        assertFalse(json.readBool(".features.zeroExV4Adapter"));
        assertFalse(json.readBool(".features.externalPositions"));
        assertFalse(json.readBool(".features.gasRelay"));
        assertFalse(json.readBool(".features.protocolFeeBuyback"));
        assertTrue(bytes(json.readString(".features.phaseNote")).length > 0);
        assertTrue(json.readBool(".deployment.bigBlocksRequired"));
    }

    /// Every chain config is on the mainnet allowlist, names its denomination asset and has the keys DeployCore reads.
    function test_config_allChains_consistentWithAllowlistAndLoader() public {
        string[5] memory chains = ["ethereum", "base", "arbitrum", "robinhood", "hyperliquid"];
        string memory ids = vm.readFile("config/mainnet-chain-ids.json");
        uint256[] memory allowed = ids.readUintArray(".mainnetChainIds");
        for (uint256 i; i < chains.length; i++) {
            string memory json = __config(chains[i]);
            uint256 id = json.readUint(".chainId");
            bool found;
            for (uint256 j; j < allowed.length; j++) {
                if (allowed[j] == id) found = true;
            }
            assertTrue(found, string.concat(chains[i], ": chain id missing from config/mainnet-chain-ids.json"));
            assertEq(json.readString(".name"), chains[i]);
            assertTrue(json.readAddress(".tokens.weth.address") != address(0));
            string memory denom = json.readString(".denominationAsset");
            assertTrue(json.readAddress(string.concat(".tokens.", denom, ".address")) != address(0));
            assertTrue(json.readAddress(".chainlink.ethUsdAggregator.address") != address(0));
            assertTrue(json.readUint(".release.chainlinkStaleRateThresholdSeconds") > 0);
            // a chain with swaps off must not claim any adapter
            if (!json.readBool(".features.swaps")) {
                assertFalse(json.readBool(".features.uniswapV3Adapter"));
                assertFalse(json.readBool(".features.paraSwapV6Adapter"));
            }
        }
    }

    function test_allowlist_includesHyperEVM() public {
        assertTrue(h.knownMainnet(999));
    }

    // Record: additive big-block fields

    function test_record_bigBlocksEmulated_trueWith30MGasLimit() public {
        h.setRequired(true);
        h.setGasLimit(30_000_000);
        h.write_();
        string memory json = h.writtenJson();
        assertTrue(json.readBool(".bigBlocksEmulated"));
        assertEq(json.readUint(".blockGasLimit"), 30_000_000);
        assertTrue(bytes(json.readString(".bigBlocksNote")).length > 0);
        // existing schema untouched
        assertEq(json.readString(".kind"), "fork, not mainnet");
        assertFalse(json.readBool(".mainnet"));
        assertEq(json.readUint(".chainId"), 999);
        assertEq(json.readAddress(".denominationAsset.address"), address(0xdead));
    }

    function test_record_bigBlocksEmulated_falseOnSmallBlockGasLimit() public {
        h.setRequired(true);
        h.setGasLimit(3_000_000);
        h.write_();
        string memory json = h.writtenJson();
        assertFalse(json.readBool(".bigBlocksEmulated"));
        assertEq(json.readUint(".blockGasLimit"), 3_000_000);
    }

    function test_record_noBigBlockFieldsForOtherChains() public {
        h.setRequired(false);
        h.setGasLimit(30_000_000);
        h.write_();
        string memory json = h.writtenJson();
        assertFalse(__has(json, ".bigBlocksEmulated"));
        assertFalse(__has(json, ".blockGasLimit"));
        assertFalse(__has(json, ".bigBlocksNote"));
    }

    function test_record_pendingBroadcast_noBigBlockBooleanAndNeverMainnet() public {
        h.setRunKind("broadcast");
        h.setAnvil(false);
        h.setBroadcasting(true);
        h.setRequired(true);
        h.setGasLimit(30_000_000);
        h.write_();
        string memory json = h.writtenJson();
        assertFalse(json.readBool(".mainnet"));
        assertTrue(json.readBool(".pendingBroadcast"));
        assertTrue(bytes(json.readString(".bigBlocksNote")).length > 0);
        // a real broadcast is never reported as emulated/enabled big blocks: only the simulation gas limit and the note
        assertFalse(__has(json, ".bigBlocksEmulated"));
        assertEq(json.readUint(".blockGasLimit"), 30_000_000);
    }
}
