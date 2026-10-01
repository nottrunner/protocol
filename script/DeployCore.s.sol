// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

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
        uint256 positionsLimit;
        address gasRelayHub;
        address gasRelayForwarder;
        uint256 gasRelayDepositCooldown;
        uint256 gasRelayDepositMaxTotal;
        uint256 gasRelayFeeMaxPercent;
        uint256 gasRelayRelayFeeMaxBase;
        address[] primitives;
        address[] aggregators;
        uint8[] rateAssets;
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

    function run() external returns (Persistent memory p_, Release memory r_) {
        Cfg memory c = loadConfig(vm.envString("CHAIN"));

        vm.startBroadcast();
        p_ = deployPersistent();
        r_ = deployRelease(c, p_);
        postDeploy(c, p_, r_);
        address nextOwner = vm.envOr("DISPATCHER_OWNER", address(0));
        if (nextOwner != address(0)) {
            IOwned(p_.dispatcher).setNominatedOwner(nextOwner);
        }
        vm.stopBroadcast();

        sanityCheck(c, p_, r_);
        logAddresses(c, p_, r_);
    }

    // CONFIG

    function loadConfig(string memory _chain) internal returns (Cfg memory c_) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/config/chains/", _chain, ".json"));
        require(vm.parseJsonUint(json, ".chainId") == block.chainid, "DeployCore: config chainId != RPC chainid");

        c_.chain = _chain;
        c_.weth = vm.parseJsonAddress(json, ".tokens.weth.address");
        c_.wrappedNative = c_.weth; // all four chains use ETH as the gas token
        c_.staleRateThreshold = vm.parseJsonUint(json, ".release.chainlinkStaleRateThresholdSeconds");
        c_.positionsLimit = vm.parseJsonUint(json, ".release.vaultPositionsLimit");
        c_.ethUsdAggregator = vm.parseJsonAddress(json, ".chainlink.ethUsdAggregator.address");
        c_.mlnBurner = vm.envOr("MLN_BURNER", address(0));

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

    function logAddresses(Cfg memory _c, Persistent memory _p, Release memory _r) internal view {
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
    }
}
