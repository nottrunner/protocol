// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {VmSafe} from "forge-std/Vm.sol";

/// @dev Minimal inline interfaces: tests/interfaces/internal/* is generated (gitignored) and must not be
/// required to run deploy scripts.
interface IOwned {
    function setNominatedOwner(address) external;
}

interface IDispatcherDeploy is IOwned {
    function setCurrentFundDeployer(address) external;
    function getCurrentFundDeployer() external view returns (address);
}

interface IGlobalConfigProxyDeploy {
    function setGlobalConfigLib(address) external;
}

interface IExternalPositionFactoryDeploy {
    function addPositionDeployers(address[] calldata) external;
}

interface IFundValueCalculatorRouterDeploy {
    function setFundValueCalculators(address[] calldata, address[] calldata) external;
}

interface IFundDeployerDeploy {
    function setComptrollerLib(address) external;
    function setProtocolFeeTracker(address) external;
    function setVaultLib(address) external;
    function setReleaseLive() external;
    function releaseIsLive() external view returns (bool);
}

interface IValueInterpreterDeploy {
    function setEthUsdAggregator(address) external;
    function addPrimitives(address[] calldata, address[] calldata, uint8[] calldata) external;
    function calcCanonicalAssetValue(address, uint256, address) external view returns (uint256);
}

interface VmKeyExists {
    function keyExistsJson(string calldata, string calldata) external view returns (bool);
}

/// @dev `vm.isContext` is not in the pinned forge-std Vm interface. ForgeContext enum values used:
/// ScriptDryRun = 5 (`forge script` without --broadcast), ScriptBroadcast = 6 (`forge script --broadcast`),
/// ScriptResume = 7 (`forge script --resume`).
interface VmContext {
    function isContext(uint8 context) external view returns (bool);
}

interface IAddressListRegistryDeploy {
    function createList(address _owner, uint8 _updateType, address[] calldata _initialItems)
        external
        returns (uint256 id_);
    function isInList(uint256 _id, address _item) external view returns (bool);
}

interface IAdapterDeploy {
    function getIntegrationManager() external view returns (address);
}

/// @dev `vm.rpc` is not in the pinned forge-std Vm interface; used only to detect an Anvil node (`anvil_nodeInfo`).
interface VmRpc {
    function rpc(string calldata method, string calldata params) external returns (bytes memory);
}

/// @title DeployCore
/// @notice Deploys the full fresh-fork stack (persistent + release core) for ONE chain, reading
/// `config/chains/<CHAIN>.json`. Mirrors tests/utils/core/deployment/DeploymentUtils.sol, but with
/// real broadcasts instead of vm.prank.
///
/// Dry run (nothing is sent): see script/README.md. Never pass a private key on the command line;
/// use `--account <keystore>` / `--ledger` when broadcasting.
///
/// The broadcaster (msg.sender) becomes Dispatcher owner and FundDeployer creator/owner for setup. If env
/// `DISPATCHER_OWNER` is set, Dispatcher ownership is only NOMINATED to it at the end (it must claim).
contract DeployCore is Script {
    struct Cfg {
        string chain;
        address weth;
        address wrappedNative;
        address mln;
        address mlnBurner;
        address ethUsdAggregator;
        uint256 staleRateThreshold;
        string denominationSymbol;
        address denominationAsset;
        uint256 positionsLimit;
        bool bigBlocksRequired; // config.deployment.bigBlocksRequired (HyperEVM: contracts exceed the 3M small-block gas limit)
        address gasRelayHub;
        address gasRelayForwarder;
        uint256 gasRelayDepositCooldown;
        uint256 gasRelayDepositMaxTotal;
        uint256 gasRelayFeeMaxPercent;
        uint256 gasRelayRelayFeeMaxBase;
        address[] primitives;
        address[] aggregators;
        uint8[] rateAssets;
        // Adapter targets (address(0) = adapter not deployed on this chain)
        address uniswapV3Router; // UniswapV3Adapter: original SwapRouter (exactInput has `deadline`)
        address uniswapV3SwapRouter02; // UniswapV3SwapRouter02Adapter: SwapRouter02 (no `deadline`)
        address paraSwapAugustusV6; // ParaSwapV6Adapter
    }

    struct Persistent {
        address dispatcher;
        address addressListRegistry;
        address externalPositionFactory;
        address globalConfigProxy;
        address protocolFeeReserveProxy;
        address uintListRegistry;
        address fundValueCalculatorRouter;
    }

    struct Release {
        address gasRelayPaymasterFactory;
        address fundDeployer;
        address protocolFeeTracker;
        address valueInterpreter;
        address policyManager;
        address externalPositionManager;
        address feeManager;
        address integrationManager;
        address comptrollerLib;
        address vaultLib;
        address fundValueCalculator;
    }

    /// @dev Integration adapters. Enzyme's IntegrationManager has no adapter registry: any contract constructed with the
    /// IntegrationManager address can be called through it (`onlyIntegrationManager` on the adapter side), and funds
    /// restrict adapters per fund via the AllowedAdapters policies. So "registering" an adapter here means (1) binding it
    /// to this deployment's IntegrationManager at construction and (2) listing it in an immutable AddressListRegistry list
    /// (`approvedAdaptersListId`, owner = Dispatcher, UpdateType.None) that funds can use with AllowedAdaptersPolicy.
    struct Adapters {
        address uniswapV3Adapter;
        address uniswapV3SwapRouter02Adapter;
        address paraSwapV6Adapter;
        uint256 approvedAdaptersListId;
        bool listCreated;
    }

    function run() external returns (Persistent memory p_, Release memory r_) {
        Adapters memory a_;
        // Fail BEFORE any transaction is simulated or sent if RUN_KIND / --broadcast / node type are inconsistent
        preflight(vm.envString("CHAIN"));
        (p_, r_, a_) = deployAll(vm.envString("CHAIN"));
    }

    /// @dev Whole flow, also callable from tests (`new DeployCore().deployAll("base")`).
    function deployAll(string memory _chain)
        public
        returns (Persistent memory p_, Release memory r_, Adapters memory a_)
    {
        Cfg memory c = loadConfig(_chain);

        vm.startBroadcast();
        p_ = deployPersistent();
        r_ = deployRelease(c, p_);
        postDeploy(c, p_, r_);
        a_ = deployAdapters(c, p_, r_);
        address nextOwner = vm.envOr("DISPATCHER_OWNER", address(0));
        if (nextOwner != address(0)) {
            IOwned(p_.dispatcher).setNominatedOwner(nextOwner);
        }
        vm.stopBroadcast();

        sanityCheck(c, p_, r_);
        sanityCheckAdapters(c, p_, r_, a_);
        logAddresses(c, p_, r_, a_);
        writeDeployment(c, p_, r_, a_);
    }

    // DEPLOYMENT RECORDS
    //
    // Safety model. A record under deployments/ must never claim something that did not happen:
    //  * Nothing is written unless RUN_KIND is set (fork | broadcast). OUTPUT_PATH is gone: the path is always
    //    deployments/<chain>.json (or deployments/<chain>.pending.json), and foundry.toml only grants fs access to those files.
    //  * RUN_KIND=fork needs an Anvil node. It writes deployments/<chain>.json with "kind": "fork, not mainnet",
    //    "mainnet": false. "simulated" is true for a plain simulation and false when the txs were broadcast to the Anvil.
    //  * RUN_KIND=broadcast needs a NON-Anvil node. While the script runs, its transactions are only simulated: they
    //    reach the chain after the script returns, and may fail or be dropped. So the script NEVER writes mainnet: true.
    //    Without --broadcast it writes nothing. With --broadcast it writes deployments/<chain>.pending.json
    //    ("mainnet": false, "simulated": true, "pendingBroadcast": true). script/finalize-broadcast.sh turns it into
    //    deployments/<chain>.json only after checking the broadcast receipts and that code exists on-chain, and only
    //    it can set "kind": "mainnet broadcast", "mainnet": true (for chain ids in config/mainnet-chain-ids.json).
    //  * --broadcast on a non-Anvil node without RUN_KIND=broadcast reverts before anything is deployed.
    //  * A record with "mainnet": true is never overwritten (fork runs: never; pending runs: only with the explicit
    //    env OVERWRITE_MAINNET_RECORD=true).

    enum RecordAction {
        None, // no RUN_KIND: no record
        Fork, // Anvil: write deployments/<chain>.json (fork)
        SimulationOnly, // RUN_KIND=broadcast on a live node without --broadcast: no record
        PendingBroadcast // RUN_KIND=broadcast + --broadcast on a live node: write deployments/<chain>.pending.json
    }

    /// @dev Pure decision table (unit-tested). Reverts on inconsistent combinations.
    function decideRecordAction(string memory _runKind, bool _anvil, bool _broadcasting)
        internal
        pure
        returns (RecordAction)
    {
        if (bytes(_runKind).length == 0) {
            require(
                _anvil || !_broadcasting, "DeployCore: --broadcast on a non-Anvil node requires RUN_KIND=broadcast"
            );
            return RecordAction.None;
        }
        bool isBroadcast = keccak256(bytes(_runKind)) == keccak256("broadcast");
        require(
            isBroadcast || keccak256(bytes(_runKind)) == keccak256("fork"), "DeployCore: RUN_KIND must be fork|broadcast"
        );
        require(_anvil != isBroadcast, "DeployCore: RUN_KIND=fork needs an Anvil node; broadcast must not be one");
        if (!isBroadcast) return RecordAction.Fork;
        return _broadcasting ? RecordAction.PendingBroadcast : RecordAction.SimulationOnly;
    }

    function preflight(string memory _chain) internal {
        RecordAction action = decideRecordAction(_runKind(), _isAnvil(), _isBroadcasting());
        if (action == RecordAction.Fork) {
            requireNoMainnetRecord(_chain);
        } else if (action == RecordAction.PendingBroadcast && !_overwriteMainnetRecord()) {
            requireNoMainnetRecord(_chain);
        }
    }

    function requireNoMainnetRecord(string memory _chain) internal {
        require(
            !_recordIsMainnet(string.concat("deployments/", _chain, ".json")),
            "DeployCore: deployments/<chain>.json is a mainnet record and will not be overwritten"
        );
    }

    /// @dev Chain ids whose deployments may be labelled "mainnet broadcast" (by script/finalize-broadcast.sh).
    /// HyperEVM (999) will be added to config/mainnet-chain-ids.json later.
    function isKnownMainnet(uint256 _chainId) internal returns (bool) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/config/mainnet-chain-ids.json"));
        uint256[] memory ids = vm.parseJsonUintArray(json, ".mainnetChainIds");
        for (uint256 i; i < ids.length; i++) {
            if (ids[i] == _chainId) return true;
        }
        return false;
    }

    function writeDeployment(Cfg memory _c, Persistent memory _p, Release memory _r, Adapters memory _a) internal {
        string memory runKind = _runKind();
        bool broadcasting = _isBroadcasting();
        RecordAction action = decideRecordAction(runKind, _isAnvil(), broadcasting);
        if (action == RecordAction.None) {
            console2.log("RUN_KIND not set: no deployment record written");
            return;
        }
        if (action == RecordAction.SimulationOnly) {
            console2.log("Simulation on a live node (no --broadcast): no deployment record written");
            return;
        }
        bool pending = action == RecordAction.PendingBroadcast;
        if (pending) {
            if (!_overwriteMainnetRecord()) requireNoMainnetRecord(_c.chain);
        } else {
            requireNoMainnetRecord(_c.chain);
        }
        string memory path = string.concat("deployments/", _c.chain, pending ? ".pending.json" : ".json");

        string memory addrJson = _addressesJson(_p, _r, _a);
        string memory denomJson = _denominationJson(_c);

        string memory o = "deployment";
        if (pending) {
            // Never mainnet: true here. The finalizer sets the real kind after checking receipts + on-chain code.
            vm.serializeString(
                o,
                "kind",
                isKnownMainnet(block.chainid)
                    ? "mainnet broadcast (PENDING receipt confirmation)"
                    : "testnet or unknown network (PENDING receipt confirmation)"
            );
            vm.serializeBool(o, "mainnet", false);
            vm.serializeString(
                o,
                "label",
                "UNCONFIRMED: simulated addresses, not yet verified on-chain. Run script/finalize-broadcast.sh after the broadcast."
            );
            vm.serializeBool(o, "pendingBroadcast", true);
            vm.serializeBool(o, "simulated", true);
        } else {
            vm.serializeString(o, "kind", "fork, not mainnet");
            vm.serializeBool(o, "mainnet", false);
            vm.serializeString(
                o,
                "label",
                "ANVIL FORK RUN - NOT A MAINNET DEPLOYMENT. Addresses exist only on a throwaway local fork."
            );
            // true: forge script ran as a simulation against the fork; false: the txs were broadcast to the local Anvil
            vm.serializeBool(o, "simulated", !broadcasting);
        }
        vm.serializeString(o, "runKind", runKind);
        vm.serializeString(o, "chain", _c.chain);
        vm.serializeUint(o, "chainId", block.chainid);
        // Chain-native block number (eth_blockNumber). `block.number` inside the EVM is the L1 block number on
        // Arbitrum-stack chains (Arbitrum, Robinhood), so both are recorded; forkBlock is also chain-native.
        vm.serializeUint(o, "blockNumberAtDeploy", _chainBlockNumber());
        vm.serializeUint(o, "evmBlockNumberAtDeploy", block.number);
        vm.serializeString(
            o,
            "blockNumberNote",
            "blockNumberAtDeploy and forkBlock are chain-native block numbers (eth_blockNumber; L2 blocks on arbitrum/robinhood). evmBlockNumberAtDeploy is block.number as seen inside the EVM (the L1 block number on arbitrum/robinhood)."
        );
        vm.serializeUint(o, "forkBlock", vm.envOr("FORK_BLOCK", uint256(0)));
        vm.serializeUint(o, "blockTimestampAtDeploy", block.timestamp);
        vm.serializeAddress(o, "deployer", msg.sender);
        vm.serializeUint(o, "chainlinkStaleRateThresholdSeconds", _c.staleRateThreshold);
        vm.serializeString(o, "scriptCommit", vm.envOr("GIT_SHA", string("unknown")));
        vm.serializeString(o, "scriptTreeDirty", vm.envOr("GIT_DIRTY", string("unknown")));
        vm.serializeString(o, "configSha256", vm.envOr("CONFIG_SHA256", string("unknown")));
        vm.serializeString(o, "denominationAsset", denomJson);
        if (_a.listCreated) {
            vm.serializeUint(o, "approvedAdaptersListId", _a.approvedAdaptersListId);
        }
        _serializeBigBlocks(o, _c, pending);
        string memory out = vm.serializeString(o, "addresses", addrJson);
        _writeRecord(path, out);
        console2.log("wrote", path);
    }

    /// @dev HyperEVM-style dual-block chains: records (additively, only when config.deployment.bigBlocksRequired) the block gas
    /// limit of the run. Fork records also get `bigBlocksEmulated`: true iff that limit is at least 30M, i.e. the limit of a
    /// HyperEVM big block. A local Anvil fork cannot ENFORCE the 3M small-block cap or route transactions into big blocks; it
    /// can only run with a 30M block gas limit, hence "emulated". Pending (real broadcast) records get NO boolean: the script
    /// cannot verify that the deployer has big blocks enabled, so it only records the simulation gas limit and the note.
    uint256 internal constant BIG_BLOCK_GAS_LIMIT = 30_000_000;

    function _serializeBigBlocks(string memory _o, Cfg memory _c, bool _pending) internal {
        if (!_c.bigBlocksRequired) return;
        uint256 gasLimit = _blockGasLimit();
        if (!_pending) vm.serializeBool(_o, "bigBlocksEmulated", gasLimit >= BIG_BLOCK_GAS_LIMIT);
        vm.serializeUint(_o, "blockGasLimit", gasLimit);
        vm.serializeString(
            _o,
            "bigBlocksNote",
            _pending
                ? "Simulation block gas limit shown. The deployer must have HyperEVM big blocks enabled (L1 action evmUserModify usingBigBlocks=true) when broadcasting: ComptrollerLib/VaultLib/FundDeployer exceed the 3M small-block gas limit. This script cannot verify that; script/finalize-broadcast.sh checks receipts only."
                : "A local Anvil fork cannot enforce HyperEVM's 3M small-block gas cap; this run used the block gas limit shown (>= 30M means big-block conditions were emulated). ComptrollerLib/VaultLib/FundDeployer exceed 3M gas, so a real deployment needs the deployer to enable big blocks (L1 action evmUserModify usingBigBlocks=true)."
        );
    }

    function _addressesJson(Persistent memory _p, Release memory _r, Adapters memory _a)
        internal
        returns (string memory)
    {
        string memory a = "addresses";
        vm.serializeAddress(a, "dispatcher", _p.dispatcher);
        vm.serializeAddress(a, "addressListRegistry", _p.addressListRegistry);
        vm.serializeAddress(a, "externalPositionFactory", _p.externalPositionFactory);
        vm.serializeAddress(a, "globalConfigProxy", _p.globalConfigProxy);
        vm.serializeAddress(a, "protocolFeeReserveProxy", _p.protocolFeeReserveProxy);
        vm.serializeAddress(a, "uintListRegistry", _p.uintListRegistry);
        vm.serializeAddress(a, "fundValueCalculatorRouter", _p.fundValueCalculatorRouter);
        vm.serializeAddress(a, "gasRelayPaymasterFactory", _r.gasRelayPaymasterFactory);
        vm.serializeAddress(a, "fundDeployer", _r.fundDeployer);
        vm.serializeAddress(a, "protocolFeeTracker", _r.protocolFeeTracker);
        vm.serializeAddress(a, "valueInterpreter", _r.valueInterpreter);
        vm.serializeAddress(a, "policyManager", _r.policyManager);
        vm.serializeAddress(a, "externalPositionManager", _r.externalPositionManager);
        vm.serializeAddress(a, "feeManager", _r.feeManager);
        vm.serializeAddress(a, "integrationManager", _r.integrationManager);
        vm.serializeAddress(a, "comptrollerLib", _r.comptrollerLib);
        vm.serializeAddress(a, "vaultLib", _r.vaultLib);
        string memory out = vm.serializeAddress(a, "fundValueCalculator", _r.fundValueCalculator);
        if (_a.uniswapV3Adapter != address(0)) {
            out = vm.serializeAddress(a, "uniswapV3Adapter", _a.uniswapV3Adapter);
        }
        if (_a.uniswapV3SwapRouter02Adapter != address(0)) {
            out = vm.serializeAddress(a, "uniswapV3SwapRouter02Adapter", _a.uniswapV3SwapRouter02Adapter);
        }
        if (_a.paraSwapV6Adapter != address(0)) {
            out = vm.serializeAddress(a, "paraSwapV6Adapter", _a.paraSwapV6Adapter);
        }
        return out;
    }

    function _denominationJson(Cfg memory _c) internal returns (string memory) {
        string memory d = "denomination";
        vm.serializeString(d, "symbol", _c.denominationSymbol);
        return vm.serializeAddress(d, "address", _c.denominationAsset);
    }

    // Overridable environment hooks (the unit tests replace them; production behaviour is the default below)

    function _runKind() internal virtual returns (string memory) {
        return vm.envOr("RUN_KIND", string(""));
    }

    function _overwriteMainnetRecord() internal virtual returns (bool) {
        return vm.envOr("OVERWRITE_MAINNET_RECORD", false);
    }

    function _writeRecord(string memory _path, string memory _json) internal virtual {
        vm.writeJson(_json, _path);
    }

    function _recordIsMainnet(string memory _path) internal virtual returns (bool) {
        try vm.fsMetadata(_path) returns (VmSafe.FsMetadata memory) {}
        catch {
            return false; // no such file
        }
        string memory json = vm.readFile(_path); // a read failure reverts: fail closed
        if (!VmKeyExists(address(vm)).keyExistsJson(json, ".mainnet")) return false;
        return vm.parseJsonBool(json, ".mainnet");
    }

    /// @dev True for `forge script --broadcast` (and --resume): the transactions will really be sent.
    function _isBroadcasting() internal virtual returns (bool) {
        return VmContext(address(vm)).isContext(6) || VmContext(address(vm)).isContext(7);
    }

    function _blockGasLimit() internal virtual returns (uint256) {
        return block.gaslimit;
    }

    /// @dev True iff the RPC answers Anvil's `anvil_nodeInfo`. Real nodes reject it.
    function _isAnvil() internal virtual returns (bool) {
        try VmRpc(address(vm)).rpc("anvil_nodeInfo", "[]") returns (bytes memory) {
            return true;
        } catch {
            return false;
        }
    }

    /// @dev Chain-native block number via eth_blockNumber (vm.rpc returns the big-endian bytes of the quantity).
    function _chainBlockNumber() internal virtual returns (uint256 n_) {
        bytes memory r = VmRpc(address(vm)).rpc("eth_blockNumber", "[]");
        for (uint256 i; i < r.length; i++) {
            n_ = (n_ << 8) | uint8(r[i]);
        }
    }

    function upper(string memory _s) internal pure returns (string memory) {
        bytes memory b = bytes(_s);
        for (uint256 i; i < b.length; i++) {
            if (b[i] >= 0x61 && b[i] <= 0x7a) b[i] = bytes1(uint8(b[i]) - 32);
        }
        return string(b);
    }

    // CONFIG

    function loadConfig(string memory _chain) internal returns (Cfg memory c_) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/config/chains/", _chain, ".json"));
        require(vm.parseJsonUint(json, ".chainId") == block.chainid, "DeployCore: config chainId != RPC chainid");

        c_.chain = _chain;
        c_.weth = vm.parseJsonAddress(json, ".tokens.weth.address");
        c_.wrappedNative = c_.weth; // all four chains use ETH as the gas token
        c_.staleRateThreshold = vm.parseJsonUint(json, ".release.chainlinkStaleRateThresholdSeconds");
        c_.denominationSymbol = upper(vm.parseJsonString(json, ".denominationAsset"));
        c_.denominationAsset = vm.parseJsonAddress(
            json, string.concat(".tokens.", vm.parseJsonString(json, ".denominationAsset"), ".address")
        );
        c_.positionsLimit = vm.parseJsonUint(json, ".release.vaultPositionsLimit");
        c_.ethUsdAggregator = vm.parseJsonAddress(json, ".chainlink.ethUsdAggregator.address");
        c_.mlnBurner = vm.envOr("MLN_BURNER", address(0));
        if (VmKeyExists(address(vm)).keyExistsJson(json, ".deployment.bigBlocksRequired")) {
            c_.bigBlocksRequired = vm.parseJsonBool(json, ".deployment.bigBlocksRequired");
        }

        // MLN is only read when the buyback feature is on; otherwise address(0) (TODO on that chain)
        if (vm.parseJsonBool(json, ".features.protocolFeeBuyback")) {
            c_.mln = vm.parseJsonAddress(json, ".tokens.mln.address");
        }

        c_.gasRelayDepositCooldown = vm.parseJsonUint(json, ".release.gasRelay.depositCooldown");
        c_.gasRelayDepositMaxTotal = vm.parseJsonUint(json, ".release.gasRelay.depositMaxTotal");
        c_.gasRelayFeeMaxPercent = vm.parseJsonUint(json, ".release.gasRelay.feeMaxPercent");
        c_.gasRelayRelayFeeMaxBase = vm.parseJsonUint(json, ".release.gasRelay.relayFeeMaxBase");
        if (vm.parseJsonBool(json, ".features.gasRelay")) {
            c_.gasRelayHub = vm.parseJsonAddress(json, ".release.gasRelay.relayHub");
            c_.gasRelayForwarder = vm.parseJsonAddress(json, ".release.gasRelay.trustedForwarder");
        }

        // Adapters (swaps only): the feature flag AND the router address must be present; Robinhood stays Phase 1 (none)
        if (featureOn(json, "uniswapV3Adapter")) {
            c_.uniswapV3Router = vm.parseJsonAddress(json, ".routers.uniswapV3SwapRouter.address");
        }
        if (featureOn(json, "uniswapV3SwapRouter02Adapter")) {
            c_.uniswapV3SwapRouter02 = vm.parseJsonAddress(json, ".routers.uniswapV3SwapRouter02.address");
        }
        if (featureOn(json, "paraSwapV6Adapter")) {
            c_.paraSwapAugustusV6 = vm.parseJsonAddress(json, ".routers.paraSwapAugustusV6.address");
        }

        // Indexed reads (wildcard array parsing is unreliable for single-element arrays)
        uint256 n;
        while (VmKeyExists(address(vm)).keyExistsJson(json, string.concat(".chainlink.primitives[", vm.toString(n), "]"))) {
            n++;
        }
        c_.primitives = new address[](n);
        c_.aggregators = new address[](n);
        c_.rateAssets = new uint8[](n);
        for (uint256 i; i < n; i++) {
            string memory k = string.concat(".chainlink.primitives[", vm.toString(i), "]");
            c_.primitives[i] = vm.parseJsonAddress(json, string.concat(k, ".token"));
            c_.aggregators[i] = vm.parseJsonAddress(json, string.concat(k, ".aggregator"));
            bytes32 h = keccak256(bytes(vm.parseJsonString(json, string.concat(k, ".rateAsset"))));
            if (h == keccak256("ETH")) {
                c_.rateAssets[i] = 0;
            } else if (h == keccak256("USD")) {
                c_.rateAssets[i] = 1;
            } else {
                revert("DeployCore: unknown rateAsset");
            }
        }
    }

    /// @dev `features.<name>`; a missing key counts as false
    function featureOn(string memory _json, string memory _name) internal returns (bool) {
        string memory k = string.concat(".features.", _name);
        return VmKeyExists(address(vm)).keyExistsJson(_json, k) && vm.parseJsonBool(_json, k);
    }

    // PERSISTENT (order mirrors DeploymentUtils.deployPersistentCore)

    function deployPersistent() internal returns (Persistent memory p_) {
        p_.dispatcher = deployCode("Dispatcher.sol");
        p_.addressListRegistry = deployCode("AddressListRegistry.sol", abi.encode(p_.dispatcher));
        p_.externalPositionFactory = deployCode("ExternalPositionFactory.sol", abi.encode(p_.dispatcher));

        // GlobalConfigLib must later be redeployed with the v4 FundDeployer address
        address globalConfigLib0 = deployCode("GlobalConfigLib.sol", abi.encode(address(0)));
        p_.globalConfigProxy = deployCode(
            "GlobalConfigProxy.sol",
            abi.encode(abi.encodeWithSignature("init(address)", p_.dispatcher), globalConfigLib0)
        );

        address protocolFeeReserveLib = deployCode("ProtocolFeeReserveLib.sol");
        p_.protocolFeeReserveProxy = deployCode(
            "ProtocolFeeReserveProxy.sol",
            abi.encode(abi.encodeWithSignature("init(address)", p_.dispatcher), protocolFeeReserveLib)
        );

        p_.uintListRegistry = deployCode("UintListRegistry.sol", abi.encode(p_.dispatcher));
        p_.fundValueCalculatorRouter = deployCode(
            "FundValueCalculatorRouter.sol", abi.encode(p_.dispatcher, new address[](0), new address[](0))
        );
    }

    // RELEASE (order mirrors DeploymentUtils.deployReleaseCoreContractsOnly)

    function deployRelease(Cfg memory _c, Persistent memory _p) internal returns (Release memory r_) {
        {
            address gasRelayPaymasterLib = deployCode(
                "GasRelayPaymasterLib.sol",
                abi.encode(
                    _c.wrappedNative,
                    _c.gasRelayHub,
                    _c.gasRelayForwarder,
                    _c.gasRelayDepositCooldown,
                    _c.gasRelayDepositMaxTotal,
                    _c.gasRelayRelayFeeMaxBase,
                    _c.gasRelayFeeMaxPercent
                )
            );
            r_.gasRelayPaymasterFactory =
                deployCode("GasRelayPaymasterFactory.sol", abi.encode(_p.dispatcher, gasRelayPaymasterLib));
        }

        r_.fundDeployer = deployCode("FundDeployer.sol", abi.encode(_p.dispatcher, r_.gasRelayPaymasterFactory));
        r_.protocolFeeTracker = deployCode("ProtocolFeeTracker.sol", abi.encode(r_.fundDeployer));
        r_.valueInterpreter =
            deployCode("ValueInterpreter.sol", abi.encode(r_.fundDeployer, _c.weth, _c.staleRateThreshold));
        r_.policyManager = deployCode("PolicyManager.sol", abi.encode(r_.fundDeployer, r_.gasRelayPaymasterFactory));
        r_.externalPositionManager = deployCode(
            "ExternalPositionManager.sol", abi.encode(r_.fundDeployer, _p.externalPositionFactory, r_.policyManager)
        );
        r_.feeManager = deployCode("FeeManager.sol", abi.encode(r_.fundDeployer));
        r_.integrationManager =
            deployCode("IntegrationManager.sol", abi.encode(r_.fundDeployer, r_.policyManager, r_.valueInterpreter));

        r_.comptrollerLib = deployCode(
            "ComptrollerLib.sol",
            abi.encode(
                _p.dispatcher,
                _p.protocolFeeReserveProxy,
                r_.fundDeployer,
                r_.valueInterpreter,
                r_.externalPositionManager,
                r_.feeManager,
                r_.integrationManager,
                r_.policyManager,
                r_.gasRelayPaymasterFactory,
                _c.mln,
                _c.wrappedNative
            )
        );

        r_.vaultLib = deployCode(
            "VaultLib.sol",
            abi.encode(
                r_.externalPositionManager,
                r_.gasRelayPaymasterFactory,
                _p.protocolFeeReserveProxy,
                r_.protocolFeeTracker,
                _c.mln,
                _c.mlnBurner,
                _c.wrappedNative,
                _c.positionsLimit
            )
        );

        r_.fundValueCalculator = deployCode(
            "FundValueCalculator.sol", abi.encode(r_.feeManager, r_.protocolFeeTracker, r_.valueInterpreter)
        );
    }

    // POST-DEPLOYMENT (mirrors DeploymentUtils.deployReleaseCore; broadcaster is Dispatcher owner + FundDeployer creator)

    function postDeploy(Cfg memory _c, Persistent memory _p, Release memory _r) internal {
        address globalConfigLib = deployCode("GlobalConfigLib.sol", abi.encode(_r.fundDeployer));
        IGlobalConfigProxyDeploy(_p.globalConfigProxy).setGlobalConfigLib(globalConfigLib);

        address[] memory positionDeployers = new address[](1);
        positionDeployers[0] = _r.externalPositionManager;
        IExternalPositionFactoryDeploy(_p.externalPositionFactory).addPositionDeployers(positionDeployers);

        IFundDeployerDeploy(_r.fundDeployer).setProtocolFeeTracker(_r.protocolFeeTracker);
        IFundDeployerDeploy(_r.fundDeployer).setComptrollerLib(_r.comptrollerLib);
        IFundDeployerDeploy(_r.fundDeployer).setVaultLib(_r.vaultLib);

        address[] memory fundDeployers = new address[](1);
        fundDeployers[0] = _r.fundDeployer;
        address[] memory calculators = new address[](1);
        calculators[0] = _r.fundValueCalculator;
        IFundValueCalculatorRouterDeploy(_p.fundValueCalculatorRouter).setFundValueCalculators(
            fundDeployers, calculators
        );

        // Price feeds must be set BEFORE setReleaseLive (FundDeployer owner is the creator until then)
        IValueInterpreterDeploy vi = IValueInterpreterDeploy(_r.valueInterpreter);
        if (_c.ethUsdAggregator != address(0)) {
            vi.setEthUsdAggregator(_c.ethUsdAggregator);
        }
        if (_c.primitives.length > 0) {
            vi.addPrimitives(_c.primitives, _c.aggregators, _c.rateAssets);
        }

        IFundDeployerDeploy(_r.fundDeployer).setReleaseLive();
        IDispatcherDeploy(_p.dispatcher).setCurrentFundDeployer(_r.fundDeployer);
    }

    // CHECKS (reads against simulated state in a dry run)

    function sanityCheck(Cfg memory _c, Persistent memory _p, Release memory _r) internal view {
        require(IFundDeployerDeploy(_r.fundDeployer).releaseIsLive(), "DeployCore: release not live");
        require(
            IDispatcherDeploy(_p.dispatcher).getCurrentFundDeployer() == _r.fundDeployer,
            "DeployCore: currentFundDeployer not set"
        );
        // WETH -> first registered primitive must price without reverting (also proves feeds are fresh enough)
        if (_c.primitives.length > 0 && _c.ethUsdAggregator != address(0)) {
            uint256 value = IValueInterpreterDeploy(_r.valueInterpreter)
                .calcCanonicalAssetValue(_c.weth, 1 ether, _c.primitives[0]);
            console2.log("1 WETH in first primitive (raw units):", value);
            require(value > 0, "DeployCore: zero price");
        }
    }

    function logAddresses(Cfg memory _c, Persistent memory _p, Release memory _r, Adapters memory _a) internal view {
        console2.log("== DeployCore:", _c.chain, "chainid", block.chainid);
        console2.log("dispatcher", _p.dispatcher);
        console2.log("addressListRegistry", _p.addressListRegistry);
        console2.log("externalPositionFactory", _p.externalPositionFactory);
        console2.log("globalConfigProxy", _p.globalConfigProxy);
        console2.log("protocolFeeReserveProxy", _p.protocolFeeReserveProxy);
        console2.log("uintListRegistry", _p.uintListRegistry);
        console2.log("fundValueCalculatorRouter", _p.fundValueCalculatorRouter);
        console2.log("gasRelayPaymasterFactory", _r.gasRelayPaymasterFactory);
        console2.log("fundDeployer", _r.fundDeployer);
        console2.log("protocolFeeTracker", _r.protocolFeeTracker);
        console2.log("valueInterpreter", _r.valueInterpreter);
        console2.log("policyManager", _r.policyManager);
        console2.log("externalPositionManager", _r.externalPositionManager);
        console2.log("feeManager", _r.feeManager);
        console2.log("integrationManager", _r.integrationManager);
        console2.log("comptrollerLib", _r.comptrollerLib);
        console2.log("vaultLib", _r.vaultLib);
        console2.log("fundValueCalculator", _r.fundValueCalculator);
        console2.log("uniswapV3Adapter", _a.uniswapV3Adapter);
        console2.log("uniswapV3SwapRouter02Adapter", _a.uniswapV3SwapRouter02Adapter);
        console2.log("paraSwapV6Adapter", _a.paraSwapV6Adapter);
        if (_a.listCreated) {
            console2.log("approvedAdaptersListId", _a.approvedAdaptersListId);
        }
    }

    // ADAPTERS

    function deployAdapters(Cfg memory _c, Persistent memory _p, Release memory _r) internal returns (Adapters memory a_) {
        uint256 n;
        address[] memory items = new address[](3);

        if (_c.uniswapV3Router != address(0)) {
            a_.uniswapV3Adapter = deployCode("UniswapV3Adapter.sol", abi.encode(_r.integrationManager, _c.uniswapV3Router));
            items[n++] = a_.uniswapV3Adapter;
        }
        if (_c.uniswapV3SwapRouter02 != address(0)) {
            a_.uniswapV3SwapRouter02Adapter =
                deployCode("UniswapV3SwapRouter02Adapter.sol", abi.encode(_r.integrationManager, _c.uniswapV3SwapRouter02));
            items[n++] = a_.uniswapV3SwapRouter02Adapter;
        }
        if (_c.paraSwapAugustusV6 != address(0)) {
            a_.paraSwapV6Adapter =
                deployCode("ParaSwapV6Adapter.sol", abi.encode(_r.integrationManager, _c.paraSwapAugustusV6));
            items[n++] = a_.paraSwapV6Adapter;
        }

        if (n > 0) {
            address[] memory deployed = new address[](n);
            for (uint256 i; i < n; i++) {
                deployed[i] = items[i];
            }
            // UpdateType.None (0): the list is immutable; owner = Dispatcher (not the deployer)
            a_.approvedAdaptersListId =
                IAddressListRegistryDeploy(_p.addressListRegistry).createList(_p.dispatcher, 0, deployed);
            a_.listCreated = true;
        }
    }

    function sanityCheckAdapters(Cfg memory _c, Persistent memory _p, Release memory _r, Adapters memory _a)
        internal
        view
    {
        address[3] memory adapters = [_a.uniswapV3Adapter, _a.uniswapV3SwapRouter02Adapter, _a.paraSwapV6Adapter];
        address[3] memory targets = [_c.uniswapV3Router, _c.uniswapV3SwapRouter02, _c.paraSwapAugustusV6];
        for (uint256 i; i < 3; i++) {
            require((adapters[i] != address(0)) == (targets[i] != address(0)), "DeployCore: adapter/target mismatch");
            if (adapters[i] == address(0)) continue;
            require(targets[i].code.length > 0, "DeployCore: adapter target has no code");
            require(
                IAdapterDeploy(adapters[i]).getIntegrationManager() == _r.integrationManager,
                "DeployCore: adapter not bound to IntegrationManager"
            );
            require(
                IAddressListRegistryDeploy(_p.addressListRegistry).isInList(_a.approvedAdaptersListId, adapters[i]),
                "DeployCore: adapter not in approved list"
            );
        }
    }
}
